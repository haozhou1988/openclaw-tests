export interface FeishuPinnedCardRecord {
  conversationId: string;
  taskId: string;
  messageId: string;
  receiveId: string;
  receiveIdType: "open_id" | "user_id" | "union_id" | "chat_id" | "email";
  createdAt: number;
  updatedAt: number;
  lastAlertState?: "stale" | "waiting_external_slow";
  lastAlertAt?: number;
}

export type FeishuPinnedCardRecordMap = Record<string, FeishuPinnedCardRecord>;
