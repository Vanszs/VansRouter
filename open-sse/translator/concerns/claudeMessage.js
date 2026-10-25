// OpenAI completion → Claude message. Non-streaming counterpart of
// response/openai-to-claude.js, reached whenever a Claude-format client is
// served by an OpenAI-compatible upstream (including forced SSE→JSON).
import { FORMATS } from "../formats.js";
import { fromOpenAIFinish } from "./finishReason.js";
import { extractReasoningText } from "./reasoning.js";
import { CLAUDE_BLOCK, MODEL_FALLBACK, RESPONSES_ITEM, ROLE } from "../schema/index.js";

function parseToolArguments(value) {
  if (!value) return {};
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

export function openAICompletionToClaudeMessage(responseBody, model = null) {
  if (!responseBody?.choices?.[0]) return responseBody;
  const choice = responseBody.choices[0];
  const message = choice.message || {};
  const content = [];

  const reasoning = extractReasoningText(message)
    || message.provider_specific_fields?.reasoning_content
    || "";
  if (reasoning) {
    content.push({ type: CLAUDE_BLOCK.THINKING, thinking: reasoning });
  }
  if (typeof message.content === "string" && message.content.length > 0) {
    content.push({ type: CLAUDE_BLOCK.TEXT, text: message.content });
  }
  for (const toolCall of message.tool_calls || []) {
    const fn = toolCall.function || {};
    content.push({
      type: CLAUDE_BLOCK.TOOL_USE,
      id: toolCall.id || `toolu_${Date.now()}_${content.length}`,
      name: fn.name || toolCall.name || "",
      input: parseToolArguments(fn.arguments || toolCall.arguments),
    });
  }
  // The Claude shape always carries content, so an empty completion (and one
  // whose only output is reasoning) falls back to an empty text block.
  if (content.length === 0) content.push({ type: CLAUDE_BLOCK.TEXT, text: "" });

  const usage = responseBody.usage || {};
  const claudeUsage = {
    input_tokens: usage.prompt_tokens ?? usage.input_tokens ?? 0,
    output_tokens: usage.completion_tokens ?? usage.output_tokens ?? 0,
  };
  if (usage.prompt_tokens_details?.cached_tokens) {
    claudeUsage.cache_read_input_tokens = usage.prompt_tokens_details.cached_tokens;
  }
  if (usage.completion_tokens_details?.reasoning_tokens) {
    claudeUsage.output_tokens += usage.completion_tokens_details.reasoning_tokens;
  }

  return {
    id: `msg_${String(responseBody.id || "").replace(/^chatcmpl-/, "") || Date.now()}`,
    type: RESPONSES_ITEM.MESSAGE,
    role: ROLE.ASSISTANT,
    model: model || responseBody.model || MODEL_FALLBACK,
    content,
    stop_reason: fromOpenAIFinish(choice.finish_reason, FORMATS.CLAUDE),
    stop_sequence: null,
    usage: claudeUsage,
  };
}
