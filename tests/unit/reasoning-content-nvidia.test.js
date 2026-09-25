import { describe, it, expect } from "vitest";
import { injectReasoningContent } from "../../open-sse/utils/reasoningContentInjector.js";

const toolCall = { id: "c1", type: "function", function: { name: "bash", arguments: "{}" } };

function body(messages) {
  return { model: "test", messages };
}

describe("reasoningContentInjector — Kimi NVIDIA prefix normalization", () => {
  it("injects reasoning_content for moonshotai/kimi-k2.6 (NVIDIA prefix)", () => {
    const out = injectReasoningContent({
      provider: "nvidia",
      model: "moonshotai/kimi-k2.6",
      body: body([{ role: "assistant", content: "", tool_calls: [toolCall] }]),
    });
    expect(out.messages[0].reasoning_content).toBeDefined();
  });

  it("injects reasoning_content for kimi-k2.5 (no prefix, no regression)", () => {
    const out = injectReasoningContent({
      provider: "kimi",
      model: "kimi-k2.5",
      body: body([{ role: "assistant", content: "", tool_calls: [toolCall] }]),
    });
    expect(out.messages[0].reasoning_content).toBeDefined();
  });

  it("injects reasoning_content for kimi-k2.7 (future variant)", () => {
    const out = injectReasoningContent({
      provider: "nvidia",
      model: "moonshotai/kimi-k2.7",
      body: body([{ role: "assistant", content: "", tool_calls: [toolCall] }]),
    });
    expect(out.messages[0].reasoning_content).toBeDefined();
  });

  it("injects reasoning_content for otherprovider/kimi-k2.6 (any prefix)", () => {
    const out = injectReasoningContent({
      provider: "siliconflow",
      model: "otherprovider/kimi-k2.6",
      body: body([{ role: "assistant", content: "", tool_calls: [toolCall] }]),
    });
    expect(out.messages[0].reasoning_content).toBeDefined();
  });

  it("does NOT inject for meta/llama-3", () => {
    const out = injectReasoningContent({
      provider: "nvidia",
      model: "meta/llama-3",
      body: body([{ role: "assistant", content: "", tool_calls: [toolCall] }]),
    });
    expect(out.messages[0].reasoning_content).toBeUndefined();
  });

  it("injects on ALL assistant turns with tool_calls in multi-turn", () => {
    const messages = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "", tool_calls: [toolCall] },
      { role: "tool", content: "result", tool_call_id: "c1" },
      { role: "assistant", content: "", tool_calls: [toolCall] },
      { role: "tool", content: "result2", tool_call_id: "c1" },
    ];
    const out = injectReasoningContent({
      provider: "nvidia",
      model: "moonshotai/kimi-k2.6",
      body: body(messages),
    });
    const assistants = out.messages.filter(m => m.role === "assistant");
    expect(assistants).toHaveLength(2);
    assistants.forEach(a => expect(a.reasoning_content).toBeDefined());
  });

  it("does NOT inject on assistant without tool_calls (scope=toolCalls)", () => {
    const out = injectReasoningContent({
      provider: "nvidia",
      model: "moonshotai/kimi-k2.6",
      body: body([{ role: "assistant", content: "plain answer" }]),
    });
    expect(out.messages[0].reasoning_content).toBeUndefined();
  });
});
