import { describe, expect, it, vi } from "vitest";
import register from "../src/index.js";

function createMockApi(config: Record<string, any> = {}) {
  const tools: any[] = [];
  const hooks = new Map<string, Function>();
  return {
    logger: { info: vi.fn() },
    config,
    registerTool: vi.fn((tool) => tools.push(tool)),
    registerHook: vi.fn((name, fn) => hooks.set(name, fn)),
    _tools: tools,
    _hooks: hooks,
  };
}

describe("index feishu card status tool", () => {
  it("registers progress_card_status", () => {
    const api = createMockApi({ injectPromptContext: false, feishuAppId: "app-id", feishuAppSecret: "app-secret" });
    register(api);
    const names = api._tools.map((t: any) => t.name);
    expect(names).toContain("progress_card_status");
  });

  it("returns config error when Feishu is not configured", async () => {
    const api = createMockApi({ injectPromptContext: false, persistenceMode: "memory" });
    register(api);
    const tool = api._tools.find((t: any) => t.name === "progress_card_status");
    const result = await tool.execute("1", { taskId: "paper-1" }, { conversation: { id: "conv-1" } });
    expect(result.content[0].text).toContain("当前未配置飞书卡片服务");
    expect(result.metadata.enabled).toBe(false);
  });
});
