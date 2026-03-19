import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProgressManager } from "../src/ProgressManager.js";

describe("ProgressManager auto aggregation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-19T00:00:00Z"));
  });

  it("derives parent percent and label from child tasks", async () => {
    const manager = new ProgressManager();

    await manager.updateTask("conv-1", {
      taskId: "root",
      label: "Overall workflow",
      stage: "start",
      status: "running",
    });

    await manager.updateTask("conv-1", {
      taskId: "child-1",
      parentTaskId: "root",
      label: "Search sources",
      stage: "done",
      status: "done",
    });

    await manager.updateTask("conv-1", {
      taskId: "child-2",
      parentTaskId: "root",
      label: "Draft answer",
      stage: "research",
      status: "running",
    });

    const root = await manager.getTask("conv-1", "root");

    expect(root?.percent).toBe(67);
    expect(root?.stage).toBe("research");
    expect(root?.label).toBe("1/2 child tasks complete, 1 running");
  });

  it("derives parent percent from weighted child tasks", async () => {
    const manager = new ProgressManager();

    await manager.updateTask("conv-1", {
      taskId: "root",
      label: "Weighted workflow",
      stage: "start",
      status: "running",
    });

    await manager.updateTask("conv-1", {
      taskId: "child-1",
      parentTaskId: "root",
      label: "Small completed task",
      weight: 1,
      stage: "done",
      status: "done",
    });

    await manager.updateTask("conv-1", {
      taskId: "child-2",
      parentTaskId: "root",
      label: "Heavy research task",
      weight: 3,
      stage: "research",
      status: "running",
    });

    const root = await manager.getTask("conv-1", "root");

    expect(root?.percent).toBe(50);
    expect(root?.label).toBe("50% complete (weighted), 1/2 child tasks complete, 1 running");
  });

  it("uses event history as a fallback when no stage or percent is provided", async () => {
    const manager = new ProgressManager();

    const first = await manager.updateTask("conv-1", {
      taskId: "leaf",
      label: "Working",
      status: "running",
    });

    const second = await manager.updateTask("conv-1", {
      taskId: "leaf",
      label: "Still working",
      status: "running",
    });

    expect(first.percent).toBe(12);
    expect(second.percent).toBe(24);
  });

  it("aggregates parent status to done when all children are done", async () => {
    const manager = new ProgressManager();

    await manager.updateTask("conv-1", {
      taskId: "root",
      label: "Overall workflow",
      status: "running",
    });

    await manager.updateTask("conv-1", {
      taskId: "child-1",
      parentTaskId: "root",
      label: "Task one",
      status: "done",
      stage: "done",
    });

    await manager.updateTask("conv-1", {
      taskId: "child-2",
      parentTaskId: "root",
      label: "Task two",
      status: "done",
      stage: "done",
    });

    const root = await manager.getTask("conv-1", "root");

    expect(root?.status).toBe("done");
    expect(root?.percent).toBe(100);
    expect(root?.stage).toBe("done");
    expect(root?.label).toBe("All 2 child tasks complete");
  });

  it("aggregates parent status to blocked or failed based on child states", async () => {
    const manager = new ProgressManager();

    await manager.updateTask("conv-1", {
      taskId: "root",
      label: "Overall workflow",
      status: "running",
    });

    await manager.updateTask("conv-1", {
      taskId: "child-1",
      parentTaskId: "root",
      label: "Blocked task",
      status: "blocked",
      stage: "research",
    });

    let root = await manager.getTask("conv-1", "root");
    expect(root?.status).toBe("blocked");
    expect(root?.label).toBe("0/1 child tasks complete, 1 blocked");

    await manager.updateTask("conv-1", {
      taskId: "child-2",
      parentTaskId: "root",
      label: "Failed task",
      status: "failed",
      stage: "draft",
    });

    root = await manager.getTask("conv-1", "root");
    expect(root?.status).toBe("failed");
    expect(root?.label).toBe("0/2 child tasks complete, 1 blocked, 1 failed");
  });

  it("keeps parent stage at the earliest unfinished child stage", async () => {
    const manager = new ProgressManager();

    await manager.updateTask("conv-1", {
      taskId: "root",
      label: "Overall workflow",
      status: "running",
      stage: "start",
    });

    await manager.updateTask("conv-1", {
      taskId: "child-1",
      parentTaskId: "root",
      label: "Research task",
      status: "running",
      stage: "research",
    });

    await manager.updateTask("conv-1", {
      taskId: "child-2",
      parentTaskId: "root",
      label: "Draft task",
      status: "running",
      stage: "draft",
    });

    const root = await manager.getTask("conv-1", "root");

    expect(root?.stage).toBe("research");
  });

  it("surfaces the dominant external wait from descendants on the parent label", async () => {
    const manager = new ProgressManager(undefined, { staleAfterMs: 5000 });

    await manager.updateTask("conv-1", {
      taskId: "root",
      label: "Overall workflow",
      status: "running",
      stage: "start",
    });

    await manager.updateTask("conv-1", {
      taskId: "child-1",
      parentTaskId: "root",
      label: "Waiting on search",
      status: "running",
      activityState: "waiting_external",
      waitingOn: "search-api",
    });

    const root = await manager.getTask("conv-1", "root");
    expect(root?.label).toBe("waiting on search-api");
  });

  it("prioritizes slow external wait over a normal waiting child", async () => {
    const manager = new ProgressManager(undefined, { staleAfterMs: 5000 });

    await manager.updateTask("conv-1", {
      taskId: "root",
      label: "Overall workflow",
      status: "running",
      stage: "start",
    });

    await manager.updateTask("conv-1", {
      taskId: "child-1",
      parentTaskId: "root",
      label: "Waiting on search",
      status: "running",
      activityState: "waiting_external",
      waitingOn: "search-api",
    });

    await manager.updateTask("conv-1", {
      taskId: "child-2",
      parentTaskId: "root",
      label: "Waiting on OpenAI",
      status: "running",
      activityState: "waiting_external",
      waitingOn: "openai",
    });

    vi.advanceTimersByTime(6000);
    await manager.touchTaskHeartbeat("conv-1", "child-2");

    const root = await manager.getTask("conv-1", "root");
    expect(root?.label).toBe("external call slow (openai)");
  });

  it("clears the parent waiting label when child work resumes", async () => {
    const manager = new ProgressManager(undefined, { staleAfterMs: 5000 });

    await manager.updateTask("conv-1", {
      taskId: "root",
      label: "Overall workflow",
      status: "running",
      stage: "start",
    });

    await manager.updateTask("conv-1", {
      taskId: "child-1",
      parentTaskId: "root",
      label: "Waiting on OpenAI",
      status: "running",
      activityState: "waiting_external",
      waitingOn: "openai",
      stage: "research",
    });

    let root = await manager.getTask("conv-1", "root");
    expect(root?.label).toBe("waiting on openai");

    await manager.updateTask("conv-1", {
      taskId: "child-1",
      parentTaskId: "root",
      label: "Continuing draft",
      status: "running",
      stage: "draft",
    });

    root = await manager.getTask("conv-1", "root");
    expect(root?.label).toBe("0/1 child tasks complete, 1 running");
  });
});
