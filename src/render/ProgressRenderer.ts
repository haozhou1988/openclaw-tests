import { progressBar } from "../utils.js";
import type { OutputMode, ProgressEvent, TaskState } from "../types.js";

export type { OutputMode, ProgressEvent, TaskState } from "../types.js";

export interface RenderOptions {
  mode?: OutputMode;
}

export class ProgressRenderer {
  renderTask(task: TaskState, options: RenderOptions = {}): string | object {
    const mode = options.mode ?? "text";

    if (mode === "json") {
      return {
        taskId: task.taskId,
        label: task.label,
        weight: task.weight,
        stage: task.stage,
        status: task.status,
        percent: task.percent,
        model: task.model,
        updatedAt: task.updatedAt,
      };
    }

    if (mode === "compact") {
      const parts = [
        task.taskId,
        task.stage ? `stage=${task.stage}` : "",
        `status=${task.status}`,
        task.weight !== undefined ? `weight=${task.weight}` : "",
        task.percent !== undefined ? `percent=${task.percent}` : "",
        `label=${task.label}`,
      ].filter(Boolean);
      return parts.join(" | ");
    }

    const headerParts: string[] = [];
    if (task.stage) headerParts.push(`[${task.stage}]`);
    if (task.status !== "running") headerParts.push(`[${task.status}]`);
    if (task.model) headerParts.push(`[${task.model}]`);
    headerParts.push(task.label);

    const header = headerParts.join(" ");
    const bar = task.percent !== undefined
      ? `\n${this.progressBar(task.percent)} ${task.percent}%`
      : "";

    return `${header}${bar}`;
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
    return `状态：${data.ok ? "healthy" : "unhealthy"}。conversation 数量：${data.conversationCount}。配置：ttlMs=${data.config?.ttlMs}, promptContextLimit=${data.config?.promptContextLimit}。`;
  }

  renderCleanup(data: any, mode: OutputMode = "text"): string | object {
    if (mode === "json") return data;
    if (mode === "compact") {
      return `removedEmpty=${data.removedEmpty} | rebuiltIndex=${data.rebuiltIndex} | remaining=${data.remainingConversationCount}`;
    }
    return `已移除空 conversation ${data.removedEmpty} 个。索引重建：${data.rebuiltIndex ? "是" : "否"}。当前剩余 conversation ${data.remainingConversationCount} 个。`;
  }
}
