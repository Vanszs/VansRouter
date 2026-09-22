import { errorResponse } from "open-sse/utils/error.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";

// Shared request-body ceiling. Reading as text (not request.json()) is what lets an
// oversized payload be rejected before JSON.parse allocates the whole object graph.
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;

export function maxBodyBytes(limit) {
  return limit || parseInt(process.env.NINEROUTER_MAX_BODY_BYTES || "", 10) || DEFAULT_MAX_BYTES;
}

/**
 * Read and parse a JSON request body with a byte ceiling.
 * Returns { body, bytes } on success, or { error } holding a ready-to-return Response.
 */
export async function readBoundedJson(request, limit) {
  const raw = await request.text().catch(() => null);
  if (raw === null) {
    return { error: errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid JSON body") };
  }

  const max = maxBodyBytes(limit);
  const bytes = Buffer.byteLength(raw, "utf8");
  if (bytes > max) {
    return {
      error: errorResponse(
        HTTP_STATUS.PAYLOAD_TOO_LARGE,
        `Request body too large (${bytes} bytes, limit ${max}). Raise NINEROUTER_MAX_BODY_BYTES to accept it.`
      ),
    };
  }

  try {
    return { body: JSON.parse(raw), bytes };
  } catch {
    return { error: errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid JSON body") };
  }
}

/** Byte size of a body already read as text, for callers that also need it downstream. */
export function bodyBytes(raw) {
  return Buffer.byteLength(raw || "", "utf8");
}
