import type { ActivityState, ProgressStatus, TaskState } from "./types.js";

export function normalizePercent(percent?: number): number | undefined {
  if (percent === undefined || percent === null || Number.isNaN(percent)) {
    return undefined;
  }
  return Math.max(0, Math.min(100, Math.round(percent)));
}

export function inferPercentFromStage(
  stage?: string,
  defaultStages: string[] = ["start", "research", "draft", "done"]
): number | undefined {
  if (!stage) return undefined;
  const index = defaultStages.indexOf(stage);
  if (index === -1) return undefined;
  if (defaultStages.length === 1) return 100;
  return Math.round((index / (defaultStages.length - 1)) * 100);
}

export function progressBar(percent: number): string {
  const safe = Math.max(0, Math.min(100, Math.round(percent)));
  const width = 10;

  if (safe >= 100) {
    return `[${"=".repeat(width)}]`;
  }

  const filled = Math.min(width - 1, Math.floor((safe / 100) * width));
  return `[${"=".repeat(filled)}>${"-".repeat(width - filled - 1)}]`;
}

export interface TaskWatchdogInfo {
  state: "active" | "waiting_external" | "waiting_external_slow" | "stale";
  inactiveForMs: number;
  lastActivityAt: number;
  lastHeartbeatAt?: number;
  waitingOn?: string;
  waitingForMs?: number;
}

export function formatElapsedMs(ms: number): string {
  const safeMs = Math.max(0, Math.round(ms));
  const totalSeconds = Math.floor(safeMs / 1000);

  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }

  const totalMinutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (totalMinutes < 60) {
    return seconds === 0 ? `${totalMinutes}m` : `${totalMinutes}m ${seconds}s`;
  }

  const totalHours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `${totalHours}h` : `${totalHours}h ${minutes}m`;
}

export function describeTimestampAge(timestamp: number, now = Date.now()): string {
  return `${formatElapsedMs(Math.max(0, now - timestamp))} ago`;
}

export function getTaskWatchdog(
  task: Pick<
    TaskState,
    | "status"
    | "updatedAt"
    | "lastActivityAt"
    | "lastHeartbeatAt"
    | "activityState"
    | "waitingOn"
    | "externalCallStartedAt"
  >,
  staleAfterMs = 180000,
  now = Date.now()
): TaskWatchdogInfo {
  const lastActivityAt = task.lastActivityAt ?? task.updatedAt;
  const inactiveForMs = Math.max(0, now - lastActivityAt);
  const activeStatuses: ProgressStatus[] = ["running", "retrying"];
  const waitingState: ActivityState | undefined = task.activityState;
  const waitingStartedAt = task.externalCallStartedAt ?? lastActivityAt;
  const waitingForMs =
    waitingState === "waiting_external"
      ? Math.max(0, now - waitingStartedAt)
      : undefined;

  let state: TaskWatchdogInfo["state"] = "active";
  if (activeStatuses.includes(task.status)) {
    if (waitingState === "waiting_external") {
      state =
        waitingForMs !== undefined && waitingForMs >= staleAfterMs
          ? "waiting_external_slow"
          : "waiting_external";
    } else if (inactiveForMs >= staleAfterMs) {
      state = "stale";
    }
  }

  return {
    state,
    inactiveForMs,
    lastActivityAt,
    lastHeartbeatAt: task.lastHeartbeatAt,
    waitingOn: task.waitingOn,
    waitingForMs,
  };
}

export function pickConversationId(context: any): string {
  return (
    context?.conversation?.id ||
    context?.session?.conversationId ||
    context?.session?.id ||
    "default"
  );
}

export function pickModelName(
  context: any,
  explicitModel?: string
): string | undefined {
  if (explicitModel) return explicitModel;
  if (context?.session?.model?.name) return context.session.model.name;
  if (context?.session?.model?.primary) return context.session.model.primary;
  return undefined;
}
