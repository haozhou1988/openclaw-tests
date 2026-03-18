import type { FeishuPinnedCardRecordMap } from "../types.js";

export interface FeishuPinnedCardPersistenceAdapter {
  loadConversation(conversationId: string): Promise<FeishuPinnedCardRecordMap>;
  saveConversation(conversationId: string, records: FeishuPinnedCardRecordMap): Promise<void>;
  deleteConversation(conversationId: string): Promise<void>;
  listConversations?(): Promise<string[]>;
  healthCheck?(): Promise<boolean>;
}
