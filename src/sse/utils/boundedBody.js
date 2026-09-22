import { errorResponse } from "open-sse/utils/error.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";

// Shared request-body ceiling. Reading the stream rather than request.json() is what lets
// an oversized payload be rejected before JSON.parse allocates the whole object graph, and
// the running byte count stops the bytes themselves from piling up in heap.
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;

function maxBodyBytes(limit) {
  return limit || parseInt(process.env.NINEROUTER_MAX_BODY_BYTES || "", 10) || DEFAULT_MAX_BYTES;
}

function tooLarge(bytes, max) {
  return errorResponse(
    HTTP_STATUS.PAYLOAD_TOO_LARGE,
    `Request body too large (${bytes} bytes, limit ${max}). Raise NINEROUTER_MAX_BODY_BYTES to accept it.`
  );
}

// ponytail: the whole body is still buffered per request (it must be parsed as one JSON
// document); only the ceiling is enforced mid-stream. Stream further if a caller ever needs
// to parse before the body ends.
async function readBoundedText(request, max) {
  const reader = request.body?.getReader();
  if (!reader) return { raw: "", bytes: 0 };

  const chunks = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > max) {
        await reader.cancel().catch(() => {});
        const error = new Error("Request body too large");
        error.code = "BODY_TOO_LARGE";
        error.bytes = bytes;
        throw error;
      }
      chunks.push(value);
    }
  } finally {
    try { reader.releaseLock(); } catch { /* already cancelled */ }
  }

  return { raw: Buffer.concat(chunks).toString("utf8"), bytes };
}

/**
 * Read and parse a JSON request body with a byte ceiling.
 * Returns { body, bytes } on success, or { error } holding a ready-to-return Response.
 */
export async function readBoundedJson(request, limit) {
  const max = maxBodyBytes(limit);

  // Announced oversize: reject before a single byte is read off the socket. A chunked or
  // lying sender is caught by the running count in readBoundedText instead.
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > max) return { error: tooLarge(declared, max) };

  let raw;
  let bytes;
  try {
    ({ raw, bytes } = await readBoundedText(request, max));
  } catch (error) {
    if (error?.code === "BODY_TOO_LARGE") return { error: tooLarge(error.bytes, max) };
    return { error: errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid JSON body") };
  }

  try {
    return { body: JSON.parse(raw), bytes };
  } catch {
    return { error: errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid JSON body") };
  }
}
