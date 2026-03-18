import { describe, expect, it } from "vitest";
import { FeishuPinnedCardStore } from "../src/feishu/FeishuPinnedCardStore.js";
import { MemoryFeishuPinnedCardAdapter } from "../src/feishu/persistence/MemoryFeishuPinnedCardAdapter.js";

describe("FeishuPinnedCardStore", () => {
  it("stores and retrieves one pinned card record", async () => {
    const store = new FeishuPinnedCardStore(new MemoryFeishuPinnedCardAdapter());

    await store.set({
      conversationId: "conv-1",
      taskId: "paper-1",
      messageId: "msg-1",
      receiveId: "chat-1",
      receiveIdType: "chat_id",
      createdAt: 100,
      updatedAt: 100,
    });

    const record = await store.get("conv-1", "paper-1");
    expect(record).toBeTruthy();
    expect(record?.messageId).toBe("msg-1");
  });

  it("returns undefined when record does not exist", async () => {
    const store = new FeishuPinnedCardStore(new MemoryFeishuPinnedCardAdapter());
    const record = await store.get("conv-1", "missing-task");
    expect(record).toBeUndefined();
  });

  it("deletes one record and removes empty conversation storage", async () => {
    const adapter = new MemoryFeishuPinnedCardAdapter();
    const store = new FeishuPinnedCardStore(adapter);

    await store.set({
      conversationId: "conv-1",
      taskId: "paper-1",
      messageId: "msg-1",
      receiveId: "chat-1",
      receiveIdType: "chat_id",
      createdAt: 100,
      updatedAt: 100,
    });

    await store.delete("conv-1", "paper-1");

    const record = await store.get("conv-1", "paper-1");
    const conversations = await adapter.listConversations();
    expect(record).toBeUndefined();
    expect(conversations).toEqual([]);
  });

  it("lists records in one conversation ordered by updatedAt desc", async () => {
    const store = new FeishuPinnedCardStore(new MemoryFeishuPinnedCardAdapter());

    await store.set({
      conversationId: "conv-1",
      taskId: "paper-1",
      messageId: "msg-1",
      receiveId: "chat-1",
      receiveIdType: "chat_id",
      createdAt: 100,
      updatedAt: 100,
    });

    await store.set({
      conversationId: "conv-1",
      taskId: "paper-2",
      messageId: "msg-2",
      receiveId: "chat-1",
      receiveIdType: "chat_id",
      createdAt: 200,
      updatedAt: 200,
    });

    const records = await store.list("conv-1");
    expect(records).toHaveLength(2);
    expect(records[0].taskId).toBe("paper-2");
    expect(records[1].taskId).toBe("paper-1");
  });

  it("lists records across all conversations", async () => {
    const store = new FeishuPinnedCardStore(new MemoryFeishuPinnedCardAdapter());

    await store.set({
      conversationId: "conv-a",
      taskId: "task-a",
      messageId: "msg-a",
      receiveId: "chat-a",
      receiveIdType: "chat_id",
      createdAt: 100,
      updatedAt: 100,
    });

    await store.set({
      conversationId: "conv-b",
      taskId: "task-b",
      messageId: "msg-b",
      receiveId: "chat-b",
      receiveIdType: "chat_id",
      createdAt: 200,
      updatedAt: 200,
    });

    const records = await store.list();
    expect(records).toHaveLength(2);
  });

  it("passes healthCheck", async () => {
    const store = new FeishuPinnedCardStore(new MemoryFeishuPinnedCardAdapter());
    const ok = await store.healthCheck();
    expect(ok).toBe(true);
  });
});
