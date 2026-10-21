import { normalizeNousFreeModels } from "open-sse/services/nous.js";

const OPENCODE_FREE_MODEL_IDS = new Set([
  "beam-free",

  "mimo-v2.6-flash-free",
  "nemotron-3.5-super-vl-free",
  "deepseek-v4.1-flash-free",
  "glm-5.3-flash-free",
  "nemotron-3.5-lightning-free",
  "minimax-m3.1-flash-free",
]);

// No dead-model list: upstream's rejections are volatile and a hardcoded snapshot
// cannot expire. A bad id fails loudly on use instead. (One existed; it hid two
// live models and had an unreachable entry.)

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
      .filter((m) => OPENCODE_FREE_MODEL_IDS.has(m.id))
      .map((m) => ({ id: m.id, name: m.id })),

  // Go subscription catalogue — every /models id is selectable; the endpoint lane
  // per model is resolved by the family regex (see open-sse/providers/models/helpers.js)
  "opencode-go": (models) =>
    (Array.isArray(models) ? models : [])
      .filter((m) => typeof m?.id === "string")
      .map((m) => ({ id: m.id, name: m.id })),

  // models.dev returns a large catalog; keep only mimo models
  "mimo-free": (models) =>
    (Array.isArray(models) ? models : [])
      .filter((m) => m.id?.startsWith("mimo") || m.name?.toLowerCase().includes("mimo"))
      .map((m) => ({ id: m.id, name: m.name || m.id })),

  // MiniMax Code (mcode) live catalog: {providers:[{providerId:"minimax",
  // config:{models:{<id>:{name, limit, modalities, thinking_config}}}}]} —
  // arrives wrapped in a single-element array (see route normalization).
  "minimax-code": (raw) => {
    const env = Array.isArray(raw) ? raw[0] : raw;
    const p = (Array.isArray(env?.providers) ? env.providers : []).find((x) => x?.providerId === "minimax");
    const ms = p?.config?.models;
    if (!ms || typeof ms !== "object") return [];
    return Object.entries(ms)
      .filter(([id, m]) => typeof id === "string" && id.trim() !== "" && m && typeof m === "object")
      .map(([id, m]) => ({ id, name: m?.name || id, contextLength: Number(m?.limit?.context) || undefined }))
      .sort((a, b) => (b.contextLength || 0) - (a.contextLength || 0));
  },


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

  "nous-free": normalizeNousFreeModels,
};
