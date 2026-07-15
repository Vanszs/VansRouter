import { createHash } from "node:crypto";
import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { SSE_DONE } from "../utils/sseConstants.js";
import { sseChunk } from "../utils/sse.js";

const META_AI_GRAPHQL_API = "https://www.meta.ai/api/graphql";
const META_AI_DEFAULT_COOKIE = "ecto_1_sess";
const META_AI_SEND_MESSAGE_DOC_ID = "29ae946c82d1f301196c6ca2226400b5";
const META_AI_ROOT_BRANCH_PATH = "0";
const META_AI_ENTRY_POINT = "KADABRA__CHAT__UNIFIED_INPUT_BAR";
const META_AI_FRIENDLY_NAME = "useEctoSendMessageSubscription";
const META_AI_REQUEST_ANALYTICS_TAGS = "graphservice";
const META_AI_ASBD_ID = "129477";
const META_AI_USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";
const BASE62_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

const MODEL_MAP = {
  "muse-spark": { mode: "mode_fast", isThinking: false },
  "muse-spark-thinking": { mode: "mode_thinking", isThinking: true },
  "muse-spark-contemplating": { mode: "think_hard", isThinking: true },
};

function extractMessageText(content) {
  if (typeof content === "string") {
    return content.trim();
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((part) => {
      if (!isRecord(part)) return "";
      if (part.type === "text" && typeof part.text === "string") {
        return part.text;
      }
      if (part.type === "input_text" && typeof part.text === "string") {
        return part.text;
      }
      return "";
    })
    .filter((part) => part.trim().length > 0)
    .join("\n")
    .trim();
}

function parseOpenAIMessages(messages) {
  const extracted = [];
  for (const message of messages) {
    let role = String(message.role || "user");
    if (role === "developer") role = "system";

    const content = extractMessageText(message.content);
    if (!content) continue;
    extracted.push({ role, content });
  }

  if (extracted.length === 0) {
    return {
      foldedPrompt: "",
      latestUserContent: "",
      lastAssistantIndex: -1,
      normalized: [],
    };
  }

  let lastUserIndex = -1;
  for (let i = extracted.length - 1; i >= 0; i--) {
    if (extracted[i].role === "user") {
      lastUserIndex = i;
      break;
    }
  }

  let lastAssistantIndex = -1;
  for (let i = extracted.length - 1; i >= 0; i--) {
    if (extracted[i].role === "assistant") {
      lastAssistantIndex = i;
      break;
    }
  }

  const foldedPrompt = extracted
    .map((message, index) => {
      if (index === lastUserIndex) {
        return message.content;
      }
      return `${message.role}: ${message.content}`;
    })
    .join("\n\n")
    .trim();

  const latestUserContent = lastUserIndex >= 0 ? extracted[lastUserIndex].content : "";

  return { foldedPrompt, latestUserContent, lastAssistantIndex, normalized: extracted };
}

function estimateTokens(text) {
  return Math.max(1, Math.ceil((text || "").length / 4));
}

function encodeBase62(value, padLength) {
  let remaining = value;
  let encoded = "";
  while (remaining > 0n) {
    encoded = BASE62_ALPHABET[Number(remaining % 62n)] + encoded;
    remaining /= 62n;
  }
  return encoded.padStart(padLength, "0");
}

function decodeBase62(value) {
  let decoded = 0n;
  for (const char of value) {
    const index = BASE62_ALPHABET.indexOf(char);
    if (index < 0) {
      throw new Error(`Invalid base62 character: ${char}`);
    }
    decoded = decoded * 62n + BigInt(index);
  }
  return decoded;
}

function randomBigInt(byteLength) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  let result = 0n;
  for (const byte of bytes) {
    result = (result << 8n) | BigInt(byte);
  }
  return result;
}

function generateMetaConversationId() {
  const timestamp = BigInt(Date.now()) & ((1n << 44n) - 1n);
  const random = randomBigInt(8) & ((1n << 64n) - 1n);
  const packed = (timestamp << 64n) | random;
  return `c.${encodeBase62(packed, 19)}`;
}

function generateMetaEventId(conversationId) {
  if (!conversationId.startsWith("c.")) {
    return null;
  }
  try {
    const packedConversation = decodeBase62(conversationId.slice(2));
    const conversationRandom = packedConversation & ((1n << 64n) - 1n);
    const timestamp = BigInt(Date.now()) & ((1n << 44n) - 1n);
    const eventRandom = randomBigInt(4) & ((1n << 32n) - 1n);
    const packedEvent = (timestamp << (64n + 32n)) | (conversationRandom << 32n) | eventRandom;
    return `e.${encodeBase62(packedEvent, 25)}`;
  } catch {
    return null;
  }
}

function generateNumericMessageId() {
  return (
    BigInt(Date.now()) * 1000n +
    BigInt(Math.floor(Math.random() * 1000)) +
    (randomBigInt(2) & 0xfffn)
  ).toString();
}

function normalizeMetaLocale() {
  const locale =
    typeof Intl !== "undefined"
      ? Intl.DateTimeFormat().resolvedOptions().locale || "en-US"
      : "en-US";
  return locale.replace(/-/g, "_");
}

function getMuseSparkModelInfo(model) {
  return MODEL_MAP[model] || MODEL_MAP["muse-spark"];
}

// Continuity cache
const MUSE_CONV_CACHE_MAX = 5000;
const MUSE_CONV_CACHE_TTL_MS = 30 * 60 * 1000;
const conversationCache = new Map();

function canonicalizeNormalizedHistory(messages) {
  return messages.map((m) => `${m.role}\x1e${m.content}`).join("\x1f");
}

function makeConversationCacheKey(connectionId, model, normalizedPrefix) {
  return createHash("sha256")
    .update(`${connectionId}\x1f${model}\x1f${canonicalizeNormalizedHistory(normalizedPrefix)}`)
    .digest("hex");
}

function lookupCachedConversation(key) {
  const entry = conversationCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    conversationCache.delete(key);
    return null;
  }
  return entry;
}

function rememberConversation(key, context) {
  if (conversationCache.size >= MUSE_CONV_CACHE_MAX && !conversationCache.has(key)) {
    const oldest = conversationCache.keys().next().value;
    if (oldest) conversationCache.delete(oldest);
  }
  conversationCache.set(key, {
    conversationId: context.conversationId,
    branchPath: context.branchPath,
    expiresAt: Date.now() + MUSE_CONV_CACHE_TTL_MS,
  });
}

function getContinuationCacheKey(parsedHistory, credentials, model) {
  if (
    parsedHistory.lastAssistantIndex < 0 ||
    !credentials?.connectionId ||
    parsedHistory.latestUserContent.length === 0
  ) {
    return null;
  }
  return makeConversationCacheKey(
    credentials.connectionId,
    model,
    parsedHistory.normalized.slice(0, parsedHistory.lastAssistantIndex + 1)
  );
}

function getConversationContext(cached) {
  if (!cached) {
    return {
      conversationId: generateMetaConversationId(),
      branchPath: META_AI_ROOT_BRANCH_PATH,
      isNewConversation: true,
    };
  }
  return {
    conversationId: cached.conversationId,
    branchPath: cached.branchPath,
    isNewConversation: false,
  };
}

function evictContinuationIfNeeded(cached, cacheKey) {
  if (cached && cacheKey) {
    conversationCache.delete(cacheKey);
  }
}

function normalizeSessionCookieHeader(apiKey, defaultCookieName) {
  if (!apiKey) return "";
  apiKey = apiKey.trim();
  if (apiKey.includes("=")) {
    return apiKey;
  }
  return `${defaultCookieName}=${apiKey}`;
}

function selectMetaAiCookieHeader(credentials) {
  const apiKey = credentials?.apiKey || "";
  return normalizeSessionCookieHeader(apiKey, META_AI_DEFAULT_COOKIE);
}

function buildMetaAiHeaders(cookieHeader) {
  return {
    Accept: "text/event-stream",
    "Accept-Language": "en-US,en;q=0.9",
    "Content-Type": "application/json",
    Cookie: cookieHeader,
    Origin: "https://www.meta.ai",
    Referer: "https://www.meta.ai/",
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
    "User-Agent": META_AI_USER_AGENT,
    "X-ASBD-ID": META_AI_ASBD_ID,
    "X-FB-Friendly-Name": META_AI_FRIENDLY_NAME,
    "X-FB-Request-Analytics-Tags": META_AI_REQUEST_ANALYTICS_TAGS,
  };
}

function buildMetaAiRequestBody(prompt, model, conversation) {
  const userUniqueMessageId = generateNumericMessageId();
  return {
    doc_id: META_AI_SEND_MESSAGE_DOC_ID,
    variables: {
      assistantMessageId: crypto.randomUUID(),
      clientLatitude: null,
      clientLongitude: null,
      clientTimezone:
        typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC",
      clippyIp: null,
      content: prompt,
      conversationId: conversation.conversationId,
      conversationStarterId: null,
      currentBranchPath: conversation.branchPath,
      developerOverridesForMessage: null,
      devicePixelRatio: 1,
      entryPoint: META_AI_ENTRY_POINT,
      imagineOperationRequest: null,
      isNewConversation: conversation.isNewConversation,
      mentions: null,
      mode: getMuseSparkModelInfo(model).mode,
      promptEditType: null,
      promptSessionId: crypto.randomUUID(),
      promptType: null,
      qplJoinId: null,
      requestedToolCall: null,
      turnId: crypto.randomUUID(),
      userAgent: META_AI_USER_AGENT,
      userEventId: generateMetaEventId(conversation.conversationId),
      userLocale: normalizeMetaLocale(),
      userMessageId: crypto.randomUUID(),
      userUniqueMessageId,
    },
  };
}

// ─── Response Parser logic (moved inline) ───

function isRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function parseMetaSseFrames(text) {
  const frames = [];
  const lines = text.split(/\r?\n/);
  let currentEvent = "message";
  let dataLines = [];

  const flush = () => {
    if (dataLines.length === 0 && currentEvent === "message") {
      return;
    }
    frames.push({
      event: currentEvent,
      data: dataLines.join("\n").trim(),
    });
    currentEvent = "message";
    dataLines = [];
  };

  for (const line of lines) {
    if (!line) {
      flush();
      continue;
    }
    if (line.startsWith(":")) {
      continue;
    }
    if (line.startsWith("event:")) {
      currentEvent = line.slice("event:".length).trim() || "message";
      continue;
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trimStart());
    }
  }

  flush();
  return frames;
}

function readMetaJsonPayloads(text) {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed);
      return isRecord(parsed) ? [parsed] : [];
    } catch {
      return [];
    }
  }

  return parseMetaSseFrames(text)
    .filter((frame) => frame.data)
    .map((frame) => {
      try {
        const parsed = JSON.parse(frame.data);
        return isRecord(parsed) ? parsed : null;
      } catch {
        return null;
      }
    })
    .filter((frame) => !!frame);
}

const META_AI_REASONING_KEYS = [
  "reasoning",
  "reasoningContent",
  "reasoning_content",
  "reasoningText",
  "thinking",
  "thinkingContent",
  "thinkingText",
  "thought",
  "thoughtText",
  "thoughts",
  "internalThoughts",
  "chainOfThought",
  "thinkingTrace",
  "thinking_trace",
];

const META_AI_NESTED_RENDERER_KEYS = [
  "contentRenderer",
  "textContent",
  "message",
  "mediaContent",
  "unified_response",
  "unifiedResponseContent",
  "sections",
  "view_model",
  "primitive",
  "primitives",
  "nested_responses",
];

function collectRendererTexts(value, seen, depth = 0) {
  if (depth > 8) {
    return [];
  }
  if (typeof value === "string") {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) {
      return [];
    }
    seen.add(normalized);
    return [normalized];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectRendererTexts(item, seen, depth + 1));
  }
  if (!isRecord(value)) {
    return [];
  }
  const parts = [];
  if (typeof value.text === "string") {
    parts.push(...collectRendererTexts(value.text, seen, depth + 1));
  }
  for (const key of META_AI_NESTED_RENDERER_KEYS) {
    if (key in value) {
      parts.push(...collectRendererTexts(value[key], seen, depth + 1));
    }
  }
  return parts;
}

function collectReasoningTexts(value, seen, depth = 0, force = false) {
  if (depth > 8) {
    return [];
  }
  if (typeof value === "string") {
    const normalized = value.trim();
    if (!force || !normalized || seen.has(normalized)) {
      return [];
    }
    seen.add(normalized);
    return [normalized];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectReasoningTexts(item, seen, depth + 1, force));
  }
  if (!isRecord(value)) {
    return [];
  }
  const typename = typeof value.__typename === "string" ? value.__typename : "";
  const localForce = force || /reasoning|thinking|thought/i.test(typename);
  const parts = [];
  if (typeof value.text === "string" && localForce) {
    parts.push(...collectReasoningTexts(value.text, seen, depth + 1, true));
  }
  for (const key of META_AI_REASONING_KEYS) {
    if (key in value) {
      parts.push(...collectReasoningTexts(value[key], seen, depth + 1, true));
    }
  }
  for (const key of META_AI_NESTED_RENDERER_KEYS) {
    if (key in value) {
      parts.push(...collectReasoningTexts(value[key], seen, depth + 1, localForce));
    }
  }
  return parts;
}

function extractAssistantContent(message) {
  if (typeof message.content === "string" && message.content.length > 0) {
    return message.content;
  }
  const contentRenderer = isRecord(message.contentRenderer) ? message.contentRenderer : null;
  if (!contentRenderer) {
    return "";
  }
  const parts = collectRendererTexts(contentRenderer, new Set());
  return parts.join("\n\n").trim();
}

function extractAssistantReasoning(message) {
  const parts = collectReasoningTexts(message, new Set());
  return parts.join("\n\n").trim();
}

function extractAssistantError(message) {
  const error = isRecord(message.error) ? message.error : null;
  const streamingState =
    typeof message.streamingState === "string" ? message.streamingState.toUpperCase() : null;
  return {
    code: typeof error?.code === "string" ? error.code : null,
    message:
      typeof error?.message === "string"
        ? error.message.trim()
        : streamingState === "ERROR" &&
            typeof message.content === "string" &&
            message.content.trim()
          ? message.content.trim()
          : null,
  };
}

function classifyMetaAiError(errorMessage, content) {
  const combined = `${errorMessage || ""}\n${content}`.trim();
  if (!combined) {
    return null;
  }
  if (/authentication required to send messages|login is required|sign in/i.test(combined)) {
    return {
      status: 401,
      message: "Meta AI auth failed — your meta.ai ecto_1_sess cookie may be missing or expired.",
    };
  }
  if (/limit exceeded|rate limit|too many requests/i.test(combined)) {
    return {
      status: 429,
      message: "Meta AI rate limited the session. Wait a moment and retry.",
    };
  }
  if (/blocked by our security system|security system/i.test(combined)) {
    return {
      status: 403,
      message:
        "Meta AI blocked the request through its web security checks. Refresh the session cookie and retry.",
    };
  }
  return null;
}

function parseMetaAiResponseText(text, isThinkingModel) {
  let lastContent = "";
  const deltas = [];
  let lastReasoning = "";
  const reasoningDeltas = [];
  let errorCode = null;
  let errorMessage = null;

  for (const payload of readMetaJsonPayloads(text)) {
    if (Array.isArray(payload.errors) && payload.errors.length > 0) {
      const firstError = payload.errors.find(
        (item) => isRecord(item) && typeof item.message === "string"
      );
      if (isRecord(firstError) && typeof firstError.message === "string") {
        errorMessage = firstError.message.trim();
      }
    }

    const data = isRecord(payload.data) ? payload.data : null;
    const sendMessageStream = isRecord(data?.sendMessageStream) ? data?.sendMessageStream : null;
    if (!sendMessageStream || sendMessageStream.__typename !== "AssistantMessage") {
      continue;
    }

    const content = extractAssistantContent(sendMessageStream);
    if (content && content !== lastContent) {
      deltas.push(content.startsWith(lastContent) ? content.slice(lastContent.length) : content);
      lastContent = content;
    }

    if (isThinkingModel) {
      const reasoning = extractAssistantReasoning(sendMessageStream);
      if (reasoning && reasoning !== content && reasoning !== lastReasoning) {
        reasoningDeltas.push(
          reasoning.startsWith(lastReasoning) ? reasoning.slice(lastReasoning.length) : reasoning
        );
        lastReasoning = reasoning;
      }
    }

    const upstreamError = extractAssistantError(sendMessageStream);
    if (upstreamError.message) {
      errorMessage = upstreamError.message;
      errorCode = upstreamError.code;
    }
  }

  const classifiedError = classifyMetaAiError(errorMessage, lastContent);
  if (classifiedError) {
    return {
      content: lastContent,
      deltas,
      reasoningContent: lastReasoning,
      reasoningDeltas,
      errorCode,
      errorMessage: classifiedError.message,
      status: classifiedError.status,
    };
  }

  if (errorMessage) {
    return {
      content: lastContent,
      deltas,
      reasoningContent: lastReasoning,
      reasoningDeltas,
      errorCode,
      errorMessage: `Meta AI returned an error: ${errorMessage}`,
      status: 502,
    };
  }

  if (!lastContent) {
    return {
      content: "",
      deltas: [],
      reasoningContent: lastReasoning,
      reasoningDeltas,
      errorCode: null,
      errorMessage: "Meta AI returned no assistant content",
      status: 502,
    };
  }

  return {
    content: lastContent,
    deltas: deltas.filter((delta) => delta.length > 0),
    reasoningContent: lastReasoning,
    reasoningDeltas: reasoningDeltas.filter((delta) => delta.length > 0),
    errorCode: null,
    errorMessage: null,
    status: 200,
  };
}

async function readTextResponse(body, signal) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  try {
    while (true) {
      if (signal?.aborted) {
        throw signal.reason ?? new DOMException("Aborted", "AbortError");
      }
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } finally {
    reader.releaseLock();
  }
}

function buildStreamingResponse(deltas, reasoningDeltas, model, id, created) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(
        encoder.encode(
          sseChunk({
            id,
            object: "chat.completion.chunk",
            created,
            model,
            system_fingerprint: null,
            choices: [
              {
                index: 0,
                delta: { role: "assistant" },
                finish_reason: null,
                logprobs: null,
              },
            ],
          })
        )
      );

      for (const delta of reasoningDeltas) {
        if (!delta) continue;
        controller.enqueue(
          encoder.encode(
            sseChunk({
              id,
              object: "chat.completion.chunk",
              created,
              model,
              system_fingerprint: null,
              choices: [
                {
                  index: 0,
                  delta: { reasoning_content: delta },
                  finish_reason: null,
                  logprobs: null,
                },
              ],
            })
          )
        );
      }

      for (const delta of deltas) {
        if (!delta) continue;
        controller.enqueue(
          encoder.encode(
            sseChunk({
              id,
              object: "chat.completion.chunk",
              created,
              model,
              system_fingerprint: null,
              choices: [
                {
                  index: 0,
                  delta: { content: delta },
                  finish_reason: null,
                  logprobs: null,
                },
              ],
            })
          )
        );
      }

      controller.enqueue(
        encoder.encode(
          sseChunk({
            id,
            object: "chat.completion.chunk",
            created,
            model,
            system_fingerprint: null,
            choices: [{ index: 0, delta: {}, finish_reason: "stop", logprobs: null }],
          })
        )
      );
      controller.enqueue(encoder.encode(SSE_DONE));
      controller.close();
    },
  });
}

function buildNonStreamingResponse(content, reasoningContent, model, id, created) {
  const completionTokens = estimateTokens(content);
  const message = { role: "assistant", content };
  if (reasoningContent) {
    message.reasoning_content = reasoningContent;
  }
  return new Response(
    JSON.stringify({
      id,
      object: "chat.completion",
      created,
      model,
      system_fingerprint: null,
      choices: [
        {
          index: 0,
          message,
          finish_reason: "stop",
          logprobs: null,
        },
      ],
      usage: {
        prompt_tokens: completionTokens,
        completion_tokens: completionTokens,
        total_tokens: completionTokens * 2,
      },
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }
  );
}

function buildErrorResponse(status, message, code = null) {
  return new Response(
    JSON.stringify({
      error: {
        message,
        type: "upstream_error",
        ...(code ? { code } : {}),
      },
    }),
    { status, headers: { "Content-Type": "application/json" } }
  );
}

// ─── Main Executor Class ───

export class MuseSparkWebExecutor extends BaseExecutor {
  constructor() {
    super("muse-spark-web", PROVIDERS["muse-spark-web"]);
  }

  async execute({ model, body, stream, credentials, signal, log }) {
    const rawMessages = body?.messages;
    if (!rawMessages || !Array.isArray(rawMessages) || rawMessages.length === 0) {
      const errResp = buildErrorResponse(400, "Missing or empty messages array", "invalid_request");
      return { response: errResp, url: META_AI_GRAPHQL_API, headers: {}, transformedBody: body };
    }

    const parsedHistory = parseOpenAIMessages(rawMessages);
    if (!parsedHistory.foldedPrompt) {
      const errResp = buildErrorResponse(400, "Empty query after processing messages", "invalid_request");
      return { response: errResp, url: META_AI_GRAPHQL_API, headers: {}, transformedBody: body };
    }

    const continuationCacheKey = getContinuationCacheKey(parsedHistory, credentials, model);
    const cached = continuationCacheKey ? lookupCachedConversation(continuationCacheKey) : null;
    const conversationContext = getConversationContext(cached);

    const prompt = cached ? parsedHistory.latestUserContent : parsedHistory.foldedPrompt;

    const modelInfo = getMuseSparkModelInfo(model);
    const transformedBody = buildMetaAiRequestBody(prompt, model, conversationContext);
    const cookieHeader = selectMetaAiCookieHeader(credentials);
    const headers = buildMetaAiHeaders(cookieHeader);

    log?.info?.("MUSE-SPARK-WEB", `Sending request to Meta AI (model=${model}, mode=${modelInfo.mode}), prompt length=${prompt.length}`);

    let upstreamResponse;
    try {
      upstreamResponse = await fetch(META_AI_GRAPHQL_API, {
        method: "POST",
        headers,
        body: JSON.stringify(transformedBody),
        signal,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log?.error?.("MUSE-SPARK-WEB", `Fetch failed: ${message}`);
      const errResp = buildErrorResponse(502, `Meta AI connection failed: ${message}`, "meta_ai_fetch_failed");
      return { response: errResp, url: META_AI_GRAPHQL_API, headers, transformedBody };
    }

    if (!upstreamResponse.ok) {
      evictContinuationIfNeeded(cached, continuationCacheKey);
      let message = `Meta AI returned HTTP ${upstreamResponse.status}`;
      if (upstreamResponse.status === 401 || upstreamResponse.status === 403) {
        message = "Meta AI auth failed — your meta.ai ecto_1_sess cookie may be missing or expired.";
      } else if (upstreamResponse.status === 429) {
        message = "Meta AI rate limited the session. Wait a moment and retry.";
      }
      const errResp = buildErrorResponse(upstreamResponse.status, message, `HTTP_${upstreamResponse.status}`);
      return { response: errResp, url: META_AI_GRAPHQL_API, headers, transformedBody };
    }

    if (!upstreamResponse.body) {
      const errResp = buildErrorResponse(502, "Meta AI returned an empty response body", "meta_ai_empty_body");
      return { response: errResp, url: META_AI_GRAPHQL_API, headers, transformedBody };
    }

    let responseText;
    try {
      responseText = await readTextResponse(upstreamResponse.body, signal);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log?.error?.("MUSE-SPARK-WEB", `Error reading stream: ${message}`);
      const errResp = buildErrorResponse(502, `Error reading Meta AI stream: ${message}`, "meta_ai_stream_read_failed");
      return { response: errResp, url: META_AI_GRAPHQL_API, headers, transformedBody };
    }

    const parsed = parseMetaAiResponseText(responseText, modelInfo.isThinking);
    if (parsed.status !== 200 || parsed.errorMessage) {
      evictContinuationIfNeeded(cached, continuationCacheKey);
      const errResp = buildErrorResponse(
        parsed.status,
        parsed.errorMessage || "Meta AI returned an unknown error",
        parsed.errorCode || "meta_ai_unknown_error"
      );
      return { response: errResp, url: META_AI_GRAPHQL_API, headers, transformedBody };
    }

    // Cache the turn for continuity
    if (parsed.content && credentials?.connectionId) {
      const writePrefix = [
        ...parsedHistory.normalized,
        { role: "assistant", content: parsed.content },
      ];
      rememberConversation(makeConversationCacheKey(credentials.connectionId, model, writePrefix), {
        conversationId: conversationContext.conversationId,
        branchPath: conversationContext.branchPath,
      });
    }

    const id = `chatcmpl-meta-${crypto.randomUUID().slice(0, 12)}`;
    const created = Math.floor(Date.now() / 1000);
    const deltas = parsed.deltas.length > 0 ? parsed.deltas : [parsed.content];
    const reasoningDeltas = parsed.reasoningDeltas;

    const response = stream
      ? new Response(buildStreamingResponse(deltas, reasoningDeltas, model, id, created), {
          status: 200,
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
          },
        })
      : buildNonStreamingResponse(parsed.content, parsed.reasoningContent, model, id, created);

    return { response, url: META_AI_GRAPHQL_API, headers, transformedBody };
  }
}
