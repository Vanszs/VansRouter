import { handleChat } from "@/sse/handlers/chat.js";
import { initTranslators } from "open-sse/translator/index.js";

let initialized = false;

async function ensureInitialized() {
  if (!initialized) {
    await initTranslators();
    initialized = true;
  }
}

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "*"
    }
  });
}

/**
 * POST /v1/responses - OpenAI Responses API format
 * Now handled by translator pattern (openai-responses format auto-detected)
 * 
 * Fix: default stream to false when client omits it.
 * chatCore.js treats `body.stream !== false` as streaming (undefined !== false = true).
 * AI SDKs (e.g. @ai-sdk/openai) omit `stream` field for non-streaming calls,
 * which caused VansRouter to force SSE and break JSON parsing downstream.
 */
export async function POST(request) {
  await ensureInitialized();
  // Inject stream:false default for Responses API when client omits stream field
  try {
    const body = await request.json();
    if (body.stream === undefined) {
      body.stream = false;
    }
    // Rebuild request with patched body
    const patched = new Request(request.url, {
      method: request.method,
      headers: request.headers,
      body: JSON.stringify(body),
    });
    return await handleChat(patched);
  } catch {
    // If body parsing fails, fall through to original handler
    return await handleChat(request);
  }
}
