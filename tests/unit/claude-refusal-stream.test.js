// Anthropic's API-level refusal (stop_reason "refusal", zero output tokens, no
// content blocks) must reach an OpenAI-format client as finish_reason
// "content_filter" carrying Anthropic's own explanation, not as a clean empty stop.
import { describe, it, expect } from "vitest";
import { claudeToOpenAIResponse } from "../../open-sse/translator/response/claude-to-openai.js";

const EXPLANATION = "This request was blocked as it violates Anthropic's Terms of Service.";

function runStream(events) {
  const state = {};
  const out = [];
  for (const ev of events) {
    const r = claudeToOpenAIResponse(ev, state);
    if (Array.isArray(r)) out.push(...r);
    else if (r) out.push(r);
  }
  return { state, out };
}

const messageStart = {
  type: "message_start",
  message: {
    id: "msg_refusal", model: "claude-opus-4.5", role: "assistant", content: [],
    usage: { input_tokens: 637, cache_creation_input_tokens: 206779, cache_read_input_tokens: 0, output_tokens: 0 },
  },
};

const textOf = (out) => out.map((c) => c.choices?.[0]?.delta?.content || "").join("");
const finishesOf = (out) => out.map((c) => c.choices?.[0]?.finish_reason).filter(Boolean);

describe("claude-to-openai: refusal stop_reason", () => {
  it("finishes with content_filter and surfaces the explanation", () => {
    const { out } = runStream([
      messageStart,
      {
        type: "message_delta",
        delta: { stop_reason: "refusal", stop_sequence: null, stop_details: { type: "refusal", category: "reasoning_extraction", explanation: EXPLANATION } },
        usage: { input_tokens: 637, cache_creation_input_tokens: 206779, cache_read_input_tokens: 0, output_tokens: 0 },
      },
      { type: "message_stop" },
    ]);

    expect(finishesOf(out)).toEqual(["content_filter"]);
    expect(textOf(out)).toBe(EXPLANATION);
    const final = out.find((c) => c.choices?.[0]?.finish_reason === "content_filter");
    expect(final.usage.prompt_tokens).toBe(637 + 206779);
    expect(final.usage.completion_tokens).toBe(0);
  });

  it("keeps the synthetic content chunk when a refusal carries no explanation", () => {
    const { out } = runStream([
      messageStart,
      { type: "message_delta", delta: { stop_reason: "refusal", stop_sequence: null }, usage: { output_tokens: 0 } },
      { type: "message_stop" },
    ]);

    expect(finishesOf(out)).toEqual(["content_filter"]);
    expect(textOf(out)).toBe("\n");
  });

  it("leaves a normal end_turn untouched", () => {
    const { out } = runStream([
      messageStart,
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "ok" } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null, stop_details: null }, usage: { output_tokens: 1 } },
      { type: "message_stop" },
    ]);

    expect(finishesOf(out)).toEqual(["stop"]);
    expect(textOf(out)).toBe("ok");
  });
});
