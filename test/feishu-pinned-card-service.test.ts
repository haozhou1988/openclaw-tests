import { beforeEach, describe, expect, it, vi } from "vitest";
import { FeishuPinnedCardService } from "../src/feishu/FeishuPinnedCardService.js";
import { FeishuPinnedCardStore } from "../src/feishu/FeishuPinnedCardStore.js";
import { MemoryFeishuPinnedCardAdapter } from "../src/feishu/persistence/MemoryFeishuPinnedCardAdapter.js";

function buildTask(overrides: Record<string, any> = {}) {
  return {
    taskId: "paper-1",
    conversationId: "conv-1",
    label: "Drafting summary",
    percent: 75,
    stage: "draft",
    status: "running",
    createdAt: 1,
    updatedAt: 2,
    lastActivityAt: 2,
    lastHeartbeatAt: undefined,
    history: [],
    ...overrides,
  };
}

describe("FeishuPinnedCardService", () => {
  let manager: any;
  let renderer: any;
  let pusher: any;
  let store: FeishuPinnedCardStore;
  let service: FeishuPinnedCardService;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-19T00:00:00Z"));

    manager = {
      getTask: vi.fn(async () => buildTask()),
      summarizeTask: vi.fn(async () => "Task summary"),
      metricsForTask: vi.fn(
        async () => ({ totalDurationMs: 1000, updateCount: 2, retryCount: 0, blockCount: 0 })
      ),
      renderMetrics: vi.fn(() => "duration=1s | updates=2"),
      childrenOfTask: vi.fn(async () => []),
    };

    renderer = {
      renderTaskCard: vi.fn(() => ({
        card: {
          schema: "2.0",
          header: { title: { content: "Workflow Progress" } },
          body: { elements: [] },
        },
      })),
    };

    pusher = {
      sendCard: vi.fn(async () => "msg-123"),
      updateCard: vi.fn(async () => {}),
      sendText: vi.fn(async () => "alert-123"),
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

  it("pin() updates an existing card when binding already exists", async () => {
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
    const record = store.get("conv-1", "paper-1");

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

  it("sends one proactive alert when a task enters waiting_external_slow", async () => {
    await store.set({
      conversationId: "conv-1",
      taskId: "paper-1",
      messageId: "msg-existing",
      receiveId: "chat-1",
      receiveIdType: "chat_id",
      createdAt: 1,
      updatedAt: 1,
    });

    manager.getTask.mockResolvedValueOnce(
      buildTask({
        label: "Waiting for OpenAI",
        activityState: "waiting_external",
        waitingOn: "openai",
        externalCallStartedAt: Date.now() - 6000,
        lastActivityAt: Date.now() - 6000,
      })
    );

    service = new FeishuPinnedCardService(manager, renderer, pusher, store, {
      staleAfterMs: 5000,
      enableAlerts: true,
      alertCooldownMs: 1000,
    });

    await service.refresh("conv-1", "paper-1", true);
    await service.refresh("conv-1", "paper-1", true);

    expect(pusher.sendText).toHaveBeenCalledTimes(1);
    expect(pusher.sendText.mock.calls[0][0].text).toContain("External call slow: waiting on openai");
  });

  it("sends one proactive alert when a task becomes stale", async () => {
    await store.set({
      conversationId: "conv-1",
      taskId: "paper-1",
      messageId: "msg-existing",
      receiveId: "chat-1",
      receiveIdType: "chat_id",
      createdAt: 1,
      updatedAt: 1,
    });

    manager.getTask.mockResolvedValueOnce(
      buildTask({
        label: "Quiet task",
        lastActivityAt: Date.now() - 6000,
        updatedAt: Date.now() - 1000,
      })
    );

    service = new FeishuPinnedCardService(manager, renderer, pusher, store, {
      staleAfterMs: 5000,
      enableAlerts: true,
      alertCooldownMs: 1000,
    });

    await service.refresh("conv-1", "paper-1", true);

    expect(pusher.sendText).toHaveBeenCalledTimes(1);
    expect(pusher.sendText.mock.calls[0][0].text).toContain("Possibly stalled: no real activity");
  });

  it("re-alerts after recovery and a new severe state transition", async () => {
    await store.set({
      conversationId: "conv-1",
      taskId: "paper-1",
      messageId: "msg-existing",
      receiveId: "chat-1",
      receiveIdType: "chat_id",
      createdAt: 1,
      updatedAt: 1,
    });

    const waitingTask = buildTask({
      label: "Waiting for OpenAI",
      activityState: "waiting_external",
      waitingOn: "openai",
      externalCallStartedAt: Date.now() - 6000,
      lastActivityAt: Date.now() - 6000,
    });
    const recoveredTask = buildTask({
      label: "Back to work",
      activityState: undefined,
      waitingOn: undefined,
      externalCallStartedAt: undefined,
      lastActivityAt: Date.now(),
      updatedAt: Date.now(),
    });

    manager.getTask
      .mockResolvedValueOnce(waitingTask)
      .mockResolvedValueOnce(recoveredTask)
      .mockResolvedValueOnce(waitingTask);

    service = new FeishuPinnedCardService(manager, renderer, pusher, store, {
      staleAfterMs: 5000,
      enableAlerts: true,
      alertCooldownMs: 0,
    });

    await service.refresh("conv-1", "paper-1", true);
    await service.refresh("conv-1", "paper-1", true);
    await service.refresh("conv-1", "paper-1", true);

    expect(pusher.sendText).toHaveBeenCalledTimes(2);
  });
});
