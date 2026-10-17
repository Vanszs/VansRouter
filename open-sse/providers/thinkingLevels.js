// Resolve valid thinking levels per model — drives UI level picker (suffix "model(level)").
// Reuses capabilities.js (thinkingFormat/canDisable) so this file only maps format→levels (DRY).
import { getCapabilitiesForModel } from "./capabilities.js";
import { matchPattern } from "./pricing.js";
import { resolveKiroEffortPath } from "../config/kiroConstants.js";
import { getProviderModels } from "../config/providerModels.js";

// Shared level sets (deduped) — verified against provider docs + wire in thinkingUnified.applyFormat.
const L = {
  base: ["none", "low", "medium", "high"],                          // qwen, step, hunyuan, gemini-budget
  onOff: ["none", "thinking"],                                      // zai (binary), minimax (adaptive)
  openai: ["none", "minimal", "low", "medium", "high", "xhigh"],    // GPT-5.x / o-series (no "max")
  levelMax: ["none", "low", "medium", "high", "max"],               // kimi
  budgetX: ["none", "low", "medium", "high", "xhigh", "max"],       // claude-budget, claude-adaptive
  gemini: ["minimal", "low", "medium", "high"],                     // gemini-3 thinkingLevel (no disable)
  hiMax: ["none", "high", "max"],                                   // deepseek (low/med→high, xhigh→max)
};

// thinkingFormat → valid selectable levels (source of truth for UI options).
const FORMAT_LEVELS = {
  openai: L.openai,
  "claude-adaptive": L.budgetX,
  "claude-budget": L.budgetX,
  "gemini-level": L.gemini,
  "gemini-budget": L.base,
  zai: L.onOff,
  qwen: L.base,
  kimi: L.levelMax,
  deepseek: L.hiMax,
  commandcode: L.budgetX,
  minimax: L.onOff,
  hunyuan: L.base,
  step: L.base,
  nous: L.base,
};

const CODEX_GPT_5_6_LEVELS = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];

// Opus/Sonnet 4.6 lack xhigh (Anthropic + Kiro docs) — keep the 4-level+max set.
const CLAUDE_NO_XHIGH = ["none", "low", "medium", "high", "max"];

// Model-name pattern overrides (glob, first match wins) — more precise than format default.
const PATTERN_THINKING = [
  // Gemini 4 (Argon) rejects "minimal" with 400 — LOW is the floor; cannot disable thinking.
  { pattern: "*gemini-4*", levels: ["low", "medium", "high"] },
  { provider: "codex", pattern: "*gpt-5.6-sol*", levels: CODEX_GPT_5_6_LEVELS },
  { provider: "codex", pattern: "*gpt-5.6-terra*", levels: CODEX_GPT_5_6_LEVELS },
  { pattern: "*claude*4.6*", levels: CLAUDE_NO_XHIGH },
  { pattern: "*claude*4-6*", levels: CLAUDE_NO_XHIGH },
  // GPT-6.x takes the full effort ladder; the responses-lite Sol/Luna ids narrow
  // it to low..max through their registry `thinkingLevels`.
  { provider: "codex", pattern: "*gpt-6*", levels: CODEX_GPT_5_6_LEVELS },
  { provider: "codex", pattern: "*gpt-5.6-sol*", levels: [...CODEX_GPT_5_6_LEVELS, "ultra"] },
  { provider: "codex", pattern: "*gpt-5.6-terra*", levels: [...CODEX_GPT_5_6_LEVELS, "ultra"] },
  { provider: "codex", pattern: "*gpt-5.6-luna*", levels: CODEX_GPT_5_6_LEVELS },
  { pattern: "*gpt-5.6-sol*", levels: ["none", "minimal", "low", "medium", "high", "xhigh", "max"] },
  { pattern: "*codex*", levels: ["low", "medium", "high", "xhigh"] }, // codex cannot disable thinking
  // mimo-v2.5-pro/v2.6 on the opencode-go lane return 400 on reasoning_effort
  // "max" (probed live); plain mimo-v2.5 accepts it. Declaring the ceiling here
  // is what lets applyFormat's deepseek case clamp "max" down to "high".
  { pattern: "*mimo*v2.6*", levels: ["none", "low", "medium", "high", "xhigh"] },
  { pattern: "*mimo*v2.5-pro*", levels: ["none", "low", "medium", "high", "xhigh"] },
  // V4.1 Flash accepts real per-level effort on both routes (the older v4 family
  // only distinguishes high/max), so the picker exposes the full range.
  { provider: "deepseek", pattern: "*deepseek-v4.1-flash*", levels: ["none", "low", "medium", "high", "xhigh", "max"] },
  { provider: "ollama", pattern: "*deepseek-v4.1-flash*", levels: ["none", "low", "medium", "high", "xhigh", "max"] },
  // codebuddy-intl rides the same gateway catalog, so its deepseek levels match.
  { provider: "codebuddy-intl", pattern: "deepseek-v4*", levels: ["low", "high", "xhigh"] },
];

// Returns valid thinking levels for a model, or null when the model has no reasoning.
export function getThinkingLevels(provider, model) {
  if (provider === "kiro" && resolveKiroEffortPath(model) === null) return null;
  const caps = getCapabilitiesForModel(provider, model);
  if (!caps.reasoning) return null;
  // A registry entry that pins `thinkingLevels` wins over the glob: the Codex
  // responses-lite ids share a prefix with the full-ladder GPT-6 models but expose
  // fewer levels. `model(level)` suffixes are stripped so the picker resolves too.
  const baseId = String(model || "").replace(/\([^()]+\)\s*$/, "");
  const modelLevels = provider === "codex"
    ? getProviderModels("cx").find((entry) => entry.id === baseId)?.thinkingLevels
    : null;
  const hit = PATTERN_THINKING.find((entry) =>
    (!entry.provider || entry.provider === provider) && matchPattern(entry.pattern, model)
  );
  let levels = modelLevels || hit?.levels || FORMAT_LEVELS[caps.thinkingFormat] || L.base;
  if (caps.thinkingCanDisable === false) levels = levels.filter((l) => l !== "none");
  return levels;
}
