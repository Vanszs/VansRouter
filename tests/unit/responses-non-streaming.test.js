import { describe, it, expect } from "vitest";
import { translateNonStreamingResponse } from "../../open-sse/handlers/chatCore/nonStreamingHandler.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

describe("translateNonStreamingResponse - openai-responses format", () => {
  it("translates standard OpenAI Chat Completion response to Responses API format", () => {
    const openaiResponse = {
      id: "chatcmpl-12345",
      object: "chat.completion",
      created: 1677649422,
      model: "gpt-4o",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: "Hello! How can I help you?",
            reasoning_content: "Let me think..."
          },
          finish_reason: "stop"
        }
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 15,
        total_tokens: 25
      }
    };

    const result = translateNonStreamingResponse(
      openaiResponse,
      FORMATS.OPENAI,
      FORMATS.OPENAI_RESPONSES
    );

    expect(result.id).toBe("resp_12345");
    expect(result.object).toBe("response");
    expect(result.created_at).toBe(1677649422);
    expect(result.status).toBe("completed");
    
    // Output should contain 2 items: reasoning and message
    expect(result.output).toHaveLength(2);
    
    // 1st item: reasoning
    expect(result.output[0].type).toBe("reasoning");
    expect(result.output[0].summary[0].text).toBe("Let me think...");
    
    // 2nd item: message
    expect(result.output[1].type).toBe("message");
    expect(result.output[1].role).toBe("assistant");
    expect(result.output[1].content[0].text).toBe("Hello! How can I help you?");
    
    // Usage
    expect(result.usage.input_tokens).toBe(10);
    expect(result.usage.output_tokens).toBe(15);
    expect(result.usage.total_tokens).toBe(25);
  });

  it("translates OpenAI response with tool calls to Responses API format", () => {
    const openaiResponse = {
      id: "chatcmpl-tool",
      object: "chat.completion",
      created: 1677649423,
      model: "gpt-4o",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call_abc",
                type: "function",
                function: {
                  name: "get_weather",
                  arguments: '{"location":"Jakarta"}'
                }
              }
            ]
          },
          finish_reason: "tool_calls"
        }
      ],
      usage: {
        prompt_tokens: 20,
        completion_tokens: 30,
        total_tokens: 50
      }
    };

    const result = translateNonStreamingResponse(
      openaiResponse,
      FORMATS.OPENAI,
      FORMATS.OPENAI_RESPONSES
    );

    expect(result.id).toBe("resp_tool");
    expect(result.output).toHaveLength(1);
    expect(result.output[0].type).toBe("function_call");
    expect(result.output[0].call_id).toBe("call_abc");
    expect(result.output[0].name).toBe("get_weather");
    expect(result.output[0].arguments).toBe('{"location":"Jakarta"}');
  });
});
