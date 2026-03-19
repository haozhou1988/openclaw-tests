import { TaskStateMachine, type ProgressStatus } from "./state/TaskStateMachine.js";
import { ProgressRenderer, type TaskState, type ProgressEvent } from "./render/ProgressRenderer.js";
import { MemoryAdapter, type PersistenceAdapter, type TaskRecordMap } from "./persistence/PersistenceAdapter.js";
import { WorkflowAnalytics } from "./analytics/WorkflowAnalytics.js";
import { TaskTreeManager } from "./tree/TaskTreeManager.js";
import { TaskScheduler } from "./scheduler/TaskScheduler.js";
import type { ActivityState, OutputMode } from "./types.js";
import { getTaskWatchdog } from "./utils.js";

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
  activityState?: ActivityState;
  waitingOn?: string;
  externalCallStartedAt?: number;
}

export interface ProgressManagerConfig {
  ttlMs?: number;
  defaultStages?: string[];
  staleAfterMs?: number;
}

export class ProgressManager {
  private stateMachine = new TaskStateMachine();
  private renderer: ProgressRenderer;
  private analytics = new WorkflowAnalytics();
  private treeManager = new TaskTreeManager();
  public scheduler = new TaskScheduler();
  private ttlMs: number;
  private defaultStages: string[];
  private staleAfterMs: number;

  constructor(
    private adapter: PersistenceAdapter = new MemoryAdapter(),
    config: ProgressManagerConfig = {}
  ) {
    this.ttlMs = config.ttlMs ?? 600000;
    this.defaultStages = config.defaultStages ?? ["start", "research", "draft", "done"];
    this.staleAfterMs = config.staleAfterMs ?? 180000;
    this.renderer = new ProgressRenderer({ staleAfterMs: this.staleAfterMs });
  }

  private normalizePercent(percent?: number): number | undefined {
    if (percent === undefined || percent === null || Number.isNaN(percent)) return undefined;
    return Math.max(0, Math.min(100, Math.round(percent)));
  }

  private normalizeWeight(weight?: number): number | undefined {
    if (
      weight === undefined ||
      weight === null ||
      Number.isNaN(weight) ||
      !Number.isFinite(weight)
    ) {
      return undefined;
    }
    return weight > 0 ? weight : undefined;
  }

  private normalizeActivityState(activityState?: ActivityState): ActivityState | undefined {
    return activityState === "working" || activityState === "waiting_external"
      ? activityState
      : undefined;
  }

  private inferPercentFromStage(stage?: string): number | undefined {
    if (!stage) return undefined;
    const index = this.defaultStages.indexOf(stage);
    if (index < 0) return undefined;
    if (this.defaultStages.length === 1) return 100;
    return Math.round((index / (this.defaultStages.length - 1)) * 100);
  }

  private inferStageFromPercent(percent?: number): string | undefined {
    const safe = this.normalizePercent(percent);
    if (safe === undefined || this.defaultStages.length === 0) return undefined;
    if (this.defaultStages.length === 1) return this.defaultStages[0];

    const index = Math.min(
      this.defaultStages.length - 1,
      Math.round((safe / 100) * (this.defaultStages.length - 1))
    );
    return this.defaultStages[index];
  }

  private inferPercentFromHistory(task: TaskState): number | undefined {
    if (task.status === "done") return 100;
    if (task.status === "queued") return 0;

    const realUpdates = task.history.filter((event) => !event.heartbeat).length;
    const updates = Math.max(1, realUpdates);
    const cap = task.status === "failed" || task.status === "canceled" ? 95 : 90;
    return Math.min(cap, updates * 12);
  }

  private childTasks(tasks: TaskRecordMap, parentTaskId: string): TaskState[] {
    return Object.values(tasks).filter((task) => task.parentTaskId === parentTaskId);
  }

  private computeDerivedPercent(
    taskId: string,
    tasks: TaskRecordMap,
    visiting = new Set<string>()
  ): number | undefined {
    const task = tasks[taskId];
    if (!task) return undefined;
    if (visiting.has(taskId)) return task.percent;

    visiting.add(taskId);
    const children = this.childTasks(tasks, taskId);

    if (children.length > 0) {
      const childProgress = children
        .map((child) => ({
          percent: this.computeDerivedPercent(child.taskId, tasks, visiting),
          weight: this.normalizeWeight(child.weight) ?? 1,
        }))
        .filter((value): value is { percent: number; weight: number } => value.percent !== undefined);

      if (childProgress.length > 0) {
        const totalWeight = childProgress.reduce((sum, child) => sum + child.weight, 0);
        visiting.delete(taskId);
        return this.normalizePercent(
          childProgress.reduce((sum, child) => sum + child.percent * child.weight, 0) /
            Math.max(1, totalWeight)
        );
      }
    }

    visiting.delete(taskId);

    const stagePercent = this.inferPercentFromStage(task.stage);
    if (stagePercent !== undefined) {
      return stagePercent;
    }

    const hasExplicitPercent = task.history.some((event) => event.percent !== undefined);
    if (hasExplicitPercent) {
      return this.normalizePercent(task.percent);
    }

    return this.inferPercentFromHistory(task);
  }

  private computeDerivedStatus(
    taskId: string,
    tasks: TaskRecordMap,
    visiting = new Set<string>()
  ): ProgressStatus | undefined {
    const task = tasks[taskId];
    if (!task) return undefined;
    if (visiting.has(taskId)) return task.status as ProgressStatus;

    visiting.add(taskId);
    const children = this.childTasks(tasks, taskId);

    if (children.length === 0) {
      visiting.delete(taskId);
      return task.status as ProgressStatus;
    }

    const childStatuses = children
      .map((child) => this.computeDerivedStatus(child.taskId, tasks, visiting))
      .filter((status): status is ProgressStatus => status !== undefined);

    visiting.delete(taskId);

    if (childStatuses.length === 0) {
      return task.status as ProgressStatus;
    }

    if (childStatuses.every((status) => status === "done")) {
      return "done";
    }

    if (childStatuses.some((status) => status === "failed")) {
      return "failed";
    }

    if (childStatuses.some((status) => status === "blocked")) {
      return "blocked";
    }

    if (childStatuses.some((status) => status === "retrying")) {
      return "retrying";
    }

    if (childStatuses.some((status) => status === "running")) {
      return "running";
    }

    if (childStatuses.every((status) => status === "canceled")) {
      return "canceled";
    }

    if (childStatuses.every((status) => status === "queued")) {
      return "queued";
    }

    return "running";
  }

  private computeDerivedStage(
    taskId: string,
    tasks: TaskRecordMap,
    visiting = new Set<string>()
  ): string | undefined {
    const task = tasks[taskId];
    if (!task) return undefined;
    if (visiting.has(taskId)) return task.stage ?? this.inferStageFromPercent(task.percent);

    visiting.add(taskId);
    const children = this.childTasks(tasks, taskId);

    if (children.length === 0) {
      visiting.delete(taskId);
      return task.stage ?? this.inferStageFromPercent(task.percent);
    }

    const childSnapshots = children.map((child) => ({
      status: this.computeDerivedStatus(child.taskId, tasks, new Set(visiting)),
      stage: this.computeDerivedStage(child.taskId, tasks, new Set(visiting)),
      percent: this.computeDerivedPercent(child.taskId, tasks, new Set(visiting)),
    }));

    visiting.delete(taskId);

    if (childSnapshots.every((child) => child.status === "done")) {
      return this.defaultStages[this.defaultStages.length - 1] ?? task.stage;
    }

    const activeStages = childSnapshots
      .filter((child) => child.status !== "done" && child.status !== "canceled")
      .map((child) => child.stage ?? this.inferStageFromPercent(child.percent))
      .filter((stage): stage is string => Boolean(stage));

    if (activeStages.length > 0) {
      return activeStages.sort(
        (a, b) => this.defaultStages.indexOf(a) - this.defaultStages.indexOf(b)
      )[0];
    }

    const anyStage = childSnapshots
      .map((child) => child.stage ?? this.inferStageFromPercent(child.percent))
      .filter((stage): stage is string => Boolean(stage));

    if (anyStage.length > 0) {
      return anyStage.sort(
        (a, b) => this.defaultStages.indexOf(a) - this.defaultStages.indexOf(b)
      )[0];
    }

    return task.stage ?? this.inferStageFromPercent(task.percent);
  }

  private descendantTasks(tasks: TaskRecordMap, parentTaskId: string): TaskState[] {
    const descendants: TaskState[] = [];
    const queue = this.childTasks(tasks, parentTaskId);

    while (queue.length > 0) {
      const task = queue.shift();
      if (!task) continue;
      descendants.push(task);
      queue.push(...this.childTasks(tasks, task.taskId));
    }

    return descendants;
  }

  private findDominantWaitingChild(
    parent: TaskState,
    tasks: TaskRecordMap,
    now: number
  ): { state: "waiting_external" | "waiting_external_slow"; waitingOn?: string } | undefined {
    const candidates = this.descendantTasks(tasks, parent.taskId)
      .filter((task) => !["done", "failed", "canceled"].includes(task.status))
      .map((task) => ({
        task,
        watchdog: getTaskWatchdog(task, this.staleAfterMs, now),
      }))
      .filter(
        (
          entry
        ): entry is {
          task: TaskState;
          watchdog: ReturnType<typeof getTaskWatchdog> & {
            state: "waiting_external" | "waiting_external_slow";
          };
        } =>
          entry.watchdog.state === "waiting_external" ||
          entry.watchdog.state === "waiting_external_slow"
      )
      .sort((a, b) => {
        const priority = (state: "waiting_external" | "waiting_external_slow") =>
          state === "waiting_external_slow" ? 0 : 1;
        const byPriority =
          priority(a.watchdog.state) - priority(b.watchdog.state);
        if (byPriority !== 0) return byPriority;
        return b.task.updatedAt - a.task.updatedAt;
      });

    if (candidates.length === 0) return undefined;
    return {
      state: candidates[0].watchdog.state,
      waitingOn: candidates[0].watchdog.waitingOn,
    };
  }

  private summarizeChildrenLabel(parent: TaskState, tasks: TaskRecordMap, now: number): string {
    const children = this.childTasks(tasks, parent.taskId);
    if (children.length === 0) {
      return parent.label;
    }

    const dominantWaitingChild = this.findDominantWaitingChild(parent, tasks, now);
    if (dominantWaitingChild?.state === "waiting_external_slow") {
      return `external call slow (${dominantWaitingChild.waitingOn ?? "external"})`;
    }
    if (dominantWaitingChild?.state === "waiting_external") {
      return `waiting on ${dominantWaitingChild.waitingOn ?? "external"}`;
    }

    const total = children.length;
    {
      const usesWeightedProgress = children.some(
        (child) => (this.normalizeWeight(child.weight) ?? 1) !== 1
      );
      const derivedPercent = this.computeDerivedPercent(parent.taskId, tasks);
      const counts = {
        done: children.filter((child) => child.status === "done").length,
        running: children.filter((child) => child.status === "running").length,
        blocked: children.filter((child) => child.status === "blocked").length,
        retrying: children.filter((child) => child.status === "retrying").length,
        failed: children.filter((child) => child.status === "failed").length,
        queued: children.filter((child) => child.status === "queued").length,
        canceled: children.filter((child) => child.status === "canceled").length,
      };

      if (counts.done === total) {
        return usesWeightedProgress && derivedPercent !== undefined
          ? `${derivedPercent}% complete (weighted), all ${total} child tasks complete`
          : `All ${total} child tasks complete`;
      }

      const parts = [`${counts.done}/${total} child tasks complete`];

      if (counts.running > 0) parts.push(`${counts.running} running`);
      if (counts.blocked > 0) parts.push(`${counts.blocked} blocked`);
      if (counts.retrying > 0) parts.push(`${counts.retrying} retrying`);
      if (counts.failed > 0) parts.push(`${counts.failed} failed`);
      if (counts.queued > 0) parts.push(`${counts.queued} queued`);
      if (counts.canceled > 0) parts.push(`${counts.canceled} canceled`);

      if (usesWeightedProgress && derivedPercent !== undefined) {
        parts.unshift(`${derivedPercent}% complete (weighted)`);
      }

      return parts.join(", ");
    }
    const usesWeightedProgress = children.some((child) => (this.normalizeWeight(child.weight) ?? 1) !== 1);
    const derivedPercent = this.computeDerivedPercent(parent.taskId, tasks);
    const counts = {
      done: children.filter((child) => child.status === "done").length,
      running: children.filter((child) => child.status === "running").length,
      blocked: children.filter((child) => child.status === "blocked").length,
      retrying: children.filter((child) => child.status === "retrying").length,
      failed: children.filter((child) => child.status === "failed").length,
      queued: children.filter((child) => child.status === "queued").length,
      canceled: children.filter((child) => child.status === "canceled").length,
    };

    if (counts.done === total) {
      return usesWeightedProgress && derivedPercent !== undefined
        ? `已完成 ${derivedPercent}%（按权重），全部 ${total} 个子任务已完成`
        : `全部 ${total} 个子任务已完成`;
    }

    const parts = [`${counts.done}/${total} 子任务已完成`];

    if (counts.running > 0) parts.push(`${counts.running} 个运行中`);
    if (counts.blocked > 0) parts.push(`${counts.blocked} 个阻塞中`);
    if (counts.retrying > 0) parts.push(`${counts.retrying} 个重试中`);
    if (counts.failed > 0) parts.push(`${counts.failed} 个失败`);
    if (counts.queued > 0) parts.push(`${counts.queued} 个待开始`);
    if (counts.canceled > 0) parts.push(`${counts.canceled} 个已取消`);

    if (usesWeightedProgress && derivedPercent !== undefined) {
      parts.unshift(`已完成 ${derivedPercent}%（按权重）`);
    }

    return parts.join("，");
  }

  private syncAncestorProgress(tasks: TaskRecordMap, taskId: string, now: number): void {
    let currentParentId = tasks[taskId]?.parentTaskId;

    while (currentParentId) {
      const parent = tasks[currentParentId];
      if (!parent) break;

      const derivedPercent = this.computeDerivedPercent(parent.taskId, tasks);
      const nextPercent = derivedPercent ?? parent.percent;
      const nextStatus = this.computeDerivedStatus(parent.taskId, tasks) ?? (parent.status as ProgressStatus);
      const nextStage = this.computeDerivedStage(parent.taskId, tasks) ?? parent.stage;
      const nextLabel = this.summarizeChildrenLabel(parent, tasks, now);

      if (
        (nextPercent !== undefined && nextPercent !== parent.percent) ||
        nextStatus !== parent.status ||
        nextStage !== parent.stage ||
        nextLabel !== parent.label
      ) {
        const event: ProgressEvent = {
          ts: now,
          label: nextLabel,
          percent: nextPercent,
          stage: nextStage,
          model: parent.model,
          status: nextStatus,
        };

        tasks[currentParentId] = {
          ...parent,
          label: nextLabel,
          percent: nextPercent,
          stage: nextStage,
          status: nextStatus,
          activityState: parent.activityState,
          waitingOn: parent.waitingOn,
          updatedAt: now,
          lastActivityAt: now,
          expiresAt: now + this.ttlMs,
          history: [...parent.history, event],
        };
      }

      currentParentId = parent.parentTaskId;
    }
  }

  private syncAncestorHeartbeat(tasks: TaskRecordMap, taskId: string, now: number): void {
    let currentParentId = tasks[taskId]?.parentTaskId;

    while (currentParentId) {
      const parent = tasks[currentParentId];
      if (!parent) break;

      const nextLabel = this.summarizeChildrenLabel(parent, tasks, now);
      const event: ProgressEvent = {
        ts: now,
        label: nextLabel,
        percent: parent.percent,
        stage: parent.stage,
        model: parent.model,
        status: parent.status,
        heartbeat: true,
        activityState: parent.activityState,
        waitingOn: parent.waitingOn,
      };

      tasks[currentParentId] = {
        ...parent,
        label: nextLabel,
        updatedAt: now,
        lastHeartbeatAt: now,
        expiresAt: now + this.ttlMs,
        history: [...parent.history, event],
      };

      currentParentId = parent.parentTaskId;
    }
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

    const inputPercent = this.normalizePercent(input.percent);
    const inputWeight = this.normalizeWeight(input.weight);
    const inputActivityState = this.normalizeActivityState(input.activityState);
    const nextActivityState =
      inputActivityState ??
      (input.heartbeat
        ? existing?.activityState
        : undefined);
    const nextWaitingOn =
      nextActivityState === "waiting_external"
        ? input.waitingOn ?? existing?.waitingOn
        : undefined;
    const nextExternalCallStartedAt =
      nextActivityState === "waiting_external"
        ? input.externalCallStartedAt ??
          (existing?.activityState === "waiting_external"
            ? existing.externalCallStartedAt
            : now)
        : undefined;
    const percent = inputPercent ?? this.inferPercentFromStage(input.stage);

    const event: ProgressEvent = {
      ts: now,
      label: input.label,
      percent,
      stage: input.stage,
      model: input.model,
      status: nextStatus,
      heartbeat: input.heartbeat,
      activityState: nextActivityState,
      waitingOn: nextWaitingOn,
    };

    const task: TaskState = existing
      ? {
          ...existing,
          label: input.label,
          weight: inputWeight ?? existing.weight,
          percent: percent ?? existing.percent,
          stage: input.stage ?? existing.stage,
          model: input.model ?? existing.model,
          status: nextStatus,
          activityState: nextActivityState,
          waitingOn: nextWaitingOn,
          externalCallStartedAt: nextExternalCallStartedAt,
          parentTaskId: input.parentTaskId ?? existing.parentTaskId,
          updatedAt: now,
          lastActivityAt: input.heartbeat
            ? (existing.lastActivityAt ?? existing.updatedAt)
            : now,
          lastHeartbeatAt: input.heartbeat ? now : existing.lastHeartbeatAt,
          expiresAt: now + this.ttlMs,
          history: [...existing.history, event],
        }
      : {
          taskId: input.taskId,
          conversationId,
          parentTaskId: input.parentTaskId,
          label: input.label,
          weight: inputWeight,
          percent,
          stage: input.stage,
          model: input.model,
          status: nextStatus,
          activityState: nextActivityState,
          waitingOn: nextWaitingOn,
          externalCallStartedAt: nextExternalCallStartedAt,
          createdAt: now,
          updatedAt: now,
          lastActivityAt: now,
          lastHeartbeatAt: input.heartbeat ? now : undefined,
          expiresAt: now + this.ttlMs,
          history: [event],
        };

    tasks[input.taskId] = task;
    const derivedPercent = this.computeDerivedPercent(input.taskId, tasks);
    if (derivedPercent !== undefined && derivedPercent !== task.percent) {
      tasks[input.taskId] = {
        ...tasks[input.taskId],
        percent: derivedPercent,
      };
    }

    this.syncAncestorProgress(tasks, input.taskId, now);
    await this.adapter.saveConversation(conversationId, tasks);
    return tasks[input.taskId];
  }

  async touchTaskHeartbeat(
    conversationId: string,
    taskId: string
  ): Promise<TaskState | undefined> {
    const tasks = await this.adapter.loadConversation(conversationId);
    this.cleanupExpired(tasks);

    const existing = tasks[taskId];
    if (!existing) return undefined;

    const now = Date.now();
    const event: ProgressEvent = {
      ts: now,
      label: existing.label,
      percent: existing.percent,
      stage: existing.stage,
      model: existing.model,
      status: existing.status,
      heartbeat: true,
      activityState: existing.activityState,
      waitingOn: existing.waitingOn,
    };

    tasks[taskId] = {
      ...existing,
      updatedAt: now,
      lastHeartbeatAt: now,
      expiresAt: now + this.ttlMs,
      history: [...existing.history, event],
    };

    this.syncAncestorHeartbeat(tasks, taskId, now);
    await this.adapter.saveConversation(conversationId, tasks);
    return tasks[taskId];
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
      if (task.weight !== undefined) parts.push(`Weight=${task.weight}`);
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

  async ancestorsOfTask(conversationId: string, taskId: string): Promise<TaskState[]> {
    const tasks = await this.adapter.loadConversation(conversationId);
    this.cleanupExpired(tasks);

    const ancestors: TaskState[] = [];
    let currentParentId = tasks[taskId]?.parentTaskId;

    while (currentParentId) {
      const parent = tasks[currentParentId];
      if (!parent) break;
      ancestors.push(parent);
      currentParentId = parent.parentTaskId;
    }

    return ancestors;
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
        staleAfterMs: this.staleAfterMs,
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
