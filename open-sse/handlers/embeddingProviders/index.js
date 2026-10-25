// Embeddings provider adapter registry
import createOpenAIEmbeddingAdapter from "./openai.js";
import gemini from "./gemini.js";
import github from "./github.js";
import openaiCompatNode from "./openaiCompatNode.js";

const OPENAI_COMPAT_PROVIDERS = [
  "openai", "openrouter", "mistral", "voyage-ai", "fireworks",
  "together", "nebius", "nvidia", "jina-ai",
  "vercel-ai-gateway",
];

const ADAPTERS = {
  ...Object.fromEntries(OPENAI_COMPAT_PROVIDERS.map((id) => [id, createOpenAIEmbeddingAdapter(id)])),
  gemini,
  google_ai_studio: gemini,
  github,
};

export function getEmbeddingAdapter(provider) {
  if (ADAPTERS[provider]) return ADAPTERS[provider];
  if (provider?.startsWith?.("openai-compatible-") || provider?.startsWith?.("custom-embedding-")) {
    return openaiCompatNode;
  }
  return null;
}
