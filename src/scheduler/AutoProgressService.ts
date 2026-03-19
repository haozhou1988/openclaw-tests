import type { ProgressManager } from "../ProgressManager.js";
import type { ScheduleMode, ScheduledTaskInfo } from "../types.js";
import { TaskScheduler } from "./TaskScheduler.js";
import type { ProgressMessagePusher } from "./ProgressMessagePusher.js";

export class AutoProgressService {
  constructor(
    private manager: ProgressManager,
    private scheduler: TaskScheduler,
    private pusher?: ProgressMessagePusher,
    private onTaskTick?: (args: {
      conversationId: string;
      taskId: string;
      mode: ScheduleMode;
    }) => Promise<void>
  ) {}

  async pushIfPossible(args: {
    conversationId: string;
    taskId: string;
    text: string;
    mode: ScheduleMode;
  }) {
    if (!this.pusher) return;
    await this.pusher.push(args);
  }

  start(
    conversationId: string,
    taskId: string,
    intervalMs: number,
    mode: ScheduleMode = "heartbeat"
  ): boolean {
    if (this.scheduler.has(conversationId, taskId)) {
      return false;
    }

    this.scheduler.start(
      conversationId,
      taskId,
      intervalMs,
      mode,
      async () => {
        const task = await this.manager.getTask(conversationId, taskId);

        if (!task) {
          this.scheduler.stop(conversationId, taskId);
          return;
        }

        if (["done", "failed", "canceled"].includes(task.status)) {
          this.scheduler.stop(conversationId, taskId);
          return;
        }

        if (mode === "heartbeat") {
          const updated = await this.manager.touchTaskHeartbeat(conversationId, taskId);
          if (!updated) {
            this.scheduler.stop(conversationId, taskId);
            return;
          }

          const text = String(this.manager.renderTask(updated, "text"));

          await this.pushIfPossible({
            conversationId,
            taskId,
            text,
            mode,
          });
          await this.onTaskTick?.({ conversationId, taskId, mode });

          return;
        }

        if (mode === "summary") {
          const summary = this.manager.buildSummary(task);

          if (!summary) {
            this.scheduler.stop(conversationId, taskId);
            return;
          }

          const updated = await this.manager.updateTask(conversationId, {
            taskId,
            label: `Scheduled summary: ${task.label}`,
            stage: task.stage,
            status: task.status,
            percent: task.percent,
            parentTaskId: task.parentTaskId,
            model: task.model,
          });

          const text = `${summary}\n\n${String(this.manager.renderTask(updated, "text"))}`;

          await this.pushIfPossible({
            conversationId,
            taskId,
            text,
            mode,
          });
          await this.onTaskTick?.({ conversationId, taskId, mode });
        }
      }
    );

    return true;
  }

  startHeartbeat(conversationId: string, taskId: string, intervalMs: number): boolean {
    return this.start(conversationId, taskId, intervalMs, "heartbeat");
  }

  startSummary(conversationId: string, taskId: string, intervalMs: number): boolean {
    return this.start(conversationId, taskId, intervalMs, "summary");
  }

  stop(conversationId: string, taskId: string): boolean {
    if (!this.scheduler.has(conversationId, taskId)) {
      return false;
    }

    this.scheduler.stop(conversationId, taskId);
    return true;
  }

  stopAll(): void {
    this.scheduler.stopAll();
  }

  has(conversationId: string, taskId: string): boolean {
    return this.scheduler.has(conversationId, taskId);
  }

  get(conversationId: string, taskId: string): ScheduledTaskInfo | undefined {
    return this.scheduler.get(conversationId, taskId);
  }

  list(conversationId?: string): ScheduledTaskInfo[] {
    return this.scheduler.list(conversationId);
  }
}
