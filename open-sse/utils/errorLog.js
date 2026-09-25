/**
 * Structured error logger for open-sse gateway.
 *
 * All gateway-level errors are written to:
 *   - stderr (console.error) for PM2/systemd capture
 *   - /var/lib/9router/logs/gateway-errors.jsonl  (newline-delimited JSON)
 *
 * Error classes tracked:
 *   POLICY       - unsupported model/mode (e.g. Kimi tool mode on NIM)
 *   PROVIDER     - upstream HTTP error (4xx/5xx from provider)
 *   STREAM       - streaming transformer failure (malformed chunk, repetition)
 *   TOOL_CALL    - tool-call parse/output failure
 *   TOKEN        - credential refresh failure
 *   AUTH         - authentication / API key rejection
 *   TIMEOUT      - connect or stream timeout
 *   PARSE        - JSON parse failure in request/response body
 *   UNKNOWN      - uncategorized error
 */

import fs from "fs";
import path from "path";

const LOG_DIR = "/var/lib/9router/logs";
const LOG_FILE = path.join(LOG_DIR, "gateway-errors.jsonl");
const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20 MB – rotate on exceed

let _initialized = false;

function ensureLogDir() {
  if (_initialized) return;
  try {
    if (!fs.existsSync(LOG_DIR)) {
      fs.mkdirSync(LOG_DIR, { recursive: true });
    }
    _initialized = true;
  } catch {
    // If we can't create the log dir, fall back to stderr-only
    _initialized = true;
  }
}

function maybeRotate() {
  try {
    const stat = fs.statSync(LOG_FILE);
    if (stat.size > MAX_FILE_BYTES) {
      fs.renameSync(LOG_FILE, LOG_FILE + ".1");
    }
  } catch {
    // File doesn't exist yet – fine
  }
}

/**
 * Log a structured gateway error.
 *
 * @param {object} opts
 * @param {"POLICY"|"PROVIDER"|"STREAM"|"TOOL_CALL"|"TOKEN"|"AUTH"|"TIMEOUT"|"PARSE"|"UNKNOWN"} opts.class - Error class
 * @param {string} opts.provider - Provider id (e.g. "nvidia")
 * @param {string} opts.model - Model id
 * @param {string} opts.message - Human-readable message
 * @param {number} [opts.status] - HTTP status code if applicable
 * @param {string} [opts.stopReason] - Provider stop_reason / finish_reason
 * @param {string} [opts.connectionId] - Connection/account id
 * @param {object} [opts.extra] - Any additional context
 */
export function logGatewayError({
  class: errorClass = "UNKNOWN",
  provider = "?",
  model = "?",
  message,
  status,
  stopReason,
  connectionId,
  extra,
} = {}) {
  const entry = {
    ts: new Date().toISOString(),
    class: errorClass,
    provider,
    model,
    message,
    ...(status !== undefined && { status }),
    ...(stopReason !== undefined && { stopReason }),
    ...(connectionId !== undefined && { connectionId }),
    ...(extra !== undefined && { extra }),
  };

  // Always emit to stderr so PM2 captures it in error logs
  console.error(`[GATEWAY-ERROR] [${errorClass}] ${provider}/${model}: ${message}`);

  // Write to JSONL file
  try {
    ensureLogDir();
    maybeRotate();
    fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + "\n", "utf8");
  } catch {
    // File logging failure must never crash the gateway
  }
}

/**
 * Classify an error thrown by an executor or handler into a standard class.
 *
 * @param {Error} error
 * @returns {"POLICY"|"PROVIDER"|"STREAM"|"TOOL_CALL"|"TOKEN"|"AUTH"|"TIMEOUT"|"PARSE"|"UNKNOWN"}
 */
export function classifyError(error) {
  if (!error) return "UNKNOWN";
  if (error.isPolicyError) return "POLICY";
  const msg = String(error.message || "").toLowerCase();
  if (msg.includes("tool-call failure") || msg.includes("tool call")) return "TOOL_CALL";
  if (msg.includes("timeout") || msg.includes("timed out") || error.name === "TimeoutError") return "TIMEOUT";
  if (msg.includes("json") || msg.includes("parse")) return "PARSE";
  if (msg.includes("401") || msg.includes("403") || msg.includes("unauthorized") || msg.includes("forbidden")) return "AUTH";
  if (msg.includes("refresh") || msg.includes("token")) return "TOKEN";
  if (msg.includes("stream") || msg.includes("repetition")) return "STREAM";
  if (error.statusCode >= 400 || error.status >= 400) return "PROVIDER";
  return "UNKNOWN";
}
