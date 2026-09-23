import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { getThinkingLevels } from "../providers/thinkingLevels.js";
import { injectReasoningContent } from "../utils/reasoningContentInjector.js";
import crypto from "node:crypto";
import { resolveSessionId } from "../utils/sessionManager.js";

// OpenCode free tier limits requests per egress IP.
const IP_LIMIT_BODY = /limit|rate|quota|exhausted|capacity|too many|retry/i;

// Models that use /zen/v1/messages (claude format)
const MESSAGES_MODELS = new Set();

const OPENCODE_UA = "opencode/1.18.31";
// Models served by /zen/v1/responses; every other model stays on /chat/completions.
const RESPONSES_MODELS = new Set(["muse-spark-1.2-contributor-free", "muse-spark-1.3-contributor-free"]);


// OpenCode free tier requires both 'bash' and 'read' in the tools payload.
// Injected as cloaked decoy tools so external CLI tools (e.g. Claude Code's Bash/Read)
// take precedence while satisfying upstream verification.
const OPENCODE_DECOY_CHAT_TOOLS = [
  {
    type: "function",
    function: {
      name: "bash",
      description: "This tool is currently unavailable and must not be used.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "read",
      description: "This tool is currently unavailable and must not be used.",
      parameters: { type: "object", properties: {} },
    },
  },
];

const OPENCODE_DECOY_RESPONSES_TOOLS = [
  {
    type: "function",
    name: "bash",
    description: "This tool is currently unavailable and must not be used.",
    parameters: { type: "object", properties: {} },
  },
  {
    type: "function",
    name: "read",
    description: "This tool is currently unavailable and must not be used.",
    parameters: { type: "object", properties: {} },
  },
];

function cloakOpencodeTools(body, isResponses) {
  if (!body || typeof body !== "object") return;
  if (isResponses) {
    if (!Array.isArray(body.tools)) body.tools = [];
    const names = new Set(body.tools.map((t) => t.name || t.function?.name));
    for (const tool of OPENCODE_DECOY_RESPONSES_TOOLS) {
      if (!names.has(tool.name)) body.tools.push({ ...tool });
    }
    if (!body.tool_choice) body.tool_choice = "auto";
  } else {
    const hasTools = Array.isArray(body.tools) && body.tools.length > 0;
    if (!hasTools) {
      body.tools = OPENCODE_DECOY_CHAT_TOOLS.map((t) => ({ ...t, function: { ...t.function } }));
      if (!body.tool_choice) body.tool_choice = "none";
    } else {
      const names = new Set(body.tools.map((t) => t.function?.name || t.name));
      for (const tool of OPENCODE_DECOY_CHAT_TOOLS) {
        if (!names.has(tool.function.name)) {
          body.tools.push({ ...tool, function: { ...tool.function } });
        }
      }
    }
  }
}

const BASE62_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
// Zen validates the exact id shape: prefix + 12 hex + 14 base62 (26 chars after
// the prefix). Anything else — uuid without dashes, hyphenated uuid — is rejected
// with 403 FreeTierError "can only be used from within OpenCode" (live-verified:
// identical wire, RE-valid session → 200, invalid → 403).
const OPENCODE_SESSION_RE = /^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/;
const OPENCODE_REQUEST_RE = /^msg_[0-9a-f]{12}[0-9A-Za-z]{14}$/;

function randomBase62(len) {
  const bytes = crypto.randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) out += BASE62_CHARS[bytes[i] % 62];
  return out;
}

function generateRequestId() {
  return `msg_${crypto.randomBytes(6).toString("hex")}${randomBase62(14)}`;
}

function generateSessionId() {
  return `ses_${crypto.randomBytes(6).toString("hex")}${randomBase62(14)}`;
}

// Keep an already-valid client/session id; otherwise map any value (uuid-based
// ids from sessionManager, downstream junk) deterministically into RE shape so
// the existing stable-per-connection session survives, only reshaped.
function translateSessionId(sessionId) {
  if (typeof sessionId === "string" && OPENCODE_SESSION_RE.test(sessionId.trim())) return sessionId.trim();
  const digest = crypto.createHash("sha256").update(`opencode\0${sessionId || ""}`).digest();
  const timeHex = digest.subarray(0, 6).toString("hex");
  let randomPart = "";
  for (let i = 6; i < 20; i++) randomPart += BASE62_CHARS[digest[i] % 62];
  return `ses_${timeHex}${randomPart}`;
}

// Advertise a real client version; bare "opencode" or spoofed UAs fall back to
// the pinned version (hasValidOpencodeVersion checks >= 1.17).
function hasValidOpencodeVersion(ua) {
  const m = String(ua || "").match(/opencode\/(\d+)\.(\d+)(?:\.(\d+))?/i);
  if (!m) return false;
  const major = parseInt(m[1], 10);
  const minor = parseInt(m[2], 10);
  return major > 1 || (major === 1 && minor >= 17);
}

// Strip the thinking suffix "model(level)" so registry lookups hit the base id.
function baseModelId(model) {
  return String(model || "").replace(/\([^()]+\)\s*$/, "").trim();
}

function isResponsesModel(model) {
  return RESPONSES_MODELS.has(baseModelId(model));
}

function resolveOpencodeSession(body, credentials) {
  const headers = credentials?.rawHeaders || {};
  return translateSessionId(resolveSessionId({
    headers,
    body,
    connectionId: credentials?.connectionId,
    scope: "opencode",
    generate: generateSessionId,
  }));
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
    this._currentSessionId = resolveOpencodeSession(body, credentials);
    if (credentials) credentials.runtimeOpencodeSession = this._currentSessionId;
    // Zen rejects non-streaming requests on free models with 403 FreeTierError;
    // always stream upstream and let the handler layer aggregate for non-stream clients.
    if (body && typeof body === "object") body.stream = true;
    if (isResponsesModel(model)) {
      // ponytail: chỉ model đã xác nhận auto-only; mở allowlist khi có bằng chứng.
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
      body.store = false;
      // Free tier gates on both 'bash' and 'read' being present in the tools
      // payload (verified live: any Responses request without both returns 403
      // FreeTierError "can only be used from within OpenCode", with both +
      // tool_choice auto it returns 200). Cloak on every request, not just
      // empty ones, so external clients sending 1..N tools still pass.
      cloakOpencodeTools(body, true);
    } else if (body && typeof body === "object") {
      cloakOpencodeTools(body, false);
    }
    return injectReasoningContent({ provider: this.provider, model, body });
  }

  buildUrl(model) {
    const base = this.config.baseUrl;
    return isResponsesModel(model)
      ? `${base}/zen/v1/responses`
      : `${base}/zen/v1/chat/completions`;
  }

  buildHeaders(credentials, stream = true) {
    const raw = Object.fromEntries(Object.entries(credentials?.rawHeaders || {}).map(([k, v]) => [k.toLowerCase(), v]));
    const downstreamUa = raw["user-agent"] || "";
    const session = OPENCODE_SESSION_RE.test(raw["x-opencode-session"] || "")
      ? raw["x-opencode-session"]
      : (credentials?.runtimeOpencodeSession || generateSessionId());
    const requestId = OPENCODE_REQUEST_RE.test(raw["x-opencode-request"] || "")
      ? raw["x-opencode-request"]
      : generateRequestId();
    return {
      "Content-Type": "application/json",
      "Authorization": "Bearer public",
      "User-Agent": hasValidOpencodeVersion(downstreamUa) ? downstreamUa : OPENCODE_UA,
      "x-opencode-client": raw["x-opencode-client"] || "desktop",
      "x-opencode-session": session,
      "x-opencode-request": requestId,
      "x-opencode-project": raw["x-opencode-project"] || "global",
      "Accept": stream ? "text/event-stream" : "*/*"
    };
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
