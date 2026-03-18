export interface ProgressMessagePusher {
  push(args: {
    conversationId: string;
    taskId: string;
    text: string;
    mode: "heartbeat" | "summary";
  }): Promise<void>;
}
