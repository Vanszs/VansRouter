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
 * 
 * AI SDKs (e.g. @ai-sdk/openai) omit `stream` field for non-streaming calls.
 * chatCore.js treats `body.stream !== false` as stream:true, causing SSE response.
 * Fix: inject stream:false default before passing to handleChat.
 */
export async function POST(request) {
  await ensureInitialized();
  try {
    const body = await request.json();
    if (body.stream === undefined) {
      body.stream = false;
    }
    const patched = new Request(request.url, {
      method: request.method,
      headers: request.headers,
      body: JSON.stringify(body),
    });
    return await handleChat(patched);
  } catch {
    return await handleChat(request);
  }
}
