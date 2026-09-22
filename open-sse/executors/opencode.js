import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { getThinkingLevels } from "../providers/thinkingLevels.js";
import { injectReasoningContent } from "../utils/reasoningContentInjector.js";
import { ANTHROPIC_API_VERSION } from "../providers/shared.js";
import crypto from "node:crypto";
import { resolveSessionId } from "../utils/sessionManager.js";
import { applyFingerprintToolNames } from "../utils/opencodeFingerprint.js";
import { getModelTargetFormat } from "../config/providerModels.js";

// OpenCode free tier limits requests per egress IP.
const IP_LIMIT_BODY = /limit|rate|quota|exhausted|capacity|too many|retry/i;

const OPENCODE_UA = "opencode/1.18.31";

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

// Strip the thinking suffix "model(level)" so registry lookups hit the base id.
function baseModelId(model) {
  return String(model || "").replace(/\([^()]+\)\s*$/, "").trim();
}

function isResponsesModel(model) {
  return getModelTargetFormat("oc", baseModelId(model)) === "openai-responses";
}

function isMessagesModel(model) {
  return getModelTargetFormat("oc", baseModelId(model)) === "claude";
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

function normalizeOpencodeReasoning(model, body) {
  const current = body.reasoning;
  const currentReasoning = current && typeof current === "object" && !Array.isArray(current)
    ? current
    : null;
  const requestedEffort = typeof body.reasoning_effort === "string"
    ? body.reasoning_effort
    : currentReasoning?.effort;
  if (typeof requestedEffort !== "string") return;

  const cleanModel = baseModelId(model || body.model);
  const supportedLevels = getThinkingLevels("opencode", cleanModel);
  let effort = requestedEffort.toLowerCase().trim();
  if ((effort === "max" || effort === "ultra") && supportedLevels?.length && !supportedLevels.includes(effort)) {
    if (effort === "ultra" && supportedLevels.includes("max")) effort = "max";
    else if (supportedLevels.includes("xhigh")) effort = "xhigh";
  }

  body.reasoning = { ...currentReasoning, effort };
  if (!body.reasoning.summary) body.reasoning.summary = "auto";
  delete body.reasoning_effort;
}
export class OpenCodeExecutor extends BaseExecutor {
  constructor() {
    super("opencode", PROVIDERS.opencode);
  }

  transformRequest(model, body, stream, credentials) {
    this._currentSessionId = translateSessionId(
      resolveOpencodeSession(body, credentials),
      credentials?.rawHeaders?.["x-opencode-client"],
    );
    if (credentials) credentials.runtimeOpencodeSession = this._currentSessionId;
    if (isResponsesModel(model)) {
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
    const lane = isResponsesModel(model) ? "responses" : isMessagesModel(model) ? "claude" : "chat";
    cloakFingerprintTools(body, lane);
    return injectReasoningContent({ provider: this.provider, model, body });
  }

  buildUrl(model) {
    const base = this.config.baseUrl;
    if (isResponsesModel(model)) return `${base}/zen/v1/responses`;
    if (isMessagesModel(model)) return `${base}/zen/v1/messages`;
    return `${base}/zen/v1/chat/completions`;
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
      "Authorization": "Bearer public",
      "User-Agent": hasValidOpencodeVersion(raw["user-agent"]) ? raw["user-agent"] : OPENCODE_UA,
      "x-opencode-client": raw["x-opencode-client"] || "desktop",
      "x-opencode-session": session,
      "x-opencode-request": request,
      "x-opencode-project": raw["x-opencode-project"] || "global",
      "Accept": stream ? "text/event-stream" : "*/*"
    };
    if (isMessagesModel(model)) headers["anthropic-version"] = ANTHROPIC_API_VERSION;
    return headers;
  }

  parseError(response, bodyText) {
    const status = response?.status || 0;
    const text = String(bodyText || "");
    if ((status === 429 || status === 403) && IP_LIMIT_BODY.test(text)) {
      return {
        status,
        message: text.slice(0, 300) || `OpenCode free limit (${status})`,
        poolScoped: { reason: "ip-limit" },
      };
    }
    return null;
  }
}
