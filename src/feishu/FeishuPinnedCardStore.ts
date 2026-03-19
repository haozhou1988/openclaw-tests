export interface FeishuPinnedCardRecord {
  conversationId: string;
  taskId: string;
  messageId: string;
  receiveId: string;
  receiveIdType: "open_id" | "user_id" | "union_id" | "chat_id" | "email";
  createdAt: number;
  updatedAt: number;
}

export class FeishuPinnedCardStore {
  private records = new Map<string, FeishuPinnedCardRecord>();

  constructor(
    private adapter?: {
      healthCheck?(): Promise<boolean>;
    }
  ) {}

  private key(conversationId: string, taskId: string): string {
    return `${conversationId}::${taskId}`;
  }

  get(conversationId: string, taskId: string): FeishuPinnedCardRecord | undefined {
    return this.records.get(this.key(conversationId, taskId));
  }

  set(record: FeishuPinnedCardRecord): void {
    this.records.set(this.key(record.conversationId, record.taskId), record);
  }

  delete(conversationId: string, taskId: string): void {
    this.records.delete(this.key(conversationId, taskId));
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
}
