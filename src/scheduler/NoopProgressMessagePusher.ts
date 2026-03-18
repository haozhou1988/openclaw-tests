import type { ProgressMessagePusher } from "./ProgressMessagePusher.js";

export class NoopProgressMessagePusher implements ProgressMessagePusher {
  async push(): Promise<void> {
    // no-op
  }
}
