import { describe, expect, it } from "vitest";
import { ProgressManager } from "../src/ProgressManager.js";

describe("ProgressManager auto percent", () => {
  it("derives parent percent from child tasks", async () => {
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
    expect(root?.label).toBe("1/2 子任务已完成，1 个运行中");
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
    expect(root?.label).toBe("全部 2 个子任务已完成");
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
    expect(root?.label).toBe("0/1 子任务已完成，1 个阻塞中");

    await manager.updateTask("conv-1", {
      taskId: "child-2",
      parentTaskId: "root",
      label: "Failed task",
      status: "failed",
      stage: "draft",
    });

    root = await manager.getTask("conv-1", "root");
    expect(root?.status).toBe("failed");
    expect(root?.label).toBe("0/2 子任务已完成，1 个阻塞中，1 个失败");
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
});
