import type { FeishuPinnedCardRecord } from "./types.js";
import type { FeishuPinnedCardPersistenceAdapter } from "./persistence/FeishuPinnedCardPersistenceAdapter.js";

export class FeishuPinnedCardStore {
  constructor(private adapter: FeishuPinnedCardPersistenceAdapter) {}

  private key(taskId: string): string {
    return taskId;
  }

  async get(conversationId: string, taskId: string): Promise<FeishuPinnedCardRecord | undefined> {
    const records = await this.adapter.loadConversation(conversationId);
    return records[this.key(taskId)];
  }

  async set(record: FeishuPinnedCardRecord): Promise<void> {
    const records = await this.adapter.loadConversation(record.conversationId);
    records[this.key(record.taskId)] = record;
    await this.adapter.saveConversation(record.conversationId, records);
  }

  async delete(conversationId: string, taskId: string): Promise<void> {
    const records = await this.adapter.loadConversation(conversationId);
    delete records[this.key(taskId)];
    if (Object.keys(records).length === 0) {
      await this.adapter.deleteConversation(conversationId);
      return;
    }
    await this.adapter.saveConversation(conversationId, records);
  }

  async list(conversationId?: string): Promise<FeishuPinnedCardRecord[]> {
    if (conversationId) {
      const records = await this.adapter.loadConversation(conversationId);
      return Object.values(records).sort((a, b) => b.updatedAt - a.updatedAt);
    }
    if (typeof this.adapter.listConversations !== "function") return [];
    const conversations = await this.adapter.listConversations();
    const all: FeishuPinnedCardRecord[] = [];
    for (const cid of conversations) {
      const records = await this.adapter.loadConversation(cid);
      all.push(...Object.values(records));
    }
    return all.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async healthCheck(): Promise<boolean> {
    if (typeof this.adapter.healthCheck === "function") {
      return this.adapter.healthCheck();
    }
    return true;
  }
}
