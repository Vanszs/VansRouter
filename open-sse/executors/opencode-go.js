import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { getModelTargetFormat } from "../config/providerModels.js";
import { injectReasoningContent } from "../utils/reasoningContentInjector.js";
import { applyAuth, BEARER_AUTH, XAPIKEY_AUTH } from "../providers/shared.js";
import crypto from "node:crypto";
import { resolveSessionId } from "../utils/sessionManager.js";
import { baseModelId, normalizeOpencodeReasoning } from "../utils/opencodeIdentity.js";
import { FORMATS } from "../translator/formats.js";

// Legacy model routing remains for callers that do not provide runtimeTransport.
const MESSAGES_FORMAT_MODELS = new Set([
  "minimax-m3",
  "minimax-m2.7",
  "minimax-m2.5",
  "qwen3.8-max",
  "qwen3.8-flash",
  "qwen3.7-max",
  "qwen3.7-plus",
  "qwen3.6-plus",
]);

const BASE = "https://opencode.ai/inference/go";
const OPENAI_BASE = `${BASE}/openai/v1`;
const ANTHROPIC_BASE = `${BASE}/anthropic/v1`;
const SESSION_HEADER = "x-opencode-session";
const SESSION_FIELD = "runtimeOpencodeGoSession";

function randomId(prefix) {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
}

function generateSessionId() {
  return `ses_${crypto.randomUUID().replace(/-/g, "")}`;
}

function generateRequestId() {
  return `msg_${crypto.randomUUID().replace(/-/g, "")}`;
}

// Conversation-stable session id for the OpenCode relay: client-provided
// header wins, then a per-connection/assistant-text derivation (same
// resolution the sibling opencode zen executor uses; scoped apart so cache
// keys don't collide across the two relay flavors).
function resolveOpencodeSession(body, credentials) {
  const headers = credentials?.rawHeaders || {};
  return resolveSessionId({
    headers,
    body,
    connectionId: credentials?.connectionId,
    scope: "opencode-go",
    generate: generateSessionId,
  });
}

// Responses-only per the provider registry (grok-4.6, gpt-5.6-luna, muse-spark, …) —
// never hardcode model ids here, config decides. getModelTargetFormat also strips the
// thinking suffix and applies the family fallback for passthrough ids.
function isResponsesModel(model) {
  return getModelTargetFormat("opencode-go", model) === FORMATS.OPENAI_RESPONSES;
}


export class OpenCodeGoExecutor extends BaseExecutor {
  constructor() {
    super("opencode-go", PROVIDERS["opencode-go"]);
  }

  async execute(args) {
    const credentials = args.credentials || {};
    const session = resolveSessionId({
      headers: credentials.rawHeaders,
      body: args.body,
      connectionId: credentials.connectionId,
      scope: "opencode-go",
    });
    return super.execute({
      ...args,
      credentials: { ...credentials, [SESSION_FIELD]: session },
    });
  }

  buildUrl(model, stream, urlIndex = 0, credentials = null) {
    this._lastModel = model;
    // Responses-only models keep /responses even when a stale runtimeTransport leaks in.
    if (isResponsesModel(model)) return `${OPENAI_BASE}/responses`;
    const runtimeTransport = credentials?.runtimeTransport;
    if (runtimeTransport?.baseUrl) {
      return runtimeTransport.urlSuffix
        ? `${runtimeTransport.baseUrl}${runtimeTransport.urlSuffix}`
        : runtimeTransport.baseUrl;
    }
    const cleanModel = baseModelId(model);
    return MESSAGES_FORMAT_MODELS.has(cleanModel)
      ? `${ANTHROPIC_BASE}/messages`
      : isResponsesModel(cleanModel)
        ? `${OPENAI_BASE}/responses`
        : `${OPENAI_BASE}/chat/completions`;
  }

  buildHeaders(credentials, stream = true, url, model) {
    const runtimeTransport = credentials?.runtimeTransport;
    const effectiveModel = model || this._lastModel;
    const raw = Object.fromEntries(
      Object.entries(credentials?.rawHeaders || {}).map(([k, v]) => [k.toLowerCase(), v]),
    );
    const headers = {
      "Content-Type": "application/json",
      ...(runtimeTransport?.headers || {}),
    };
    const session = raw[SESSION_HEADER] || credentials?.[SESSION_FIELD]
      || (credentials?.connectionId
        ? resolveSessionId({
          headers: credentials.rawHeaders,
          connectionId: credentials.connectionId,
          scope: "opencode-go",
        })
        : generateSessionId());
    if (credentials && !credentials[SESSION_FIELD]) credentials[SESSION_FIELD] = session;
    headers[SESSION_HEADER] = session;
    headers["x-opencode-client"] ||= raw["x-opencode-client"] || "desktop";
    headers["x-opencode-request"] ||= raw["x-opencode-request"] || randomId("msg");
    headers["x-opencode-project"] ||= raw["x-opencode-project"] || "global";
    const isMessages = MESSAGES_FORMAT_MODELS.has(baseModelId(effectiveModel));
    applyAuth(
      headers,
      runtimeTransport?.auth || (isMessages ? { ...XAPIKEY_AUTH, anthropicVersion: true } : BEARER_AUTH),
      credentials || {},
    );

    if (stream) headers["Accept"] = "text/event-stream";
    return headers;
  }

  transformRequest(model, body, stream, credentials) {
    const isResponses = credentials?.runtimeTransport?.format === "openai-responses"
      || isResponsesModel(model);
    if (isResponses) {
      // Responses API names the output cap max_output_tokens and takes thinking
      // as reasoning:{effort,summary} — normalize the Chat fields at this boundary.
      if (body.max_output_tokens === undefined) {
        if (body.max_completion_tokens !== undefined)
          body.max_output_tokens = body.max_completion_tokens;
        else if (body.max_tokens !== undefined)
          body.max_output_tokens = body.max_tokens;
      }
      delete body.max_tokens;
      delete body.max_completion_tokens;
      normalizeOpencodeReasoning(model, body);
    }
    return injectReasoningContent({ provider: this.provider, model, body });
  }
}
