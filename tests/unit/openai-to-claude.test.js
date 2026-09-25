/**
 * Unit tests for open-sse/translator/request/openai-to-claude.js
 *
 * Tests cover:
 *  - openaiToClaudeRequest() - OpenAI to Claude request translation
 *  - Response format handling (json_schema, json_object)
 */

import { describe, it, expect } from "vitest";
import { openaiToClaudeRequest } from "../../open-sse/translator/request/openai-to-claude.js";
import { openaiToClaudeResponse } from "../../open-sse/translator/response/openai-to-claude.js";
import { openaiToClaudeNonStreaming } from "../../open-sse/handlers/chatCore/nonStreamingHandler.js";
import { decloakToolNames } from "../../open-sse/utils/claudeCloaking.js";

describe("openaiToClaudeRequest", () => {
  describe("response_format handling", () => {
    it("should inject JSON schema instructions for json_schema type", () => {
      const body = {
        messages: [{ role: "user", content: "What is 2+2?" }],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "math_response",
            schema: {
              type: "object",
              properties: {
                answer: { type: "number" },
                explanation: { type: "string" }
              },
              required: ["answer", "explanation"]
            }
          }
        }
      };

      const result = openaiToClaudeRequest("claude-sonnet-4.5", body, false);

      // Should have system array with instructions
      expect(result.system).toBeDefined();
      expect(Array.isArray(result.system)).toBe(true);
      
      // Check that system prompt includes schema
      const systemText = result.system
        .filter(s => s.type === "text")
        .map(s => s.text)
        .join("\n");
      
      expect(systemText).toContain("You must respond with valid JSON");
      expect(systemText).toContain("\"answer\"");
      expect(systemText).toContain("\"explanation\"");
      expect(systemText).toContain("Respond ONLY with the JSON object");
    });

    it("should inject basic JSON instructions for json_object type", () => {
      const body = {
        messages: [{ role: "user", content: "Give me a JSON object" }],
        response_format: {
          type: "json_object"
        }
      };

      const result = openaiToClaudeRequest("claude-sonnet-4.5", body, false);

      // Should have system array with instructions
      expect(result.system).toBeDefined();
      expect(Array.isArray(result.system)).toBe(true);
      
      const systemText = result.system
        .filter(s => s.type === "text")
        .map(s => s.text)
        .join("\n");
      
      expect(systemText).toContain("You must respond with valid JSON");
      expect(systemText).toContain("Respond ONLY with a JSON object");
    });

    it("should not modify system prompt when response_format is missing", () => {
      const body = {
        messages: [{ role: "user", content: "Hello" }]
      };

      const result = openaiToClaudeRequest("claude-sonnet-4.5", body, false);

      // Should have system but without JSON instructions
      expect(result.system).toBeDefined();
      
      const systemText = result.system
        .filter(s => s.type === "text")
        .map(s => s.text)
        .join("\n");
      
      // Should NOT contain JSON-specific instructions
      expect(systemText).not.toContain("You must respond with valid JSON");
    });

    it("should preserve existing system messages when adding response_format", () => {
      const body = {
        messages: [
          { role: "system", content: "You are a helpful math tutor." },
          { role: "user", content: "What is 2+2?" }
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            schema: {
              type: "object",
              properties: {
                result: { type: "number" }
              }
            }
          }
        }
      };

      const result = openaiToClaudeRequest("claude-sonnet-4.5", body, false);

      // Should preserve original system message
      const systemText = result.system
        .filter(s => s.type === "text")
        .map(s => s.text)
        .join("\n");
      
      expect(systemText).toContain("You are a helpful math tutor");
      expect(systemText).toContain("You must respond with valid JSON");
    });
  });

  describe("tool_choice handling", () => {
    const baseBody = {
      messages: [{ role: "user", content: "add a todo" }],
      tools: [{
        type: "function",
        function: { name: "todo_write", description: "write todos", parameters: { type: "object", properties: {} } }
      }]
    };

    const choiceOf = (tc) =>
      openaiToClaudeRequest("claude-sonnet-4.5", { ...baseBody, tool_choice: tc }, false).tool_choice;

    it("converts OpenAI forced tool ({type:'function'}) to Claude {type:'tool'}", () => {
      // Must NOT leak the OpenAI "function" type — Claude only accepts auto|any|tool|none.
      expect(choiceOf({ type: "function", function: { name: "todo_write" } }))
        .toEqual({ type: "tool", name: "todo_write" });
    });

    it("maps string tool_choice values", () => {
      expect(choiceOf("auto")).toEqual({ type: "auto" });
      expect(choiceOf("none")).toEqual({ type: "auto" });
      expect(choiceOf("required")).toEqual({ type: "any" });
    });

    it("passes through Claude-native tool_choice objects unchanged", () => {
      expect(choiceOf({ type: "tool", name: "todo_write" })).toEqual({ type: "tool", name: "todo_write" });
      expect(choiceOf({ type: "any" })).toEqual({ type: "any" });
      expect(choiceOf({ type: "none" })).toEqual({ type: "none" });
    });

    it("never leaks an invalid type (falls back to auto)", () => {
      // Malformed forced choice with no tool name, and unknown types, must not
      // pass an invalid `type` through to Claude.
      expect(choiceOf({ type: "function", function: {} })).toEqual({ type: "auto" });
      expect(choiceOf({ type: "function" })).toEqual({ type: "auto" });
      expect(choiceOf({ type: "bogus" })).toEqual({ type: "auto" });
    });

    it("omits tool_choice entirely when the request has none", () => {
      const result = openaiToClaudeRequest("claude-sonnet-4.5", baseBody, false);
      expect(result.tool_choice).toBeUndefined();
    });
  });
});

describe("openaiToClaudeResponse", () => {
  it("omits empty Read pages tool argument before emitting Claude input deltas", () => {
    const state = { toolCalls: new Map() };
    const chunk = {
      id: "chatcmpl-test",
      model: "gpt-test",
      choices: [{
        delta: {
          tool_calls: [{
            index: 0,
            id: "call_read",
            function: {
              name: "Read",
              arguments: JSON.stringify({
                file_path: "/tmp/example.txt",
                offset: 0,
                limit: 120,
                pages: ""
              })
            }
          }]
        }
      }]
    };

    // Args are buffered while streaming; the sanitized input_json_delta is
    // emitted once the tool call finishes.
    openaiToClaudeResponse(chunk, state);
    const finishChunk = {
      id: "chatcmpl-test",
      model: "gpt-test",
      choices: [{ delta: {}, finish_reason: "tool_calls" }]
    };
    const result = openaiToClaudeResponse(finishChunk, state);
    const inputDelta = result.find(event => event.delta?.type === "input_json_delta");

    expect(inputDelta).toBeDefined();
    expect(JSON.parse(inputDelta.delta.partial_json)).toEqual({
      file_path: "/tmp/example.txt",
      offset: 0,
      limit: 120
    });
  });
});

describe("openaiToClaudeNonStreaming", () => {
  it("translates OpenAI text and reasoning content to Claude blocks", () => {
    const openaiBody = {
      id: "chatcmpl-123",
      model: "gpt-4o",
      choices: [{
        index: 0,
        message: {
          role: "assistant",
          content: "Hello user",
          reasoning_content: "Checking parameters first."
        },
        finish_reason: "stop"
      }],
      usage: {
        prompt_tokens: 15,
        completion_tokens: 25,
        total_tokens: 40,
        prompt_tokens_details: { cached_tokens: 10 },
        completion_tokens_details: { reasoning_tokens: 12 }
      }
    };

    const result = openaiToClaudeNonStreaming(openaiBody, "claude-3-5-sonnet");

    expect(result.id).toBe("msg_123");
    expect(result.type).toBe("message");
    expect(result.role).toBe("assistant");
    expect(result.model).toBe("claude-3-5-sonnet");
    expect(result.stop_reason).toBe("end_turn");
    expect(result.content).toEqual([
      { type: "thinking", thinking: "Checking parameters first." },
      { type: "text", text: "Hello user" }
    ]);
    expect(result.usage).toEqual({
      input_tokens: 15,
      output_tokens: 37, // 25 completion + 12 reasoning
      cache_read_input_tokens: 10
    });
  });

  it("translates OpenAI tool calls to Claude format", () => {
    const openaiBody = {
      id: "chatcmpl-456",
      model: "gpt-4o",
      choices: [{
        index: 0,
        message: {
          role: "assistant",
          tool_calls: [{
            id: "call_abc",
            type: "function",
            function: {
              name: "read_file",
              arguments: JSON.stringify({ path: "/etc/passwd" })
            }
          }]
        },
        finish_reason: "tool_calls"
      }],
      usage: {
        prompt_tokens: 20,
        completion_tokens: 10
      }
    };

    const result = openaiToClaudeNonStreaming(openaiBody);

    expect(result.id).toBe("msg_456");
    expect(result.stop_reason).toBe("tool_use");
    expect(result.content).toEqual([
      {
        type: "tool_use",
        id: "call_abc",
        name: "read_file",
        input: { path: "/etc/passwd" }
      }
    ]);
    expect(result.usage).toEqual({
      input_tokens: 20,
      output_tokens: 10
    });
  });

  it("restores cloaked tool names when used in combination with decloakToolNames", () => {
    const openaiBody = {
      id: "chatcmpl-tool-cloaked",
      model: "gpt-4o",
      choices: [{
        index: 0,
        message: {
          role: "assistant",
          tool_calls: [{
            id: "call_t1",
            type: "function",
            function: {
              name: "read_file_cc",
              arguments: "{}"
            }
          }]
        },
        finish_reason: "tool_calls"
      }]
    };

    const toolNameMap = new Map([["read_file_cc", "read_file"]]);
    const reversed = openaiToClaudeNonStreaming(openaiBody, "claude-3-5-sonnet");
    const result = decloakToolNames(reversed, toolNameMap);

    expect(result.content[0].name).toBe("read_file");
  });

  it("handles missing choices gracefully", () => {
    const emptyBody = { choices: [] };
    expect(openaiToClaudeNonStreaming(emptyBody)).toEqual(emptyBody);
    expect(openaiToClaudeNonStreaming(null)).toBeNull();
  });
});
