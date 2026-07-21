// Provider icon paths under /public/providers.
// Alias related brands; session-cache 404s so one miss never spams again.

const ICON_ALIASES = {
  "perplexity-agent": "perplexity",
  "gitlab-duo": "gitlab",
  "vercel-ai-gateway": "vercel",
};

// Runtime only — first 404 remembers id for the whole session
const failedIds = new Set();

function normalizeId(providerId) {
  if (!providerId || typeof providerId !== "string") return "";
  return providerId.trim().toLowerCase();
}

/** Resolve icon file id (after alias). Empty if previously failed this session. */
export function resolveProviderIconId(providerId) {
  const id = normalizeId(providerId);
  if (!id) return "";
  if (failedIds.has(id)) return "";
  const aliased = ICON_ALIASES[id] || id;
  if (failedIds.has(aliased)) return "";
  return aliased;
}

/** `/providers/{id}.webp` or null when previously failed. */
export function getProviderIconSrc(providerId) {
  const id = resolveProviderIconId(providerId);
  return id ? `/providers/${id}.webp` : null;
}

/** Call from img onError so later mounts skip the request. */
export function markProviderIconMissing(providerId) {
  const id = normalizeId(providerId);
  if (id) failedIds.add(id);
  const aliased = ICON_ALIASES[id];
  if (aliased) failedIds.add(aliased);
}

const POPULAR_PROVIDERS = [
  "openai", "anthropic", "claude", "gemini", "github", "copilot", "cursor",
  "grok-cli", "kiro", "deepseek", "qwen", "mistral", "groq", "openrouter",
  "together", "cohere", "ollama", "cerebras", "sambanova", "fireworks",
  "siliconflow", "vllm", "vertex", "azure", "aws-polly", "deepgram", "elevenlabs",
  "searxng", "jina-ai", "tavily", "perplexing", "alicode", "cline", "roo", "kilo", "codex"
];

/** Non-blocking background preloader for provider icon webp images */
export function preloadProviderIcons(providerIds = POPULAR_PROVIDERS) {
  if (typeof window === "undefined") return;
  const schedule = window.requestIdleCallback || ((cb) => setTimeout(cb, 200));
  schedule(() => {
    for (const pId of providerIds) {
      const src = getProviderIconSrc(pId);
      if (src) {
        const img = new Image();
        img.src = src;
      }
    }
  });
}

