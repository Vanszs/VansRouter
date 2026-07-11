import { FORMATS } from "../../translator/formats.js";
import { needsTranslation } from "../../translator/index.js";
import { ollamaBodyToOpenAI } from "../../translator/response/ollama-to-openai.js";
import { normalizeKimiToolCalls } from "../../utils/kimiToolParser.js";
import { addBufferToUsage, filterUsageForFormat } from "../../utils/usageTracking.js";
import { createErrorResult } from "../../utils/error.js";
import { HTTP_STATUS } from "../../config/runtimeConfig.js";
import { unwrapClinepassEnvelope } from "../../utils/clinepassEnvelope.js";
import { parseSSEToOpenAIResponse } from "./sseToJsonHandler.js";
import { buildRequestDetail, extractRequestConfig, extractUsageFromResponse, saveUsageStats } from "./requestDetail.js";
import { appendRequestLog, saveRequestDetail } from "@/lib/usageDb.js";
import { decloakToolNames } from "../../utils/claudeCloaking.js";
import { extractToolNames } from "../../translator/concerns/toolCall.js";

/**
 * Translate non-streaming response body from provider format → OpenAI format.
 */

function translateGeminiToOpenAI(responseBody) {
  const response = responseBody.response || responseBody;
  if (!response?.candidates?.[0]) return responseBody;

  const candidate = response.candidates[0];
  const content = candidate.content;
  const usage = response.usageMetadata || responseBody.usageMetadata;
  let textContent = "", reasoningContent = "";
  const toolCalls = [];

  if (content?.parts) {
    for (const part of content.parts) {
      if (part.thought === true && part.text) reasoningContent += part.text;
      else if (part.text !== undefined) textContent += part.text;
      if (part.functionCall) {
        toolCalls.push({
          id: `call_${part.functionCall.name}_${Date.now()}_${toolCalls.length}`,
          type: "function",
          function: { name: part.functionCall.name, arguments: JSON.stringify(part.functionCall.args || {}) }
        });
      }
      const inlineData = part.inlineData || part.inline_data;
      if (inlineData?.data) {
        const mimeType = inlineData.mimeType || inlineData.mime_type || "image/png";
        textContent += `\n![image](data:${mimeType};base64,${inlineData.data})\n`;
      }
    }
  }

  const message = { role: "assistant" };
  if (textContent) message.content = textContent;
  if (reasoningContent) message.reasoning_content = reasoningContent;
  if (toolCalls.length > 0) message.tool_calls = toolCalls;
  if (!message.content && !message.tool_calls) message.content = "";

  let finishReason = (candidate.finishReason || "stop").toLowerCase();
  if (finishReason === "stop" && toolCalls.length > 0) finishReason = "tool_calls";

  const result = {
    id: `chatcmpl-${response.responseId || Date.now()}`,
    object: "chat.completion",
    created: Math.floor(new Date(response.createTime || Date.now()).getTime() / 1000),
    model: response.modelVersion || "gemini",
    choices: [{ index: 0, message, finish_reason: finishReason }]
  };

  if (usage) {
    result.usage = {
      prompt_tokens: (usage.promptTokenCount || 0) + (usage.thoughtsTokenCount || 0),
      completion_tokens: usage.candidatesTokenCount || 0,
      total_tokens: usage.totalTokenCount || 0
    };
    if (usage.thoughtsTokenCount > 0) {
      result.usage.completion_tokens_details = { reasoning_tokens: usage.thoughtsTokenCount };
    }
  }
  return result;
}

function translateClaudeToOpenAI(responseBody) {
  if (responseBody.choices || (responseBody.content && !Array.isArray(responseBody.content))) return responseBody;

  let textContent = "", thinkingContent = "";
  const toolCalls = [];

  for (const block of (responseBody.content || [])) {
    if (block.type === "text") {
      const raw = block.text ?? "";
      const text = raw.replace(/^\s*```\s*json\s*\n?/i, "").replace(/\n?\s*```\s*$/i, "");
      textContent += text;
    } else if (block.type === "thinking") thinkingContent += block.thinking || "";
    else if (block.type === "tool_use") {
      toolCalls.push({ id: block.id, type: "function", function: { name: block.name, arguments: JSON.stringify(block.input || {}) } });
    }
  }

  const message = { role: "assistant" };
  if (textContent) message.content = textContent;
  if (thinkingContent) message.reasoning_content = thinkingContent;
  if (toolCalls.length > 0) message.tool_calls = toolCalls;
  if (!message.content && !message.tool_calls) message.content = "";

  let finishReason = responseBody.stop_reason || "stop";
  if (finishReason === "end_turn") finishReason = "stop";
  if (finishReason === "tool_use") finishReason = "tool_calls";

  const result = {
    id: `chatcmpl-${responseBody.id || Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: responseBody.model || "claude",
    choices: [{ index: 0, message, finish_reason: finishReason }]
  };

  if (responseBody.usage) {
    result.usage = {
      prompt_tokens: responseBody.usage.input_tokens || 0,
      completion_tokens: responseBody.usage.output_tokens || 0,
      total_tokens: (responseBody.usage.input_tokens || 0) + (responseBody.usage.output_tokens || 0)
    };
  }
  return result;
}

function translateOpenAIToOpenAIResponses(openaiResponse) {
  if (!openaiResponse) return openaiResponse;

  const choices = openaiResponse.choices || [];
  const output = [];

  if (choices.length > 0) {
    const choice = choices[0];
    const message = choice.message || {};
    const responseId = openaiResponse.id ? `resp_${openaiResponse.id.replace(/^chatcmpl-/, "")}` : `resp_${Date.now()}`;

    // 1. Handle reasoning_content / reasoning
    const reasoningText = message.reasoning_content || message.reasoning || (message.provider_specific_fields?.reasoning_content) || "";
    if (reasoningText) {
      output.push({
        id: `rs_${responseId}_0`,
        type: "reasoning",
        summary: [
          {
            type: "summary_text",
            text: reasoningText
          }
        ]
      });
    }

    // 2. Handle content
    if (message.content !== undefined && message.content !== null) {
      output.push({
        id: `msg_${responseId}_0`,
        type: "message",
        role: "assistant",
        content: [
          {
            type: "output_text",
            text: message.content,
            annotations: [],
            logprobs: []
          }
        ]
      });
    }

    // 3. Handle tool calls
    if (Array.isArray(message.tool_calls)) {
      for (const tc of message.tool_calls) {
        output.push({
          id: `fc_${tc.id}`,
          type: "function_call",
          call_id: tc.id,
          name: tc.function?.name || "",
          arguments: tc.function?.arguments || "{}"
        });
      }
    }
  }

  const openaiUsage = openaiResponse.usage || {};
  const usage = {
    input_tokens: openaiUsage.prompt_tokens || 0,
    output_tokens: openaiUsage.completion_tokens || 0,
    total_tokens: openaiUsage.total_tokens || 0
  };

  return {
    id: openaiResponse.id ? `resp_${openaiResponse.id.replace(/^chatcmpl-/, "")}` : `resp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    object: "response",
    created_at: openaiResponse.created || Math.floor(Date.now() / 1000),
    status: "completed",
    model: openaiResponse.model || "",
    output,
    usage
  };
}

/**
 * Translate non-streaming response body from provider format → client format.
 */
export function translateNonStreamingResponse(responseBody, targetFormat, sourceFormat) {
  if (targetFormat === sourceFormat) return responseBody;

  let baseResponse = responseBody;

  if (targetFormat !== FORMATS.OPENAI) {
    if (targetFormat === FORMATS.GEMINI || targetFormat === FORMATS.ANTIGRAVITY || targetFormat === FORMATS.GEMINI_CLI || targetFormat === FORMATS.VERTEX) {
      baseResponse = translateGeminiToOpenAI(responseBody);
    } else if (targetFormat === FORMATS.CLAUDE) {
      baseResponse = translateClaudeToOpenAI(responseBody);
    } else if (targetFormat === FORMATS.OLLAMA) {
      baseResponse = ollamaBodyToOpenAI(responseBody);
    }
  }

  if (sourceFormat === FORMATS.OPENAI_RESPONSES) {
    return translateOpenAIToOpenAIResponses(baseResponse);
  }

  return baseResponse;
}

export async function handleNonStreamingResponse({ providerResponse, provider, model, sourceFormat, targetFormat, body, stream, translatedBody, finalBody, requestStartTime, connectionId, apiKey, apiKeyName, clientRawRequest, onRequestSuccess, reqLogger, toolNameMap, trackDone, appendLog, pxpipe }) {
  trackDone();
  const contentType = providerResponse.headers.get("content-type") || "";
  let responseBody;

  if (contentType.includes("text/event-stream")) {
    const sseText = await providerResponse.text();
    const parsed = parseSSEToOpenAIResponse(sseText, model, extractToolNames(body?.tools));
    if (!parsed) {
      appendLog({ status: `FAILED ${HTTP_STATUS.BAD_GATEWAY}` });
      return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Invalid SSE response for non-streaming request");
    }
    responseBody = parsed;
  } else {
    try {
      responseBody = await providerResponse.json();
    } catch (err) {
      appendLog({ status: `FAILED ${HTTP_STATUS.BAD_GATEWAY}` });
      console.error(`[ChatCore] Failed to parse JSON from ${provider}:`, err.message);
      return createErrorResult(HTTP_STATUS.BAD_GATEWAY, `Invalid JSON response from ${provider}`);
    }
  }

  reqLogger.logProviderResponse(providerResponse.status, providerResponse.statusText, providerResponse.headers, responseBody);
  if (onRequestSuccess) {
    Promise.resolve()
      .then(onRequestSuccess)
      .catch(err => {
        console.error("[ChatCore] onRequestSuccess failed:", err?.message || err);
      });
  }

  // Unwrap ClinePass {success, data} envelope before decloak/translation
  {
    const { body: unwrapped, error: envError } = unwrapClinepassEnvelope(responseBody, provider);
    if (envError) {
      appendLog({ status: `FAILED ${HTTP_STATUS.BAD_GATEWAY}` });
      return createErrorResult(HTTP_STATUS.BAD_GATEWAY, envError.message);
    }
    responseBody = unwrapped;
  }

  // Decloak tool_use names once on raw Claude body, before any translation (INPUT side)
  responseBody = decloakToolNames(responseBody, toolNameMap);

  const usage = extractUsageFromResponse(responseBody);
  appendLog({ tokens: usage, status: "200 OK" });
  saveUsageStats({ provider, model, tokens: usage, connectionId, apiKey, endpoint: clientRawRequest?.endpoint });

  const translatedResponse = needsTranslation(targetFormat, sourceFormat)
    ? translateNonStreamingResponse(responseBody, targetFormat, sourceFormat)
    : responseBody;

  // Native Kimi tool-call markup sometimes leaks into `content` instead of being
  // returned as a structured `tool_calls` array (see .docs/audit/KIMI-WEIRD-OUTPUTS.md).
  // Convert it for Kimi-family models before the finish_reason fixup.
  const isKimiModel = /kimi-k2\./i.test(model || "");
  if (isKimiModel && Array.isArray(translatedResponse?.choices)) {
    for (const choice of translatedResponse.choices) {
      const msg = choice?.message;
      if (!msg || msg.role !== "assistant") continue;
      const { message: normalized, hasTools } = normalizeKimiToolCalls(msg);
      if (hasTools) {
        choice.message = normalized;
      }
    }
  }

  // Fix finish_reason for tool_calls: some providers return non-standard values (e.g. "other")
  if (translatedResponse?.choices?.[0]) {
    const choice = translatedResponse.choices[0];
    const msg = choice.message;
    const hasToolCalls = Array.isArray(msg?.tool_calls) && msg.tool_calls.length > 0;
    if (hasToolCalls && choice.finish_reason !== "tool_calls") {
      choice.finish_reason = "tool_calls";
    }
  }

  // Ensure OpenAI-required fields
  if (!translatedResponse.object) translatedResponse.object = "chat.completion";
  if (!translatedResponse.created) translatedResponse.created = Math.floor(Date.now() / 1000);

  // Strip Azure-specific fields
  delete translatedResponse.prompt_filter_results;
  if (translatedResponse?.choices) {
    for (const choice of translatedResponse.choices) delete choice.content_filter_results;
  }

  if (translatedResponse?.usage) {
    translatedResponse.usage = filterUsageForFormat(addBufferToUsage(translatedResponse.usage), sourceFormat);
  }

  // Strip reasoning_content when content is non-empty.
  // When content is empty (e.g. thinking models that used all tokens for reasoning),
  // reasoning_content is the only useful output and must be preserved.
  // Also strip provider_specific_fields.reasoning_content (Kimchi puts it there).
  if (translatedResponse?.choices) {
    for (const choice of translatedResponse.choices) {
      const msg = choice?.message;
      if (!msg) continue;
      if (msg.reasoning_content && msg.content) {
        delete msg.reasoning_content;
      }
      if (msg.provider_specific_fields?.reasoning_content && msg.content) {
        delete msg.provider_specific_fields.reasoning_content;
      }
      if (msg.provider_specific_fields?.reasoning && msg.content) {
        delete msg.provider_specific_fields.reasoning;
      }
    }
  }

  reqLogger.logConvertedResponse(translatedResponse);

  const totalLatency = Date.now() - requestStartTime;
  saveRequestDetail(buildRequestDetail({
    provider, model, connectionId, apiKey, apiKeyName,
    latency: { ttft: totalLatency, total: totalLatency },
    tokens: usage || { prompt_tokens: 0, completion_tokens: 0 },
    request: extractRequestConfig(body, stream),
    providerRequest: finalBody || translatedBody || null,
    providerResponse: responseBody || null,
    response: {
      content: translatedResponse?.choices?.[0]?.message?.content || translatedResponse?.content || null,
      thinking: translatedResponse?.choices?.[0]?.message?.reasoning_content || translatedResponse?.reasoning_content || null,
      finish_reason: translatedResponse?.choices?.[0]?.finish_reason || "unknown"
    },
    pxpipe,
    status: "success"
  }, { endpoint: clientRawRequest?.endpoint || null })).catch(err => {
    console.error("[RequestDetail] Failed to save:", err.message);
  });

  return {
    success: true,
    response: new Response(JSON.stringify(translatedResponse), {
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    })
  };
}
