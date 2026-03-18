import { TaskStateMachine, type ProgressStatus } from "./state/TaskStateMachine.js";
import { ProgressRenderer, type TaskState, type ProgressEvent } from "./render/ProgressRenderer.js";
import { MemoryAdapter, type PersistenceAdapter, type TaskRecordMap } from "./persistence/PersistenceAdapter.js";
import { WorkflowAnalytics } from "./analytics/WorkflowAnalytics.js";
import { TaskTreeManager } from "./tree/TaskTreeManager.js";
import { TaskScheduler } from "./scheduler/TaskScheduler.js";

export interface UpdateProgressInput {
  taskId: string;
  label: string;
  percent?: number;
  stage?: string;
  model?: string;
  status?: ProgressStatus;
  parentTaskId?: string;
}

export interface ProgressManagerConfig {
  ttlMs?: number;
  defaultStages?: string[];
}

export class ProgressManager {
  private stateMachine = new TaskStateMachine();
  private renderer = new ProgressRenderer();
  private analytics = new WorkflowAnalytics();
  private treeManager = new TaskTreeManager();
  public scheduler = new TaskScheduler();
  private ttlMs: number;
  private defaultStages: string[];

  constructor(
    private adapter: PersistenceAdapter = new MemoryAdapter(),
    config: ProgressManagerConfig = {}
  ) {
    this.ttlMs = config.ttlMs ?? 600000;
    this.defaultStages = config.defaultStages ?? ["start", "research", "draft", "done"];
  }

  private normalizePercent(percent?: number): number | undefined {
    if (percent === undefined || percent === null || Number.isNaN(percent)) return undefined;
    return Math.max(0, Math.min(100, Math.round(percent)));
  }

  private inferPercentFromStage(stage?: string): number | undefined {
    if (!stage) return undefined;
    const index = this.defaultStages.indexOf(stage);
    if (index < 0) return undefined;
    if (this.defaultStages.length === 1) return 100;
    return Math.round((index / (this.defaultStages.length - 1)) * 100);
  }

  private cleanupExpired(tasks: TaskRecordMap): void {
    const now = Date.now();
    for (const [taskId, task] of Object.entries(tasks)) {
      if (task.expiresAt && now > task.expiresAt) {
        delete tasks[taskId];
      }
    }
  }

  async updateTask(conversationId: string, input: UpdateProgressInput): Promise<TaskState> {
    const tasks = await this.adapter.loadConversation(conversationId);
    this.cleanupExpired(tasks);
    
    const existing = tasks[input.taskId];
    const now = Date.now();

    const nextStatus = existing
      ? this.stateMachine.nextStatus(existing.status as ProgressStatus, input.status)
      : (input.status ?? "running");

    const percent = this.normalizePercent(input.percent) ?? this.inferPercentFromStage(input.stage);

    const event: ProgressEvent = {
      ts: now,
      label: input.label,
      percent,
      stage: input.stage,
      model: input.model,
      status: nextStatus,
    };

    const task: TaskState = existing
      ? {
          ...existing,
          label: input.label,
          percent: percent ?? existing.percent,
          stage: input.stage ?? existing.stage,
          model: input.model ?? existing.model,
          status: nextStatus,
          parentTaskId: input.parentTaskId ?? existing.parentTaskId,
          updatedAt: now,
          expiresAt: now + this.ttlMs,
          history: [...existing.history, event],
        }
      : {
          taskId: input.taskId,
          conversationId,
          parentTaskId: input.parentTaskId,
          label: input.label,
          percent,
          stage: input.stage,
          model: input.model,
          status: nextStatus,
          createdAt: now,
          updatedAt: now,
          expiresAt: now + this.ttlMs,
          history: [event],
        };

    tasks[input.taskId] = task;
    await this.adapter.saveConversation(conversationId, tasks);
    return task;
  }

  async getTask(conversationId: string, taskId: string): Promise<TaskState | undefined> {
    const tasks = await this.adapter.loadConversation(conversationId);
    this.cleanupExpired(tasks);
    return tasks[taskId];
  }

  async listTasks(conversationId: string, status?: ProgressStatus): Promise<TaskState[]> {
    const tasks = await this.adapter.loadConversation(conversationId);
    this.cleanupExpired(tasks);
    const list = Object.values(tasks).sort((a, b) => b.updatedAt - a.updatedAt);
    return status ? list.filter((t) => t.status === status) : list;
  }

  async listActiveTasks(conversationId: string, limit = 3): Promise<TaskState[]> {
    const tasks = await this.listTasks(conversationId);
    return tasks
      .filter((t) => t.status !== "done" && t.status !== "failed" && t.status !== "canceled")
      .slice(0, limit);
  }

  async clearTask(conversationId: string, taskId?: string, clearAll = false): Promise<number> {
    const tasks = await this.adapter.loadConversation(conversationId);
    
    if (clearAll) {
      const count = Object.keys(tasks).length;
      await this.adapter.deleteConversation(conversationId);
      return count;
    }

    if (taskId && tasks[taskId]) {
      delete tasks[taskId];
      await this.adapter.saveConversation(conversationId, tasks);
      return 1;
    }

    return 0;
  }

  async getSummary(conversationId: string, taskId: string): Promise<string | undefined> {
    const task = await this.getTask(conversationId, taskId);
    if (!task) return undefined;

    const totalMs = Math.max(0, task.updatedAt - task.createdAt);
    const stageTrail = task.history.map((h) => h.stage).filter(Boolean);
    const deduped = stageTrail.filter((s, i) => i === 0 || s !== stageTrail[i - 1]);
    const stageText = deduped.length > 0 ? deduped.join(" → ") : "未记录";
    const latest = task.history[task.history.length - 1];

    const parts = [
      `任务 ${task.taskId} 当前状态为 ${task.status}。`,
      `共更新 ${task.history.length} 次，阶段轨迹：${stageText}。`,
      `当前标签：${task.label}${task.percent !== undefined ? `（${task.percent}%）` : ""}。`,
    ];

    if (latest?.model) parts.push(`最近一次模型：${latest.model}。`);
    parts.push(`累计时长约 ${Math.round(totalMs / 1000)} 秒。`);
    parts.push(`最后更新时间：${new Date(task.updatedAt).toISOString()}。`);

    return parts.join("");
  }

  async getPromptContext(conversationId: string, limit = 2): Promise<string> {
    const tasks = await this.listActiveTasks(conversationId, limit);
    if (!tasks.length) return "";

    const lines = ["[Progress Context]"];

    for (const task of tasks) {
      const stageTrail = task.history.map((h) => h.stage).filter(Boolean);
      const deduped = stageTrail.filter((s, i) => i === 0 || s !== stageTrail[i - 1]);

      const parts = [
        `Task=${task.taskId}`,
        `Status=${task.status}`,
      ];
      if (task.stage) parts.push(`Stage=${task.stage}`);
      if (task.percent !== undefined) parts.push(`Percent=${task.percent}`);
      parts.push(`Label=${task.label}`);
      if (deduped.length) parts.push(`Trail=${deduped.join("->")}`);

      lines.push(`- ${parts.join(" | ")}`);
    }

    return lines.join("\n");
  }

  renderTask(task: TaskState, mode = "text"): string | object {
    return this.renderer.renderTask(task, { mode: mode as any });
  }

  renderTaskList(tasks: TaskState[], mode = "text"): string | object {
    return this.renderer.renderTaskList(tasks, { mode: mode as any });
  }

  renderReplay(text: string, mode = "text"): string | object {
    if (mode === "json") {
      return { replay: text };
    }
    return text;
  }

  async childrenOfTask(conversationId: string, taskId: string): Promise<TaskState[]> {
    const tasks = await this.listTasks(conversationId);
    return this.treeManager.getChildren(tasks, taskId);
  }

  async descendantsOfTask(conversationId: string, taskId: string): Promise<TaskState[]> {
    const tasks = await this.listTasks(conversationId);
    return this.treeManager.getDescendants(tasks, taskId);
  }

  async taskTree(conversationId: string, rootTaskId?: string) {
    const tasks = await this.listTasks(conversationId);

    if (!rootTaskId) {
      return this.treeManager.buildTree(tasks);
    }

    const subtree = this.treeManager.findSubtree(tasks, rootTaskId);
    return subtree ? [subtree] : [];
  }

  renderTree(nodes: any[], mode = "text") {
    if (mode === "json") {
      return nodes;
    }

    if (mode === "compact") {
      return this.treeManager
        .renderTreeText(nodes)
        .replace(/\n\s+/g, "\n");
    }

    return this.treeManager.renderTreeText(nodes);
  }

  async listConversations(): Promise<string[]> {
    if (typeof this.adapter.listConversations === "function") {
      return this.adapter.listConversations();
    }
    return [];
  }

  async health() {
    const adapterHealthy =
      typeof this.adapter.healthCheck === "function"
        ? await this.adapter.healthCheck()
        : true;

    const conversations =
      typeof this.adapter.listConversations === "function"
        ? await this.adapter.listConversations()
        : [];

    return {
      ok: adapterHealthy,
      conversationCount: conversations.length,
      conversations,
      config: {
        ttlMs: this.ttlMs,
        defaultStages: this.defaultStages,
      },
    };
  }

  async cleanup(options?: {
    rebuildIndex?: boolean;
    removeEmptyConversations?: boolean;
  }) {
    const rebuildIndex = options?.rebuildIndex ?? false;
    const removeEmptyConversations = options?.removeEmptyConversations ?? true;

    const conversations =
      typeof this.adapter.listConversations === "function"
        ? await this.adapter.listConversations()
        : [];

    let removedEmpty = 0;

    if (removeEmptyConversations) {
      for (const conversationId of conversations) {
        const loaded = await this.adapter.loadConversation(conversationId);
        const cleaned = this.cleanupExpiredWithResult(loaded);

        if (Object.keys(cleaned).length === 0) {
          await this.adapter.deleteConversation(conversationId);
          removedEmpty += 1;
        } else if (Object.keys(cleaned).length !== Object.keys(loaded).length) {
          await this.adapter.saveConversation(conversationId, cleaned);
        }
      }
    }

    let rebuiltCount: number | undefined;
    if (rebuildIndex && typeof this.adapter.rebuildIndex === "function") {
      rebuiltCount = await this.adapter.rebuildIndex();
    }

    const remaining =
      typeof this.adapter.listConversations === "function"
        ? await this.adapter.listConversations()
        : [];

    return {
      removedEmpty,
      rebuiltIndex: rebuildIndex,
      rebuiltCount,
      remainingConversationCount: remaining.length,
      remainingConversations: remaining,
    };
  }

  private cleanupExpiredWithResult(tasks: Record<string, TaskState>): Record<string, TaskState> {
    const now = Date.now();
    const cleaned: Record<string, TaskState> = {};
    for (const [id, task] of Object.entries(tasks)) {
      if (!task.expiresAt || now <= task.expiresAt) {
        cleaned[id] = task;
      }
    }
    return cleaned;
  }

  renderHealth(data: any, mode = "text") {
    return this.renderer.renderHealth(data, mode as any);
  }

  renderCleanup(data: any, mode = "text") {
    return this.renderer.renderCleanup(data, mode as any);
  }

  renderMetrics(data: any, mode = "text") {
    if (mode === "json") {
      return data;
    }
    if (mode === "compact") {
      const parts = [
        `duration=${Math.round(data.totalDurationMs / 1000)}s`,
        `updates=${data.updateCount}`,
        `retries=${data.retryCount}`,
        `blocks=${data.blockCount}`,
      ];
      return parts.join(" | ");
    }
    return this.analytics.buildMetricsText(data as any);
  }

  buildSummary(task: TaskState): string {
    return this.analytics.buildSummary(task);
  }

  renderSchedule(data: any, mode: OutputMode = "text") {
    if (mode === "json") return data;
    if (mode === "compact") {
      return `taskId=${data.taskId} | mode=${data.mode} | intervalMs=${data.intervalMs} | enabled=${data.enabled}`;
    }
    return `已为任务 ${data.taskId} 启用定时更新，模式=${data.mode}，间隔=${data.intervalMs}ms。`;
  }

  renderUnschedule(data: any, mode: OutputMode = "text") {
    if (mode === "json") return data;
    if (mode === "compact") {
      return `taskId=${data.taskId} | stopped=${data.stopped}`;
    }
    return data.stopped
      ? `已停止任务 ${data.taskId} 的定时更新。`
      : `任务 ${data.taskId} 当前没有运行中的定时更新。`;
  }

  getScheduler() {
    return this.scheduler;
  }
}
