import { BaseExecutor } from "./base.js";
import { getThinkingLevels } from "../providers/thinkingLevels.js";
import { PROVIDERS } from "../config/providers.js";
import { getModelTargetFormat } from "../config/providerModels.js";
import { injectReasoningContent } from "../utils/reasoningContentInjector.js";
import { ANTHROPIC_API_VERSION } from "../providers/shared.js";
import crypto from "node:crypto";
import { resolveSessionId } from "../utils/sessionManager.js";

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

const BASE = "https://opencode.ai/zen/go/v1";
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

function baseModelId(model) {
  return String(model || "")
    .replace(/\([^()]+\)\s*$/, "")
    .trim();
}

// Responses-only per the provider registry (grok-4.6, gpt-5.6-luna, muse-spark, …) —
// never hardcode model ids here, config decides. getModelTargetFormat also strips the
// thinking suffix, so "gpt-5.6-luna(high)" resolves to its base entry.
function isResponsesModel(model) {
  return getModelTargetFormat("opencode-go", model) === "openai-responses";
}

function normalizeOpencodeReasoning(model, body) {
  const current = body.reasoning;
  const currentReasoning =
    current && typeof current === "object" && !Array.isArray(current)
      ? current
      : null;
  const requestedEffort =
    typeof body.reasoning_effort === "string"
      ? body.reasoning_effort
      : currentReasoning?.effort;
  if (typeof requestedEffort !== "string") return;

  const cleanModel = baseModelId(model || body.model);
  const supportedLevels = getThinkingLevels("opencode", cleanModel);
  let effort = requestedEffort.toLowerCase().trim();
  if (
    (effort === "max" || effort === "ultra") &&
    supportedLevels?.length &&
    !supportedLevels.includes(effort)
  ) {
    if (effort === "ultra" && supportedLevels.includes("max")) effort = "max";
    else if (supportedLevels.includes("xhigh")) effort = "xhigh";
  }

  body.reasoning = { ...currentReasoning, effort };
  if (!body.reasoning.summary) body.reasoning.summary = "auto";
  delete body.reasoning_effort;
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
    if (isResponsesModel(model)) return `${BASE}/responses`;
    const runtimeTransport = credentials?.runtimeTransport;
    if (runtimeTransport?.baseUrl) {
      return runtimeTransport.urlSuffix
        ? `${runtimeTransport.baseUrl}${runtimeTransport.urlSuffix}`
        : runtimeTransport.baseUrl;
    }
    const cleanModel = baseModelId(model);
    return MESSAGES_FORMAT_MODELS.has(cleanModel)
      ? `${BASE}/messages`
      : isResponsesModel(cleanModel)
        ? `${BASE}/responses`
        : `${BASE}/chat/completions`;
  }

  buildHeaders(credentials, stream = true, model) {
    const runtimeTransport = credentials?.runtimeTransport;
    const key = credentials?.apiKey || credentials?.accessToken;
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
    const auth = runtimeTransport?.auth;
    if (auth?.header) {
      headers[auth.header] = auth.scheme === "bearer" ? `Bearer ${key}` : key;
      if (auth.anthropicVersion && !headers["anthropic-version"]) {
        headers["anthropic-version"] = ANTHROPIC_API_VERSION;
      }
    } else if (MESSAGES_FORMAT_MODELS.has(baseModelId(effectiveModel))) {
      headers["x-api-key"] = key;
      headers["anthropic-version"] = ANTHROPIC_API_VERSION;
    } else {
      headers["Authorization"] = `Bearer ${key}`;
    }

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
