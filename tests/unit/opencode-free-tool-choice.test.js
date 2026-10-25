import { describe, expect, it, vi } from "vitest";
import { OpenCodeExecutor } from "../../open-sse/executors/opencode.js";
import { PROVIDER_MODELS } from "../../open-sse/config/providerModels.js";
import { takeRenamedToolNames, restoreToolNames } from "../../open-sse/utils/opencodeFingerprint.js";
import { parseSSEToOpenAIResponse } from "../../open-sse/handlers/chatCore/sseToJsonHandler.js";

const CREDS = { connectionId: "opencode-free-tool-choice-test" };
const QUARTET = ["bash", "glob", "grep", "read"];

describe("opencode free-tier fingerprint tools", () => {
  const executor = new OpenCodeExecutor();

  it("never duplicates a quartet member the caller already declares", () => {
    for (const spelling of ["bash", "Bash"]) {
      const body = {
        messages: [{ role: "user", content: "hi" }],
        tools: [{ type: "function", function: { name: spelling, description: "client", parameters: { type: "object" } } }],
      };
      const out = executor.transformRequest("big-pickle", body, true, CREDS);
      const named = out.tools.filter((tool) => tool.function.name.toLowerCase() === "bash");
      expect(named).toHaveLength(1);
      expect(named[0].function.description).toBe("client");
      expect(out.tools.some((tool) => tool.function.name === "glob")).toBe(true);
    }
  });

  it("does not mutate the caller's tools array", () => {
    const tools = [{ type: "function", function: { name: "get_weather", parameters: { type: "object" } } }];
    const body = { messages: [{ role: "user", content: "hi" }], tools };
    const out = executor.transformRequest("big-pickle", body, true, CREDS);
    expect(tools).toHaveLength(1);
    expect(out.tools).toHaveLength(1 + QUARTET.length);
  });

  it("uses nested decoys and tool_choice none for chat requests without tools", () => {
    const out = executor.transformRequest("big-pickle", { messages: [{ role: "user", content: "hi" }] }, true, CREDS);
    expect(out.tools.map((tool) => tool.function.name)).toEqual(QUARTET);
    expect(out.tool_choice).toBe("none");
  });

  it("keeps the caller tool_choice for chat requests that already have tools", () => {
    const body = {
      messages: [{ role: "user", content: "hi" }],
      tools: [{ type: "function", function: { name: "get_weather", parameters: { type: "object" } } }],
      tool_choice: "required",
    };
    const out = executor.transformRequest("big-pickle", body, true, CREDS);
    expect(out.tool_choice).toBe("required");
    expect(out.tools.map((tool) => tool.function.name)).toEqual(["get_weather", ...QUARTET]);
  });

  it("uses Anthropic decoy shape for the Messages lane and leaves tool_choice alone", () => {
    const body = {
      messages: [{ role: "user", content: "hi" }],
      tools: [{ name: "get_weather", description: "w", input_schema: { type: "object", properties: {} } }],
    };
    const out = executor.transformRequest("big-pickle", body, true, {
      ...CREDS,
      runtimeTransport: { format: "claude" },
    });
    expect(out.tools.map((tool) => tool.name)).toEqual(["get_weather", ...QUARTET]);
    expect(out.tools[1]).toMatchObject({ name: "bash", input_schema: { type: "object", properties: {} } });
    expect("tool_choice" in out).toBe(false);
  });

  it("exposes the live free models verified by required tool calls", () => {
    const ids = PROVIDER_MODELS.oc.map(({ id }) => id);
    expect(ids).toEqual([
      "beam-free",
      // A decision model on the SystemOne endpoint, not a chat model.
      "jev-1.13-free",
      "mimo-v2.6-flash-free",
      "nemotron-3.5-super-vl-free",
      "deepseek-v4.1-flash-free",
      "glm-5.3-flash-free",
      "nemotron-3.5-lightning-free",
      "minimax-m3.1-flash-free",
    ]);
  });

  it("round-trips tool-result continuation through the real chat handler path", () => {
    const assistantMessage = {
      role: "assistant",
      content: null,
      tool_calls: [{
        id: "call-1",
        type: "function",
        function: { name: "report_weather", arguments: '{"city":"Paris"}' },
      }],
    };
    const toolResult = { role: "tool", tool_call_id: "call-1", content: "Sunny, 18C" };
    const body = { messages: [{ role: "user", content: "Weather?" }, assistantMessage, toolResult] };
    const out = executor.transformRequest("deepseek-v4.1-flash-free", body, true, CREDS);

    expect(out.messages[0]).toEqual(body.messages[0]);
    expect(out.messages[1]).toMatchObject({
      role: "assistant",
      content: null,
      tool_calls: assistantMessage.tool_calls,
    });
    expect(out.messages[2]).toEqual(toolResult);
  });

  it("aggregates streamed tool-call deltas and restores the original caller name", () => {
    const body = {
      messages: [{ role: "user", content: "find files" }],
      tools: [{ type: "function", function: { name: "Grep", parameters: { type: "object" } } }],
    };
    executor.transformRequest("deepseek-v4.1-flash-free", body, true, CREDS);
    const toolNameMap = takeRenamedToolNames(body);
    const sse = [
      'data: {"id":"c1","model":"deepseek-v4.1-flash-free","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call-1","type":"function","function":{"name":"grep","arguments":"{\\"query\\":"}}]},"finish_reason":null}]}',
      'data: {"id":"c1","model":"deepseek-v4.1-flash-free","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"TODO\\"}"}}]},"finish_reason":null}]}',
      'data: {"id":"c1","model":"deepseek-v4.1-flash-free","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}',
      "data: [DONE]",
    ].join("\n");

    const parsed = parseSSEToOpenAIResponse(sse, "deepseek-v4.1-flash-free");
    expect(parsed.choices[0].finish_reason).toBe("tool_calls");
    expect(restoreToolNames(parsed, toolNameMap).choices[0].message.tool_calls).toEqual([{
      id: "call-1",
      type: "function",
      function: { name: "Grep", arguments: '{"query":"TODO"}' },
    }]);
  });

  it("does not advertise space-bunny after upstream deprecates it", () => {
    const ids = PROVIDER_MODELS.oc.map(({ id }) => id);
    expect(ids).not.toContain("space-bunny-free");
    expect(ids).toContain("minimax-m3.1-flash-free");
  });
});
