import { handleChat } from "@/sse/handlers/chat.js";
import { readBoundedJson } from "@/sse/utils/boundedBody.js";
import { initTranslators } from "open-sse/translator/index.js";
import { transformToOllama } from "open-sse/utils/ollamaTransform.js";

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

export async function POST(request) {
  await ensureInitialized();

  const clonedReq = request.clone();
  let modelName = "llama3.2";
  const { body, error } = await readBoundedJson(clonedReq);
  if (error) return error;
  modelName = body.model || "llama3.2";

  const response = await handleChat(request);
  return transformToOllama(response, modelName);
}

