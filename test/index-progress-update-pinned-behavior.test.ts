import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import register from "../src/index.js";

// mock FeishuCardPusher，避免真实请求
const sendCardMock = vi.fn(async () => "msg-123");
const updateCardMock = vi.fn(async () => {});

vi.mock("../src/feishu/FeishuCardPusher.js", () => {
  return {
    FeishuCardPusher: vi.fn().mockImplementation(() => ({
      sendCard: sendCardMock,
      updateCard: updateCardMock,
    })),
  };
});

// mock renderer，避免关心卡片细节
vi.mock("../src/feishu/FeishuCardRenderer.js", () => {
  return {
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
  };
});

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
        label: "开始处理",
        stage: "start",
        status: "running",
      },
      { conversation: { id: "conv-1" } }
    );

    expect(result.content).toHaveLength(1);
    expect(result.content[0].text).toContain("开始处理");
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

    // 先创建任务
    await updateTool.execute(
      "1",
      {
        taskId: "test-progress-1",
        label: "开始处理",
        stage: "start",
        status: "running",
      },
      ctx
    );

    // 再 pin 成飞书卡片
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

    // 再次更新同一 task，应该只 refresh 卡片，不返回完整普通文本
    const result = await updateTool.execute(
      "3",
      {
        taskId: "test-progress-1",
        label: "测试更新",
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
        label: "开始处理",
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
        label: "测试更新",
        stage: "research",
        status: "running",
        percent: 80,
      },
      ctx
    );

    expect(result.content).toHaveLength(1);
    expect(result.content[0].text).toContain("测试更新");
    expect(result.metadata.pinned).toBe(true);
    expect(result.metadata.refreshed).toBe(false);
  });

  it("refreshes pinned parent card when a child task updates", async () => {
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

  // Note: Schedule tests disabled - requires mocking autoProgress
});
