import type { TaskState } from "../types.js";
import { progressBar } from "../utils.js";

export interface FeishuCardRenderOptions {
  title?: string;
  showSummary?: boolean;
  summaryText?: string;
}

export class FeishuCardRenderer {
  renderTaskCard(
    task: TaskState,
    options: FeishuCardRenderOptions = {}
  ): Record<string, any> {
    const title = options.title ?? "Workflow Progress";
    const progressText =
      task.percent !== undefined ? `${task.percent}%` : "N/A";
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
          content: `**任务**: ${task.taskId}`,
        },
      },
      {
        tag: "div",
        fields: [
          {
            is_short: true,
            text: {
              tag: "lark_md",
              content: `**阶段**\n${task.stage ?? "N/A"}`,
            },
          },
          {
            is_short: true,
            text: {
              tag: "lark_md",
              content: `**状态**\n${task.status}`,
            },
          },
          {
            is_short: true,
            text: {
              tag: "lark_md",
              content: `**进度**\n${progressText}`,
            },
          },
          {
            is_short: true,
            text: {
              tag: "lark_md",
              content: `**更新时间**\n${updatedText}`,
            },
          },
        ],
      },
      {
        tag: "div",
        text: {
          tag: "lark_md",
          content: `**说明**: ${task.label}`,
        },
      },
      {
        tag: "div",
        text: {
          tag: "lark_md",
          content: `**动态进度条**\n\`${progressBarText}\``,
        },
      },
    ];

    if (options.showSummary && options.summaryText) {
      elements.push({
        tag: "hr",
      });
      elements.push({
        tag: "div",
        text: {
          tag: "lark_md",
          content: `**摘要**\n${options.summaryText}`,
        },
      });
    }

    const statusText =
      task.status === "done"
        ? "已完成"
        : task.status === "failed"
        ? "失败"
        : task.status === "canceled"
        ? "已取消"
        : "处理中";

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
            content: statusText,
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
}
