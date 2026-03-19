import type { TaskState } from "../types.js";
import {
  describeTimestampAge,
  formatElapsedMs,
  getTaskWatchdog,
  progressBar,
} from "../utils.js";

export interface FeishuCardRenderOptions {
  title?: string;
  showSummary?: boolean;
  summaryText?: string;
}

export class FeishuCardRenderer {
  constructor(private config: { staleAfterMs?: number } = {}) {}

  renderTaskCard(
    task: TaskState,
    options: FeishuCardRenderOptions = {}
  ): Record<string, any> {
    const title = options.title ?? "Workflow Progress";
    const watchdog = getTaskWatchdog(task, this.config.staleAfterMs);
    const progressText = task.percent !== undefined ? `${task.percent}%` : "N/A";
    const progressBarText =
      task.percent !== undefined
        ? `${progressBar(task.percent)} ${progressText}${this.renderPercentDelta(task)}`
        : "N/A";
    const updatedText = new Date(task.updatedAt).toISOString();

    const elements: any[] = [
      {
        tag: "div",
        text: {
          tag: "lark_md",
          content: `**Task**: ${task.taskId}`,
        },
      },
      {
        tag: "div",
        fields: [
          {
            is_short: true,
            text: {
              tag: "lark_md",
              content: `**Stage**\n${task.stage ?? "N/A"}`,
            },
          },
          {
            is_short: true,
            text: {
              tag: "lark_md",
              content: `**Status**\n${this.renderStatusText(task.status, watchdog.state)}`,
            },
          },
          {
            is_short: true,
            text: {
              tag: "lark_md",
              content: `**Progress**\n${progressText}`,
            },
          },
          {
            is_short: true,
            text: {
              tag: "lark_md",
              content: `**Updated**\n${updatedText}`,
            },
          },
        ],
      },
      {
        tag: "div",
        text: {
          tag: "lark_md",
          content: `**Label**: ${task.label}`,
        },
      },
      {
        tag: "div",
        text: {
          tag: "lark_md",
          content: `**Progress Bar**\n\`${progressBarText}\``,
        },
      },
      {
        tag: "div",
        text: {
          tag: "lark_md",
          content: `**Agent Activity**\n${this.renderActivityText(watchdog)}`,
        },
      },
    ];

    if (options.showSummary && options.summaryText) {
      elements.push({ tag: "hr" });
      elements.push({
        tag: "div",
        text: {
          tag: "lark_md",
          content: `**Summary**\n${options.summaryText}`,
        },
      });
    }

    return {
      type: "template",
      data: {
        template_id: "",
        template_variable: {},
      },
      card: {
        schema: "2.0",
        config: {
          wide_screen_mode: true,
        },
        header: {
          title: {
            tag: "plain_text",
            content: title,
          },
          subtitle: {
            tag: "plain_text",
            content: this.renderStatusText(task.status, watchdog.state),
          },
        },
        body: {
          elements,
        },
      },
    };
  }

  private renderPercentDelta(task: TaskState): string {
    const previous = [...task.history]
      .reverse()
      .find((event) => event.percent !== undefined && event.percent !== task.percent);

    if (task.percent === undefined || previous?.percent === undefined) {
      return "";
    }

    const delta = task.percent - previous.percent;
    if (delta === 0) {
      return "";
    }

    return delta > 0 ? ` (+${delta}%)` : ` (${delta}%)`;
  }

  private renderStatusText(
    status: TaskState["status"],
    watchdogState: ReturnType<typeof getTaskWatchdog>["state"]
  ): string {
    if (status === "done") return "Completed";
    if (status === "failed") return "Failed";
    if (status === "canceled") return "Canceled";
    if (watchdogState === "waiting_external") return "Waiting on external call";
    if (watchdogState === "waiting_external_slow") return "External call slow";
    if (watchdogState === "stale") return "Possibly stalled";
    return "Working";
  }

  private renderActivityText(
    watchdog: ReturnType<typeof getTaskWatchdog>
  ): string {
    const parts = [
      `last activity ${describeTimestampAge(watchdog.lastActivityAt)}`,
    ];

    if (watchdog.lastHeartbeatAt !== undefined) {
      parts.push(`last heartbeat ${describeTimestampAge(watchdog.lastHeartbeatAt)}`);
    }

    if (watchdog.state === "waiting_external") {
      parts.unshift(
        `waiting on ${watchdog.waitingOn ?? "external"}${
          watchdog.waitingForMs !== undefined
            ? ` for ${formatElapsedMs(watchdog.waitingForMs)}`
            : ""
        }`
      );
    } else if (watchdog.state === "waiting_external_slow") {
      parts.unshift(
        `external call slow (${watchdog.waitingOn ?? "external"})${
          watchdog.waitingForMs !== undefined
            ? ` | ${formatElapsedMs(watchdog.waitingForMs)}`
            : ""
        }`
      );
    } else if (watchdog.state === "stale") {
      parts.unshift("watchdog: possibly stalled");
    }

    return parts.join(" | ");
  }
}
