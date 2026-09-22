import crypto from "crypto";
import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { OAUTH_ENDPOINTS, ANTIGRAVITY_HEADERS, ANTIGRAVITY_PROMPT_REWRITES } from "../config/appConstants.js";
import { HTTP_STATUS } from "../config/runtimeConfig.js";
import { resolveSessionId, toNumericSessionId } from "../utils/sessionManager.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { scrubProxyAndFingerprintHeaders } from "../services/antigravityHeaderScrub.js";
import { cleanJSONSchemaForAntigravity, normalizeGeminiContents } from "../translator/formats/gemini.js";
import { DEFAULT_THINKING_AG_SIGNATURE } from "../config/defaultThinkingSignature.js";
import { getGeminiThoughtSignatureSync } from "../services/thoughtSignatureStore.js";
import { resolveAntigravityUpstreamModel } from "../config/providerModels.js";

// Sanitize function name: Gemini requires [a-zA-Z_][a-zA-Z0-9_.:\-]{0,63}
function sanitizeFunctionName(name) {
  if (!name) return "_unknown";
  let s = name.replace(/[^a-zA-Z0-9_.:\-]/g, "_");
  if (!/^[a-zA-Z_]/.test(s)) s = "_" + s;
  return s.substring(0, 64);
}

const MAX_RETRY_AFTER_MS = 10000;
const ANTIGRAVITY_TRANSIENT_RETRY_MAX_MS = 15000;
const MAX_ANTIGRAVITY_OUTPUT_TOKENS = 16384;
const COMPETITIVE_CLAUDE_AGENT_PROMPT = "You are a Claude agent, built on Anthropic's Claude Agent SDK.";
const AG_PROMPT_TRIGGERS = [COMPETITIVE_CLAUDE_AGENT_PROMPT, "Hermes Agent", "Nous Research"];
const ANTIGRAVITY_IDE_REQUEST_ID_RE = /^agent\/[^/]+\/\d+\/[^/]+\/\d+$/;

const ANTIGRAVITY_TRANSIENT_ERROR_PATTERNS = [
  /high\s+traffic/i,
  /agent\s+(execution\s+)?terminated\s+due\s+to\s+error/i,
  /capacity/i,
  /temporarily\s+unavailable/i,
  /timeout/i,
  /stream\s+(ended|closed|terminated|interrupted)/i,
  /empty\s+response/i,
];

const ANTIGRAVITY_TRANSIENT_STATUSES = new Set([
  HTTP_STATUS.SERVER_ERROR,
  HTTP_STATUS.BAD_GATEWAY,
  HTTP_STATUS.SERVICE_UNAVAILABLE,
  HTTP_STATUS.GATEWAY_TIMEOUT,
]);

// Fields Google generateContent rejects (Claude/OpenAI/Qwen thinking fields set at body root by thinkingUnified.js)
const ANTIGRAVITY_REQUEST_BLACKLIST = [
  "output_config",
  "thinking",
  "reasoning_effort",
  "reasoning",
  "enable_thinking",
  "thinking_budget",
];

// thinkingConfig handling is delegated to the shared cloudCodeThinking module
// so behavior stays in sync with OmniRoute (selective strip: only for Claude/gpt-oss/tab_).
import { shouldStripCloudCodeThinking, stripCloudCodeThinkingConfig } from "../services/cloudCodeThinking.js";

// Strip blacklisted fields from an object (used for both body.request and top-level body).
// thinkingConfig is NOT blacklisted here — model-aware strip is handled by cloudCodeThinking.
const stripBlacklisted = (obj) => {
  if (!obj) return;
  for (const key of ANTIGRAVITY_REQUEST_BLACKLIST) delete obj[key];
};

// Image generation model name patterns
const IMAGE_MODEL_PATTERNS = [
  /image/i,
  /imagen/i,
  /image-generation/i,
];

// Detect if a model is an image generation model
function isImageModel(model) {
  if (!model) return false;
  return IMAGE_MODEL_PATTERNS.some(p => p.test(model));
}

// Parse aspect ratio / resolution from model name suffixes
// e.g. "gemini-3.1-flash-image-16x9" -> { aspectRatio: "16:9" }
// e.g. "gemini-3.1-flash-image-1024x768" -> { aspectRatio: "4:3" }
function parseImageConfig(model) {
  const config = { aspectRatio: "1:1" };
  const resMatch = model.match(/(\d+)x(\d+)$/);
  if (resMatch) {
    const w = parseInt(resMatch[1]);
    const h = parseInt(resMatch[2]);
    if (w <= 16 && h <= 16) {
      config.aspectRatio = `${w}:${h}`;
    } else {
      // Resolution like 1024x768 — derive aspect ratio
      const gcd = (a, b) => b ? gcd(b, a % b) : a;
      const d = gcd(w, h);
      config.aspectRatio = `${w/d}:${h/d}`;
    }
  }
  return config;
}

function uuidFromSeed(seed) {
  const bytes = crypto.createHash("sha256").update(String(seed || "antigravity")).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function buildIdeRequestId({ body, request, credentials, model, requestType }) {
  if (ANTIGRAVITY_IDE_REQUEST_ID_RE.test(body?.requestId || "")) {
    return body.requestId;
  }

  const sessionId = request?.sessionId || body?.request?.sessionId || credentials?._clientSessionId || credentials?.connectionId || credentials?.email || "anonymous";
  const conversationId = uuidFromSeed(`antigravity:conversation:${sessionId}`);
  const trajectoryId = uuidFromSeed(`antigravity:trajectory:${sessionId}:${model}:${requestType}`);
  const contentCount = Array.isArray(request?.contents) ? request.contents.length : 1;
  const step = Math.max(1, contentCount * 2 - 1);
  return `agent/${conversationId}/${Date.now()}/${trajectoryId}/${step}`;
}

export class AntigravityExecutor extends BaseExecutor {
  constructor() {
    super("antigravity", PROVIDERS.antigravity);
  }

  buildUrl(model, stream, urlIndex = 0) {
    const baseUrls = this.getBaseUrls();
    const baseUrl = baseUrls[urlIndex] || baseUrls[0];
    // Image generation MUST use non-streaming generateContent
    const forceNonStream = isImageModel(model);
    const action = (stream && !forceNonStream) ? "streamGenerateContent?alt=sse" : "generateContent";
    return `${baseUrl}/v1internal:${action}`;
  }

  // Daily host has newer models (Gemini 3.6). Production returns 404 for those IDs.
  // Rotate to the next baseUrl on 404 as well as rate-limit.
  shouldRetry(status, urlIndex) {
    const retriable = status === HTTP_STATUS.RATE_LIMITED || status === HTTP_STATUS.NOT_FOUND;
    return retriable && urlIndex + 1 < this.getFallbackCount();
  }

  // sessionId comes from transformRequest output; base.execute runs transformRequest before
  // buildHeaders, so we read it from instance state cached there (fallback: explicit arg).
  buildHeaders(credentials, stream = true, sessionId = null) {
    return scrubProxyAndFingerprintHeaders({
      "Content-Type": "application/json",
      "Authorization": `Bearer ${credentials.accessToken}`,
      "User-Agent": this.config.headers?.["User-Agent"] || ANTIGRAVITY_HEADERS["User-Agent"],
    });
  }

  transformRequest(model, body, stream, credentials) {
    const projectId = credentials?.projectId || this.generateProjectId();
    const upstreamModel = resolveAntigravityUpstreamModel(model);

    // OpenAI clients may include stream_options even for non-streaming calls.
    // Google generateContent rejects that combination before processing the request.
    if (stream !== true) delete body.stream_options;

    // ─── Image generation: completely different request structure ───
    if (isImageModel(model)) {
      const imageConfig = parseImageConfig(model);
      // Strip model name suffixes for the actual API model name
      const cleanModel = model.replace(/-(\d+)x(\d+)$/, "");

      // Build simplified contents — text-only, merge all user messages
      const contents = [];
      const srcContents = body.request?.contents || body.contents || [];
      for (const c of srcContents) {
        const textParts = (c.parts || []).filter(p => p.text !== undefined).map(p => ({ text: p.text }));
        if (textParts.length > 0) {
          contents.push({ role: c.role || "user", parts: textParts });
        }
      }

      const sessionId = resolveSessionId({
        headers: credentials?.rawHeaders,
        body,
        connectionId: credentials?.email || credentials?.connectionId,
        scope: "antigravity",
      });

      this._lastSessionId = sessionId;
      const request = {
        contents,
        generationConfig: {
          temperature: 1.0,
          topP: 0.95,
          topK: 40,
          maxOutputTokens: 8192,
          imageConfig,
        },
        sessionId,
        // No tools, no systemInstruction, no safetySettings for image gen
      };

      return {
        project: projectId,
        model: cleanModel,
        userAgent: "antigravity",
        requestType: "image_gen",
        requestId: buildIdeRequestId({ body, request, credentials, model: cleanModel, requestType: "image_gen" }),
        request,
      };
    }

    const rawSessionId = body.request?.sessionId || resolveSessionId({ headers: credentials?.rawHeaders, body, connectionId: credentials?.email || credentials?.connectionId, scope: "antigravity" });
    const sessionId = toNumericSessionId(rawSessionId) || rawSessionId;

    // ─── Standard (non-image) request ───
    // Fix contents for Claude models via Antigravity
    const rawContents = (body.request?.contents || []).map(c => {
      let role = c.role;
      // functionResponse must be role "user" for Claude models
      if (c.parts?.some(p => p.functionResponse)) {
        role = "user";
      }
      // Strip thought-only parts, keep thoughtSignature on functionCall parts (Gemini 3+ requires it)
      const parts = c.parts?.filter(p => {
        if (p.thought && !p.functionCall) return false;
        if (p.thoughtSignature && !p.functionCall && !p.text) return false;
        return true;
      });
      // Gemini 3+ rejects functionCall parts without thoughtSignature. Clients (Claude Code, IDE)
      // don't persist thoughtSignature in their history, so backfill from cache or default signature.
      // In parallel function calls, only the first call needs a signature; siblings stay unsigned.
      let firstFunctionCallSeen = false;
      const modifiedParts = parts?.map(p => {
        if (!p.functionCall) return p;
        const callId = p.functionCall.id;
        const cachedSig = callId ? getGeminiThoughtSignatureSync(callId, sessionId, body.model || model) : null;
        const callSig = p.thoughtSignature || cachedSig || (!firstFunctionCallSeen ? DEFAULT_THINKING_AG_SIGNATURE : undefined);
        firstFunctionCallSeen = true;
        if (callSig) {
          return { ...p, thoughtSignature: callSig };
        }
        return p;
      });

      const partsChanged = parts?.length !== c.parts?.length || modifiedParts?.some((p, idx) => p !== parts[idx]);
      if (role !== c.role || partsChanged) {
        return { ...c, role, parts: modifiedParts || parts };
      }
      return c;
    }).filter(c => Array.isArray(c.parts) && c.parts.length > 0); // ponytail: v1internal rejects empty parts[] (issue #6)
    const contents = normalizeGeminiContents(rawContents);

    // Sanitize tool schemas and function names before sending to Antigravity.
    let tools = body.request?.tools;

    if (tools && tools.length > 0) {
      // Merge all groups into a single functionDeclarations group (Gemini expects 1 group)
      const seenToolNames = new Set();
      const allDeclarations = [];
      for (const group of tools) {
        for (const fn of group.functionDeclarations || []) {
          const name = sanitizeFunctionName(fn.name);
          if (seenToolNames.has(name)) continue;
          seenToolNames.add(name);
          allDeclarations.push({
            ...fn,
            name,
            parameters: fn.parameters
              ? cleanJSONSchemaForAntigravity(structuredClone(fn.parameters))
              : { type: "object", properties: { reason: { type: "string", description: "Brief explanation" } }, required: ["reason"] }
          });
          // Strip parametersJsonSchema — v1internal uses parameters only;
          // both fields cause 400 "must not be set when parameters is set".
          delete allDeclarations[allDeclarations.length - 1].parametersJsonSchema;
        }
      }
      tools = allDeclarations.length > 0 ? [{ functionDeclarations: allDeclarations }] : [];
    }

    const sourceRequest = body.request?.request || body.request || body;

    // Whitelist: only forward fields the Antigravity API protobuf accepts.
    // Spread-all leaked unexpected fields (max_tokens, messages, stream, etc.)
    // from Antigravity IDE passthrough → 400 "Unknown name" from Google API.
    const AG_REQUEST_FIELDS = [
      "contents", "systemInstruction", "generationConfig",
      "sessionId", "safetySettings",
    ];
    const requestWithoutTools = {};
    for (const key of AG_REQUEST_FIELDS) {
      if (sourceRequest?.[key] !== undefined) {
        requestWithoutTools[key] = sourceRequest[key];
      }
    }
    stripBlacklisted(requestWithoutTools);

    // Rewrite competing-client branding in system prompts (e.g. Zed's Claude prompt,
    // OpenCode naming) so Antigravity doesn't flag the request with a 429 Quota Exhausted.
    if (Array.isArray(requestWithoutTools.systemInstruction?.parts)) {
      requestWithoutTools.systemInstruction = {
        ...requestWithoutTools.systemInstruction,
        parts: requestWithoutTools.systemInstruction.parts.map((part) => {
          if (typeof part?.text !== "string") return part;
          let text = part.text;
          for (const { from, to } of ANTIGRAVITY_PROMPT_REWRITES) {
            text = text.replaceAll(from, to);
          }
          text = AG_PROMPT_TRIGGERS.reduce((t, trigger) => t.split(trigger).join(""), text);
          return { ...part, text };
        }),
      };
    }
    // Model-aware thinkingConfig strip — keep for Gemini, drop for Claude/gpt-oss/tab_.
    if (shouldStripCloudCodeThinking("antigravity", model)) {
      stripCloudCodeThinkingConfig(requestWithoutTools);
    }
    const generationConfig = { ...(requestWithoutTools.generationConfig || {}) };
    if (generationConfig.maxOutputTokens > MAX_ANTIGRAVITY_OUTPUT_TOKENS) {
      generationConfig.maxOutputTokens = MAX_ANTIGRAVITY_OUTPUT_TOKENS;
    }

    const transformedRequest = {
      ...requestWithoutTools,
      generationConfig,
      ...(contents && { contents }),
      ...(tools && { tools }),
      sessionId,
      safetySettings: undefined,
      ...(tools?.length > 0 && { toolConfig: { functionCallingConfig: { mode: "VALIDATED" } } })
    };

    // Strip blacklisted thinking fields from top-level body (set by thinkingUnified.js at root, not body.request)
    stripBlacklisted(body);
    if (shouldStripCloudCodeThinking("antigravity", model)) {
      // stripCloudCodeThinkingConfig is safe on non-record bodies (no-op)
      const stripped = stripCloudCodeThinkingConfig(body);
      // mutate body in-place keys (the helper returns a new object)
      for (const k of Object.keys(body)) delete body[k];
      Object.assign(body, stripped);
    }

    // Strip OpenAI-format fields that leak from passthrough or translation residue.
    // The API only accepts: project, model, userAgent, requestId, requestType, request.
    const OPENAI_LEAK_FIELDS = [
      "messages", "max_tokens", "max_completion_tokens", "temperature", "top_p",
      "top_k", "stream", "stream_options", "tools", "tool_choice", "tool_calls",
      "n", "stop", "presence_penalty", "frequency_penalty", "seed", "user",
      "response_format", "logprobs", "top_logprobs", "logit_bias",
      "contents", "generationConfig", "safetySettings", "systemInstruction",
      "thinking", "reasoning_effort", "reasoning", "thinkingConfig",
      "output_config", "enable_thinking", "thinking_budget",
    ];
    for (const key of OPENAI_LEAK_FIELDS) {
      if (key !== "request") delete body[key];
    }

    this._lastSessionId = transformedRequest.sessionId; // cached for buildHeaders (base.execute order)

    // The agent (chat) path must NOT carry `requestType`: Google then buckets the
    // request and returns a detail-free 429 RESOURCE_EXHAUSTED even with quota left.
    // Also drops the field when it leaks in via the ...body spread below.
    delete body.requestType;

    return {
      ...body,
      project: projectId,
      model: upstreamModel,
      userAgent: "antigravity",
      requestId: buildIdeRequestId({ body, request: transformedRequest, credentials, model, requestType: "agent" }),
      request: transformedRequest
    };
  }

  async refreshCredentials(credentials, log, proxyOptions = null) {
    if (!credentials.refreshToken) return null;

    try {
      const response = await proxyAwareFetch(OAUTH_ENDPOINTS.google.token, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: credentials.refreshToken,
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret
        })
      }, proxyOptions);

      if (!response.ok) return null;

      const tokens = await response.json();
      log?.info?.("TOKEN", "Antigravity refreshed");

      return {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || credentials.refreshToken,
        expiresIn: tokens.expires_in,
        projectId: credentials.projectId
      };
    } catch (error) {
      log?.error?.("TOKEN", `Antigravity refresh error: ${error.message}`);
      return null;
    }
  }

  generateProjectId() {
    const adj = ["useful", "bright", "swift", "calm", "bold"][Math.floor(Math.random() * 5)];
    const noun = ["fuze", "wave", "spark", "flow", "core"][Math.floor(Math.random() * 5)];
    return `${adj}-${noun}-${crypto.randomUUID().slice(0, 5)}`;
  }

  generateSessionId() {
    return crypto.randomUUID() + Date.now().toString();
  }

  parseRetryHeaders(headers) {
    if (!headers?.get) return null;

    const retryAfter = headers.get('retry-after');
    if (retryAfter) {
      const seconds = parseInt(retryAfter, 10);
      if (!isNaN(seconds) && seconds > 0) return seconds * 1000;

      const date = new Date(retryAfter);
      if (!isNaN(date.getTime())) {
        const diff = date.getTime() - Date.now();
        return diff > 0 ? diff : null;
      }
    }

    const resetAfter = headers.get('x-ratelimit-reset-after');
    if (resetAfter) {
      const seconds = parseInt(resetAfter, 10);
      if (!isNaN(seconds) && seconds > 0) return seconds * 1000;
    }

    const resetTimestamp = headers.get('x-ratelimit-reset');
    if (resetTimestamp) {
      const ts = parseInt(resetTimestamp, 10) * 1000;
      const diff = ts - Date.now();
      return diff > 0 ? diff : null;
    }

    return null;
  }

  // Parse retry time from Antigravity error message body
  // Format: "Your quota will reset after 2h7m23s" or "1h30m" or "45m" or "30s"
  parseRetryFromErrorMessage(errorMessage) {
    if (!errorMessage || typeof errorMessage !== "string") return null;

    const match = errorMessage.match(/reset after (\d+h)?(\d+m)?(\d+s)?/i);
    if (!match) return null;

    let totalMs = 0;
    if (match[1]) totalMs += parseInt(match[1]) * 3600 * 1000; // hours
    if (match[2]) totalMs += parseInt(match[2]) * 60 * 1000; // minutes
    if (match[3]) totalMs += parseInt(match[3]) * 1000; // seconds

    return totalMs > 0 ? totalMs : null;
  }

  extractErrorMessage(errorJson, bodyText = "") {
    return [
      errorJson?.error?.message,
      errorJson?.message,
      errorJson?.error,
      bodyText,
    ].filter(Boolean).map(v => typeof v === "string" ? v : JSON.stringify(v)).join("\n");
  }

  isTransientAntigravityError(status, message) {
    if (status === HTTP_STATUS.RATE_LIMITED) return true;
    if (ANTIGRAVITY_TRANSIENT_STATUSES.has(status)) return true;
    return ANTIGRAVITY_TRANSIENT_ERROR_PATTERNS.some(pattern => pattern.test(message || ""));
  }

  // Hook called by BaseExecutor.tryRetry: derive delay from Retry-After (header → body),
  // cap at MAX_RETRY_AFTER_MS, else retry transient Antigravity failures with backoff.
  // Return false to veto (fallback URL / final error).
  async computeRetryDelay(response, attempt) {
    let bodyText = "";
    let errorJson = null;
    let retryMs = this.parseRetryHeaders(response.headers);

    try {
      bodyText = await response.clone().text();
      errorJson = bodyText ? JSON.parse(bodyText) : null;
    } catch {
      // ignore parse errors → fall through to status/message based retry
    }

    const errorMessage = this.extractErrorMessage(errorJson, bodyText);

    if (!retryMs) {
      retryMs = this.parseRetryFromErrorMessage(errorMessage);
    }
    if (retryMs) return retryMs <= MAX_RETRY_AFTER_MS ? retryMs : false;

    if (!this.isTransientAntigravityError(response.status, errorMessage)) return false;

    const cap = response.status === HTTP_STATUS.RATE_LIMITED
      ? MAX_RETRY_AFTER_MS
      : ANTIGRAVITY_TRANSIENT_RETRY_MAX_MS;
    return Math.min(1000 * (2 ** attempt), cap); // exponential backoff
  }

}

export default AntigravityExecutor;
