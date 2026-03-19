export type ProgressStatus =
  | "queued"
  | "running"
  | "blocked"
  | "retrying"
  | "done"
  | "failed"
  | "canceled";

export type OutputMode = "text" | "compact" | "json";

export interface ProgressEvent {
  ts: number;
  label: string;
  percent?: number;
  stage?: string;
  model?: string;
  status?: ProgressStatus;
  heartbeat?: boolean;
}

export interface TaskState {
  taskId: string;
  conversationId: string;
  parentTaskId?: string;
  label: string;
  weight?: number;
  percent?: number;
  stage?: string;
  model?: string;
  status: ProgressStatus;
  createdAt: number;
  updatedAt: number;
  lastActivityAt?: number;
  lastHeartbeatAt?: number;
  expiresAt?: number;
  history: ProgressEvent[];
}

export interface PluginConfig {
  ttlMs?: number;
  injectPromptContext?: boolean;
  promptContextLimit?: number;
  defaultStages?: string[];
  persistenceMode?: "memory" | "file";
  persistenceDir?: string;
  staleAfterMs?: number;
  autoHeartbeatOnProgress?: boolean;
}

export interface UpdateProgressInput {
  taskId: string;
  label: string;
  weight?: number;
  percent?: number;
  stage?: string;
  model?: string;
  status?: ProgressStatus;
  parentTaskId?: string;
  heartbeat?: boolean;
}

export interface GetProgressInput {
  taskId: string;
  outputMode?: OutputMode;
}

export interface ListProgressInput {
  status?: ProgressStatus;
  outputMode?: OutputMode;
}

export interface ClearProgressInput {
  taskId?: string;
  all?: boolean;
}

export interface SummaryInput {
  taskId: string;
  outputMode?: OutputMode;
}

export interface ReplayInput {
  taskId: string;
  outputMode?: OutputMode;
}

export interface MetricsInput {
  taskId: string;
  outputMode?: OutputMode;
}

export interface ChildrenInput {
  taskId: string;
  outputMode?: OutputMode;
}

export interface TreeInput {
  taskId?: string;
  outputMode?: OutputMode;
}

export interface ConversationsInput {
  outputMode?: OutputMode;
}

export interface HealthInput {
  outputMode?: OutputMode;
}

export interface CleanupInput {
  outputMode?: OutputMode;
  rebuildIndex?: boolean;
  removeEmptyConversations?: boolean;
}

export type ScheduleMode = "heartbeat" | "summary";

export interface ScheduleInput {
  taskId: string;
  intervalMs?: number;
  mode?: ScheduleMode;
  enabled?: boolean;
}

export interface UnscheduleInput {
  taskId: string;
}

export interface ScheduledTaskInfo {
  taskId: string;
  conversationId: string;
  intervalMs: number;
  mode: ScheduleMode;
  startedAt: number;
}

export interface SchedulerConfig {
  enableScheduledUpdates?: boolean;
  defaultUpdateIntervalMs?: number;
}

export interface PluginConfig {
  ttlMs?: number;
  injectPromptContext?: boolean;
  promptContextLimit?: number;
  defaultStages?: string[];
  persistenceMode?: "memory" | "file";
  persistenceDir?: string;
  enableScheduledUpdates?: boolean;
  defaultUpdateIntervalMs?: number;
  pushScheduledMessages?: boolean;
  feishuAppId?: string;
  feishuAppSecret?: string;
  staleAfterMs?: number;
  autoHeartbeatOnProgress?: boolean;
}

export interface PinCardInput {
  taskId: string;
  receiveId: string;
  receiveIdType?: "open_id" | "user_id" | "union_id" | "chat_id" | "email";
  showSummary?: boolean;
}

export interface UnpinCardInput {
  taskId: string;
}

export interface RefreshCardInput {
  taskId: string;
  showSummary?: boolean;
}

export interface WorkflowMetrics {
  totalDurationMs: number;
  updateCount: number;
  retryCount: number;
  blockCount: number;
  stageDurations: Record<string, number>;
  longestStage?: string;
}

export type TaskRecordMap = Record<string, TaskState>;
