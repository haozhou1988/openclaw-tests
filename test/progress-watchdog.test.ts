import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProgressManager } from "../src/ProgressManager.js";
import register from "../src/index.js";

function createMockApi(config: Record<string, any> = {}) {
  const tools: any[] = [];
  const hooks = new Map<string, Function>();

  return {
    logger: {
      info: vi.fn(),
    },
    config,
    sendMessage: vi.fn(),
    registerTool: vi.fn((tool) => {
      tools.push(tool);
    }),
    registerHook: vi.fn((name, fn) => {
      hooks.set(name, fn);
    }),
    _tools: tools,
    _hooks: hooks,
  };
}

describe("progress watchdog", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-19T00:00:00Z"));
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("keeps inferred percent stable during heartbeat updates and marks stale tasks", async () => {
    const manager = new ProgressManager(undefined, { staleAfterMs: 5000 });

    const first = await manager.updateTask("conv-1", {
      taskId: "task-1",
      label: "Working on analysis",
      status: "running",
    });

    vi.advanceTimersByTime(6000);

    const heartbeat = await manager.touchTaskHeartbeat("conv-1", "task-1");

    expect(first.percent).toBe(12);
    expect(heartbeat?.percent).toBe(12);
    expect(heartbeat?.lastActivityAt).toBe(first.lastActivityAt);
    expect(heartbeat?.lastHeartbeatAt).toBeGreaterThan(
      heartbeat?.lastActivityAt ?? 0
    );

    const rendered = String(manager.renderTask(heartbeat!));
    expect(rendered).toContain("[stale]");
    expect(rendered).toContain("watchdog: possibly stalled");
    expect(rendered).toContain("heartbeat 0s ago");
  });

  it("propagates child heartbeat visibility to the parent task", async () => {
    const manager = new ProgressManager(undefined, { staleAfterMs: 5000 });

    await manager.updateTask("conv-1", {
      taskId: "root",
      label: "Parent task",
      status: "running",
      stage: "start",
    });

    await manager.updateTask("conv-1", {
      taskId: "child",
      parentTaskId: "root",
      label: "Child task",
      status: "running",
    });

    const before = await manager.getTask("conv-1", "root");

    vi.advanceTimersByTime(6000);
    await manager.touchTaskHeartbeat("conv-1", "child");

    const after = await manager.getTask("conv-1", "root");

    expect(after?.percent).toBe(before?.percent);
    expect(after?.lastActivityAt).toBe(before?.lastActivityAt);
    expect(after?.lastHeartbeatAt).toBeGreaterThan(before?.updatedAt ?? 0);
  });

  it("auto-starts heartbeat after progress updates for active tasks", async () => {
    const api = createMockApi({
      injectPromptContext: false,
      autoHeartbeatOnProgress: true,
      defaultUpdateIntervalMs: 1000,
      staleAfterMs: 5000,
      persistenceMode: "memory",
    });

    register(api);

    const updateTool = api._tools.find((tool: any) => tool.name === "progress_update");
    const getTool = api._tools.find((tool: any) => tool.name === "progress_get");
    const ctx = { conversation: { id: "conv-1" } };

    await updateTool.execute(
      "1",
      {
        taskId: "task-1",
        label: "Working quietly",
        status: "running",
      },
      ctx
    );

    const firstGet = await getTool.execute("2", { taskId: "task-1" }, ctx);
    expect(firstGet.metadata.task.lastHeartbeatAt).toBeUndefined();

    await vi.advanceTimersByTimeAsync(1000);

    const secondGet = await getTool.execute("3", { taskId: "task-1" }, ctx);
    expect(secondGet.metadata.task.lastHeartbeatAt).toBeDefined();
    expect(secondGet.metadata.task.lastActivityAt).toBeLessThan(
      secondGet.metadata.task.lastHeartbeatAt
    );
    expect(secondGet.metadata.task.percent).toBe(12);

    await updateTool.execute(
      "4",
      {
        taskId: "task-1",
        label: "Finished",
        status: "done",
        stage: "done",
      },
      ctx
    );
  });
});
