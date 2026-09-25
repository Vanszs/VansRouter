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

// OpenCode's free tier rejects requests whose User-Agent has no version >= 1.17.0.
function hasValidOpencodeVersion(ua) {
  const m = String(ua || "").match(/opencode\/(\d+)\.(\d+)/i);
  if (!m) return false;
  const major = parseInt(m[1], 10);
  const minor = parseInt(m[2], 10);
  return major > 1 || (major === 1 && minor >= 17);
}

// A client-supplied session id in a non-canonical shape makes the free tier 403,
// so ignore anything that does not match the canonical format upstream validates.
const CANONICAL_SESSION = /^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/;
const CANONICAL_REQUEST = /^msg_[0-9a-f]{12}[0-9A-Za-z]{14}$/;

function canonicalId(value, pattern) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return pattern.test(trimmed) ? trimmed : "";
}

function clientSession(sessionId) {
  return canonicalId(sessionId, CANONICAL_SESSION);
}

function clientRequestId(requestId) {
  return canonicalId(requestId, CANONICAL_REQUEST);
}

// Canonical id formats OpenCode validates: ses_<12 hex><14 base62> / msg_<12 hex><14 base62>.
const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

function translateCanonicalId(value, pattern, prefix, kind, clientTool = "") {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (pattern.test(trimmed)) return trimmed;
  const digest = crypto
    .createHash("sha256")
    .update(`opencode\0${kind}\0${clientTool || "generic"}\0${value ?? ""}`)
    .digest();
  const randomPart = Array.from(digest.subarray(6, 20), (byte) => BASE62[byte % 62]).join("");
  return `${prefix}${digest.subarray(0, 6).toString("hex")}${randomPart}`;
}

export function translateSessionId(value, clientTool) {
  return translateCanonicalId(value, CANONICAL_SESSION, "ses_", "session", clientTool);
}

export function translateRequestId(value) {
  return translateCanonicalId(value, CANONICAL_REQUEST, "msg_", "request");
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
    return injectReasoningContent({ provider: this.provider, model, body });
  }

  buildUrl(model, stream, urlIndex = 0, credentials = null) {
    const lane = this.laneFor(model, credentials);
    // Registry declares the keyed lane's endpoints; the free lane has no
    // transports, so it falls back to the shared /zen/v1 root.
    return resolveTransport(this.provider, LANE_FORMAT[lane])?.baseUrl
      || `${this.origin}/zen/v1${LANE_PATH[lane]}`;
  }

  buildHeaders(credentials, stream = true, model) {
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
