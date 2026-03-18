import type { ProgressMessagePusher } from "./ProgressMessagePusher.js";

export class ApiProgressMessagePusher implements ProgressMessagePusher {
  constructor(private api: any) {}

  async push(args: {
    conversationId: string;
    taskId: string;
    text: string;
    mode: "heartbeat" | "summary";
  }): Promise<void> {
    if (typeof this.api?.sendMessage !== "function") {
      return;
    }

    await this.api.sendMessage({
      conversationId: args.conversationId,
      content: args.text,
      metadata: {
        source: "progress-notifier",
        taskId: args.taskId,
        mode: args.mode,
      },
    });
  }
}
