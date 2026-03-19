import type { FeishuPinnedCardRecord, FeishuPinnedCardRecordMap } from "./types.js";
import type { FeishuPinnedCardPersistenceAdapter } from "./persistence/FeishuPinnedCardPersistenceAdapter.js";

export class FeishuPinnedCardStore {
  private records = new Map<string, FeishuPinnedCardRecord>();

  constructor(private adapter?: FeishuPinnedCardPersistenceAdapter) {}

  private key(conversationId: string, taskId: string): string {
    return `${conversationId}::${taskId}`;
  }

  async restore(): Promise<void> {
    if (!this.adapter) return;

    const conversations = typeof this.adapter.listConversations === "function"
      ? await this.adapter.listConversations()
      : [];

    for (const conversationId of conversations) {
      const loaded = await this.adapter.loadConversation(conversationId);
      for (const record of Object.values(loaded)) {
        this.records.set(this.key(record.conversationId, record.taskId), record);
      }
    }
  }

  get(conversationId: string, taskId: string): FeishuPinnedCardRecord | undefined {
    return this.records.get(this.key(conversationId, taskId));
  }

  async set(record: FeishuPinnedCardRecord): Promise<void> {
    this.records.set(this.key(record.conversationId, record.taskId), record);
    await this.persistConversation(record.conversationId);
  }

  async delete(conversationId: string, taskId: string): Promise<void> {
    this.records.delete(this.key(conversationId, taskId));
    await this.persistConversation(conversationId);
  }

  list(conversationId?: string): FeishuPinnedCardRecord[] {
    const all = Array.from(this.records.values());
    const filtered = conversationId
      ? all.filter((r) => r.conversationId === conversationId)
      : all;

    return filtered.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async healthCheck(): Promise<boolean> {
    if (typeof this.adapter?.healthCheck === "function") {
      return this.adapter.healthCheck();
    }
    return true;
  }

  private async persistConversation(conversationId: string): Promise<void> {
    if (!this.adapter) return;

    const records = this.list(conversationId).reduce<FeishuPinnedCardRecordMap>(
      (acc, record) => {
        acc[this.key(record.conversationId, record.taskId)] = record;
        return acc;
      },
      {}
    );

    if (Object.keys(records).length === 0) {
      await this.adapter.deleteConversation(conversationId);
      return;
    }

    await this.adapter.saveConversation(conversationId, records);
  }
}
