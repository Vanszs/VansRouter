// Kiro sanitizes tool names to [A-Za-z0-9_-]; the client must get its own names
// back in the response, and images a tool returned must reach the model.
import { describe, it, expect } from "vitest";
import { normalizeKiroToolSpecs } from "../../open-sse/translator/concerns/kiroConversation.js";
import { claudeToKiroRequest } from "../../open-sse/translator/request/claude-to-kiro.js";
import { openaiToKiroRequest } from "../../open-sse/translator/request/openai-to-kiro.js";
import { kiroToClaudeResponse, kiroToClaudeNonStreaming } from "../../open-sse/translator/response/kiro-to-claude.js";
import { kiroToOpenAIResponse } from "../../open-sse/translator/response/kiro-to-openai.js";

const CLAUDE_BODY = (extra) => ({
  messages: [{ role: "user", content: "hello" }],
  ...extra,
});

describe("Kiro tool names", () => {
  it("keeps consecutive underscores instead of collapsing them", () => {
    const { specs, nameMap } = normalizeKiroToolSpecs([
      { name: "mcp__gitea__search_repos", description: "Search Gitea" },
    ]);

    expect(specs[0].toolSpecification.name).toBe("mcp__gitea__search_repos");
    expect(nameMap.get("mcp__gitea__search_repos")).toBe("mcp__gitea__search_repos");
  });

  it("returns the sanitized→original map on the Claude→Kiro payload", () => {
    const body = CLAUDE_BODY({
      tools: [{ name: "mcp.browser.computer", description: "browser", input_schema: { type: "object", properties: {} } }],
    });

    const out = claudeToKiroRequest("claude-sonnet-4.5", body, true, null);

    expect(out._toolNameMap).toBeInstanceOf(Map);
    expect(out._toolNameMap.get("mcp_browser_computer")).toBe("mcp.browser.computer");
    const wire = JSON.parse(JSON.stringify(out.conversationState));
    expect(JSON.stringify(wire)).toContain("mcp_browser_computer");
    expect(JSON.stringify(wire)).not.toContain("mcp.browser.computer");
  });

  it("returns the sanitized→original map on the OpenAI→Kiro payload", () => {
    const out = openaiToKiroRequest("claude-sonnet-4.5", {
      tools: [{ type: "function", function: { name: "mcp.browser.computer", description: "browser" } }],
      messages: [{ role: "user", content: "hello" }],
    }, true, {});

    expect(out._toolNameMap).toBeInstanceOf(Map);
    expect(out._toolNameMap.get("mcp_browser_computer")).toBe("mcp.browser.computer");
  });

  it("omits the map when no name changed", () => {
    const out = claudeToKiroRequest("claude-sonnet-4.5", CLAUDE_BODY({
      tools: [{ name: "mcp__gitea__search_repos", description: "Search Gitea", input_schema: { type: "object", properties: {} } }],
    }), true, null);

    expect(out._toolNameMap).toBeUndefined();
  });

  it("restores the client name in Kiro→Claude streaming", () => {
    const state = { toolNameMap: new Map([["my_tool_search", "my.tool/search"]]), toolCalls: new Map(), nextBlockIndex: 0 };
    const events = kiroToClaudeResponse({
      id: "chatcmpl-1",
      choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "my_tool_search", arguments: "" } }] } }],
    }, state);

    const start = events.find((e) => e.type === "content_block_start");
    expect(start.content_block.name).toBe("my.tool/search");
  });

  it("restores the client name in Kiro→Claude non-streaming", () => {
    const result = kiroToClaudeNonStreaming({
      choices: [{ message: { tool_calls: [{ id: "call_1", function: { name: "my_tool_search", arguments: "{}" } }] } }],
      toolNameMap: new Map([["my_tool_search", "my.tool/search"]]),
    });

    expect(result.content[0].name).toBe("my.tool/search");
  });

  it("restores the client name in Kiro→OpenAI chunks", () => {
    const state = { toolNameMap: new Map([["my_tool_search", "my.tool/search"]]) };
    const chunk = kiroToOpenAIResponse({
      object: "chat.completion.chunk",
      choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "my_tool_search", arguments: "" } }] } }],
    }, state);

    expect(chunk.choices[0].delta.tool_calls[0].function.name).toBe("my.tool/search");
  });
});

describe("Kiro tool-result images", () => {
  const body = {
    tools: [{ name: "shot", description: "screenshot", input_schema: { type: "object", properties: {} } }],
    messages: [
      { role: "user", content: "take a screenshot" },
      { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "shot", input: {} }] },
      {
        role: "user",
        content: [{
          type: "tool_result",
          tool_use_id: "t1",
          content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: "QUJD" } }],
        }],
      },
    ],
  };

  it("forwards a tool-result image as a user image", () => {
    const out = claudeToKiroRequest("claude-sonnet-4.5", body, true, null);
    const wire = out.conversationState.currentMessage.userInputMessage;

    expect(wire.images).toEqual([{ format: "png", source: { bytes: "QUJD" } }]);
    expect(wire.userInputMessageContext.toolResults[0].content[0].text).toBe("(image attached)");
  });

  it("keeps the tool-result text when the result also carries text", () => {
    const out = claudeToKiroRequest("claude-sonnet-4.5", {
      ...body,
      messages: [
        body.messages[0],
        body.messages[1],
        {
          role: "user",
          content: [{
            type: "tool_result",
            tool_use_id: "t1",
            content: [
              { type: "text", text: "captured" },
              { type: "image", source: { type: "base64", media_type: "image/png", data: "QUJD" } },
            ],
          }],
        },
      ],
    }, true, null);
    const wire = out.conversationState.currentMessage.userInputMessage;

    expect(wire.images).toEqual([{ format: "png", source: { bytes: "QUJD" } }]);
    expect(wire.userInputMessageContext.toolResults[0].content[0].text).toBe("captured");
  });
});
