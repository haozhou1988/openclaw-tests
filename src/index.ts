import { Type } from "@sinclair/typebox";
import { ProgressManager, type UpdateProgressInput } from "./ProgressManager.js";
import { TaskScheduler } from "./scheduler/TaskScheduler.js";
import { AutoProgressService } from "./scheduler/AutoProgressService.js";
import { NoopProgressMessagePusher } from "./scheduler/NoopProgressMessagePusher.js";
import { ApiProgressMessagePusher } from "./scheduler/ApiProgressMessagePusher.js";
import { FeishuCardRenderer } from "./feishu/FeishuCardRenderer.js";
import { FeishuCardPusher } from "./feishu/FeishuCardPusher.js";
import { FeishuPinnedCardStore } from "./feishu/FeishuPinnedCardStore.js";
import { FeishuPinnedCardService } from "./feishu/FeishuPinnedCardService.js";
import { FileAdapter } from "./persistence/FileAdapter.js";
import { MemoryAdapter } from "./persistence/PersistenceAdapter.js";
import { FileFeishuPinnedCardAdapter } from "./feishu/persistence/FileFeishuPinnedCardAdapter.js";
import { MemoryFeishuPinnedCardAdapter } from "./feishu/persistence/MemoryFeishuPinnedCardAdapter.js";
import type { ProgressStatus } from "./state/TaskStateMachine.js";
import path from "node:path";

export default function register(api: any) {
  api.logger.info("[progress-notifier] register() called");

  // Get plugin-specific config from OpenClaw config path
  const pluginConfig =
    api?.config?.plugins?.entries?.["progress-notifier"]?.config ||
    api?.config?.plugins?.["progress-notifier"] ||
    api?.config ||
    {};
  
  const config = {
    ttlMs: pluginConfig.ttlMs ?? 600000,
    defaultStages: pluginConfig.defaultStages ?? ["start", "research", "draft", "done"],
    injectPromptContext: pluginConfig.injectPromptContext ?? true,
    promptContextLimit: pluginConfig.promptContextLimit ?? 2,
    persistenceMode: pluginConfig.persistenceMode ?? "memory",
    persistenceDir: pluginConfig.persistenceDir ?? ".progress-store",
    enableScheduledUpdates: pluginConfig.enableScheduledUpdates ?? false,
    defaultUpdateIntervalMs: pluginConfig.defaultUpdateIntervalMs ?? 60000,
    pushScheduledMessages: pluginConfig.pushScheduledMessages ?? true,
    feishuAppId: pluginConfig.feishuAppId,
    feishuAppSecret: pluginConfig.feishuAppSecret,
    staleAfterMs: pluginConfig.staleAfterMs ?? 180000,
    autoHeartbeatOnProgress: pluginConfig.autoHeartbeatOnProgress ?? true,
    enableFeishuAlerts: pluginConfig.enableFeishuAlerts ?? false,
    alertCooldownMs: pluginConfig.alertCooldownMs ?? 300000,
    restoreStateOnStartup: pluginConfig.restoreStateOnStartup ?? true,
  };

  const persistenceBaseDir = path.resolve(config.persistenceDir);
  const taskAdapter =
    config.persistenceMode === "file"
      ? new FileAdapter(persistenceBaseDir)
      : new MemoryAdapter();
  const manager = new ProgressManager(taskAdapter, config);

  const scheduler = new TaskScheduler();

  const pusher =
    config.pushScheduledMessages && typeof api?.sendMessage === "function"
      ? new ApiProgressMessagePusher(api)
      : new NoopProgressMessagePusher();

  const feishuPinnedCardStore = new FeishuPinnedCardStore(
    config.persistenceMode === "file"
      ? new FileFeishuPinnedCardAdapter(persistenceBaseDir)
      : new MemoryFeishuPinnedCardAdapter()
  );
  const feishuPinnedCardService =
    config.feishuAppId && config.feishuAppSecret
      ? new FeishuPinnedCardService(
          manager,
          new FeishuCardRenderer({ staleAfterMs: config.staleAfterMs }),
          new FeishuCardPusher({
            appId: config.feishuAppId,
            appSecret: config.feishuAppSecret,
          }),
          feishuPinnedCardStore,
          {
            staleAfterMs: config.staleAfterMs,
            enableAlerts: config.enableFeishuAlerts,
            alertCooldownMs: config.alertCooldownMs,
          }
        )
      : null;

  async function syncPinnedCards(conversationId: string, taskId: string): Promise<{
    pinned: boolean;
    refreshed: boolean;
    messageId?: string;
  }> {
    if (!feishuPinnedCardService) {
      return { pinned: false, refreshed: false };
    }

    const pinned = feishuPinnedCardService.get(conversationId, taskId);
    let refreshed = false;

    if (pinned) {
      try {
        refreshed = await feishuPinnedCardService.refresh(conversationId, taskId, true);
      } catch (err) {
        api.logger?.info?.(
          `[progress-notifier] failed to refresh Feishu card for ${taskId}: ${String(err)}`
        );
      }
    }

    const ancestors = await manager.ancestorsOfTask(conversationId, taskId);
    for (const ancestor of ancestors) {
      if (!feishuPinnedCardService.get(conversationId, ancestor.taskId)) {
        continue;
      }

      try {
        await feishuPinnedCardService.refresh(conversationId, ancestor.taskId, true);
      } catch (err) {
        api.logger?.info?.(
          `[progress-notifier] failed to refresh Feishu card for ancestor ${ancestor.taskId}: ${String(err)}`
        );
      }
    }

    return {
      pinned: Boolean(pinned),
      refreshed,
      messageId: pinned?.messageId,
    };
  }

  const autoProgress = new AutoProgressService(manager, scheduler, pusher, async (args) => {
    await syncPinnedCards(args.conversationId, args.taskId);
  });

  const startupPromise = (async () => {
    if (config.persistenceMode !== "file" || !config.restoreStateOnStartup) {
      return;
    }

    await feishuPinnedCardStore.restore();

    const conversations = await manager.listConversations();
    for (const conversationId of conversations) {
      const tasks = await manager.listTasks(conversationId);
      for (const task of tasks) {
        if (!["running", "retrying"].includes(task.status)) {
          continue;
        }
        if (autoProgress.has(conversationId, task.taskId)) {
          continue;
        }
        autoProgress.startHeartbeat(
          conversationId,
          task.taskId,
          config.defaultUpdateIntervalMs
        );
      }
    }
  })();

  // Helper to get conversation ID from context
  function pickConversationId(context: any): string {
    return context?.conversation?.id || context?.session?.conversationId || context?.session?.id || "default";
  }

  // Helper to get model name from context
  function pickModelName(context: any, explicit?: string): string | undefined {
    if (explicit) return explicit;
    return context?.session?.model?.name || context?.session?.model?.primary;
  }

  async function ensureReady(): Promise<void> {
    await startupPromise;
  }

  // === progress_update ===
   api.registerTool({
    name: "progress_update",
    description: "Use this tool whenever the user asks to create or update task/workflow progress, including progress percentage, percent, status, stage, summary, or metrics. This includes requests such as \u201C\u66f4\u65b0\u8fdb\u5ea6\u201D, \u201Cprogress\u201D, \u201C\u72b6\u6001\u66f4\u65b0\u201D, \u201C\u8fdb\u5ea6\u6539\u6210 80%\u201D, or direct tool-like messages such as `progress_update ...`. Do not answer with plain text when an actual progress update is requested.",
    parameters: Type.Object({
      taskId: Type.String(),
      label: Type.String(),
      weight: Type.Optional(Type.Number({ exclusiveMinimum: 0 })),
      percent: Type.Optional(Type.Number()),
      stage: Type.Optional(Type.String()),
      model: Type.Optional(Type.String()),
      activityState: Type.Optional(
        Type.Union([Type.Literal("working"), Type.Literal("waiting_external")])
      ),
      waitingOn: Type.Optional(Type.String()),
      externalCallStartedAt: Type.Optional(Type.Number()),
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
      await ensureReady();
      const conversationId = pickConversationId(context);
      const modelName = pickModelName(context, params.model);

      const task = await manager.updateTask(conversationId, {
        ...params,
        model: modelName,
      });

      const cardSync = await syncPinnedCards(conversationId, task.taskId);

      // Auto-stop scheduled updates when a task is no longer actively running.
      if (["done", "failed", "canceled", "blocked", "queued"].includes(task.status)) {
        autoProgress.stop(conversationId, task.taskId);
      } else if (
        config.autoHeartbeatOnProgress &&
        ["running", "retrying"].includes(task.status) &&
        !autoProgress.has(conversationId, task.taskId)
      ) {
        autoProgress.startHeartbeat(
          conversationId,
          task.taskId,
          config.defaultUpdateIntervalMs
        );
      }

      if (cardSync.pinned && cardSync.refreshed) {
        return {
          content: [],
          metadata: {
            conversationId,
            task,
            pinned: true,
            refreshed: true,
            messageId: cardSync.messageId,
          },
        };
      }

      const rendered = manager.renderTask(task);

      return {
        content: [{ type: "text", text: rendered as string }],
        metadata: {
          conversationId,
          task,
          pinned: cardSync.pinned,
          refreshed: cardSync.refreshed,
          messageId: cardSync.messageId,
        },
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
      await ensureReady();
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
      await ensureReady();
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
      await ensureReady();
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
      await ensureReady();
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
      await ensureReady();
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
      await ensureReady();
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
      await ensureReady();
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
      await ensureReady();
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
      await ensureReady();
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
      await ensureReady();
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
      await ensureReady();
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
      await ensureReady();
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
      await ensureReady();
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

  // === progress_pin_card ===
   api.registerTool({
    name: "progress_pin_card",
    description: "Use this tool whenever the user wants a Feishu pinned progress card to be created, sent, refreshed, or updated for a task. This includes requests such as \u201C\u521b\u5efa\u8fdb\u5ea6\u5361\u7247\u201D, \u201C\u5237\u65b0\u98de\u4e66\u8fdb\u5ea6\u5361\u7247\u201D, \u201C\u7f6e\u9876\u8fdb\u5ea6\u5361\u7247\u201D, or direct tool-like messages such as `progress_pin_card ...`. Do not reply with explanation-only text if the card action can be executed.",
    parameters: Type.Object({
      taskId: Type.String(),
      receiveId: Type.String(),
      receiveIdType: Type.Optional(Type.Union([
        Type.Literal("open_id"),
        Type.Literal("user_id"),
        Type.Literal("union_id"),
        Type.Literal("chat_id"),
        Type.Literal("email"),
      ])),
      showSummary: Type.Optional(Type.Boolean()),
    }),
    async execute(_id: string, params: any, context: any) {
      await ensureReady();
      if (!feishuPinnedCardService) {
        return {
          content: [{ type: "text", text: "当前未配置飞书卡片服务，请先配置 feishuAppId 和 feishuAppSecret。" }],
          metadata: { enabled: false },
        };
      }

      const conversationId = pickConversationId(context);

      try {
        const result = await feishuPinnedCardService.pin({
          conversationId,
          taskId: params.taskId,
          receiveId: params.receiveId,
          receiveIdType: params.receiveIdType ?? "chat_id",
          showSummary: params.showSummary ?? true,
        });

        return {
          content: [{
            type: "text",
            text: result.created
              ? `已为任务 ${params.taskId} 创建飞书进度卡片。`
              : `已刷新任务 ${params.taskId} 的飞书进度卡片。`,
          }],
          metadata: { conversationId, taskId: params.taskId, messageId: result.messageId, created: result.created },
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `为任务 ${params.taskId} 创建/刷新飞书卡片失败：${String(err)}` }],
          metadata: { conversationId, taskId: params.taskId, error: String(err) },
        };
      }
    },
  });

  // === progress_unpin_card ===
   api.registerTool({
    name: "progress_unpin_card",
    description: "Remove a pinned Feishu progress card mapping for a task.",
    parameters: Type.Object({
      taskId: Type.String(),
    }),
    async execute(_id: string, params: any, context: any) {
      await ensureReady();
      if (!feishuPinnedCardService) {
        return {
          content: [{ type: "text", text: "当前未配置飞书卡片服务。" }],
          metadata: { enabled: false },
        };
      }

      const conversationId = pickConversationId(context);

      try {
        const removed = await feishuPinnedCardService.unpin(conversationId, params.taskId);

        return {
          content: [{
            type: "text",
            text: removed
              ? `已取消任务 ${params.taskId} 的飞书进度卡片绑定。`
              : `任务 ${params.taskId} 当前没有已绑定的飞书进度卡片。`,
          }],
          metadata: { conversationId, taskId: params.taskId, removed },
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `取消任务 ${params.taskId} 的飞书进度卡片绑定失败：${String(err)}` }],
          metadata: { conversationId, taskId: params.taskId, error: String(err) },
        };
      }
    },
  });

  // === progress_refresh_card ===
   api.registerTool({
    name: "progress_refresh_card",
    description: "Refresh an existing pinned Feishu progress card for a task.",
    parameters: Type.Object({
      taskId: Type.String(),
      showSummary: Type.Optional(Type.Boolean()),
    }),
    async execute(_id: string, params: any, context: any) {
      await ensureReady();
      if (!feishuPinnedCardService) {
        return {
          content: [{ type: "text", text: "当前未配置飞书卡片服务。" }],
          metadata: { enabled: false },
        };
      }

      const conversationId = pickConversationId(context);

      try {
        const refreshed = await feishuPinnedCardService.refresh(conversationId, params.taskId, params.showSummary ?? true);

        return {
          content: [{
            type: "text",
            text: refreshed
              ? `已刷新任务 ${params.taskId} 的飞书进度卡片。`
              : `未找到任务 ${params.taskId} 对应的飞书进度卡片绑定。`,
          }],
          metadata: { conversationId, taskId: params.taskId, refreshed },
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `刷新任务 ${params.taskId} 的飞书进度卡片失败：${String(err)}` }],
          metadata: { conversationId, taskId: params.taskId, error: String(err) },
        };
      }
    },
  });

  // === progress_card_status ===
   api.registerTool({
    name: "progress_card_status",
    description: "Show pinned Feishu progress card bindings for the current conversation or a single task.",
    parameters: Type.Object({
      taskId: Type.Optional(Type.String()),
    }),
    async execute(_id: string, params: { taskId?: string }, context: any) {
      await ensureReady();
      if (!feishuPinnedCardService) {
        return {
          content: [{ type: "text", text: "当前未配置飞书卡片服务。" }],
          metadata: { enabled: false },
        };
      }

      const conversationId = pickConversationId(context);

      if (params.taskId) {
        const record = feishuPinnedCardService.get(conversationId, params.taskId);
        if (!record) {
          return {
            content: [{ type: "text", text: `任务 ${params.taskId} 当前没有绑定飞书进度卡片。` }],
            metadata: { enabled: true, found: false, taskId: params.taskId },
          };
        }

        return {
          content: [{
            type: "text",
            text: `任务 ${params.taskId} 已绑定飞书卡片，messageId=${record.messageId}，receiveId=${record.receiveId}。`,
          }],
          metadata: { enabled: true, found: true, record },
        };
      }

      const records = feishuPinnedCardService.list(conversationId);
      if (records.length === 0) {
        return {
          content: [{ type: "text", text: "当前会话没有绑定任何飞书进度卡片。" }],
          metadata: { enabled: true, count: 0, records: [] },
        };
      }

      return {
        content: [{
          type: "text",
          text: records
            .map((record) => `${record.taskId} -> ${record.messageId} (${record.receiveIdType}:${record.receiveId})`)
            .join("\n"),
        }],
        metadata: { enabled: true, count: records.length, records },
      };
    },
  });

  // === Inject prompt context hook ===
  if (config.injectPromptContext && typeof api.registerHook === "function") {
    api.registerHook("before_prompt_build", async (payload: any, context: any) => {
      await ensureReady();
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
