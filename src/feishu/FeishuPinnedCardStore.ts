import type { FeishuPinnedCardRecord } from "./types.js";
import type { FeishuPinnedCardPersistenceAdapter } from "./persistence/FeishuPinnedCardPersistenceAdapter.js";

export class FeishuPinnedCardStore {
  constructor(private adapter: FeishuPinnedCardPersistenceAdapter) {}

  private key(conversationId: string, taskId: string): string {
    return `${conversationId}:${taskId}`;
  }

  async get(conversationId: string, taskId: string): Promise<FeishuPinnedCardRecord | undefined> {
    const records = await this.adapter.loadAll();
    return records[this.key(conversationId, taskId)];
  }

  async set(record: FeishuPinnedCardRecord): Promise<void> {
    const records = await this.adapter.loadAll();
    records[this.key(record.conversationId, record.taskId)] = record;
    await this.adapter.saveAll(records);
  }

  async delete(conversationId: string, taskId: string): Promise<void> {
    const records = await this.adapter.loadAll();
    delete records[this.key(conversationId, taskId)];
    await this.adapter.saveAll(records);
  }

  async list(conversationId?: string): Promise<FeishuPinnedCardRecord[]> {
    const records = await this.adapter.loadAll();
    const all = Object.values(records);
    if (!conversationId) return all.sort((a, b) => b.updatedAt - a.updatedAt);
    return all
      .filter(r => r.conversationId === conversationId)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async healthCheck(): Promise<boolean> {
    if (typeof this.adapter.healthCheck === "function") {
      return this.adapter.healthCheck();
    }
    return true;
  }
}
