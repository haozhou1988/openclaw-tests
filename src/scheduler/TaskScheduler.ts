import type { ScheduleMode, ScheduledTaskInfo } from "../types.js";

export interface ScheduledTaskHandle {
  taskId: string;
  conversationId: string;
  intervalMs: number;
  mode: ScheduleMode;
  stop(): void;
}

interface InternalTaskRecord extends ScheduledTaskInfo {
  timer: NodeJS.Timeout;
}

export class TaskScheduler {
  private timers = new Map<string, InternalTaskRecord>();

  private key(conversationId: string, taskId: string): string {
    return `${conversationId}::${taskId}`;
  }

  start(
    conversationId: string,
    taskId: string,
    intervalMs: number,
    mode: ScheduleMode,
    callback: () => Promise<void> | void
  ): ScheduledTaskHandle {
    const k = this.key(conversationId, taskId);
    this.stop(conversationId, taskId);

    const startedAt = Date.now();
    const timer = setInterval(() => {
      void callback();
    }, intervalMs);

    const record: InternalTaskRecord = {
      taskId,
      conversationId,
      intervalMs,
      mode,
      startedAt,
      timer,
    };

    this.timers.set(k, record);

    return {
      taskId,
      conversationId,
      intervalMs,
      mode,
      stop: () => this.stop(conversationId, taskId),
    };
  }

  stop(conversationId: string, taskId: string): void {
    const k = this.key(conversationId, taskId);
    const record = this.timers.get(k);
    if (record) {
      clearInterval(record.timer);
      this.timers.delete(k);
    }
  }

  stopAll(): void {
    for (const record of this.timers.values()) {
      clearInterval(record.timer);
    }
    this.timers.clear();
  }

  has(conversationId: string, taskId: string): boolean {
    return this.timers.has(this.key(conversationId, taskId));
  }

  get(conversationId: string, taskId: string): ScheduledTaskInfo | undefined {
    const record = this.timers.get(this.key(conversationId, taskId));
    if (!record) return undefined;

    const { timer: _timer, ...info } = record;
    return info;
  }

  list(conversationId?: string): ScheduledTaskInfo[] {
    const all = Array.from(this.timers.values()).map(({ timer: _timer, ...info }) => info);
    if (!conversationId) return all.sort((a, b) => a.startedAt - b.startedAt);
    return all
      .filter((item) => item.conversationId === conversationId)
      .sort((a, b) => a.startedAt - b.startedAt);
  }
}
