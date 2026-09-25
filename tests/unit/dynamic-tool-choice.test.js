import { beforeEach, describe, it, expect, vi } from "vitest";

// 9Router honors the client tool_choice for Kimi NVIDIA (no forced "required", no block).
// Behavior matches direct-NVIDIA usage.
describe("Tool_choice passthrough (Kimi NVIDIA)", () => {
  beforeEach(() => { vi.resetModules(); });

  async function calledBodyFor(model, toolChoice) {
    const { DefaultExecutor } = await import("../../open-sse/executors/default.js");
    const { BaseExecutor } = await import("../../open-sse/executors/base.js");
    const executor = new DefaultExecutor("nvidia");
    const baseSpy = vi.spyOn(BaseExecutor.prototype, "execute").mockResolvedValue({
      response: new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "ok" } }] }), { status: 200, headers: { "content-type": "application/json" } }),
      url: "https://example.test", headers: {}, transformedBody: {},
    });
    const body = { messages: [{ role: "user", content: "hi" }], tools: [{ type: "function", function: { name: "bash" } }] };
    if (toolChoice !== undefined) body.tool_choice = toolChoice;
    await executor.execute({ model, body, stream: false, credentials: { apiKey: "k" }, signal: undefined, log: undefined, proxyOptions: null });
    return baseSpy.mock.calls[0][0].body;
  }

  it("tool_choice 'auto' → stays 'auto' (not forced to required)", async () => {
    expect((await calledBodyFor("moonshotai/kimi-k2.6", "auto")).tool_choice).toBe("auto");
  });

  it("no tool_choice → not set to required", async () => {
    expect((await calledBodyFor("moonshotai/kimi-k2.6", undefined)).tool_choice).not.toBe("required");
  });

  it("tool_choice 'required' → honored", async () => {
    expect((await calledBodyFor("moonshotai/kimi-k2.6", "required")).tool_choice).toBe("required");
  });

  it("tool_choice 'none' → honored", async () => {
    expect((await calledBodyFor("moonshotai/kimi-k2.6", "none")).tool_choice).toBe("none");
  });

  it("non-Kimi NVIDIA model → tool_choice unaffected", async () => {
    expect((await calledBodyFor("meta/llama-3.1-8b-instruct", "auto")).tool_choice).toBe("auto");
  });
});
