import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/usageDb.js", () => ({ appendRequestLog: vi.fn(), saveRequestDetail: vi.fn() }));

import { openaiToClaudeNonStreaming } from "../../open-sse/handlers/chatCore/nonStreamingHandler.js";

// Some OpenAI-compatible upstreams report the reasoning text only as
// provider_specific_fields.reasoning_content rather than on message.reasoning_content.
// The Claude converter (reached whenever a Claude-format client was served over an
// OpenAI upstream, e.g. the relayn path) must not drop it. (upstream 1d4335d4)
describe("openaiToClaudeNonStreaming reasoning fallbacks", () => {
  const base = {
    id: "chatcmpl-abc123",
    model: "some-model",
    choices: [{ index: 0, message: { role: "assistant", content: "hello" }, finish_reason: "stop" }],
    usage: { prompt_tokens: 1, completion_tokens: 2 },
  };

  it("maps message.reasoning_content to a thinking block", () => {
    const body = structuredClone(base);
    body.choices[0].message.reasoning_content = "because";
    const out = openaiToClaudeNonStreaming(body, "some-model");
    expect(out.content).toContainEqual({ type: "thinking", thinking: "because" });
  });

  it("maps provider_specific_fields.reasoning_content to a thinking block", () => {
    const body = structuredClone(base);
    body.choices[0].message.provider_specific_fields = { reasoning_content: "because" };
    const out = openaiToClaudeNonStreaming(body, "some-model");
    expect(out.content).toContainEqual({ type: "thinking", thinking: "because" });
  });

  it("falls back to an empty text block when the completion has no content", () => {
    const body = structuredClone(base);
    body.choices[0].message.content = "";
    body.choices[0].message.reasoning_content = "because";
    const out = openaiToClaudeNonStreaming(body, "some-model");
    // A reasoning-only completion keeps just the thinking block; the empty text
    // block is only for a genuinely empty message.
    expect(out.content).toEqual([{ type: "thinking", thinking: "because" }]);

    const empty = structuredClone(base);
    empty.choices[0].message.content = "";
    expect(openaiToClaudeNonStreaming(empty, "some-model").content).toEqual([{ type: "text", text: "" }]);
  });
});
