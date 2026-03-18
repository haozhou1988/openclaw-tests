import { Type } from "@sinclair/typebox";
import { ProgressManager, type UpdateProgressInput } from "./ProgressManager.js";
import { AutoProgressService } from "./scheduler/AutoProgressService.js";
import type { ProgressStatus } from "./state/TaskStateMachine.js";

export default function register(api: any) {
  api.logger.info("[progress-notifier] register() called");

  const config = {
    ttlMs: api?.config?.ttlMs ?? 600000,
    defaultStages: api?.config?.defaultStages ?? ["start", "research", "draft", "done"],
    injectPromptContext: api?.config?.injectPromptContext ?? true,
    promptContextLimit: api?.config?.promptContextLimit ?? 2,
    enableScheduledUpdates: api?.config?.enableScheduledUpdates ?? false,
    defaultUpdateIntervalMs: api?.config?.defaultUpdateIntervalMs ?? 60000,
  };

  const manager = new ProgressManager(undefined, config);
  const autoProgress = new AutoProgressService(manager, {
    enableScheduledUpdates: api?.config?.enableScheduledUpdates ?? false,
    defaultUpdateIntervalMs: api?.config?.defaultUpdateIntervalMs ?? 60000,
  });

  // Helper to get conversation ID from context
  function pickConversationId(context: any): string {
    return context?.conversation?.id || context?.session?.conversationId || context?.session?.id || "default";
  }

  // Helper to get model name from context
  function pickModelName(context: any, explicit?: string): string | undefined {
    if (explicit) return explicit;
    return context?.session?.model?.name || context?.session?.model?.primary;
  }

  // === progress_update ===
  api.registerTool({
    name: "progress_update",
    description: "Create or update staged progress for a task.",
    parameters: Type.Object({
      taskId: Type.String(),
      label: Type.String(),
      percent: Type.Optional(Type.Number()),
      stage: Type.Optional(Type.String()),
      model: Type.Optional(Type.String()),
      status: Type.Optional(Type.Union([
        Type.Literal("queued"),
        Type.Literal("running"),
        Type.Literal("blocked"),
        Type.Literal("retrying"),
        Type.Literal("failed"),
        Type.Literal("canceled"),
        Type.Literal("done"),
      ])),
      parentTaskId: Type.Optional(Type.String()),
    }),
    async execute(_id: string, params: UpdateProgressInput, context: any) {
      const conversationId = pickConversationId(context);
      const modelName = pickModelName(context, params.model);

      const task = await manager.updateTask(conversationId, {
        ...params,
        model: modelName,
      });

      const rendered = manager.renderTask(task);

      return {
        content: [{ type: "text", text: rendered as string }],
        metadata: { conversationId, task },
      };
    },
  });

  // === progress_get ===
  api.registerTool({
    name: "progress_get",
    description: "Get a task progress record.",
    parameters: Type.Object({
      taskId: Type.String(),
    }),
    async execute(_id: string, params: { taskId: string }, context: any) {
      const conversationId = pickConversationId(context);
      const task = await manager.getTask(conversationId, params.taskId);

      if (!task) {
        return {
          content: [{ type: "text", text: `未找到任务 ${params.taskId}。` }],
          metadata: { found: false },
        };
      }

      return {
        content: [{ type: "text", text: manager.renderTask(task) as string }],
        metadata: { found: true, task },
      };
    },
  });

  // === progress_list ===
  api.registerTool({
    name: "progress_list",
    description: "List task progress records.",
    parameters: Type.Object({
      status: Type.Optional(Type.Union([
        Type.Literal("queued"),
        Type.Literal("running"),
        Type.Literal("blocked"),
        Type.Literal("retrying"),
        Type.Literal("failed"),
        Type.Literal("canceled"),
        Type.Literal("done"),
      ])),
    }),
    async execute(_id: string, params: { status?: ProgressStatus }, context: any) {
      const conversationId = pickConversationId(context);
      const tasks = await manager.listTasks(conversationId, params.status);

      const text = tasks.length === 0
        ? "当前没有任务。"
        : manager.renderTaskList(tasks) as string;

      return {
        content: [{ type: "text", text }],
        metadata: { count: tasks.length, tasks },
      };
    },
  });

  // === progress_clear ===
  api.registerTool({
    name: "progress_clear",
    description: "Clear one or all task progress records.",
    parameters: Type.Object({
      taskId: Type.Optional(Type.String()),
      all: Type.Optional(Type.Boolean()),
    }),
    async execute(_id: string, params: { taskId?: string; all?: boolean }, context: any) {
      const conversationId = pickConversationId(context);
      const removed = await manager.clearTask(conversationId, params.taskId, params.all ?? false);

      return {
        content: [{
          type: "text",
          text: removed > 0 ? `已清理 ${removed} 条任务记录。` : "没有找到可清理的任务记录。"
        }],
        metadata: { removed },
      };
    },
  });

  // === progress_summary ===
  api.registerTool({
    name: "progress_summary",
    description: "Summarize a task's progress history.",
    parameters: Type.Object({
      taskId: Type.String(),
    }),
    async execute(_id: string, params: { taskId: string }, context: any) {
      const conversationId = pickConversationId(context);
      const summary = await manager.getSummary(conversationId, params.taskId);

      if (!summary) {
        return {
          content: [{ type: "text", text: `未找到任务 ${params.taskId} 的历史记录。` }],
          metadata: { found: false },
        };
      }

      return {
        content: [{ type: "text", text: summary }],
        metadata: { found: true },
      };
    },
  });

  // === progress_replay (new) ===
  api.registerTool({
    name: "progress_replay",
    description: "Replay a task's full history.",
    parameters: Type.Object({
      taskId: Type.String(),
      outputMode: Type.Optional(Type.Union([
        Type.Literal("text"),
        Type.Literal("compact"),
        Type.Literal("json"),
      ])),
    }),
    async execute(_id: string, params: { taskId: string; outputMode?: string }, context: any) {
      const conversationId = pickConversationId(context);
      const task = await manager.getTask(conversationId, params.taskId);

      if (!task) {
        return {
          content: [{ type: "text", text: `未找到任务 ${params.taskId}。` }],
        };
      }

      const replay = task.history.map((h) => {
        const ts = new Date(h.ts).toISOString();
        const parts = [ts];
        if (h.stage) parts.push(h.stage);
        if (h.status) parts.push(`status=${h.status}`);
        if (h.percent !== undefined) parts.push(`pct=${h.percent}`);
        parts.push(h.label);
        return parts.join(" | ");
      }).join("\n");

      const rendered = manager.renderReplay(replay, params.outputMode as any);

      return {
        content: [{ type: "text", text: typeof rendered === "string" ? rendered : JSON.stringify(rendered, null, 2) }],
      };
    },
  });

  // === progress_metrics (new) ===
  api.registerTool({
    name: "progress_metrics",
    description: "Get task metrics (timing, retries, blocks).",
    parameters: Type.Object({
      taskId: Type.String(),
      outputMode: Type.Optional(Type.Union([
        Type.Literal("text"),
        Type.Literal("compact"),
        Type.Literal("json"),
      ])),
    }),
    async execute(_id: string, params: { taskId: string; outputMode?: string }, context: any) {
      const conversationId = pickConversationId(context);
      const task = await manager.getTask(conversationId, params.taskId);

      if (!task) {
        return {
          content: [{ type: "text", text: `未找到任务 ${params.taskId}。` }],
        };
      }

      const metrics = {
        totalDurationMs: task.updatedAt - task.createdAt,
        updateCount: task.history.length,
        retryCount: task.history.filter((h) => h.status === "retrying").length,
        blockCount: task.history.filter((h) => h.status === "blocked").length,
      };

      const rendered = manager.renderMetrics(metrics, params.outputMode as any);

      return {
        content: [{ type: "text", text: typeof rendered === "string" ? rendered : JSON.stringify(rendered, null, 2) }],
      };
    },
  });

  // === progress_children ===
  api.registerTool({
    name: "progress_children",
    description: "List direct child tasks of a parent task.",
    parameters: Type.Object({
      taskId: Type.String(),
      outputMode: Type.Optional(Type.Union([
        Type.Literal("text"),
        Type.Literal("compact"),
        Type.Literal("json"),
      ])),
    }),
    async execute(_id: string, params: any, context: any) {
      const conversationId = pickConversationId(context);
      const children = await manager.childrenOfTask(conversationId, params.taskId);

      if (children.length === 0) {
        return {
          content: [{ type: "text", text: `任务 ${params.taskId} 没有子任务记录。` }],
          metadata: { found: false, taskId: params.taskId },
        };
      }

      const rendered = manager.renderTaskList(children, params.outputMode as any);

      return {
        content: [{ type: "text", text: typeof rendered === "string" ? rendered : JSON.stringify(rendered, null, 2) }],
        metadata: { found: true, count: children.length, children },
      };
    },
  });

  // === progress_tree ===
  api.registerTool({
    name: "progress_tree",
    description: "Render the task tree for the current conversation or a subtree.",
    parameters: Type.Object({
      taskId: Type.Optional(Type.String()),
      outputMode: Type.Optional(Type.Union([
        Type.Literal("text"),
        Type.Literal("compact"),
        Type.Literal("json"),
      ])),
    }),
    async execute(_id: string, params: any, context: any) {
      const conversationId = pickConversationId(context);
      const nodes = await manager.taskTree(conversationId, params.taskId);

      if (nodes.length === 0) {
        return {
          content: [{ type: "text", text: params.taskId ? `未找到任务 ${params.taskId} 对应的任务树。` : "当前没有任务树记录。" }],
          metadata: { found: false, taskId: params.taskId },
        };
      }

      const rendered = manager.renderTree(nodes, params.outputMode as any);

      return {
        content: [{ type: "text", text: typeof rendered === "string" ? rendered : JSON.stringify(rendered, null, 2) }],
        metadata: { found: true, tree: nodes },
      };
    },
  });

  // === progress_conversations ===
  api.registerTool({
    name: "progress_conversations",
    description: "List all persisted conversation IDs.",
    parameters: Type.Object({
      outputMode: Type.Optional(Type.Union([
        Type.Literal("text"),
        Type.Literal("compact"),
        Type.Literal("json"),
      ])),
    }),
    async execute(_id: string, params: any) {
      const conversations = await manager.listConversations();
      const mode = params.outputMode ?? "text";

      if (conversations.length === 0) {
        return {
          content: [{ type: "text", text: "当前没有已持久化的 conversation 记录。" }],
          metadata: { count: 0, conversations: [] },
        };
      }

      let text: string;
      if (mode === "json") {
        text = JSON.stringify(conversations, null, 2);
      } else if (mode === "compact") {
        text = conversations.join(" | ");
      } else {
        text = conversations.join("\n");
      }

      return {
        content: [{ type: "text", text }],
        metadata: { count: conversations.length, conversations },
      };
    },
  });

  // === progress_health ===
  api.registerTool({
    name: "progress_health",
    description: "Report plugin health and configuration.",
    parameters: Type.Object({
      outputMode: Type.Optional(Type.Union([
        Type.Literal("text"),
        Type.Literal("compact"),
        Type.Literal("json"),
      ])),
    }),
    async execute(_id: string, params: any) {
      const data = await manager.health();
      const rendered = manager.renderHealth(data, params.outputMode as any);

      return {
        content: [{ type: "text", text: typeof rendered === "string" ? rendered : JSON.stringify(rendered, null, 2) }],
        metadata: data,
      };
    },
  });

  // === progress_cleanup ===
  api.registerTool({
    name: "progress_cleanup",
    description: "Clean expired or empty conversations and optionally rebuild index.",
    parameters: Type.Object({
      outputMode: Type.Optional(Type.Union([
        Type.Literal("text"),
        Type.Literal("compact"),
        Type.Literal("json"),
      ])),
      rebuildIndex: Type.Optional(Type.Boolean()),
      removeEmptyConversations: Type.Optional(Type.Boolean()),
    }),
    async execute(_id: string, params: any) {
      const data = await manager.cleanup({
        rebuildIndex: params.rebuildIndex ?? false,
        removeEmptyConversations: params.removeEmptyConversations ?? true,
      });
      const rendered = manager.renderCleanup(data, params.outputMode as any);

      return {
        content: [{ type: "text", text: typeof rendered === "string" ? rendered : JSON.stringify(rendered, null, 2) }],
        metadata: data,
      };
    },
  });

  // === progress_schedule ===
  api.registerTool({
    name: "progress_schedule",
    description: "Schedule automatic progress updates for a task",
    parameters: Type.Object({
      taskId: Type.String(),
      mode: Type.Optional(Type.Union([Type.Literal("heartbeat"), Type.Literal("summary")])),
      intervalMs: Type.Optional(Type.Integer()),
      enabled: Type.Optional(Type.Boolean()),
    }),
    async execute(_id: string, params: any, context: any) {
      const conversationId = pickConversationId(context);
      const taskId = params.taskId;
      const mode = params.mode ?? "heartbeat";
      const intervalMs = params.intervalMs ?? 60000;
      const enabled = params.enabled ?? true;

      if (!enabled) {
        autoProgress.stop(conversationId, taskId);
        return {
          content: [{ type: "text", text: `已停止任务 ${taskId} 的定时更新。` }],
        };
      }

      const task = await manager.getTask(conversationId, taskId);
      if (!task) {
        return {
          content: [{ type: "text", text: `未找到任务 ${taskId}。` }],
        };
      }

      let success = false;
      if (mode === "heartbeat") {
        success = autoProgress.startHeartbeat(conversationId, taskId, intervalMs);
      } else {
        success = autoProgress.startSummary(conversationId, taskId, intervalMs);
      }

      if (success) {
        return {
          content: [{ type: "text", text: `已为任务 ${taskId} 开启定时更新（${mode}，每 ${intervalMs / 1000} 秒）。` }],
        };
      } else {
        return {
          content: [{ type: "text", text: `任务 ${taskId} 已有定时更新在运行。` }],
        };
      }
    },
  });

  // === progress_unschedule ===
  api.registerTool({
    name: "progress_unschedule",
    description: "Stop scheduled automatic progress updates for a task",
    parameters: Type.Object({
      taskId: Type.String(),
    }),
    async execute(_id: string, params: any, context: any) {
      const conversationId = pickConversationId(context);
      const taskId = params.taskId;

      const stopped = autoProgress.stop(conversationId, taskId);

      if (stopped) {
        return {
          content: [{ type: "text", text: `已停止任务 ${taskId} 的定时更新。` }],
        };
      } else {
        return {
          content: [{ type: "text", text: `任务 ${taskId} 没有正在运行的定时更新。` }],
        };
      }
    },
  });

  // === Inject prompt context hook ===
  if (config.injectPromptContext && typeof api.registerHook === "function") {
    api.registerHook("before_prompt_build", async (payload: any, context: any) => {
      const conversationId = pickConversationId(context);
      const progressText = await manager.getPromptContext(conversationId, config.promptContextLimit);

      if (!progressText) return payload;

      return {
        ...payload,
        system: `${payload.system ?? ""}\n\n${progressText}`.trim(),
      };
    });

    api.logger.info("[progress-notifier] before_prompt_build hook registered");
  }
}
