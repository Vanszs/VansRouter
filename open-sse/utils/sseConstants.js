// Shared SSE primitives (no imports → safe for executors + stream.js)
export const SSE_DONE = "data: [DONE]\n\n";

export const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  "X-Accel-Buffering": "no",
  "Connection": "keep-alive",
};

// Variant for web-cookie executors behind nginx (disable proxy buffering)
export const SSE_HEADERS_NO_BUFFER = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  "X-Accel-Buffering": "no",
};

// Authenticated dashboard streams must not be stored or transformed by a proxy.
export const SSE_HEADERS_DASHBOARD = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "private, no-store, no-transform",
  "X-Accel-Buffering": "no",
  "Connection": "keep-alive",
};

// Variant for client-facing SSE responses (adds permissive CORS)
export const SSE_HEADERS_CORS = {
  ...SSE_HEADERS,
  "Access-Control-Allow-Origin": "*",
};
