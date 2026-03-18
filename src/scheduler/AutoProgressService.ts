import type { ProgressManager } from "../ProgressManager.js";
import type { ScheduleMode, ScheduledTaskInfo } from "../types.js";
import { TaskScheduler } from "./TaskScheduler.js";
import type { ProgressMessagePusher } from "./ProgressMessagePusher.js";

export class AutoProgressService {
  constructor(
    private manager: ProgressManager,
    private scheduler: TaskScheduler,
    private pusher?: ProgressMessagePusher
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
  ) {
    return this.scheduler.start(
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
          const updated = await this.manager.updateTask(conversationId, {
            taskId,
            label: `仍在处理中：${task.label}`,
            stage: task.stage,
            status: task.status,
            percent: task.percent,
            parentTaskId: task.parentTaskId,
            model: task.model,
          });

          const text = String(this.manager.renderTask(updated, "text"));

          await this.pushIfPossible({
            conversationId,
            taskId,
            text,
            mode,
          });

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
            label: `定时汇报：${task.label}`,
            stage: task.stage,
            status: task.status,
            percent: task.percent,
            parentTaskId: task.parentTaskId,
            model: task.model,
          });

          const text = String(this.manager.renderTask(updated, "text"));

          await this.pushIfPossible({
            conversationId,
            taskId,
            text,
            mode,
          });
        }
      }
    );
  }

  stop(conversationId: string, taskId: string): void {
    this.scheduler.stop(conversationId, taskId);
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
