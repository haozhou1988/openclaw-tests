import type { ProgressManager } from "../ProgressManager.js";
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

  private buildTitle(taskStatus: string): string {
    switch (taskStatus) {
      case "done": return "Workflow Complete";
      case "failed": return "Workflow Failed";
      case "canceled": return "Workflow Canceled";
      default: return "Workflow Progress";
    }
  }

  private async buildCardOptions(task: any, showSummary: boolean) {
    const options: any = { showSummary };

    // Summary
    if (showSummary) {
      options.summaryText = await this.manager.summarizeTask(task.conversationId, task.taskId) ?? undefined;
    }

    // Metrics
    try {
      const metrics = await this.manager.metricsForTask?.(task.conversationId, task.taskId);
      if (metrics) {
        options.showMetrics = true;
        options.metricsText = String(this.manager.renderMetrics?.(metrics, "compact") ?? "");
      }
    } catch {}

    // Children overview
    try {
      const children = await this.manager.childrenOfTask?.(task.conversationId, task.taskId);
      if (children && children.length > 0) {
        const done = children.filter((c: any) => c.status === "done").length;
        const running = children.filter((c: any) => c.status === "running").length;
        const blocked = children.filter((c: any) => c.status === "blocked").length;
        options.showChildrenOverview = true;
        options.childrenOverviewText = `总数=${children.length} | 完成=${done} | 运行中=${running} | 阻塞=${blocked}`;
      }
    } catch {}

    return options;
  }

  async pin(args: PinCardArgs): Promise<{ messageId: string; created: boolean }> {
    const task = await this.manager.getTask(args.conversationId, args.taskId);
    if (!task) {
      throw new Error(`Task not found: ${args.taskId}`);
    }

    const existing = await this.store.get(args.conversationId, args.taskId);
    const cardOptions = await this.buildCardOptions(task, args.showSummary ?? false);
    cardOptions.title = this.buildTitle(task.status);

    const card = this.renderer.renderTaskCard(task, cardOptions);

    if (existing) {
      await this.pusher.updateCard({ messageId: existing.messageId, card });
      await this.store.set({ ...existing, updatedAt: Date.now() });
      return { messageId: existing.messageId, created: false };
    }

    const messageId = await this.pusher.sendCard({
      receiveId: args.receiveId,
      receiveIdType: args.receiveIdType ?? "chat_id",
      card,
    });

    await this.store.set({
      conversationId: args.conversationId,
      taskId: args.taskId,
      messageId,
      receiveId: args.receiveId,
      receiveIdType: args.receiveIdType ?? "chat_id",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    return { messageId, created: true };
  }

  async refresh(conversationId: string, taskId: string, showSummary = false): Promise<boolean> {
    const record = await this.store.get(conversationId, taskId);
    if (!record) return false;

    const task = await this.manager.getTask(conversationId, taskId);
    if (!task) return false;

    const cardOptions = await this.buildCardOptions(task, showSummary);
    cardOptions.title = this.buildTitle(task.status);

    const card = this.renderer.renderTaskCard(task, cardOptions);

    await this.pusher.updateCard({ messageId: record.messageId, card });
    await this.store.set({ ...record, updatedAt: Date.now() });

    return true;
  }

  async unpin(conversationId: string, taskId: string): Promise<boolean> {
    const record = await this.store.get(conversationId, taskId);
    if (!record) return false;
    await this.store.delete(conversationId, taskId);
    return true;
  }

  async get(conversationId: string, taskId: string) {
    return this.store.get(conversationId, taskId);
  }

  async list(conversationId?: string) {
    return this.store.list(conversationId);
  }

  async healthCheck() {
    return this.store.healthCheck();
  }
}
