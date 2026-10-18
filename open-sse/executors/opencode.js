import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { injectReasoningContent } from "../utils/reasoningContentInjector.js";
import { ANTHROPIC_API_VERSION, applyAuth, BEARER_AUTH } from "../providers/shared.js";
import { resolveTransport } from "../services/provider.js";
import { baseModelId, normalizeOpencodeReasoning } from "../utils/opencodeIdentity.js";
import crypto from "node:crypto";
import { resolveSessionId } from "../utils/sessionManager.js";
import { applyFingerprintToolNames } from "../utils/opencodeFingerprint.js";
import { getModelTargetFormat, PROVIDER_MODELS, PROVIDER_ID_TO_ALIAS } from "../config/providerModels.js";

// OpenCode free tier limits requests per egress IP.
const IP_LIMIT_BODY = /limit|rate|quota|exhausted|capacity|too many|retry/i;

const OPENCODE_UA = "opencode/1.18.31";

// Lane → registry transport format / shared /zen/v1 path (free lane has no transports).
const LANE_FORMAT = { chat: "openai", claude: "claude", responses: "openai-responses" };
const LANE_PATH = { chat: "/chat/completions", claude: "/messages", responses: "/responses" };

// The free tier gates on the lowercase file-search quartet: every request must
// declare bash/glob/grep/read exactly once. See utils/opencodeFingerprint.js.
const DECOY_DESCRIPTION = "This tool is currently unavailable and must not be used.";

// OpenCode's free tier answers 426 UpgradeRequired below opencode/1.18.0.
// The official UA is opencode/<channel>/<version>/<name>; the version is the
// first major.minor after the product name, so both shapes parse the same way.
const MIN_OPENCODE_MINOR = 18;

function hasValidOpencodeVersion(ua) {
  const m = String(ua || "").match(/opencode\/(?:[a-z][a-z0-9-]*\/)?(\d+)\.(\d+)/i);
  if (!m) return false;
  const major = parseInt(m[1], 10);
  const minor = parseInt(m[2], 10);
  return major > 1 || (major === 1 && minor >= MIN_OPENCODE_MINOR);
}

// Shape the free tier accepts: ses_/msg_ + 12 hex + 14 base62.
const CANONICAL_SESSION = /^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/;
const CANONICAL_REQUEST = /^msg_[0-9a-f]{12}[0-9A-Za-z]{14}$/;

function canonicalId(value, pattern) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return pattern.test(trimmed) ? trimmed : "";
}

// The session's 12 hex are the low 48 bits of ~(unixMillis * 4096 + counter)
// (packages/schema/src/identifier.ts). The free tier rejects a session that was
// not inverted: an ascending timestamp and a hash-derived id both answer 403
// FreeTierError, while the inverted form answers 200. The multiply overflows
// 48 bits, so the high bit of a live inverted id is 1. Age is not what the gate
// checks — ids from a year either side still pass — so the inversion is the
// whole check. Request ids are minted ascending and are not gated this way.
export function plausibleOpencodeId(value, pattern) {
  const trimmed = canonicalId(value, pattern);
  if (!trimmed || pattern !== CANONICAL_SESSION) return trimmed;
  return (BigInt(`0x${trimmed.slice(4, 16)}`) >> 47n) === 1n ? trimmed : "";
}

function clientSession(sessionId) {
  return plausibleOpencodeId(sessionId, CANONICAL_SESSION);
}

function clientRequestId(requestId) {
  return canonicalId(requestId, CANONICAL_REQUEST);
}

// Canonical id formats OpenCode validates: ses_<12 hex><14 base62> / msg_<12 hex><14 base62>.
const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

// One minted id per foreign conversation key. The timestamp is the payload, so
// a hash can no longer be the id; caching is what keeps one upstream session
// (and its prompt cache) for the life of this process.
const translatedSessions = new Map();
const MAX_TRANSLATED_SESSIONS = 256;

function rememberTranslatedSession(key) {
  const existing = translatedSessions.get(key);
  if (existing) return existing;
  const minted = generateSessionId();
  if (translatedSessions.size >= MAX_TRANSLATED_SESSIONS) {
    translatedSessions.delete(translatedSessions.keys().next().value);
  }
  translatedSessions.set(key, minted);
  return minted;
}

export function translateSessionId(value, clientTool = "") {
  const accepted = clientSession(value);
  if (accepted) return accepted;
  const key = `${clientTool || "generic"}\0${value ?? ""}`;
  return rememberTranslatedSession(key);
}

export function translateRequestId(value) {
  return clientRequestId(value) || generateRequestId();
}

function timeHex(value) {
  return Array.from({ length: 6 }, (_, i) =>
    Number((value >> BigInt(40 - 8 * i)) & 0xffn).toString(16).padStart(2, "0")
  ).join("");
}

function randomPart() {
  const bytes = crypto.randomBytes(14);
  return Array.from(bytes, (b) => BASE62[b % 62]).join("");
}

function generateRequestId() {
  return `msg_${timeHex(BigInt(Date.now()) * 0x1000n + 1n)}${randomPart()}`;
}

function generateSessionId() {
  return `ses_${timeHex(~(BigInt(Date.now()) * 0x1000n))}${randomPart()}`;
}

// Declared lane for a model: primary registry alias (oc free lane / ocz keyed
// zen lane), then the oc registry for passthrough ids the keyed catalog doesn't
// list ("-free" ids served on both lanes).
function modelFormat(alias, model) {
  const clean = baseModelId(model);
  const fmt = getModelTargetFormat(alias, clean);
  if (fmt) return fmt;
  if (alias !== "oc" && !(PROVIDER_MODELS[alias] || []).some((m) => m.id === clean)) {
    return getModelTargetFormat("oc", clean);
  }
  return null;
}

// Decoy shape follows the lane: Responses takes flat entries, Chat Completions
// nests them under `function`, the Messages API uses Anthropic's input_schema form.
function decoyTool(name, shape) {
  if (shape === "claude") {
    return { name, description: DECOY_DESCRIPTION, input_schema: { type: "object", properties: {} } };
  }
  if (shape === "chat") {
    return {
      type: "function",
      function: { name, description: DECOY_DESCRIPTION, parameters: { type: "object", properties: {} } },
    };
  }
  return { type: "function", name, description: DECOY_DESCRIPTION, parameters: { type: "object", properties: {} } };
}

// /responses rejects a tool name outside ^[a-zA-Z0-9_.-]+$ (measured: `mcp:fs:read`
// answers 400). The colon an MCP name carries is the character that fails.
const RESPONSES_TOOL_NAME = /[^a-zA-Z0-9_.-]/g;

function responsesToolName(name) {
  return String(name || "").trim().replace(RESPONSES_TOOL_NAME, "_").slice(0, 128);
}

// A compacted or interrupted turn arrives with a function_call and no output, or
// an output and no call. /responses answers 400 for either. Drop the output that
// has no call and close the call that has no output.
function pairResponsesCalls(input) {
  if (!Array.isArray(input)) return input;
  const calls = new Set(input.filter((item) => item?.type === "function_call" && item.call_id).map((item) => item.call_id));
  const kept = input.filter((item) => item?.type !== "function_call_output" || calls.has(item?.call_id));
  const outputs = new Set(kept.filter((item) => item?.type === "function_call_output").map((item) => item.call_id));
  const paired = [];
  for (const item of kept) {
    paired.push(item);
    if (item?.type === "function_call" && item.call_id && !outputs.has(item.call_id)) {
      paired.push({ type: "function_call_output", call_id: item.call_id, output: "{}" });
      outputs.add(item.call_id);
    }
  }
  return paired;
}

function hardenResponsesBody(body) {
  if (!body || typeof body !== "object") return;
  // /responses answers 400 below 16. A large cap is accepted (700000 answered
  // 200), so only the floor is enforced.
  if (typeof body.max_output_tokens === "number" && body.max_output_tokens < 16) {
    body.max_output_tokens = 16;
  }
  if (Array.isArray(body.tools)) {
    for (const tool of body.tools) {
      if (!tool || typeof tool !== "object") continue;
      if (typeof tool.name === "string") tool.name = responsesToolName(tool.name);
      const fn = tool.function;
      if (fn && typeof fn === "object" && typeof fn.name === "string") fn.name = responsesToolName(fn.name);
    }
  }
  if (Array.isArray(body.input)) {
    for (const item of body.input) {
      if (item?.type === "function_call" && typeof item.name === "string") item.name = responsesToolName(item.name);
    }
    body.input = pairResponsesCalls(body.input);
  }
}

function cloakFingerprintTools(body, shape) {
  if (!body || typeof body !== "object") return;
  const hadTools = Array.isArray(body.tools) && body.tools.length > 0;
  // Canonicalise the quartet (Claude Code's `Bash` goes upstream as `bash`) and
  // append whatever the caller did not declare; the rename map is recorded on the
  // body so the response side can hand the client its own spellings back.
  applyFingerprintToolNames(body, (name) => decoyTool(name, shape));
  // Responses uses auto once the quartet is supplied; chat requests with no
  // caller tools use none so the injected decoys cannot be selected. Anthropic
  // tool_choice shapes are left to the client.
  if (shape === "responses" && !body.tool_choice) body.tool_choice = "auto";
  else if (shape === "chat" && !hadTools && !body.tool_choice) body.tool_choice = "none";
}

function resolveOpencodeSession(body, credentials) {
  const headers = credentials?.rawHeaders || {};
  return resolveSessionId({
    headers,
    body,
    connectionId: credentials?.connectionId,
    scope: "opencode",
    generate: generateSessionId,
  });
}

export class OpenCodeExecutor extends BaseExecutor {
  constructor(provider = "opencode") {
    super(provider, PROVIDERS[provider]);
    this.modelAlias = PROVIDER_ID_TO_ALIAS[provider] || provider;
    this.origin = new URL(this.config.baseUrl).origin;
  }

  // Request lane ("responses" | "claude" | "chat"): responses-only models never
  // move (a stale runtimeTransport must not downgrade them — same rule as
  // opencode-go), then the source-format transport chatCore picked, else the
  // model's declared lane.
  laneFor(model, credentials) {
    if (modelFormat(this.modelAlias, model) === "openai-responses") return "responses";
    const rtFormat = credentials?.runtimeTransport?.format;
    if (rtFormat === "openai-responses") return "responses";
    if (rtFormat === "claude") return "claude";
    if (rtFormat === "openai") return "chat";
    return modelFormat(this.modelAlias, model) === "claude" ? "claude" : "chat";
  }

  transformRequest(model, body, stream, credentials) {
    // Zen's free tier 403s any non-streaming body; the identity
    // openai-to-openai translator never writes body.stream — pin it here
    // (same convention as codex/commandcode/grok-cli executors).
    if (stream) body.stream = true;
    this._currentSessionId = translateSessionId(
      resolveOpencodeSession(body, credentials),
      credentials?.rawHeaders?.["x-opencode-client"],
    );
    if (credentials) credentials.runtimeOpencodeSession = this._currentSessionId;
    const lane = this.laneFor(model, credentials);
    if (lane === "responses") {
      // ponytail: only the model confirmed auto-only; widen the allowlist when
      // there is evidence for another one.
      if ("tool_choice" in body && body.tool_choice !== "auto"
        && this.config.quirks?.forceAutoToolChoiceModels?.includes(baseModelId(model))) {
        body.tool_choice = "auto";
      }
      // Responses API names the output cap max_output_tokens and takes thinking
      // as reasoning:{effort,summary} — normalize the Chat fields at this boundary.
      if (body.max_output_tokens === undefined) {
        if (body.max_completion_tokens !== undefined) body.max_output_tokens = body.max_completion_tokens;
        else if (body.max_tokens !== undefined) body.max_output_tokens = body.max_tokens;
      }
      delete body.max_tokens;
      delete body.max_completion_tokens;
      normalizeOpencodeReasoning(model, body);
    }
    cloakFingerprintTools(body, lane);
    // After the fingerprint pass, so a canonical tool name is not rewritten and
    // a decoy the pass appends is paired like any other call.
    if (lane === "responses") hardenResponsesBody(body);
    return injectReasoningContent({ provider: this.provider, model, body });
  }

  buildUrl(model, stream, urlIndex = 0, credentials = null) {
    const lane = this.laneFor(model, credentials);
    // Registry declares the keyed lane's endpoints; the free lane has no
    // transports, so it falls back to the shared /zen/v1 root.
    return resolveTransport(this.provider, LANE_FORMAT[lane])?.baseUrl
      || `${this.origin}/zen/v1${LANE_PATH[lane]}`;
  }

  buildHeaders(credentials, stream = true, url, model) {
    const raw = Object.fromEntries(Object.entries(credentials?.rawHeaders || {}).map(([k, v]) => [k.toLowerCase(), v]));
    const rawSession = raw["x-opencode-session"];
    const storedSession = credentials?.runtimeOpencodeSession;
    const session = clientSession(rawSession)
      || (Object.hasOwn(raw, "x-opencode-session") ? translateSessionId(rawSession, raw["x-opencode-client"]) : "")
      || clientSession(storedSession)
      || (typeof storedSession === "string" ? translateSessionId(storedSession, raw["x-opencode-client"]) : "")
      || generateSessionId();
    const rawRequest = raw["x-opencode-request"];
    const request = clientRequestId(rawRequest)
      || (Object.hasOwn(raw, "x-opencode-request") ? translateRequestId(rawRequest) : "")
      || generateRequestId();
    const headers = {
      "Content-Type": "application/json",
      "User-Agent": hasValidOpencodeVersion(raw["user-agent"]) ? raw["user-agent"] : OPENCODE_UA,
      "x-opencode-client": raw["x-opencode-client"] || "desktop",
      "x-opencode-session": session,
      "x-opencode-request": request,
      "x-opencode-project": raw["x-opencode-project"] || "global",
      "Accept": stream ? "text/event-stream" : "*/*"
    };
    // Per-transport contract when chatCore picked one (zen claude: x-api-key raw
    // + version; else Bearer). A keyless request falls back to "public" on every
    // lane this executor serves — restricting it to the free lane let the keyed
    // zen lane send "Bearer undefined", which the upstream reads as no credential.
    const authCredentials = { ...(credentials || {}) };
    if (!authCredentials.apiKey && !authCredentials.accessToken) {
      authCredentials.apiKey = "public";
    }
    applyAuth(headers, credentials?.runtimeTransport?.auth || BEARER_AUTH, authCredentials);
    if (this.laneFor(model, credentials) === "claude" && !headers["anthropic-version"]) {
      headers["anthropic-version"] = ANTHROPIC_API_VERSION;
    }
    return headers;
  }

  parseError(response, bodyText) {
    const status = response?.status || 0;
    const text = String(bodyText || "");
    if (this.provider === "opencode") {
      if ((status === 429 || status === 403) && IP_LIMIT_BODY.test(text)) {
        return {
          status,
          message: text.slice(0, 300) || `OpenCode free limit (${status})`,
          poolScoped: { reason: "ip-limit" },
        };
      }
      if (status === 401 && /Model .* is not supported/i.test(text)) {
        return {
          status: 404,
          message: text.slice(0, 300),
          code: "model_not_found",
        };
      }
      if (status === 400 && /Model is unavailable/i.test(text)) {
        return {
          status: 503,
          message: text.slice(0, 300),
          code: "model_unavailable",
        };
      }
    }
    return null;
  }
}
