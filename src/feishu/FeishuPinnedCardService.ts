import type { ProgressManager } from "../ProgressManager.js";
import type { TaskState } from "../types.js";
import { formatElapsedMs, getTaskWatchdog } from "../utils.js";
import { FeishuCardRenderer } from "./FeishuCardRenderer.js";
import { FeishuCardPusher } from "./FeishuCardPusher.js";
import { FeishuPinnedCardStore } from "./FeishuPinnedCardStore.js";
import type { FeishuPinnedCardRecord } from "./types.js";

export interface PinCardArgs {
  conversationId: string;
  taskId: string;
  receiveId: string;
  receiveIdType?: "open_id" | "user_id" | "union_id" | "chat_id" | "email";
  showSummary?: boolean;
}

export interface FeishuPinnedCardServiceConfig {
  staleAfterMs?: number;
  enableAlerts?: boolean;
  alertCooldownMs?: number;
}

export class FeishuPinnedCardService {
  constructor(
    private manager: ProgressManager,
    private renderer: FeishuCardRenderer,
    private pusher: FeishuCardPusher,
    private store: FeishuPinnedCardStore,
    private config: FeishuPinnedCardServiceConfig = {}
  ) {}

  async pin(args: PinCardArgs): Promise<{ messageId: string; created: boolean }> {
    const task = await this.manager.getTask(args.conversationId, args.taskId);
    if (!task) {
      throw new Error(`Task not found: ${args.taskId}`);
    }

    const existing = this.store.get(args.conversationId, args.taskId);
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

      await this.store.set({
        ...existing,
        updatedAt: Date.now(),
      });

      return {
        messageId: existing.messageId,
        created: false,
      };
    }

    const now = Date.now();
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
      createdAt: now,
      updatedAt: now,
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

    const updatedRecord = await this.syncAlertState({
      record: {
        ...record,
        updatedAt: Date.now(),
      },
      task,
    });

    await this.store.set(updatedRecord);
    return true;
  }

  async unpin(conversationId: string, taskId: string): Promise<boolean> {
    const record = this.store.get(conversationId, taskId);
    if (!record) return false;

    await this.store.delete(conversationId, taskId);
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

  private async syncAlertState(args: {
    record: FeishuPinnedCardRecord;
    task: TaskState;
  }): Promise<FeishuPinnedCardRecord> {
    const { record, task } = args;
    const nextAlertState = this.pickAlertState(task);

    if (!nextAlertState) {
      return {
        ...record,
        lastAlertState: undefined,
      };
    }

    if (!this.config.enableAlerts) {
      return record;
    }

    const now = Date.now();
    const cooldownMs = this.config.alertCooldownMs ?? 300000;
    const canAlert =
      record.lastAlertState !== nextAlertState &&
      (record.lastAlertAt === undefined || now - record.lastAlertAt >= cooldownMs);

    if (!canAlert) {
      return record;
    }

    await this.pusher.sendText({
      receiveId: record.receiveId,
      receiveIdType: record.receiveIdType,
      text: this.buildAlertText(task, nextAlertState),
    });

    return {
      ...record,
      lastAlertState: nextAlertState,
      lastAlertAt: now,
    };
  }

  private pickAlertState(task: TaskState): FeishuPinnedCardRecord["lastAlertState"] {
    const watchdog = getTaskWatchdog(task, this.config.staleAfterMs);
    if (watchdog.state === "stale") return "stale";
    if (watchdog.state === "waiting_external_slow") return "waiting_external_slow";
    return undefined;
  }

  private buildAlertText(
    task: TaskState,
    alertState: NonNullable<FeishuPinnedCardRecord["lastAlertState"]>
  ): string {
    const watchdog = getTaskWatchdog(task, this.config.staleAfterMs);

    if (alertState === "waiting_external_slow") {
      return `External call slow: waiting on ${watchdog.waitingOn ?? "external"}${
        watchdog.waitingForMs !== undefined
          ? ` for ${formatElapsedMs(watchdog.waitingForMs)}`
          : ""
      }`;
    }

    return `Possibly stalled: no real activity for ${formatElapsedMs(
      watchdog.inactiveForMs
    )}`;
  }
}
