import type { TaskState } from "../render/ProgressRenderer.js";

export type TaskRecordMap = Record<string, TaskState>;

export interface PersistenceAdapter {
  loadConversation(conversationId: string): Promise<TaskRecordMap>;
  saveConversation(conversationId: string, tasks: TaskRecordMap): Promise<void>;
  deleteConversation(conversationId: string): Promise<void>;
  listConversations?(): Promise<string[]>;
  healthCheck?(): Promise<boolean>;
  rebuildIndex?(): Promise<number>;
}

export class MemoryAdapter implements PersistenceAdapter {
  private store = new Map<string, TaskRecordMap>();

  async loadConversation(conversationId: string): Promise<TaskRecordMap> {
    return this.store.get(conversationId) ?? {};
  }

  async saveConversation(conversationId: string, tasks: TaskRecordMap): Promise<void> {
    this.store.set(conversationId, tasks);
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
