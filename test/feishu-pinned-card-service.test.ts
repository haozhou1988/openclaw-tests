import { describe, expect, it, vi, beforeEach } from "vitest";
import { FeishuPinnedCardService } from "../src/feishu/FeishuPinnedCardService.js";
import { FeishuPinnedCardStore } from "../src/feishu/FeishuPinnedCardStore.js";
import { MemoryFeishuPinnedCardAdapter } from "../src/feishu/persistence/MemoryFeishuPinnedCardAdapter.js";

function buildTask(status = "running") {
  return {
    taskId: "paper-1",
    conversationId: "conv-1",
    label: "正在整理摘要",
    percent: 75,
    stage: "draft",
    status,
    createdAt: 1,
    updatedAt: 2,
    history: [],
  };
}

describe("FeishuPinnedCardService", () => {
  let manager: any;
  let renderer: any;
  let pusher: any;
  let store: FeishuPinnedCardStore;
  let service: FeishuPinnedCardService;

  beforeEach(() => {
    manager = {
      getTask: vi.fn(async () => buildTask()),
      summarizeTask: vi.fn(async () => "任务摘要"),
      metricsForTask: vi.fn(async () => ({ totalDurationMs: 1000, updateCount: 2, retryCount: 0, blockCount: 0 })),
      renderMetrics: vi.fn(() => "duration=1s | updates=2"),
      childrenOfTask: vi.fn(async () => []),
    };

    renderer = {
      renderTaskCard: vi.fn(() => ({
        card: { schema: "2.0", header: { title: { content: "Workflow Progress" } }, body: { elements: [] } },
      })),
    };

    pusher = {
      sendCard: vi.fn(async () => "msg-123"),
      updateCard: vi.fn(async () => {}),
    };

    store = new FeishuPinnedCardStore(new MemoryFeishuPinnedCardAdapter());
    service = new FeishuPinnedCardService(manager, renderer, pusher, store);
  });

  it("pin() sends a new card when no binding exists", async () => {
    const result = await service.pin({
      conversationId: "conv-1",
      taskId: "paper-1",
      receiveId: "chat-1",
      receiveIdType: "chat_id",
      showSummary: true,
    });

    expect(result.created).toBe(true);
    expect(result.messageId).toBe("msg-123");
    expect(pusher.sendCard).toHaveBeenCalledTimes(1);
    expect(pusher.updateCard).not.toHaveBeenCalled();
  });

  it("pin() updates existing card when binding already exists", async () => {
    await store.set({
      conversationId: "conv-1",
      taskId: "paper-1",
      messageId: "msg-existing",
      receiveId: "chat-1",
      receiveIdType: "chat_id",
      createdAt: 1,
      updatedAt: 1,
    });

    const result = await service.pin({
      conversationId: "conv-1",
      taskId: "paper-1",
      receiveId: "chat-1",
      receiveIdType: "chat_id",
      showSummary: true,
    });

    expect(result.created).toBe(false);
    expect(result.messageId).toBe("msg-existing");
    expect(pusher.updateCard).toHaveBeenCalledTimes(1);
  });

  it("refresh() updates a bound card", async () => {
    await store.set({
      conversationId: "conv-1",
      taskId: "paper-1",
      messageId: "msg-existing",
      receiveId: "chat-1",
      receiveIdType: "chat_id",
      createdAt: 1,
      updatedAt: 1,
    });

    const refreshed = await service.refresh("conv-1", "paper-1", true);
    expect(refreshed).toBe(true);
    expect(pusher.updateCard).toHaveBeenCalledTimes(1);
  });

  it("refresh() returns false if binding does not exist", async () => {
    const refreshed = await service.refresh("conv-1", "paper-1", true);
    expect(refreshed).toBe(false);
    expect(pusher.updateCard).not.toHaveBeenCalled();
  });

  it("unpin() removes a binding", async () => {
    await store.set({
      conversationId: "conv-1",
      taskId: "paper-1",
      messageId: "msg-existing",
      receiveId: "chat-1",
      receiveIdType: "chat_id",
      createdAt: 1,
      updatedAt: 1,
    });

    const removed = await service.unpin("conv-1", "paper-1");
    const record = await store.get("conv-1", "paper-1");

    expect(removed).toBe(true);
    expect(record).toBeUndefined();
  });

  it("unpin() returns false if binding does not exist", async () => {
    const removed = await service.unpin("conv-1", "paper-1");
    expect(removed).toBe(false);
  });

  it("throws if task does not exist on pin()", async () => {
    manager.getTask = vi.fn(async () => undefined);
    const brokenService = new FeishuPinnedCardService(manager, renderer, pusher, store);

    await expect(
      brokenService.pin({ conversationId: "conv-1", taskId: "missing-task", receiveId: "chat-1" })
    ).rejects.toThrow("Task not found");
  });
});
