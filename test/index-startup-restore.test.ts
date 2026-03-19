import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import register from "../src/index.js";
import { ProgressManager } from "../src/ProgressManager.js";
import { AutoProgressService } from "../src/scheduler/AutoProgressService.js";
import { TaskScheduler } from "../src/scheduler/TaskScheduler.js";
import { FileFeishuPinnedCardAdapter } from "../src/feishu/persistence/FileFeishuPinnedCardAdapter.js";
import { FileAdapter } from "../src/persistence/FileAdapter.js";

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
    logger: { info: vi.fn() },
    config,
    registerTool: vi.fn((tool) => tools.push(tool)),
    registerHook: vi.fn((name, fn) => hooks.set(name, fn)),
    _tools: tools,
    _hooks: hooks,
  };
}

describe("index startup restore", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), "progress-notifier-"));
    sendCardMock.mockClear();
    updateCardMock.mockClear();
    sendTextMock.mockClear();
  });

  afterEach(async () => {
    vi.clearAllTimers();
    await Promise.resolve();
    vi.restoreAllMocks();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("restores pinned card bindings from file persistence on startup", async () => {
    const taskAdapter = new FileAdapter(tempDir);
    const pinnedAdapter = new FileFeishuPinnedCardAdapter(tempDir);
    const createdAt = Date.now() - 2000;

    await taskAdapter.saveConversation("conv-1", {
      "task-1": {
        taskId: "task-1",
        conversationId: "conv-1",
        label: "Working quietly",
        percent: 12,
        stage: "research",
        status: "done",
        createdAt,
        updatedAt: createdAt,
        lastActivityAt: createdAt,
        history: [
          {
            ts: createdAt,
            label: "Working quietly",
            percent: 12,
            stage: "research",
            status: "done",
          },
        ],
      },
    });

    await pinnedAdapter.saveConversation("conv-1", {
      "conv-1::task-1": {
        conversationId: "conv-1",
        taskId: "task-1",
        messageId: "msg-existing",
        receiveId: "chat-1",
        receiveIdType: "chat_id",
        createdAt,
        updatedAt: createdAt,
      },
    });

    const api = createMockApi({
      injectPromptContext: false,
      persistenceMode: "file",
      persistenceDir: tempDir,
      defaultUpdateIntervalMs: 1000,
      restoreStateOnStartup: true,
      feishuAppId: "app-id",
      feishuAppSecret: "app-secret",
    });

    register(api);

    const statusTool = api._tools.find((tool: any) => tool.name === "progress_card_status");
    const getTool = api._tools.find((tool: any) => tool.name === "progress_get");
    const ctx = { conversation: { id: "conv-1" } };

    const status = await statusTool.execute("1", {}, ctx);
    expect(status.metadata.count).toBe(1);
    expect(getTool).toBeTruthy();
  });

  it("restarts heartbeat visibility for running file-persisted tasks", async () => {
    const taskAdapter = new FileAdapter(tempDir);
    const createdAt = Date.now() - 2000;

    await taskAdapter.saveConversation("conv-1", {
      "task-1": {
        taskId: "task-1",
        conversationId: "conv-1",
        label: "Working quietly",
        percent: 12,
        stage: "research",
        status: "running",
        createdAt,
        updatedAt: createdAt,
        lastActivityAt: createdAt,
        history: [
          {
            ts: createdAt,
            label: "Working quietly",
            percent: 12,
            stage: "research",
            status: "running",
          },
        ],
      },
    });

    const manager = new ProgressManager(new FileAdapter(tempDir), { staleAfterMs: 5000 });
    const scheduler = new TaskScheduler();
    const autoProgress = new AutoProgressService(manager, scheduler);

    const conversations = await manager.listConversations();
    for (const conversationId of conversations) {
      const tasks = await manager.listTasks(conversationId);
      for (const task of tasks) {
        if (!["running", "retrying"].includes(task.status)) {
          continue;
        }
        autoProgress.startHeartbeat(conversationId, task.taskId, 20);
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 60));
    const task = await manager.getTask("conv-1", "task-1");
    autoProgress.stopAll();

    expect(task?.lastHeartbeatAt).toBeDefined();
    expect(task?.lastHeartbeatAt).toBeGreaterThan(task?.lastActivityAt ?? 0);
  });

  it("does not restart heartbeat for non-running file-persisted tasks", async () => {
    const taskAdapter = new FileAdapter(tempDir);
    const createdAt = Date.now() - 2000;

    await taskAdapter.saveConversation("conv-1", {
      blocked: {
        taskId: "blocked",
        conversationId: "conv-1",
        label: "Blocked task",
        percent: 30,
        stage: "research",
        status: "blocked",
        createdAt,
        updatedAt: createdAt,
        lastActivityAt: createdAt,
        history: [
          {
            ts: createdAt,
            label: "Blocked task",
            percent: 30,
            stage: "research",
            status: "blocked",
          },
        ],
      },
      done: {
        taskId: "done",
        conversationId: "conv-1",
        label: "Done task",
        percent: 100,
        stage: "done",
        status: "done",
        createdAt,
        updatedAt: createdAt,
        lastActivityAt: createdAt,
        history: [
          {
            ts: createdAt,
            label: "Done task",
            percent: 100,
            stage: "done",
            status: "done",
          },
        ],
      },
    });

    const manager = new ProgressManager(new FileAdapter(tempDir), { staleAfterMs: 5000 });
    const scheduler = new TaskScheduler();
    const autoProgress = new AutoProgressService(manager, scheduler);

    const conversations = await manager.listConversations();
    for (const conversationId of conversations) {
      const tasks = await manager.listTasks(conversationId);
      for (const task of tasks) {
        if (!["running", "retrying"].includes(task.status)) {
          continue;
        }
        autoProgress.startHeartbeat(conversationId, task.taskId, 20);
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 60));
    const blocked = await manager.getTask("conv-1", "blocked");
    const done = await manager.getTask("conv-1", "done");
    autoProgress.stopAll();

    expect(blocked?.lastHeartbeatAt).toBeUndefined();
    expect(done?.lastHeartbeatAt).toBeUndefined();
  });
});
