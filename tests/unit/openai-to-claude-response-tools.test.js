import { describe, expect, it } from "vitest";
import { openaiToClaudeResponse } from "../../open-sse/translator/response/openai-to-claude.js";

function createState() {
  return { toolCalls: new Map(), nextBlockIndex: 0 };
}

function getInputJsonDelta(events) {
  return events.find((event) => event.type === "content_block_delta" && event.delta?.type === "input_json_delta")?.delta.partial_json;
}

describe("openaiToClaudeResponse GLM/fireworks repeated tool-call id handling (#52623587)", () => {
  it("opens only one content_block_start when provider repeats id+null-name chunks", () => {
    const state = createState();
    const allEvents = [];

    const first = openaiToClaudeResponse({
      id: "chatcmpl-glm-repeat",
      model: "test-model",
      choices: [{ delta: { tool_calls: [{ index: 0, id: "toolu_glm", function: { name: "Read" } }] } }],
    }, state);
    if (first) allEvents.push(...first);

    expect(allEvents.filter((e) => e.type === "content_block_start")).toHaveLength(1);

    const second = openaiToClaudeResponse({
      id: "chatcmpl-glm-repeat",
      model: "test-model",
      choices: [{ delta: { tool_calls: [{ index: 0, id: "toolu_glm", function: { name: null } }] } }],
    }, state);
    if (second) allEvents.push(...second);

    // Without the fix this would emit a second content_block_start (and a stop for the first).
    expect(allEvents.filter((e) => e.type === "content_block_start")).toHaveLength(1);
    expect(allEvents.filter((e) => e.type === "content_block_stop")).toHaveLength(0);
    expect(state.toolCalls.size).toBe(1);

    const third = openaiToClaudeResponse({
      id: "chatcmpl-glm-repeat",
      model: "test-model",
      choices: [{
        delta: { tool_calls: [{ index: 0, function: { arguments: JSON.stringify({ file_path: "/tmp/x" }) } }] },
        finish_reason: "tool_calls",
      }],
    }, state);
    if (third) allEvents.push(...third);

    expect(JSON.parse(getInputJsonDelta(allEvents))).toEqual({ file_path: "/tmp/x" });
  });
});

describe("openaiToClaudeResponse tool argument sanitization", () => {
  it("drops invalid Read pages and clamps numeric bounds", () => {
    const state = createState();

    openaiToClaudeResponse({
      id: "chatcmpl-test-read",
      model: "test-model",
      choices: [{ delta: { tool_calls: [{ index: 0, id: "toolu_read", function: { name: "Read" } }] } }],
    }, state);

    const events = openaiToClaudeResponse({
      id: "chatcmpl-test-read",
      model: "test-model",
      choices: [{
        delta: { tool_calls: [{ index: 0, function: { arguments: JSON.stringify({ file_path: "F:/repo/file.js", offset: -5, limit: 999999999, pages: "" }) } }] },
        finish_reason: "tool_calls",
      }],
    }, state);

    expect(JSON.parse(getInputJsonDelta(events))).toEqual({
      file_path: "F:/repo/file.js",
      offset: 0,
      limit: 2000,
    });
  });

  it("keeps valid PDF pages", () => {
    const state = createState();

    openaiToClaudeResponse({
      id: "chatcmpl-test-pdf",
      model: "test-model",
      choices: [{ delta: { tool_calls: [{ index: 0, id: "toolu_pdf", function: { name: "proxy_Read" } }] } }],
    }, state);

    const events = openaiToClaudeResponse({
      id: "chatcmpl-test-pdf",
      model: "test-model",
      choices: [{
        delta: { tool_calls: [{ index: 0, function: { arguments: JSON.stringify({ file_path: "F:/repo/doc.pdf", pages: "1-3" }) } }] },
        finish_reason: "tool_calls",
      }],
    }, state);

    expect(JSON.parse(getInputJsonDelta(events))).toEqual({
      file_path: "F:/repo/doc.pdf",
      pages: "1-3",
    });
  });
});
