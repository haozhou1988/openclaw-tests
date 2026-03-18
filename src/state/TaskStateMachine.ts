export type ProgressStatus =
  | "queued"
  | "running"
  | "blocked"
  | "retrying"
  | "done"
  | "failed"
  | "canceled";

export class TaskStateMachine {
  private allowedTransitions: Record<ProgressStatus, ProgressStatus[]> = {
    queued: ["running", "canceled"],
    running: ["blocked", "retrying", "done", "failed", "canceled"],
    blocked: ["running", "canceled", "failed"],
    retrying: ["running", "failed", "canceled"],
    done: [],
    failed: ["retrying"],
    canceled: [],
  };

  canTransition(from: ProgressStatus, to: ProgressStatus): boolean {
    return this.allowedTransitions[from]?.includes(to) ?? false;
  }

  assertTransition(from: ProgressStatus, to: ProgressStatus): void {
    if (!this.canTransition(from, to)) {
      throw new Error(`Invalid task status transition: ${from} -> ${to}`);
    }
  }

  nextStatus(current: ProgressStatus, requested?: ProgressStatus): ProgressStatus {
    if (!requested) return current;
    if (requested === current) return current;
    this.assertTransition(current, requested);
    return requested;
  }
}
