import type { TaskState, ProgressEvent } from "../render/ProgressRenderer.js";

export interface WorkflowMetrics {
  totalDurationMs: number;
  updateCount: number;
  retryCount: number;
  blockCount: number;
  stageDurations: Record<string, number>;
  longestStage?: string;
}

export class WorkflowAnalytics {
  buildReplay(task: TaskState): string[] {
    return task.history.map((event) => {
      const ts = new Date(event.ts).toISOString();
      const parts = [ts];
      if (event.stage) parts.push(event.stage);
      if (event.status) parts.push(`status=${event.status}`);
      if (event.percent !== undefined) parts.push(`percent=${event.percent}`);
      parts.push(`label=${event.label}`);
      return parts.join(" | ");
    });
  }

  buildReplayText(task: TaskState): string {
    return this.buildReplay(task).join("\n");
  }

  buildMetrics(task: TaskState): WorkflowMetrics {
    const history = [...task.history].sort((a, b) => a.ts - b.ts);
    const totalDurationMs = Math.max(0, task.updatedAt - task.createdAt);
    const retryCount = history.filter((h) => h.status === "retrying").length;
    const blockCount = history.filter((h) => h.status === "blocked").length;

    const stageDurations: Record<string, number> = {};

    for (let i = 0; i < history.length; i++) {
      const current = history[i];
      const next = history[i + 1];
      if (!current.stage) continue;

      const duration = next ? next.ts - current.ts : task.updatedAt - current.ts;
      stageDurations[current.stage] = (stageDurations[current.stage] ?? 0) + Math.max(0, duration);
    }

    const longestStage = Object.entries(stageDurations).sort((a, b) => b[1] - a[1])[0]?.[0];

    return {
      totalDurationMs,
      updateCount: history.length,
      retryCount,
      blockCount,
      stageDurations,
      longestStage,
    };
  }

  buildMetricsText(task: TaskState): string {
    const m = this.buildMetrics(task);
    const stageSummary = Object.entries(m.stageDurations)
      .map(([stage, ms]) => `${stage}=${Math.round(ms / 1000)}s`)
      .join(", ");

    return [
      `任务 ${task.taskId} 总耗时约 ${Math.round(m.totalDurationMs / 1000)} 秒。`,
      `更新 ${m.updateCount} 次，阻塞 ${m.blockCount} 次，重试 ${m.retryCount} 次。`,
      stageSummary ? `阶段耗时：${stageSummary}。` : "",
      m.longestStage ? `最长阶段：${m.longestStage}。` : "",
    ].filter(Boolean).join("");
  }

  buildSummary(task: TaskState): string {
    const totalSec = Math.round((task.updatedAt - task.createdAt) / 1000);
    const stageTrail = task.history
      .map((h) => h.stage)
      .filter((s): s is string => Boolean(s));

    const dedupedStages = stageTrail.filter(
      (stage, idx) => idx === 0 || stage !== stageTrail[idx - 1]
    );

    return [
      `任务 ${task.taskId} 当前状态为 ${task.status}。`,
      `共更新 ${task.history.length} 次，阶段轨迹：${
        dedupedStages.length ? dedupedStages.join(" → ") : "未记录"
      }。`,
      `当前标签：${task.label}${task.percent !== undefined ? `（${task.percent}%）` : ""}。`,
      `累计时长约 ${totalSec} 秒。`,
      `最后更新时间：${new Date(task.updatedAt).toISOString()}。`,
    ].join("");
  }
}
