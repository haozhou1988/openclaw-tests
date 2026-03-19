import type { ProgressManager } from "../ProgressManager.js";
import type { TaskState } from "../types.js";
import { FeishuCardRenderer } from "./FeishuCardRenderer.js";
import { FeishuCardPusher } from "./FeishuCardPusher.js";
import { FeishuPinnedCardStore } from "./FeishuPinnedCardStore.js";

export interface PinCardArgs {
  conversationId: string;
  taskId: string;
  receiveId: string;
  receiveIdType?: "open_id" | "user_id" | "union_id" | "chat_id" | "email";
  showSummary?: boolean;
}

export class FeishuPinnedCardService {
  constructor(
    private manager: ProgressManager,
    private renderer: FeishuCardRenderer,
    private pusher: FeishuCardPusher,
    private store: FeishuPinnedCardStore
  ) {}

  async pin(args: PinCardArgs): Promise<{ messageId: string; created: boolean }> {
    const task = await this.manager.getTask(args.conversationId, args.taskId);
    if (!task) {
      throw new Error(`Task not found: ${args.taskId}`);
    }

    const existing = this.store.get(args.conversationId, args.taskId);
    // Build summary from task data (since summarizeTask method doesn't exist)
    const summary = args.showSummary
      ? this.buildSummaryText(task, args.taskId)
      : undefined;

    const card = this.renderer.renderTaskCard(task, {
      showSummary: args.showSummary,
      summaryText: summary,
    });

    if (existing) {
      await this.pusher.updateCard({
        messageId: existing.messageId,
        card,
      });

      this.store.set({
        ...existing,
        updatedAt: Date.now(),
      });

      return {
        messageId: existing.messageId,
        created: false,
      };
    }

    const messageId = await this.pusher.sendCard({
      receiveId: args.receiveId,
      receiveIdType: args.receiveIdType ?? "chat_id",
      card,
    });

    this.store.set({
      conversationId: args.conversationId,
      taskId: args.taskId,
      messageId,
      receiveId: args.receiveId,
      receiveIdType: args.receiveIdType ?? "chat_id",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    return {
      messageId,
      created: true,
    };
  }

  async refresh(conversationId: string, taskId: string, showSummary = false): Promise<boolean> {
    const record = this.store.get(conversationId, taskId);
    if (!record) return false;

    const task = await this.manager.getTask(conversationId, taskId);
    if (!task) return false;

    const summary = showSummary
      ? this.buildSummaryText(task, taskId)
      : undefined;

    const card = this.renderer.renderTaskCard(task, {
      showSummary,
      summaryText: summary,
    });

    await this.pusher.updateCard({
      messageId: record.messageId,
      card,
    });

    this.store.set({
      ...record,
      updatedAt: Date.now(),
    });

    return true;
  }

  async unpin(conversationId: string, taskId: string): Promise<boolean> {
    const record = this.store.get(conversationId, taskId);
    if (!record) return false;

    this.store.delete(conversationId, taskId);
    return true;
  }

  get(conversationId: string, taskId: string) {
    return this.store.get(conversationId, taskId);
  }

  list(conversationId?: string) {
    return this.store.list(conversationId);
  }

  private buildSummaryText(task: TaskState, fallbackTaskId: string): string {
    const progressText = task.percent !== undefined ? `${task.percent}%` : "N/A";
    return `${task.label || fallbackTaskId}: ${task.status} (${progressText})`;
  }
}
