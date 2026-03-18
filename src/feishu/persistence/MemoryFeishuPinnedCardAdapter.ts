import type { FeishuPinnedCardRecordMap } from "../types.js";
import type { FeishuPinnedCardPersistenceAdapter } from "./FeishuPinnedCardPersistenceAdapter.js";

export class MemoryFeishuPinnedCardAdapter implements FeishuPinnedCardPersistenceAdapter {
  private store = new Map<string, FeishuPinnedCardRecordMap>();

  async loadConversation(conversationId: string): Promise<FeishuPinnedCardRecordMap> {
    return this.store.get(conversationId) ?? {};
  }

  async saveConversation(conversationId: string, records: FeishuPinnedCardRecordMap): Promise<void> {
    this.store.set(conversationId, records);
  }

  async deleteConversation(conversationId: string): Promise<void> {
    this.store.delete(conversationId);
  }

  async listConversations(): Promise<string[]> {
    return Array.from(this.store.keys()).sort();
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }
}
