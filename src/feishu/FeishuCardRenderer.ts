import type { TaskState } from "../types.js";

export interface FeishuCardRenderOptions {
  title?: string;
  showSummary?: boolean;
  summaryText?: string;
  showMetrics?: boolean;
  metricsText?: string;
  showChildrenOverview?: boolean;
  childrenOverviewText?: string;
}

export class FeishuCardRenderer {
  renderTaskCard(
    task: TaskState,
    options: FeishuCardRenderOptions = {}
  ): Record<string, any> {
    const title = options.title ?? "Workflow Progress";
    const progressText = task.percent !== undefined ? `${task.percent}%` : "N/A";
    const updatedText = this.formatTime(task.updatedAt);

    const headerTemplate = this.buildHeader(task, title);
    const elements: any[] = [];

    // Status overview
    elements.push({
      tag: "column_set",
      flex_mode: "stretch",
      background_style: "default",
      columns: [
        this.metricColumn("任务", task.taskId, false),
        this.metricColumn("阶段", task.stage ?? "N/A", true),
        this.metricColumn("状态", task.status, true),
      ],
    });

    // Progress display
    elements.push({
      tag: "column_set",
      flex_mode: "none",
      background_style: "grey",
      columns: [
        {
          tag: "column",
          width: "weighted",
          weight: 3,
          elements: [
            {
              tag: "markdown",
              content: `**当前说明**\n${task.label}`,
            },
          ],
        },
        {
          tag: "column",
          width: "weighted",
          weight: 1,
          elements: [
            {
              tag: "markdown",
              content: `**进度**\n# ${progressText}`,
              text_align: "center",
            },
          ],
        },
      ],
    });

    // Text progress bar
    if (task.percent !== undefined) {
      elements.push({
        tag: "markdown",
        content: `**进度条**\n\`${this.progressBar(task.percent)} ${task.percent}%\``,
      });
    }

    // Optional summary
    if (options.showSummary && options.summaryText) {
      elements.push({ tag: "hr" });
      elements.push({
        tag: "markdown",
        content: `**摘要**\n${options.summaryText}`,
      });
    }

    // Optional metrics
    if (options.showMetrics && options.metricsText) {
      elements.push({ tag: "hr" });
      elements.push({
        tag: "markdown",
        content: `**指标**\n${options.metricsText}`,
      });
    }

    // Optional children overview
    if (options.showChildrenOverview && options.childrenOverviewText) {
      elements.push({ tag: "hr" });
      elements.push({
        tag: "markdown",
        content: `**子任务概览**\n${options.childrenOverviewText}`,
      });
    }

    // Footer update time
    elements.push({ tag: "hr" });
    elements.push({
      tag: "note",
      elements: [
        {
          tag: "plain_text",
          content: `更新时间：${updatedText}`,
        },
      ],
    });

    return {
      card: {
        schema: "2.0",
        config: {
          wide_screen_mode: true,
        },
        header: headerTemplate,
        body: {
          elements,
        },
      },
    };
  }

  private buildHeader(task: TaskState, title: string) {
    const statusMeta = this.statusMeta(task.status);

    return {
      title: {
        tag: "plain_text",
        content: title,
      },
      subtitle: {
        tag: "plain_text",
        content: statusMeta.subtitle,
      },
      template: statusMeta.template,
    };
  }

  private statusMeta(status: TaskState["status"]): {
    subtitle: string;
    template: "blue" | "wathet" | "turquoise" | "green" | "yellow" | "orange" | "red" | "grey" | "indigo" | "purple" | "carmine";
  } {
    switch (status) {
      case "done":
        return { subtitle: "已完成", template: "green" };
      case "failed":
        return { subtitle: "失败", template: "red" };
      case "canceled":
        return { subtitle: "已取消", template: "grey" };
      case "blocked":
        return { subtitle: "阻塞中", template: "orange" };
      case "retrying":
        return { subtitle: "重试中", template: "yellow" };
      case "queued":
        return { subtitle: "排队中", template: "wathet" };
      case "running":
      default:
        return { subtitle: "处理中", template: "blue" };
    }
  }

  private metricColumn(label: string, value: string, short = true) {
    return {
      tag: "column",
      width: "weighted",
      weight: short ? 1 : 2,
      elements: [
        {
          tag: "markdown",
          content: `**${label}**\n${value}`,
        },
      ],
    };
  }

  private progressBar(percent: number): string {
    const safe = Math.max(0, Math.min(100, Math.round(percent));
    const filled = Math.round(safe / 10);
    return "█".repeat(filled) + "░".repeat(10 - filled);
  }

  private formatTime(ts: number): string {
    const d = new Date(ts);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const mi = String(d.getMinutes()).padStart(2, "0");
    const ss = String(d.getSeconds()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
  }
}
