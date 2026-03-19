import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import register from "../src/index.js";

const sendCardMock = vi.fn(async () => "msg-123");
const updateCardMock = vi.fn(async () => {});
const sendTextMock = vi.fn(async () => "alert-123");

vi.mock("../src/feishu/FeishuCardPusher.js", () => ({
  FeishuCardPusher: vi.fn().mockImplementation(() => ({
    sendCard: sendCardMock,
    updateCard: updateCardMock,
    sendText: sendTextMock,
  })),
}));

vi.mock("../src/feishu/FeishuCardRenderer.js", () => ({
  FeishuCardRenderer: vi.fn().mockImplementation(() => ({
    renderTaskCard: vi.fn(() => ({
      card: {
        schema: "2.0",
        header: {
          title: { content: "Workflow Progress" },
        },
        body: { elements: [] },
      },
    })),
  })),
}));

function createMockApi(config: Record<string, any> = {}) {
  const tools: any[] = [];
  const hooks = new Map<string, Function>();

  return {
    logger: {
      info: vi.fn(),
    },
    config,
    registerTool: vi.fn((tool) => {
      tools.push(tool);
    }),
    registerHook: vi.fn((name, fn) => {
      hooks.set(name, fn);
    }),
    _tools: tools,
    _hooks: hooks,
  };
}

describe("progress_update pinned card behavior", () => {
  beforeEach(() => {
    sendCardMock.mockClear();
    updateCardMock.mockClear();
    sendTextMock.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns normal progress text when task is not pinned", async () => {
    const api = createMockApi({
      injectPromptContext: false,
      feishuAppId: "app-id",
      feishuAppSecret: "app-secret",
      persistenceMode: "memory",
    });

    register(api);

    const updateTool = api._tools.find((t: any) => t.name === "progress_update");

    const result = await updateTool.execute(
      "1",
      {
        taskId: "paper-1",
        label: "Start processing",
        stage: "start",
        status: "running",
      },
      { conversation: { id: "conv-1" } }
    );

    expect(result.content).toHaveLength(1);
    expect(result.content[0].text).toContain("Start processing");
    expect(result.metadata.pinned).toBe(false);
  });

  it("suppresses normal progress text when task is pinned and refresh succeeds", async () => {
    const api = createMockApi({
      injectPromptContext: false,
      feishuAppId: "app-id",
      feishuAppSecret: "app-secret",
      persistenceMode: "memory",
    });

    register(api);

    const updateTool = api._tools.find((t: any) => t.name === "progress_update");
    const pinTool = api._tools.find((t: any) => t.name === "progress_pin_card");
    const ctx = { conversation: { id: "conv-1" } };

    await updateTool.execute(
      "1",
      {
        taskId: "test-progress-1",
        label: "Start processing",
        stage: "start",
        status: "running",
      },
      ctx
    );

    await pinTool.execute(
      "2",
      {
        taskId: "test-progress-1",
        receiveId: "chat-1",
        receiveIdType: "chat_id",
        showSummary: true,
      },
      ctx
    );

    const result = await updateTool.execute(
      "3",
      {
        taskId: "test-progress-1",
        label: "Updated",
        stage: "research",
        status: "running",
        percent: 80,
      },
      ctx
    );

    expect(updateCardMock).toHaveBeenCalled();
    expect(result.content).toEqual([]);
    expect(result.metadata.pinned).toBe(true);
    expect(result.metadata.refreshed).toBe(true);
    expect(result.metadata.messageId).toBe("msg-123");
  });

  it("falls back to normal progress text when task is pinned but refresh fails", async () => {
    updateCardMock.mockImplementationOnce(async () => {
      throw new Error("refresh failed");
    });

    const api = createMockApi({
      injectPromptContext: false,
      feishuAppId: "app-id",
      feishuAppSecret: "app-secret",
      persistenceMode: "memory",
    });

    register(api);

    const updateTool = api._tools.find((t: any) => t.name === "progress_update");
    const pinTool = api._tools.find((t: any) => t.name === "progress_pin_card");
    const ctx = { conversation: { id: "conv-1" } };

    await updateTool.execute(
      "1",
      {
        taskId: "test-progress-1",
        label: "Start processing",
        stage: "start",
        status: "running",
      },
      ctx
    );

    await pinTool.execute(
      "2",
      {
        taskId: "test-progress-1",
        receiveId: "chat-1",
        receiveIdType: "chat_id",
        showSummary: true,
      },
      ctx
    );

    const result = await updateTool.execute(
      "3",
      {
        taskId: "test-progress-1",
        label: "Updated",
        stage: "research",
        status: "running",
        percent: 80,
      },
      ctx
    );

    expect(result.content).toHaveLength(1);
    expect(result.content[0].text).toContain("Updated");
    expect(result.metadata.pinned).toBe(true);
    expect(result.metadata.refreshed).toBe(false);
  });

  it("refreshes a pinned parent card when a child task updates", async () => {
    const api = createMockApi({
      injectPromptContext: false,
      feishuAppId: "app-id",
      feishuAppSecret: "app-secret",
      persistenceMode: "memory",
    });

    register(api);

    const updateTool = api._tools.find((t: any) => t.name === "progress_update");
    const pinTool = api._tools.find((t: any) => t.name === "progress_pin_card");
    const getTool = api._tools.find((t: any) => t.name === "progress_get");
    const ctx = { conversation: { id: "conv-1" } };

    await updateTool.execute(
      "1",
      {
        taskId: "root-task",
        label: "Parent task",
        stage: "start",
        status: "running",
      },
      ctx
    );

    await pinTool.execute(
      "2",
      {
        taskId: "root-task",
        receiveId: "chat-1",
        receiveIdType: "chat_id",
        showSummary: true,
      },
      ctx
    );

    updateCardMock.mockClear();

    await updateTool.execute(
      "3",
      {
        taskId: "child-task",
        parentTaskId: "root-task",
        label: "Child task",
        stage: "done",
        status: "done",
      },
      ctx
    );

    const root = await getTool.execute("4", { taskId: "root-task" }, ctx);

    expect(updateCardMock).toHaveBeenCalled();
    expect(root.content[0].text).toContain("100%");
  });
});
