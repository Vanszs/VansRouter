// Free OpenCode models that don't use the "-free" id suffix
const KNOWN_FREE_OPENCODE_MODELS = ["big-pickle"];

// Upstream rejects these ids, so the dashboard must not suggest them. Measured
// through our own /v1/chat/completions on 2026-09-26:
//   deepseek-v4-flash-free   -> 503   muse-spark-1.2/1.3-contributor-free -> 200 (alive)
//   hy3-free                 -> 404   jev-1.13-free       -> 500 (served via
//   deepseek-v4.1-flash:free -> 404     /zen/v1/systemone, a lane this fork has no route for)
// space-bunny-free answers, so it stays offered. Re-measure before adding an id:
// a low max_tokens returns 400 about the token floor, which looks like a dead model.
const DEAD_FREE_OPENCODE_MODELS = new Set([
  "deepseek-v4-flash-free",
  "hy3-free",
  "jev-1.13-free",
  "deepseek-v4.1-flash:free",
]);

// NVIDIA NIM free-tier models whitelist.
// This is statically defined to prevent Next.js standalone dependency-splitting failures
// where the import of PROVIDERS from open-sse registry yields an empty object in production.
const NVIDIA_FREE_MODEL_IDS = new Set([
  "minimaxai/minimax-m2.7",
  "minimaxai/minimax-m3",
  "z-ai/glm-5.1",
  "z-ai/glm-5.2",
  "deepseek-ai/deepseek-v4-pro",
  "deepseek-ai/deepseek-v4-flash",
  "moonshotai/kimi-k2.6",
  "nvidia/nemotron-3-ultra-550b-a55b",
  "nvidia/nv-embedqa-e5-v5"
]);

export const FILTERS = {
  "openrouter-free": (models) =>
    models
      .filter(
        (m) =>
          m.pricing?.prompt === "0" &&
          m.pricing?.completion === "0" &&
          m.context_length >= 200000
      )
      .map((m) => ({ id: m.id, name: m.name, contextLength: m.context_length }))
      .sort((a, b) => b.contextLength - a.contextLength),

  "opencode-free": (models) =>
    models
      .filter((m) => (m.id?.endsWith("-free") || KNOWN_FREE_OPENCODE_MODELS.includes(m.id)) && !DEAD_FREE_OPENCODE_MODELS.has(m.id))
      .map((m) => ({ id: m.id, name: m.id })),

  // models.dev returns a large catalog; keep only mimo models
  "mimo-free": (models) =>
    (Array.isArray(models) ? models : [])
      .filter((m) => m.id?.startsWith("mimo") || m.name?.toLowerCase().includes("mimo"))
      .map((m) => ({ id: m.id, name: m.name || m.id })),

  // NVIDIA NIM: filter only free-tier models by ID whitelist.
  // The NVIDIA /v1/models endpoint does not expose pricing/is_free fields,
  // so we cannot filter server-side. Whitelist is the source of truth.
  "nvidia-free": (models) =>
    (Array.isArray(models) ? models : [])
      .filter((m) => m.id && NVIDIA_FREE_MODEL_IDS.has(m.id))
      .map((m) => {
        // Friendly display mapping for whitelisted models
        const friendlyNames = {
          "minimaxai/minimax-m2.7": "MiniMax M2.7",
          "minimaxai/minimax-m3": "MiniMax M3",
          "z-ai/glm-5.1": "GLM 5.1",
          "z-ai/glm-5.2": "GLM 5.2",
          "deepseek-ai/deepseek-v4-pro": "DeepSeek V4 Pro",
          "deepseek-ai/deepseek-v4-flash": "DeepSeek V4 Flash",
          "moonshotai/kimi-k2.6": "Kimi K2.6",
          "nvidia/nemotron-3-ultra-550b-a55b": "Nemotron 3 Ultra",
          "nvidia/nv-embedqa-e5-v5": "NV EmbedQA E5 v5"
        };
        return { id: m.id, name: friendlyNames[m.id] || m.id };
      }),
};
