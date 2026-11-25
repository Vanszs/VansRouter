import { ERROR_TYPES, DEFAULT_ERROR_MESSAGES } from "../config/errorConfig.js";
import { unwrapClinepassEnvelope } from "./clinepassEnvelope.js";

/**
 * Build OpenAI-compatible error response body
 * @param {number} statusCode - HTTP status code
 * @param {string} message - Error message
 * @returns {object} Error response object
 */
export function buildErrorBody(statusCode, message) {
  const errorInfo = ERROR_TYPES[statusCode] || 
    (statusCode >= 500 
      ? { type: "server_error", code: "internal_server_error" }
      : { type: "invalid_request_error", code: "" });

  return {
    error: {
      message: message || DEFAULT_ERROR_MESSAGES[statusCode] || "An error occurred",
      type: errorInfo.type,
      code: errorInfo.code
    }
  };
}

/**
 * Create error Response object (for non-streaming)
 * @param {number} statusCode - HTTP status code
 * @param {string} message - Error message
 * @returns {Response} HTTP Response object
 */
export function errorResponse(statusCode, message, extraHeaders = null) {
  return new Response(JSON.stringify(buildErrorBody(statusCode, message)), {
    status: statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      ...extraHeaders
    }
  });
}

/**
 * 503 returned while an OpenCode egress pool is being rotated. The client is
 * expected to retry after the advertised delay; the next request picks another
 * pool because the failed one is now benched in the fitness store.
 */
export function rotationInProgressResponse({
  message,
  retryAfterMs = 1500,
  fromPoolId = null,
  toPoolId = null,
  reason = "",
} = {}) {
  const retryAfterSec = Math.max(1, Math.ceil(retryAfterMs / 1000));
  const body = {
    error: {
      message: message || `OpenCode egress rotated; retry in ${retryAfterSec}s.`,
      type: "server_error",
      code: "rotation_in_progress",
      ...(reason ? { reason } : {}),
    },
  };
  return new Response(JSON.stringify(body), {
    status: 503,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      // Lower-case on purpose: avoids a duplicate header when an upstream
      // Retry-After is also forwarded.
      "retry-after": String(retryAfterSec),
      ...(fromPoolId || toPoolId
        ? { "x-vansroute-rotation": `${fromPoolId || "direct"}>${toPoolId || "next"}` }
        : {}),
    },
  });
}

/**
 * Write error to SSE stream (for streaming)
 * @param {WritableStreamDefaultWriter} writer - Stream writer
 * @param {number} statusCode - HTTP status code
 * @param {string} message - Error message
 */
export async function writeStreamError(writer, statusCode, message) {
  const errorBody = buildErrorBody(statusCode, message);
  const encoder = new TextEncoder();
  await writer.write(encoder.encode(`data: ${JSON.stringify(errorBody)}\n\n`));
}

/**
 * Parse upstream provider error response
 * @param {Response} response - Fetch response from provider
 * @param {object} [executor] - Optional executor with parseError() override for provider-specific parsing
 * @returns {Promise<{statusCode: number, message: string, resetsAtMs?: number}>}
 */
export async function parseUpstreamError(response, executor = null) {
  let bodyText = "";
  try {
    bodyText = await response.text();
  } catch {
    bodyText = "";
  }

  // Let executor-specific parser extract provider-specific fields (e.g. codex resetsAtMs)
  if (executor && typeof executor.parseError === "function") {
    try {
      const parsed = executor.parseError(response, bodyText);
      if (parsed && typeof parsed === "object") {
        const msg = parsed.message || DEFAULT_ERROR_MESSAGES[response.status] || `Upstream error: ${response.status}`;
        return {
          statusCode: parsed.status || response.status,
          message: msg,
          resetsAtMs: parsed.resetsAtMs,
          poolScoped: parsed.poolScoped
            ? { ...parsed.poolScoped, resetsAtMs: parsed.resetsAtMs }
            : parsed.poolScoped,
        };
      }
    } catch { /* fall through to default parsing */ }
  }

  let message = "";
  try {
    const json = JSON.parse(bodyText);
    const { error: envError } = unwrapClinepassEnvelope(json, executor?.getProvider?.() || executor?.provider);
    if (envError) {
      message = envError.message;
    } else {
      message = json.error?.message || json.message || json.error || bodyText;
    }
  } catch {
    message = bodyText;
  }

  const messageStr = typeof message === "string" ? message : JSON.stringify(message);
  const finalMessage = messageStr || DEFAULT_ERROR_MESSAGES[response.status] || `Upstream error: ${response.status}`;

  return { statusCode: response.status, message: finalMessage };
}

/**
 * Create error result for chatCore handler
 * @param {number} statusCode - HTTP status code
 * @param {string} message - Error message
 * @param {number} [resetsAtMs] - Optional precise cooldown expiry (ms epoch) for provider-specific quota errors
 * @param {boolean} [isPolicyError] - True for provider policy refusals (content filter); classifyError() reads this
 * @param {Object} [extraHeaders] - Upstream headers to forward on the error Response
 * @returns {{ success: false, status: number, error: string, response: Response, resetsAtMs?: number, isPolicyError: boolean }}
 */
export function createErrorResult(statusCode, message, resetsAtMs, isPolicyError = false, extraHeaders = null) {
  return {
    success: false,
    status: statusCode,
    error: message,
    resetsAtMs,
    isPolicyError,
    response: errorResponse(statusCode, message, extraHeaders)
  };
}

/**
 * Create unavailable response when all accounts are rate limited
 * @param {number} statusCode - Original error status code
 * @param {string} message - Error message (without retry info)
 * @param {string} retryAfter - ISO timestamp when earliest account becomes available
 * @param {string} retryAfterHuman - Human-readable retry info e.g. "reset after 30s"
 * @returns {Response}
 */
export function unavailableResponse(statusCode, message, retryAfter, retryAfterHuman, extraHeaders = null) {
  const retryAfterSec = Math.max(Math.ceil((new Date(retryAfter).getTime() - Date.now()) / 1000), 1);
  const msg = `${message} (${retryAfterHuman})`;
  return new Response(
    JSON.stringify({ error: { message: msg } }),
    {
      status: statusCode,
      headers: {
        ...extraHeaders,
        "Content-Type": "application/json",
        // Intentionally mis-cased to prevent duplicate headers
        "retry-after": String(retryAfterSec)
      }
    }
  );
}

/**
 * Attach the X-VansRoute-Selected-Connection-Id header to a response so
 * clients can see which upstream account handled their request.
 *
 * Works for both streaming and non-streaming responses: `response.body`
 * (a ReadableStream) is passed by reference to the new Response, so the
 * stream continues to flow untouched — only the headers object is rebuilt.
 *
 * Returns the original response unchanged when connectionId is falsy.
 *
 * @param {Response} response - the response to tag
 * @param {string} [connectionId] - the selected connection's id
 * @returns {Response}
 */
export function withSelectedConnectionHeader(response, connectionId) {
  if (!response || !connectionId) return response;
  const headers = new Headers(response.headers);
  headers.set("X-VansRoute-Selected-Connection-Id", connectionId);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Format provider error with context
 * @param {Error} error - Original error
 * @param {string} provider - Provider name
 * @param {string} model - Model name
 * @param {number|string} statusCode - HTTP status code or error code
 * @returns {string} Formatted error message
 */
export function formatProviderError(error, provider, model, statusCode) {
  const code = statusCode || error.code || "FETCH_FAILED";
  const message = error.message || "Unknown error";
  // Expose low-level cause (e.g. UND_ERR_SOCKET, ECONNRESET, ETIMEDOUT) for diagnosing fetch failures
  const causeCode = error.cause?.code;
  const causeMsg = error.cause?.message;
  const causeStr = causeCode || causeMsg ? ` (cause: ${[causeCode, causeMsg].filter(Boolean).join(": ")})` : "";
  return `[${code}]: ${message}${causeStr}`;
}
