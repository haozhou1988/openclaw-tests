import {
  describeTimestampAge,
  formatElapsedMs,
  getTaskWatchdog,
  progressBar,
} from "../utils.js";
import type { OutputMode, ProgressEvent, TaskState } from "../types.js";

export type { OutputMode, ProgressEvent, TaskState } from "../types.js";

export interface RenderOptions {
  mode?: OutputMode;
}

export class ProgressRenderer {
  constructor(private config: { staleAfterMs?: number } = {}) {}

  renderTask(task: TaskState, options: RenderOptions = {}): string | object {
    const mode = options.mode ?? "text";
    const watchdog = getTaskWatchdog(task, this.config.staleAfterMs);

    if (mode === "json") {
      return {
        taskId: task.taskId,
        label: task.label,
        weight: task.weight,
        stage: task.stage,
        status: task.status,
        activityState: task.activityState,
        waitingOn: task.waitingOn,
        externalCallStartedAt: task.externalCallStartedAt,
        percent: task.percent,
        model: task.model,
        updatedAt: task.updatedAt,
        lastActivityAt: task.lastActivityAt,
        lastHeartbeatAt: task.lastHeartbeatAt,
        watchdog,
      };
    }

    if (mode === "compact") {
      const parts = [
        task.taskId,
        task.stage ? `stage=${task.stage}` : "",
        `status=${task.status}`,
        watchdog.state !== "active" ? `attention=${watchdog.state}` : "",
        task.waitingOn ? `waitingOn=${task.waitingOn}` : "",
        `inactiveMs=${watchdog.inactiveForMs}`,
        task.weight !== undefined ? `weight=${task.weight}` : "",
        task.percent !== undefined ? `percent=${task.percent}` : "",
        `label=${task.label}`,
      ].filter(Boolean);
      return parts.join(" | ");
    }

    const headerParts: string[] = [];
    if (task.stage) headerParts.push(`[${task.stage}]`);
    if (task.status !== "running") headerParts.push(`[${task.status}]`);
    if (watchdog.state === "stale") headerParts.push("[stale]");
    if (watchdog.state === "waiting_external") {
      headerParts.push(`[waiting${watchdog.waitingOn ? `:${watchdog.waitingOn}` : ""}]`);
    }
    if (watchdog.state === "waiting_external_slow") {
      headerParts.push(`[api-slow${watchdog.waitingOn ? `:${watchdog.waitingOn}` : ""}]`);
    }
    if (task.model) headerParts.push(`[${task.model}]`);
    headerParts.push(task.label);

    const header = headerParts.join(" ");
    const bar =
      task.percent !== undefined
        ? `\n${this.progressBar(task.percent)} ${task.percent}%`
        : "";
    const activityParts = [
      `last activity ${describeTimestampAge(watchdog.lastActivityAt)}`,
    ];

    if (watchdog.lastHeartbeatAt !== undefined) {
      activityParts.push(`heartbeat ${describeTimestampAge(watchdog.lastHeartbeatAt)}`);
    }

    const activityLabel = `\n${this.renderWatchdogLine(watchdog, activityParts)}`;

    return `${header}${bar}${activityLabel}`;
  }

  renderTaskList(tasks: TaskState[], options: RenderOptions = {}): string | object {
    const mode = options.mode ?? "text";
    if (mode === "json") {
      return tasks.map((t) => this.renderTask(t, { mode: "json" }));
    }
    return tasks.map((t) => this.renderTask(t, options)).join("\n\n");
  }

  private progressBar(percent: number): string {
    return progressBar(percent);
  }

  renderConversations(conversations: string[], mode: OutputMode = "text"): string | object {
    if (mode === "json") return conversations;
    if (mode === "compact") return conversations.join(" | ");
    return conversations.join("\n");
  }

  renderHealth(data: any, mode: OutputMode = "text"): string | object {
    if (mode === "json") return data;
    if (mode === "compact") {
      return `ok=${data.ok} | conversationCount=${data.conversationCount} | ttlMs=${data.config?.ttlMs}`;
    }
    return `Status: ${data.ok ? "healthy" : "unhealthy"}. Conversations: ${data.conversationCount}. Config: ttlMs=${data.config?.ttlMs}, staleAfterMs=${data.config?.staleAfterMs}.`;
  }

  renderCleanup(data: any, mode: OutputMode = "text"): string | object {
    if (mode === "json") return data;
    if (mode === "compact") {
      return `removedEmpty=${data.removedEmpty} | rebuiltIndex=${data.rebuiltIndex} | remaining=${data.remainingConversationCount}`;
    }
    return `Removed ${data.removedEmpty} empty conversations. Rebuilt index: ${data.rebuiltIndex ? "yes" : "no"}. Remaining conversations: ${data.remainingConversationCount}.`;
  }

  private renderWatchdogLine(
    watchdog: ReturnType<typeof getTaskWatchdog>,
    activityParts: string[]
  ): string {
    if (watchdog.state === "stale") {
      return `watchdog: possibly stalled | ${activityParts.join(" | ")}`;
    }

    if (watchdog.state === "waiting_external") {
      return `activity: waiting on ${watchdog.waitingOn ?? "external"}${
        watchdog.waitingForMs !== undefined
          ? ` | waiting ${formatElapsedMs(watchdog.waitingForMs)}`
          : ""
      } | ${activityParts.join(" | ")}`;
    }

    if (watchdog.state === "waiting_external_slow") {
      return `watchdog: external call slow (${watchdog.waitingOn ?? "external"})${
        watchdog.waitingForMs !== undefined
          ? ` | waiting ${formatElapsedMs(watchdog.waitingForMs)}`
          : ""
      } | ${activityParts.join(" | ")}`;
    }

    return `activity: ${activityParts.join(" | ")}`;
  }
}
