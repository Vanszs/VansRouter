// Model capabilities — what each model can read/do beyond plain text.
//
// Fallback order (first match wins), result merged over DEFAULT_CAPABILITIES:
//   1. PROVIDER_CAPABILITIES[provider][model]  — provider-specific override
//   2. MODEL_CAPABILITIES[model]               — canonical exact id (handles exceptions)
//   3. PATTERN_CAPABILITIES                     — glob match, ordered specific -> generic
//   4. DEFAULT_CAPABILITIES                     — safe floor (always returned)
//

// Two extra layers then refine the result:
//   • the synced catalog — modalities keyed by model, limits keyed by provider
//     + model, refreshed from models.dev in the background. It reads a file, so
//     the server installs it via setCatalogSource(); this module stays free of
//     node:fs because the dashboard bundles it into the browser too.
//   • visionPatterns.js — name-based vision detection, last resort so a model
//     nobody has catalogued yet still accepts images.
// Modalities only ever turn a capability ON. Limits from the catalog overlay
// the canonical exact entry (step 2) so a gateway-specific models.dev delta
// (Copilot's 32k Claude output, etc.) actually publishes. Step 1 still
// short-circuits: a hand-written PROVIDER_CAPABILITIES truncation is the
// gateway's own number and must not be overwritten.
//
// ── HOW TO ADD / UPDATE A MODEL ──────────────────────────────────────
// Authoritative data source: https://models.dev/api.json (145 providers, 4000+
// models, MIT). Each model exposes the exact fields we map below:
//   modalities.input  ["text","image","pdf","audio","video"] -> vision / pdf / audioInput / videoInput
//   modalities.output ["text","image","audio"]               -> imageOutput / audioOutput
//   reasoning   -> reasoning      tool_call    -> tools
//   limit.context -> contextWindow   limit.output -> maxOutput
// Look up the model id, then:
//   • If a PATTERN below already covers it correctly -> nothing to do.
//   • If it is an exception (pattern would mis-match) -> add an exact entry to
//     MODEL_CAPABILITIES (only the fields that differ from DEFAULT).
//   • If a whole new family -> add an ordered PATTERN (specific before generic).
// NOTE: models.dev has NO "search" flag (web search is a runtime tool, not a
// model spec); set `search` from vendor docs (Claude 4.x+, GPT-5.x/4o, Gemini
// 2.0+, Grok, Perplexity). Verify with: curl -s https://models.dev/api.json

import { matchPattern } from "./pricing.js";
import { looksLikeVisionModel } from "./visionPatterns.js";

/**
 * Safe floor — every resolved result is merged over this so consumers
 * never need null-checks. Most modern LLMs meet these limits.
 */
export const DEFAULT_CAPABILITIES = {
  // input modalities
  vision: false, // read images
  pdf: false, // read PDF / documents
  audioInput: false, // read audio
  videoInput: false, // read video
  // output modalities
  imageOutput: false, // generate images
  audioOutput: false, // generate audio
  // features
  search: false, // built-in web search tool / grounding
  tools: true, // function / tool calling
  reasoning: false, // thinking / reasoning
  // thinking wire format (only meaningful when reasoning:true). null → derive from transport.format.
  // enum: openai|claude-adaptive|claude-budget|gemini-level|gemini-budget|zai|qwen|deepseek|kimi|minimax|hunyuan|step|commandcode|nous
  thinkingFormat: null,
  thinkingCanDisable: true, // false → model cannot turn thinking off (clamp to min instead of disable)
  thinkingRange: null, // { min, max } for budget formats; null = no clamp
  thinkingEffortSupported: false, // zai format only: model accepts a reasoning_effort level (GLM-5.2+; older GLM ignores it)
  // limits (tokens)
  contextWindow: 200000,
  maxOutput: 64000,
};

// User-added model metadata can carry dashboard service kinds instead of the
// runtime capability names used here. Map those typed model kinds into input /
// output capabilities so custom vision models are not treated as text-only.
const SERVICE_KIND_CAPABILITIES = {
  imageToText: { vision: true },
  image: { imageOutput: true },
  stt: { audioInput: true },
  tts: { audioOutput: true },
  embedding: { tools: false },
};

export function capabilitiesFromServiceKind(kind) {
  return SERVICE_KIND_CAPABILITIES[kind] || null;
}

/**
 * Canonical exact-id overrides — used for exceptions that patterns would
 * otherwise mis-match. Only declare deltas vs DEFAULT.
 */
export const MODEL_CAPABILITIES = {
  // Claude Fable 5.1, Opus 5.5/5, 4.6/4.7/4.8 and Kiro Sonnet 5 have 1M context + adaptive thinking (override generic claude pattern)
  // Claude Opus 5.5 — experimental preview on Kiro (rateMultiplier: 2.0, 1M context) (#4410)
  "claude-opus-5.5": { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },
  "claude-opus-5.5-thinking": { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },
  "claude-opus-5.5-agentic": { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },
  "claude-opus-5.5-thinking-agentic": { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },
  "claude-opus-5": {
    vision: true,
    reasoning: true,
    search: true,
    thinkingFormat: "claude-adaptive",
    contextWindow: 1000000,
    maxOutput: 128000,
  },
  "claude-opus-5-thinking": {
    vision: true,
    reasoning: true,
    search: true,
    thinkingFormat: "claude-adaptive",
    contextWindow: 1000000,
    maxOutput: 128000,
  },
  "claude-opus-5-agentic": {
    vision: true,
    reasoning: true,
    search: true,
    thinkingFormat: "claude-adaptive",
    contextWindow: 1000000,
    maxOutput: 128000,
  },
  "claude-opus-5-thinking-agentic": {
    vision: true,
    reasoning: true,
    search: true,
    thinkingFormat: "claude-adaptive",
    contextWindow: 1000000,
    maxOutput: 128000,
  },
  "claude-opus-4.6": {
    vision: true,
    reasoning: true,
    search: true,
    thinkingFormat: "claude-adaptive",
    contextWindow: 1000000,
    maxOutput: 128000,
  },
  "claude-opus-4.7": {
    vision: true,
    reasoning: true,
    search: true,
    thinkingFormat: "claude-adaptive",
    contextWindow: 1000000,
    maxOutput: 128000,
  },
  "claude-opus-4-7": {
    vision: true,
    reasoning: true,
    search: true,
    thinkingFormat: "claude-adaptive",
    contextWindow: 1000000,
    maxOutput: 128000,
  },
  "claude-opus-4-6": {
    vision: true,
    reasoning: true,
    search: true,
    thinkingFormat: "claude-adaptive",
    contextWindow: 1000000,
    maxOutput: 128000,
  },
  "claude-opus-4-6-thinking": {
    vision: true,
    reasoning: true,
    search: true,
    thinkingFormat: "claude-adaptive",
    contextWindow: 1000000,
    maxOutput: 128000,
  },
  "claude-sonnet-4-6-thinking": {
    vision: true,
    reasoning: true,
    search: true,
    thinkingFormat: "claude-adaptive",
    contextWindow: 1000000,
    maxOutput: 128000,
  },
  "claude-opus-4.8": {
    vision: true,
    reasoning: true,
    search: true,
    thinkingFormat: "claude-adaptive",
    contextWindow: 1000000,
    maxOutput: 128000,
  },
  "claude-opus-4-8": {
    vision: true,
    reasoning: true,
    search: true,
    thinkingFormat: "claude-adaptive",
    contextWindow: 1000000,
    maxOutput: 128000,
  },
  "claude-opus-4.8-thinking": {
    vision: true,
    reasoning: true,
    search: true,
    thinkingFormat: "claude-adaptive",
    contextWindow: 1000000,
    maxOutput: 128000,
  },
  "claude-opus-4-8-thinking": {
    vision: true,
    reasoning: true,
    search: true,
    thinkingFormat: "claude-adaptive",
    contextWindow: 1000000,
    maxOutput: 128000,
  },
  "claude-sonnet-4.6": {
    vision: true,
    reasoning: true,
    search: true,
    thinkingFormat: "claude-adaptive",
    contextWindow: 1000000,
    maxOutput: 128000,
  },
  "claude-sonnet-4-6": {
    vision: true,
    reasoning: true,
    search: true,
    thinkingFormat: "claude-adaptive",
    contextWindow: 1000000,
    maxOutput: 128000,
  },
  "claude-sonnet-5": {
    vision: true,
    reasoning: true,
    search: true,
    thinkingFormat: "claude-adaptive",
    contextWindow: 1000000,
    maxOutput: 128000,
  },
  "claude-sonnet-5-thinking": {
    vision: true,
    reasoning: true,
    search: true,
    thinkingFormat: "claude-adaptive",
    contextWindow: 1000000,
    maxOutput: 128000,
  },
  "claude-sonnet-5-agentic": {
    vision: true,
    reasoning: true,
    search: true,
    thinkingFormat: "claude-adaptive",
    contextWindow: 1000000,
    maxOutput: 128000,
  },
  "claude-sonnet-5-thinking-agentic": {
    vision: true,
    reasoning: true,
    search: true,
    thinkingFormat: "claude-adaptive",
    contextWindow: 1000000,
    maxOutput: 128000,
  },
  "claude-fable-5-1": { vision: true, pdf: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", thinkingCanDisable: false, contextWindow: 1000000, maxOutput: 128000 },
  "claude-opus-5.5":                   { vision: true, pdf: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },
  "claude-opus-5.5-thinking":          { vision: true, pdf: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },
  "claude-opus-5.5-agentic":           { vision: true, pdf: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },
  "claude-opus-5.5-thinking-agentic":  { vision: true, pdf: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },
  // Opus 5.5 rejects thinking.type "disabled" and forced tool_choice (any/tool) with 400.
  "claude-opus-5-5":                   { vision: true, pdf: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000, thinkingCanDisable: false, forcedToolChoice: false },
  "claude-opus-5-5-thinking":          { vision: true, pdf: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000, thinkingCanDisable: false, forcedToolChoice: false },
  "claude-opus-5-5-high":              { vision: true, pdf: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000, thinkingCanDisable: false, forcedToolChoice: false },
  "claude-opus-5-5-medium":            { vision: true, pdf: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000, thinkingCanDisable: false, forcedToolChoice: false },
  "claude-opus-5-5-low":               { vision: true, pdf: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000, thinkingCanDisable: false, forcedToolChoice: false },
  "claude-opus-5":     { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },
  "claude-opus-5-thinking": { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },
  "claude-opus-5-agentic": { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },
  "claude-opus-5-thinking-agentic": { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },
  "claude-opus-4.6":   { vision: true, pdf: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },
  "claude-opus-4.7":   { vision: true, pdf: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },
  "claude-opus-4-7":   { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },
  "claude-opus-4.8":   { vision: true, pdf: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },
  "claude-opus-4-6":   { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },
  "claude-opus-4-8":   { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },
  "claude-opus-4.8-thinking": { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },
  "claude-opus-4-8-thinking": { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },
  "claude-sonnet-4.6": { vision: true, pdf: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },
  "claude-sonnet-4-6": { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },
  // Sonnet 5.5 rejects thinking.type "disabled" (use "between_tools") and forced tool_choice (any/tool).
  "claude-sonnet-5-5": { vision: true, pdf: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000, thinkingOffType: "between_tools", forcedToolChoice: false },
  "claude-sonnet-5-5-thinking": { vision: true, pdf: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000, thinkingOffType: "between_tools", forcedToolChoice: false },
  "claude-sonnet-5-5-high": { vision: true, pdf: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000, thinkingOffType: "between_tools", forcedToolChoice: false },
  "claude-sonnet-5-5-medium": { vision: true, pdf: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000, thinkingOffType: "between_tools", forcedToolChoice: false },
  "claude-sonnet-5-5-low": { vision: true, pdf: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000, thinkingOffType: "between_tools", forcedToolChoice: false },
  "claude-sonnet-5": { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },
  "claude-sonnet-5-thinking": { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },
  "claude-sonnet-5-agentic": { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },
  "claude-sonnet-5-thinking-agentic": { vision: true, reasoning: true, search: true, thinkingFormat: "claude-adaptive", contextWindow: 1000000, maxOutput: 128000 },

  // Gemini image-gen / OpenAI image / xai image variants
  "gpt-image-1": { imageOutput: true, tools: false },
  "gpt-image-2": { imageOutput: true, tools: false },
  "flux-2-pro": { imageOutput: true, tools: false },
  "venice-sd35": { imageOutput: true, tools: false },

  // GLM vision variants (text GLM has no vision) — 5.3-Flash is natively
  // multimodal per z.ai and carries the full 1M window.
  // thinkingCanDisable:false is REQUIRED, not a default: z.ai's docs state the
  // 5.3 line no longer supports disabling thinking and errors if thinking.type
  // is "disabled". Left true, applyThinking emitted enable_thinking:false on
  // turns that asked for no reasoning and z.ai answered 400 code 1210.
  "glm-5.3-flash": {
    vision: true,
    videoInput: true,
    pdf: true,
    reasoning: true,
    thinkingFormat: "zai",
    thinkingCanDisable: false,
    contextWindow: 1000000,
    maxOutput: 131072,
  },
  "glm-4.6v": {
    vision: true,
    videoInput: true,
    reasoning: true,
    thinkingFormat: "zai",
    contextWindow: 128000,
    maxOutput: 32768,
  },
  "glm-4.5v": {
    vision: true,
    videoInput: true,
    reasoning: true,
    thinkingFormat: "zai",
    contextWindow: 64000,
    maxOutput: 16384,
  },

  // DeepSeek's first V4 model with image input; text limits match V4-Flash.
  "deepseek-v4-flash-vision-exp": {
    vision: true,
    reasoning: true,
    thinkingFormat: "deepseek",
    contextWindow: 1000000,
    maxOutput: 384000,
  },
  // V4.1-Flash is natively multimodal (models.dev lists it with image input) and
  // the retired v4-flash / vision-exp ids route to it upstream, so the live id
  // carries the same image capability. "deepseek-flash" is the GA id on the
  // DeepSeek API and used to fall through to the generic *deepseek* pattern,
  // whose 128K/64K limits are repeated here: an exact entry short-circuits the
  // pattern table, so a vision-only delta would drop them.
  // Some providers (e.g. Kenari) expose this model under the hyphenated ID
  // "deepseek-v4-1-flash" (dash instead of dot); add it as an alias (#4293).
  "deepseek-v4-1-flash": { vision: true, reasoning: true, thinkingFormat: "deepseek", contextWindow: 1000000, maxOutput: 384000 },
  "deepseek-v4.1-flash": {
    vision: true,
    reasoning: true,
    thinkingFormat: "deepseek",
    contextWindow: 1000000,
    maxOutput: 384000,
  },
  "deepseek-v4.1-flash:free": {
    vision: true,
    reasoning: true,
    thinkingFormat: "deepseek",
    contextWindow: 1000000,
    maxOutput: 384000,
  },
  "deepseek-flash": {
    vision: true,
    reasoning: true,
    thinkingFormat: "deepseek",
    contextWindow: 128000,
    maxOutput: 64000,
  },

  // Qwen plain coder/text (no vision) — registry "vision-model" / "coder-model" aliases
  "vision-model": {
    vision: true,
    reasoning: true,
    thinkingFormat: "qwen",
    contextWindow: 1000000,
  },
  "coder-model": {
    reasoning: true,
    thinkingFormat: "qwen",
    contextWindow: 1000000,
  },

  // Kimi flagship + coding (platform + Kimi Code ids) — vision/video native
  // ── OpenCode Free (reasoning: true in models.dev, ids newer than the tables above) ──
  // Without these entries getCapabilitiesForModel() falls through to
  // DEFAULT_CAPABILITIES (reasoning: false) and applyThinking() strips the client's
  // reasoning_effort before it reaches the upstream — see #2690.
  // Modalities and limits below are taken verbatim from models.dev/api.json.
  "big-pickle":        { reasoning: true, thinkingFormat: "openai", contextWindow: 200000, maxOutput: 32000 },
  "beam-free":         { reasoning: true, thinkingFormat: "openai", contextWindow: 1048576, maxOutput: 131072 },

  "mimo-v2.6-flash-free": { vision: true, audioInput: true, videoInput: true, reasoning: true, thinkingFormat: "openai", contextWindow: 200000, maxOutput: 32000 },
  "nemotron-3.5-super-vl-free": { vision: true, reasoning: true, thinkingFormat: "openai", contextWindow: 1048576, maxOutput: 131072 },
  "nemotron-3.5-lightning-free": { reasoning: true, thinkingFormat: "openai", contextWindow: 262144, maxOutput: 262144 },
  "deepseek-v4.1-flash-free": { vision: true, reasoning: true, thinkingFormat: "deepseek", contextWindow: 200000, maxOutput: 32000 },
  "glm-5.3-flash-free": { vision: true, videoInput: true, pdf: true, reasoning: true, thinkingFormat: "openai", contextWindow: 200000, maxOutput: 32000 },
  "minimax-m3.1-flash-free": { vision: true, videoInput: true, reasoning: true, thinkingFormat: "openai", contextWindow: 1000000, maxOutput: 512000 },
  "exo-free":          { vision: true, reasoning: true, thinkingFormat: "openai", contextWindow: 1048576, maxOutput: 131072 },
  "fledge-alpha-free": { vision: true, reasoning: true, thinkingFormat: "openai", contextWindow: 1048576, maxOutput: 131072 },
  "longcat-2.0":             { reasoning: true, thinkingFormat: "openai", contextWindow: 1000000, maxOutput: 131072 },
  "longcat-2.0-free":        { reasoning: true, thinkingFormat: "openai", contextWindow: 1000000, maxOutput: 131072 },
  "north-mini-code-free":    { reasoning: true, thinkingFormat: "openai", contextWindow: 256000, maxOutput: 64000 },
  "ring-2.6-1t-free":        { reasoning: true, thinkingFormat: "openai", contextWindow: 262000, maxOutput: 66000 },
  "x-preview-f-free":        { vision: true, videoInput: true, reasoning: true, thinkingFormat: "openai", contextWindow: 1000000, maxOutput: 131072 },

  "kimi-k3": {
    vision: true,
    videoInput: true,
    reasoning: true,
    thinkingFormat: "kimi",
    thinkingCanDisable: false,
    contextWindow: 1048576,
    maxOutput: 131072,
  },
  k3: {
    vision: true,
    videoInput: true,
    reasoning: true,
    thinkingFormat: "kimi",
    thinkingCanDisable: false,
    contextWindow: 1048576,
    maxOutput: 131072,
  },
  "kimi-for-coding": {
    vision: true,
    videoInput: true,
    reasoning: true,
    thinkingFormat: "kimi",
    thinkingCanDisable: false,
    contextWindow: 262144,
    maxOutput: 65536,
  },
  "kimi-for-coding-highspeed": {
    vision: true,
    videoInput: true,
    reasoning: true,
    thinkingFormat: "kimi",
    thinkingCanDisable: false,
    contextWindow: 262144,
    maxOutput: 65536,
  },
  "kimi-k2.7-code": {
    vision: true,
    videoInput: true,
    reasoning: true,
    thinkingFormat: "kimi",
    thinkingCanDisable: false,
    contextWindow: 262144,
    maxOutput: 65536,
  },
  "kimi-k2.7-code-highspeed": {
    vision: true,
    videoInput: true,
    reasoning: true,
    thinkingFormat: "kimi",
    thinkingCanDisable: false,
    contextWindow: 262144,
    maxOutput: 65536,
  },
  // OpenCode Go Muse Spark — same Responses reasoning shape as the free tier.
  "muse-spark-1.2-contributor": {
    reasoning: true,
    thinkingFormat: "openai",
    contextWindow: 1048576,
    maxOutput: 131072,
  },
  "muse-spark-1.3-contributor": {
    reasoning: true,
    thinkingFormat: "openai",
    contextWindow: 1048576,
    maxOutput: 131072,
  },
  "grok-4.6": {
    reasoning: true,
    thinkingFormat: "openai",
    contextWindow: 500000,
    maxOutput: 500000,
  },};

const KIRO_GPT_5_6_CAPABILITIES = {
  vision: true,
  reasoning: true,
  search: true,
  thinkingFormat: "openai",
  contextWindow: 272000,
  maxOutput: 128000,
};
const CODEX_GPT_56_SOL_CAPS = {
  vision: true,
  reasoning: true,
  search: true,
  thinkingFormat: "openai",
  contextWindow: 372000,
  maxOutput: 128000,
};
const CODEX_GPT_56_DEFAULT_CAPS = {
  vision: true,
  reasoning: true,
  search: true,
  thinkingFormat: "openai",
  contextWindow: 272000,
  maxOutput: 128000,
};
const CODEX_EXTENDED_CAPS = { ...CODEX_GPT_56_DEFAULT_CAPS, contextWindow: 872000 };

// Devin CLI's registry declares a 200k context window for these GPT variants.
// Keep the GPT feature/output fields because provider overrides short-circuit
// the generic pattern rather than merging with it.
const DEVIN_CLI_GPT_CAPS = { vision: true, reasoning: true, search: true, thinkingFormat: "openai", contextWindow: 200000, maxOutput: 128000 };

/**
 * Provider-specific capability overrides. Keyed by provider alias/id.
 */
export const PROVIDER_CAPABILITIES = {
  // Hive AI — OpenAI-compatible endpoints with 1M context, vision/multimodal, tools.
  // Keyed by the bare model id; the upstream "vendor/model" form resolves through
  // the baseModel fallback in getCapabilitiesForModel.
  // Verified live: reasoning_content streams on every turn regardless of request
  // params (reasoning_effort / thinking / enable_thinking are all accepted and
  // ignored), so thinking cannot be turned off.
  hive: {
    "deepseek-v4.1-flash": {
      vision: true,
      reasoning: true,
      thinkingFormat: "openai",
      thinkingCanDisable: false,
      contextWindow: 1000000,
    },
    "glm-5.3-flash": {
      vision: true,
      videoInput: true,
      reasoning: true,
      thinkingFormat: "openai",
      thinkingCanDisable: false,
      contextWindow: 1000000,
      // Verified live 2026-10-01 through /v1/chat/completions against
      // api.thehive.ai: the stream closes with finish_reason "tool_calls" after
      // a single delta that carries function.name and no arguments at all
      // (completion_tokens: 1). The same route preserves arguments for
      // hive/deepseek-v4.1-flash, so this is upstream, not the translator.
      tools: false,
    },
  },
  // Kimchi provider — exactly the 4 models advertised by the Kimchi CLI.
  // Kimi entries copied from the official Kimchi CLI catalog
  // (https://models.dev/api.json, provider "moonshotai").
  kimchi: {
    "kimi-k2.7": {
      vision: true,
      videoInput: true,
      reasoning: true,
      thinkingFormat: "kimi",
      thinkingCanDisable: false,
      contextWindow: 262144,
      maxOutput: 262144,
      structuredOutput: true,
      supportsTemperature: false,
    },
    "minimax-m3": {
      vision: true,
      reasoning: true,
      thinkingFormat: "minimax",
      contextWindow: 1048576,
      maxOutput: 512000,
    },
    "nemotron-3-ultra-fp4": {
      reasoning: false,
      contextWindow: 128000,
      maxOutput: 8192,
    },
    "deepseek-v4-flash": {
      vision: true,
      reasoning: true,
      thinkingFormat: "deepseek",
      thinkingCanDisable: false,
      contextWindow: 1000000,
      maxOutput: 50000,
    },
  },
  // AgentRouter — multi-model gateway (Claude format).
  agentrouter: {
    "claude-opus-4-6": {
      vision: true,
      reasoning: true,
      thinkingFormat: "claude-adaptive",
      contextWindow: 1000000,
      maxOutput: 128000,
      search: true,
    },
    "claude-opus-4-7": {
      vision: true,
      reasoning: true,
      thinkingFormat: "claude-adaptive",
      contextWindow: 1000000,
      maxOutput: 128000,
      search: true,
    },
    "claude-opus-4-8": {
      vision: true,
      reasoning: true,
      thinkingFormat: "claude-adaptive",
      contextWindow: 1000000,
      maxOutput: 128000,
      search: true,
    },
    "glm-5.2": {
      reasoning: true,
      thinkingFormat: "claude-budget",
      thinkingCanDisable: true,
      contextWindow: 128000,
      maxOutput: 128000,
    },
    "gpt-5.5": {
      reasoning: true,
      thinkingFormat: "openai",
      thinkingCanDisable: true,
      contextWindow: 256000,
      maxOutput: 128000,
    },
  },
  // NVIDIA NIM is OpenAI-compatible → rejects MiniMax/GLM native `thinking` field.
  // Force openai reasoning_effort format for its reasoning models. #issue
  nvidia: {
    "minimaxai/minimax-m2.7": {
      reasoning: true,
      thinkingFormat: "openai",
      thinkingCanDisable: false,
      contextWindow: 200000,
      maxOutput: 131072,
    },
    "minimaxai/minimax-m3": {
      vision: true,
      reasoning: true,
      thinkingFormat: "openai",
      thinkingCanDisable: false,
      contextWindow: 512000,
      maxOutput: 131072,
    },
    "z-ai/glm-5.2": {
      reasoning: true,
      thinkingFormat: "openai",
      contextWindow: 200000,
      maxOutput: 128000,
    },
    "deepseek-ai/deepseek-v4-pro": {
      reasoning: true,
      thinkingFormat: "openai",
      contextWindow: 1000000,
      maxOutput: 65536,
    },
    "deepseek-ai/deepseek-v4-flash": {
      reasoning: true,
      thinkingFormat: "openai",
      contextWindow: 1000000,
      maxOutput: 65536,
    },
  },
  // glm-5.3-flash on OpenCode Go is served by a backend that rejects the z.ai
  // `thinking` object (400: unknown field "thinking") and wants reasoning_effort.
  // Overrides the global entry, whose z.ai shape is correct for z.ai itself.
  "opencode-go": {
    "glm-5.3-flash": {
      vision: true,
      videoInput: true,
      pdf: true,
      reasoning: true,
      thinkingFormat: "openai",
      thinkingCanDisable: false,
      contextWindow: 1000000,
      maxOutput: 131072,
    },
  },
  codex: {
    "gpt-6-astra": { vision: true, reasoning: true, search: true, thinkingFormat: "openai", contextWindow: 272000, maxOutput: 128000 },
    "gpt-6.1-sol": { vision: true, reasoning: true, search: true, thinkingFormat: "openai", contextWindow: 272000, maxOutput: 128000 },
    "gpt-6-sol": { vision: true, reasoning: true, search: true, thinkingFormat: "openai", contextWindow: 272000, maxOutput: 128000 },
    "gpt-6-luna": { vision: true, reasoning: true, search: true, thinkingFormat: "openai", contextWindow: 272000, maxOutput: 128000 },
    "gpt-5.6-sol": CODEX_GPT_56_SOL_CAPS,
    "gpt-5.6-sol-review": CODEX_GPT_56_SOL_CAPS,
    "gpt-5.6-terra": CODEX_GPT_56_DEFAULT_CAPS,
    "gpt-5.6-terra-review": CODEX_GPT_56_DEFAULT_CAPS,
    "gpt-5.6-luna": CODEX_GPT_56_DEFAULT_CAPS,
    "gpt-5.6-luna-review": CODEX_GPT_56_DEFAULT_CAPS,
    "gpt-6-astra[1m]":           CODEX_EXTENDED_CAPS,
    "gpt-6-sol[1m]":             CODEX_EXTENDED_CAPS,
    "gpt-6-luna[1m]":            CODEX_EXTENDED_CAPS,
    "gpt-5.6-sol[1m]":           CODEX_EXTENDED_CAPS,
    "gpt-5.6-terra[1m]":         CODEX_EXTENDED_CAPS,
    "gpt-5.6-luna[1m]":          CODEX_EXTENDED_CAPS,
  },
  kiro: {
    "gpt-5.6-sol": KIRO_GPT_5_6_CAPABILITIES,
    "gpt-5.6-terra": KIRO_GPT_5_6_CAPABILITIES,
    "gpt-5.6-luna": KIRO_GPT_5_6_CAPABILITIES,
    "gpt-5.6-sol-thinking": KIRO_GPT_5_6_CAPABILITIES,
    "gpt-5.6-terra-thinking": KIRO_GPT_5_6_CAPABILITIES,
    "gpt-5.6-luna-thinking": KIRO_GPT_5_6_CAPABILITIES,
    "gpt-5.6-sol-agentic": KIRO_GPT_5_6_CAPABILITIES,
    "gpt-5.6-terra-agentic": KIRO_GPT_5_6_CAPABILITIES,
    "gpt-5.6-luna-agentic": KIRO_GPT_5_6_CAPABILITIES,
    "gpt-5.6-sol-thinking-agentic": KIRO_GPT_5_6_CAPABILITIES,
    "gpt-5.6-terra-thinking-agentic": KIRO_GPT_5_6_CAPABILITIES,
    "gpt-5.6-luna-thinking-agentic": KIRO_GPT_5_6_CAPABILITIES,
  },
  "devin-cli": {
    "gpt-5.4-high": DEVIN_CLI_GPT_CAPS,
    "gpt-5.4-medium": DEVIN_CLI_GPT_CAPS,
    "gpt-5.4-low": DEVIN_CLI_GPT_CAPS,
    "gpt-5.5-xhigh": DEVIN_CLI_GPT_CAPS,
    "gpt-5.5-high": DEVIN_CLI_GPT_CAPS,
    "gpt-5.5-medium": DEVIN_CLI_GPT_CAPS,
    "gpt-5.5-low": DEVIN_CLI_GPT_CAPS,
  },
  // CodeBuddy.cn — authoritative per-model metadata from the gateway's model
  // config (contextWindow=maxInputTokens, maxOutput=maxOutputTokens, vision=
  // supportsImages). Every model reasons via OpenAI-style reasoning_effort
  // (see registry thinkingFormat). `onlyReasoning` models can't turn thinking
  // off → thinkingCanDisable:false (clamped to minimal instead of disabled).
  "codebuddy-cn": {
    "glm-5.2":            { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: true, contextWindow: 1000000, maxOutput: 131072 },
    "glm-5.1":            { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 200000, maxOutput: 48000 },
    "glm-5.0":            { reasoning: true, thinkingFormat: "openai", contextWindow: 200000, maxOutput: 48000 },
    // maxOutput 64000 per both the plugin-baked fallback and the live server
    // table (the old 38000 had no source and truncated output).
    "glm-4.7":            { reasoning: true, thinkingFormat: "openai", contextWindow: 200000, maxOutput: 48000 },
    "minimax-m3":         { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 512000, maxOutput: 524288 },
    "kimi-k2.5":          { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 164000, maxOutput: 32000 },
    "hy3-preview":        { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 192000, maxOutput: 64000 },
    "deepseek-v4-flash":  { reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 1000000, maxOutput: 50000 },
    "deepseek-v3-2-volc": { reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 96000, maxOutput: 32000 },
    // Per-model values mirror the server's product-config payload (the plugin
    // fetches it from copilot.tencent.com; the `models[]` entries carry
    // maxInputTokens/maxOutputTokens/supportsImages). contextWindow =
    // maxInputTokens, maxOutput = maxOutputTokens. Where the server and the
    // plugin-baked fallback disagree, the server table wins.
    // ⚠️ thinkingCanDisable maps to the server's reasoning.canDisableThinking —
    // it is NOT the inverse of onlyReasoning. onlyReasoning means "thinking is
    // on by default"; canDisableThinking means "it CAN be turned off". glm-5.3
    // and glm-5.3-flash are onlyReasoning:true BUT canDisableThinking:true, so
    // their thinking is switchable; the hy* models are forced always-on.
    "hy3":                { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 192000, maxOutput: 64000 },
    "hy4-preview":        { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 1000000, maxOutput: 64000 },
    "glm-5.3":            { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: true, contextWindow: 1000000, maxOutput: 131072 },
    "glm-5.3-flash":      { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: true, contextWindow: 1000000, maxOutput: 131072 },
    "kimi-k3-1":          { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: false, contextWindow: 1000000, maxOutput: 1048576 },
    // contextWindow is the server's contextWindow.defaultLength (300000), NOT
    // maxInputTokens — k2.8 publishes supportedLengths [300000, 1000000] and the
    // gateway only gives 1M when the request opts in (this executor never does).
    // Using 1000000 here would let the capacity adapter budget history for a
    // window the model doesn't actually have.
    "kimi-k2.8-preview":  { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: true, contextWindow: 300000, maxOutput: 131072 },
    "deepseek-v4-pro":    { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: true, contextWindow: 1000000, maxOutput: 393216 },
    // deepseek-v4.1-flash replaced v4-flash on the server list. The 2026-09-30
    // snapshot raised maxOutput to 393216 (matching v4-pro) and changed the
    // published efforts from low/high/xhigh to low/high/max.
    "deepseek-v4.1-flash": { vision: true, reasoning: true, thinkingFormat: "openai", thinkingCanDisable: true, contextWindow: 1000000, maxOutput: 393216 },
  },
  // CodeBuddy intl — same gateway catalog as CN, so deepseek-v4.1-flash mirrors
  // the codebuddy-cn entry (the openai-style reasoning_effort format matters:
  // the generic *deepseek-v4* pattern would otherwise pick the vendor-native
  // "deepseek" thinking shape, which the CodeBuddy gateway does not accept).
  "codebuddy-intl": {
    "deepseek-v4.1-flash": {
      vision: true,
      reasoning: true,
      thinkingFormat: "openai",
      thinkingCanDisable: true,
      contextWindow: 1000000,
      maxOutput: 128000,
    },
  },
  // ClinePass proxies through Vercel's OpenAI Chat Completions API, which only
  // accepts reasoning.effort in {none,minimal,low,medium,high,xhigh}. Force
  // "openai" so thinkingUnified.js emits valid Vercel enum values.
  clinepass: {
    "deepseek-v4-pro": {
      reasoning: true,
      thinkingFormat: "openai",
      thinkingCanDisable: false,
      contextWindow: 1000000,
      maxOutput: 50000,
    },
    "deepseek-v4-flash": {
      reasoning: true,
      thinkingFormat: "openai",
      thinkingCanDisable: false,
      contextWindow: 1000000,
      maxOutput: 50000,
    },
  },
  kimi: {
    "kimi-k2.7": {
      vision: true,
      reasoning: true,
      thinkingFormat: "kimi",
      thinkingCanDisable: true,
      contextWindow: 262144,
      maxOutput: 262144,
    },
    "kimi-k2.6": {
      vision: true,
      reasoning: true,
      thinkingFormat: "kimi",
      thinkingCanDisable: true,
      contextWindow: 262144,
      maxOutput: 262144,
    },
  },
  // DeepSeek V4.1 Flash reads images and takes the full low..max effort range
  // (see PATTERN_THINKING); the shared *deepseek-v4* pattern carries neither flag.
  deepseek: {
    "deepseek-v4.1-flash": {
      vision: true,
      reasoning: true,
      thinkingFormat: "deepseek",
      thinkingEffortSupported: true,
      contextWindow: 1000000,
      maxOutput: 128000,
    },
  },
  // Ollama Cloud serves the same model (mirrored tag) with image input.
  ollama: {
    "deepseek-v4.1-flash:cloud": {
      vision: true,
      reasoning: true,
      thinkingFormat: "deepseek",
      contextWindow: 1000000,
      maxOutput: 384000,
    },
  },
  // Nous Research Portal free-tier models (probed live against https://inference-api.nousresearch.com/v1/models).
  "nous": {
    "meituan/longcat-2.0:free":         { tools: true, reasoning: true, thinkingFormat: "nous", contextWindow: 1048756, maxOutput: 262144 },
    "meituan/longcat-2.5-preview:free": { tools: true, vision: true, reasoning: true, thinkingFormat: "nous", contextWindow: 1048576, maxOutput: 131072 },
    "stepfun/step-5-preview:free":      { tools: true, vision: true, videoInput: true, reasoning: true, thinkingFormat: "nous", contextWindow: 1000000, maxOutput: 64000 },
    "upstage/solar-mini4:free":         { tools: true, reasoning: true, thinkingFormat: "nous", contextWindow: 524288, maxOutput: 131072 },
    "stepfun/step-3.7-flash:free":      { tools: true, vision: true, videoInput: true, reasoning: true, thinkingFormat: "nous", contextWindow: 262144, maxOutput: 256000 },
    "poolside/laguna-s-2.1:free":       { tools: true, reasoning: true, thinkingFormat: "nous", contextWindow: 262144, maxOutput: 131072 },
    "poolside/laguna-xs-2.1:free":      { tools: true, reasoning: true, thinkingFormat: "nous", contextWindow: 262144, maxOutput: 32768 },
    "stealth/missingno":                { tools: true, reasoning: true, thinkingFormat: "nous", contextWindow: 262144, maxOutput: 131072 },
  },
  // MiniMax Code (mcode) credits lane — Anthropic messages on mavis; thinking
  // is adaptive effort via output_config (claude-adaptive). Limits from
  // magpie's minimax plugin static catalog (live probes pending). M2.7 pair
  // always thinks and takes no effort knob in MiniMax Code itself.
  "minimax-code": {
    "MiniMax-M3.1-Flash-Preview": { vision: true, reasoning: true, thinkingFormat: "claude-adaptive", thinkingCanDisable: false, contextWindow: 512000, maxOutput: 128000 },
    "MiniMax-M3":                 { vision: true, reasoning: true, thinkingFormat: "claude-adaptive", contextWindow: 512000, maxOutput: 128000 },
    "MiniMax-M2.7":               { reasoning: true, thinkingFormat: "claude-adaptive", thinkingCanDisable: false, contextWindow: 200000, maxOutput: 128000 },
    "MiniMax-M2.7-highspeed":     { reasoning: true, thinkingFormat: "claude-adaptive", thinkingCanDisable: false, contextWindow: 200000, maxOutput: 128000 },
  },
};

// Qoder CN serves the identical model catalog from the CN gateway, so it shares
// the intl Qoder capability table verbatim (vision/reasoning/contextWindow).
PROVIDER_CAPABILITIES["qoder-cn"] = PROVIDER_CAPABILITIES["qoder"];
PROVIDER_CAPABILITIES.cx = PROVIDER_CAPABILITIES.codex;
PROVIDER_CAPABILITIES.dv = PROVIDER_CAPABILITIES["devin-cli"];
PROVIDER_CAPABILITIES.devin = PROVIDER_CAPABILITIES["devin-cli"];
// The global mcode site serves the same catalog — share the capability table.
PROVIDER_CAPABILITIES["minimax-code-global"] = PROVIDER_CAPABILITIES["minimax-code"];

/**
 * Pattern fallback — glob (* = wildcard), matched case-insensitively and
 * anchored (^...$) so a pattern must match the full model id. ORDER MATTERS:
 * vision/specific variants first, text-only/generic families last, to avoid
 * a broad family pattern swallowing an exception (e.g. glm-4.6v vs glm-5).
 */
export const PATTERN_CAPABILITIES = [
  // ── Claude (4.6+ = adaptive thinking; older/haiku = budget) ──────
  {
    pattern: "*claude*opus-5*",
    caps: {
      vision: true,
      reasoning: true,
      search: true,
      thinkingFormat: "claude-adaptive",
      contextWindow: 1000000,
      maxOutput: 128000,
    },
  },
  {
    pattern: "*claude*opus-4.6*",
    caps: {
      vision: true,
      reasoning: true,
      search: true,
      thinkingFormat: "claude-adaptive",
    },
  },
  {
    pattern: "*claude*opus-4-6*",
    caps: {
      vision: true,
      reasoning: true,
      search: true,
      thinkingFormat: "claude-adaptive",
    },
  },
  {
    pattern: "*claude*opus-4.7*",
    caps: {
      vision: true,
      reasoning: true,
      search: true,
      thinkingFormat: "claude-adaptive",
    },
  },
  {
    pattern: "*claude*opus-4.8*",
    caps: {
      vision: true,
      reasoning: true,
      search: true,
      thinkingFormat: "claude-adaptive",
    },
  },
  {
    pattern: "*claude*sonnet-4.6*",
    caps: {
      vision: true,
      reasoning: true,
      search: true,
      thinkingFormat: "claude-adaptive",
    },
  },
  {
    pattern: "*claude*sonnet-4-6*",
    caps: {
      vision: true,
      reasoning: true,
      search: true,
      thinkingFormat: "claude-adaptive",
    },
  },
  {
    pattern: "*claude*sonnet-4.7*",
    caps: {
      vision: true,
      reasoning: true,
      search: true,
      thinkingFormat: "claude-adaptive",
    },
  },
  {
    pattern: "*claude*haiku*",
    caps: {
      vision: true,
      reasoning: true,
      search: true,
      thinkingFormat: "claude-budget",
    },
  },
  {
    pattern: "*claude*opus*",
    caps: {
      vision: true,
      reasoning: true,
      search: true,
      thinkingFormat: "claude-budget",
    },
  },
  {
    // Sonnet 5.x (5, 5.5) takes adaptive thinking and the 1M window; both the
    // dotted and hyphenated spellings must land here, ahead of the generic
    // *claude*sonnet* rule that would otherwise send a thinking budget.
    pattern: "*claude*sonnet-5*",
    caps: {
      vision: true,
      reasoning: true,
      search: true,
      thinkingFormat: "claude-adaptive",
      contextWindow: 1000000,
      maxOutput: 128000,
    },
  },
  {
    pattern: "*claude*sonnet*",
    caps: {
      vision: true,
      reasoning: true,
      search: true,
      thinkingFormat: "claude-budget",
    },
  },
  {
    pattern: "*claude*fable*",
    caps: {
      vision: true,
      reasoning: true,
      search: true,
      thinkingFormat: "claude-budget",
      contextWindow: 1000000,
      maxOutput: 128000,
    },
  },
  {
    pattern: "*claude*mythos*",
    caps: {
      vision: true,
      reasoning: true,
      search: true,
      thinkingFormat: "claude-budget",
      contextWindow: 1000000,
      maxOutput: 128000,
    },
  },
  { pattern: "*claude-3*", caps: { vision: true } },
  {
    pattern: "*claude*",
    caps: {
      vision: true,
      reasoning: true,
      search: true,
      thinkingFormat: "claude-budget",
    },
  },

  // ── Gemini (all 2.0+ multimodal + google_search grounding, 1M ctx) ─
  {
    pattern: "*gemini*image*",
    caps: { vision: true, imageOutput: true, contextWindow: 1048576 },
  },
  // Gemini 4 (Argon): no "minimal" tier (400) and no thinkingBudget — LOW/MEDIUM/HIGH only, cannot disable.
  // This block is the one that matches first (see the duplicate compact block further
  // down), so new gemini generations have to be registered here as well.
  {
    pattern: "*gemini-4*",
    caps: {
      vision: true,
      audioInput: true,
      videoInput: true,
      reasoning: true,
      search: true,
      thinkingFormat: "gemini-level",
      thinkingCanDisable: false,
      contextWindow: 1048576,
      maxOutput: 65536,
    },
  },
  {
    pattern: "*gemini-3.8*",
    caps: {
      vision: true,
      audioInput: true,
      videoInput: true,
      reasoning: true,
      search: true,
      thinkingFormat: "gemini-level",
      thinkingCanDisable: false,
      contextWindow: 1048576,
      maxOutput: 65536,
    },
  },
  {
    pattern: "*gemini-3.7*",
    caps: {
      vision: true,
      audioInput: true,
      videoInput: true,
      reasoning: true,
      search: true,
      thinkingFormat: "gemini-level",
      thinkingCanDisable: false,
      contextWindow: 1048576,
      maxOutput: 65536,
    },
  },
  {
    pattern: "*gemini-3*pro*",
    caps: {
      vision: true,
      audioInput: true,
      videoInput: true,
      reasoning: true,
      search: true,
      thinkingFormat: "gemini-level",
      thinkingCanDisable: false,
      contextWindow: 1048576,
      maxOutput: 65535,
    },
  },
  {
    pattern: "*gemini-3*",
    caps: {
      vision: true,
      audioInput: true,
      videoInput: true,
      reasoning: true,
      search: true,
      thinkingFormat: "gemini-level",
      thinkingCanDisable: false,
      contextWindow: 1048576,
      maxOutput: 65536,
    },
  },
  {
    pattern: "*gemini-2.5*",
    caps: {
      vision: true,
      audioInput: true,
      videoInput: true,
      reasoning: true,
      search: true,
      thinkingFormat: "gemini-budget",
      thinkingRange: { min: 0, max: 24576 },
      contextWindow: 1048576,
      maxOutput: 65536,
    },
  },
  {
    pattern: "*gemini-2*",
    caps: {
      vision: true,
      audioInput: true,
      videoInput: true,
      search: true,
      contextWindow: 1048576,
      maxOutput: 65536,
    },
  },
  {
    pattern: "*gemini*",
    caps: { vision: true, search: true, contextWindow: 1048576 },
  },
  { pattern: "*gemma*", caps: { vision: true, contextWindow: 128000 } },
  { pattern: "*nanobanana*", caps: { vision: true, imageOutput: true } },

  // ── OpenAI GPT-5.x (vision + thinking + web search) ──────────────
  { pattern: "*gpt-5*image*", caps: { imageOutput: true } },
  {
    pattern: "*gpt-5*codex*",
    caps: {
      reasoning: true,
      search: true,
      thinkingFormat: "openai",
      contextWindow: 400000,
      maxOutput: 128000,
    },
  },
  {
    pattern: "*gpt-5-[0-3]*",
    caps: {
      vision: true,
      reasoning: true,
      search: true,
      thinkingFormat: "openai",
      contextWindow: 400000,
      maxOutput: 128000,
    },
  },
  {
    pattern: "*gpt-4o*",
    caps: {
      vision: true,
      search: true,
      contextWindow: 128000,
      maxOutput: 16384,
    },
  },
  {
    pattern: "*gpt-4.1*",
    caps: { vision: true, contextWindow: 1000000, maxOutput: 32768 },
  },
  { pattern: "*gpt-4-turbo*", caps: { vision: true, contextWindow: 128000 } },
  { pattern: "*gpt-4*", caps: { contextWindow: 128000 } },
  { pattern: "*gpt-3.5*", caps: { contextWindow: 16385, maxOutput: 4096 } },
  {
    pattern: "*gpt-oss*",
    caps: { reasoning: true, thinkingFormat: "openai", contextWindow: 128000 },
  },
  { pattern: "*gemini*image*",  caps: { vision: true, imageOutput: true, contextWindow: 1048576 } },
  // Gemini 4 (Argon): no "minimal" tier (400) and no thinkingBudget — LOW/MEDIUM/HIGH only, cannot disable.
  { pattern: "*gemini-4*",      caps: { vision: true, audioInput: true, videoInput: true, reasoning: true, search: true, thinkingFormat: "gemini-level", thinkingCanDisable: false, contextWindow: 1048576, maxOutput: 65536 } },
  { pattern: "*gemini-3.8*",    caps: { vision: true, audioInput: true, videoInput: true, reasoning: true, search: true, thinkingFormat: "gemini-level", thinkingCanDisable: false, contextWindow: 1048576, maxOutput: 65536 } },
  { pattern: "*gemini-3.7*",    caps: { vision: true, audioInput: true, videoInput: true, reasoning: true, search: true, thinkingFormat: "gemini-level", thinkingCanDisable: false, contextWindow: 1048576, maxOutput: 65536 } },
  { pattern: "*gemini-3*pro*",  caps: { vision: true, audioInput: true, videoInput: true, reasoning: true, search: true, thinkingFormat: "gemini-level", thinkingCanDisable: false, contextWindow: 1048576, maxOutput: 65535 } },
  { pattern: "*gemini-3*",      caps: { vision: true, audioInput: true, videoInput: true, reasoning: true, search: true, thinkingFormat: "gemini-level", thinkingCanDisable: false, contextWindow: 1048576, maxOutput: 65536 } },
  { pattern: "*gemini-2.5*",    caps: { vision: true, audioInput: true, videoInput: true, reasoning: true, search: true, thinkingFormat: "gemini-budget", thinkingRange: { min: 0, max: 24576 }, contextWindow: 1048576, maxOutput: 65536 } },
  { pattern: "*gemini-2*",      caps: { vision: true, audioInput: true, videoInput: true, search: true, contextWindow: 1048576, maxOutput: 65536 } },
  { pattern: "*gemini*",        caps: { vision: true, search: true, contextWindow: 1048576 } },
  { pattern: "*gemma*",         caps: { vision: true, contextWindow: 128000 } },
  { pattern: "*nanobanana*",    caps: { vision: true, imageOutput: true } },
  // ── OpenAI GPT-6.x (vision + thinking + web search) ──────────────
  // 1.05M is the API window for the whole gpt-6 family (astra, luna, sol alike).
  // A gateway that truncates lower records its own number in
  // PROVIDER_CAPABILITIES, which wins over this pattern — Kiro at 272k, Codex
  // OAuth at 272k/372k (see CODEX_GPT_56_* above). This entry used to carry
  // Kiro's 272k, so every other provider's gpt-6 models inherited one gateway's
  // limit and were published at 3.9x under their real window.
  { pattern: "*gpt-6*",         caps: { vision: true, reasoning: true, search: true, thinkingFormat: "openai", contextWindow: 1050000, maxOutput: 128000 } },
  { pattern: "*gpt-5*image*",   caps: { imageOutput: true } },
  { pattern: "*gpt-5*codex*",   caps: { reasoning: true, search: true, thinkingFormat: "openai", contextWindow: 400000, maxOutput: 128000 } },
  // gpt-5.4 is where the 1.05M window starts, but the mini and nano tiers stayed
  // at 400k — first match wins, so those two have to be listed ahead of it.
  { pattern: "*gpt-5.4-mini*",  caps: { vision: true, reasoning: true, search: true, thinkingFormat: "openai", contextWindow: 400000, maxOutput: 128000 } },
  { pattern: "*gpt-5.4-nano*",  caps: { vision: true, reasoning: true, search: true, thinkingFormat: "openai", contextWindow: 400000, maxOutput: 128000 } },
  { pattern: "*gpt-5.4*",       caps: { vision: true, reasoning: true, search: true, thinkingFormat: "openai", contextWindow: 1050000, maxOutput: 128000 } },
  { pattern: "*gpt-5.5*",       caps: { vision: true, reasoning: true, search: true, thinkingFormat: "openai", contextWindow: 1050000, maxOutput: 128000 } },
  { pattern: "*gpt-5.6*",       caps: { vision: true, reasoning: true, search: true, thinkingFormat: "openai", contextWindow: 1050000, maxOutput: 128000 } },
  { pattern: "*gpt-5*",         caps: { vision: true, reasoning: true, search: true, thinkingFormat: "openai", contextWindow: 400000, maxOutput: 128000 } },
  { pattern: "*gpt-4o*",        caps: { vision: true, search: true, contextWindow: 128000, maxOutput: 16384 } },
  { pattern: "*gpt-4.1*",       caps: { vision: true, contextWindow: 1000000, maxOutput: 32768 } },
  { pattern: "*gpt-4-turbo*",   caps: { vision: true, contextWindow: 128000 } },
  { pattern: "*gpt-4*",         caps: { contextWindow: 128000 } },
  { pattern: "*gpt-3.5*",       caps: { contextWindow: 16385, maxOutput: 4096 } },
  { pattern: "*gpt-oss*",       caps: { reasoning: true, thinkingFormat: "openai", contextWindow: 128000 } },

  // ── OpenAI o-series (reasoning, vision) ──────────────────────────
  {
    pattern: "*o1-mini*",
    caps: { reasoning: true, thinkingFormat: "openai", contextWindow: 128000 },
  },
  {
    pattern: "*o1*",
    caps: {
      vision: true,
      reasoning: true,
      thinkingFormat: "openai",
      contextWindow: 200000,
      maxOutput: 100000,
    },
  },
  {
    pattern: "*o3*",
    caps: {
      vision: true,
      reasoning: true,
      thinkingFormat: "openai",
      contextWindow: 200000,
      maxOutput: 100000,
    },
  },
  {
    pattern: "*o4*",
    caps: {
      vision: true,
      reasoning: true,
      thinkingFormat: "openai",
      contextWindow: 200000,
      maxOutput: 100000,
    },
  },

  // ── Grok (vision + Live Search) ──────────────────────────────────
  { pattern: "*grok*image*", caps: { imageOutput: true } },
  {
    pattern: "*grok-code*",
    caps: { reasoning: true, thinkingFormat: "openai", contextWindow: 256000 },
  },
  // Grok 4.6: 500k context, no text output limit (docs.x.ai/developers/grok-4-6)
  {
    pattern: "*grok-4.6*",
    caps: {
      vision: true,
      reasoning: true,
      search: true,
      thinkingFormat: "openai",
      contextWindow: 500000,
      maxOutput: 500000,
    },
  },
  // Grok 4.5 (Grok CLI / Grok Build): 500k context per cli-chat-proxy /v1/models
  {
    pattern: "*grok-4.5*",
    caps: {
      vision: true,
      reasoning: true,
      search: true,
      thinkingFormat: "openai",
      contextWindow: 500000,
      maxOutput: 64000,
    },
  },
  {
    pattern: "*grok-4*",
    caps: {
      vision: true,
      reasoning: true,
      search: true,
      thinkingFormat: "openai",
      contextWindow: 256000,
    },
  },
  {
    pattern: "*grok-3*",
    caps: {
      vision: true,
      reasoning: true,
      search: true,
      thinkingFormat: "openai",
      contextWindow: 131072,
    },
  },
  {
    pattern: "*grok*",
    caps: {
      vision: true,
      reasoning: true,
      search: true,
      thinkingFormat: "openai",
      contextWindow: 256000,
    },
  },

  // ── Qwen (3.5+ = native vision/video; coder & max = text-only; QwQ = thinking-only) ─
  {
    pattern: "*qwen*vl*",
    caps: {
      vision: true,
      reasoning: true,
      thinkingFormat: "qwen",
      contextWindow: 262144,
    },
  },
  {
    pattern: "*qwen*omni*",
    caps: {
      vision: true,
      audioInput: true,
      videoInput: true,
      reasoning: true,
      thinkingFormat: "qwen",
      contextWindow: 262144,
      maxOutput: 65536,
    },
  },
  {
    pattern: "*qwen*coder*",
    caps: { reasoning: true, thinkingFormat: "qwen", contextWindow: 1000000 },
  },
  {
    pattern: "*qwen*max*",
    caps: {
      reasoning: true,
      thinkingFormat: "qwen",
      contextWindow: 1000000,
      maxOutput: 65536,
    },
  },
  {
    pattern: "*qwen3.5*",
    caps: {
      vision: true,
      videoInput: true,
      reasoning: true,
      thinkingFormat: "qwen",
      contextWindow: 1000000,
      maxOutput: 65536,
    },
  },
  {
    pattern: "*qwen3.6*",
    caps: {
      vision: true,
      videoInput: true,
      reasoning: true,
      thinkingFormat: "qwen",
      contextWindow: 1000000,
      maxOutput: 65536,
    },
  },
  {
    pattern: "*qwen3.7*",
    caps: {
      vision: true,
      videoInput: true,
      reasoning: true,
      thinkingFormat: "qwen",
      contextWindow: 1000000,
      maxOutput: 65536,
    },
  },
  {
    pattern: "*qwen*plus*",
    caps: {
      vision: true,
      reasoning: true,
      thinkingFormat: "qwen",
      contextWindow: 1000000,
      maxOutput: 65536,
    },
  },
  {
    pattern: "*qwen*235b*",
    caps: { reasoning: true, thinkingFormat: "qwen", contextWindow: 262144 },
  },
  {
    pattern: "*qwq*",
    caps: {
      reasoning: true,
      thinkingFormat: "qwen",
      thinkingCanDisable: false,
      contextWindow: 131072,
    },
  },
  {
    pattern: "*qwen*",
    caps: { reasoning: true, thinkingFormat: "qwen", contextWindow: 262144 },
  },

  // ── Kimi (enabled→reasoning_effort; K2.7-code cannot disable) ─────
  {
    pattern: "*kimi*k3*",
    caps: {
      vision: true,
      videoInput: true,
      reasoning: true,
      thinkingFormat: "kimi",
      thinkingCanDisable: false,
      contextWindow: 1048576,
      maxOutput: 131072,
    },
  },
  {
    pattern: "*kimi*for-coding*",
    caps: {
      vision: true,
      videoInput: true,
      reasoning: true,
      thinkingFormat: "kimi",
      thinkingCanDisable: false,
      contextWindow: 262144,
      maxOutput: 65536,
    },
  },
  {
    pattern: "*kimi*k2.7*code*",
    caps: {
      vision: true,
      videoInput: true,
      reasoning: true,
      thinkingFormat: "kimi",
      thinkingCanDisable: false,
      contextWindow: 262144,
      maxOutput: 65536,
    },
  },
  {
    pattern: "*kimi*k2*",
    caps: {
      vision: true,
      reasoning: true,
      thinkingFormat: "kimi",
      contextWindow: 262144,
      maxOutput: 262144,
    },
  },
  {
    pattern: "*kimi*",
    caps: { reasoning: true, thinkingFormat: "kimi", contextWindow: 262144 },
  },

  // ── GLM / Z.ai (thinking.enabled; disable via enable_thinking:false) ─
  // reasoning_effort is only read by z.ai from GLM-5.2 onward (docs.z.ai/guides/capabilities/thinking) —
  // older GLM (4.x, 5.0, 5.1, 5-turbo, 5v-turbo) ignore it, so gate it per exact version, not the "*glm-5*" catch-all.
  {
    pattern: "*glm-5.3*",
    caps: {
      reasoning: true,
      thinkingFormat: "zai",
      thinkingEffortSupported: true,
      thinkingCanDisable: false,
      contextWindow: 1000000,
      maxOutput: 128000,
    },
  },
  {
    pattern: "*glm-5.2*",
    caps: {
      reasoning: true,
      thinkingFormat: "zai",
      thinkingEffortSupported: true,
      contextWindow: 1000000,
      maxOutput: 128000,
    },
  },
  {
    pattern: "*glm-5*",
    caps: {
      reasoning: true,
      thinkingFormat: "zai",
      contextWindow: 200000,
      maxOutput: 128000,
    },
  },
  {
    pattern: "*glm-4.7*",
    caps: {
      reasoning: true,
      thinkingFormat: "zai",
      contextWindow: 200000,
      maxOutput: 128000,
    },
  },
  {
    pattern: "*glm-4*",
    caps: { reasoning: true, thinkingFormat: "zai", contextWindow: 200000 },
  },
  {
    pattern: "*glm*",
    caps: { reasoning: true, thinkingFormat: "zai", contextWindow: 200000 },
  },

  // ── DeepSeek (thinking.enabled + reasoning_effort; r1 = thinking-only) ─
  {
    pattern: "*deepseek-v4*",
    caps: {
      reasoning: true,
      thinkingFormat: "deepseek",
      contextWindow: 1000000,
      maxOutput: 384000,
    },
  },
  {
    pattern: "*reasoner*",
    caps: {
      reasoning: true,
      thinkingFormat: "deepseek",
      thinkingCanDisable: false,
      contextWindow: 128000,
    },
  },
  {
    pattern: "*deepseek-r*",
    caps: {
      reasoning: true,
      thinkingFormat: "deepseek",
      thinkingCanDisable: false,
      contextWindow: 128000,
    },
  },
  { pattern: "*deepseek-chat*", caps: { contextWindow: 128000 } },
  {
    pattern: "*deepseek*",
    caps: {
      reasoning: true,
      thinkingFormat: "deepseek",
      contextWindow: 128000,
    },
  },

  // ── MiniMax (M3 = adaptive; M2.x cannot disable) ─────────────────
  { pattern: "*minimax*image*", caps: { imageOutput: true } },
  {
    pattern: "*minimax-m3*",
    caps: {
      vision: true,
      reasoning: true,
      thinkingFormat: "minimax",
      contextWindow: 1048576,
      maxOutput: 512000,
    },
  },
  {
    pattern: "*minimax-m2.7*",
    caps: {
      reasoning: true,
      thinkingFormat: "minimax",
      thinkingCanDisable: false,
      contextWindow: 204800,
      maxOutput: 131072,
    },
  },
  {
    pattern: "*minimax*",
    caps: {
      reasoning: true,
      thinkingFormat: "minimax",
      thinkingCanDisable: false,
      contextWindow: 200000,
      maxOutput: 131072,
    },
  },

  // ── Xiaomi MiMo (vision, 1M / 262K ctx) ──────────────────────────
  {
    pattern: "*mimo*v2.5*",
    caps: { vision: true, contextWindow: 1048576, maxOutput: 131072 },
  },
  {
    pattern: "*mimo*omni*",
    caps: {
      vision: true,
      audioInput: true,
      contextWindow: 262144,
      maxOutput: 131072,
    },
  },
  {
    pattern: "*mimo*",
    caps: { vision: true, contextWindow: 262144, maxOutput: 131072 },
  },

  // ── Llama (4 = vision/1M; 3.x = text-only/128K) ──────────────────
  { pattern: "*llama-4*", caps: { vision: true, contextWindow: 1000000 } },
  { pattern: "*llama*", caps: { contextWindow: 128000 } },

  // ── Mistral (Large 3 = vision/256K; codestral text) ──────────────
  { pattern: "*codestral*", caps: { contextWindow: 256000 } },
  { pattern: "*mistral-large*", caps: { vision: true, contextWindow: 256000 } },
  { pattern: "*mistral*", caps: { contextWindow: 128000 } },

  // ── Cohere (Command A Vision = vision; others text) ──────────────
  {
    pattern: "*command-a-vision*",
    caps: { vision: true, contextWindow: 128000 },
  },
  { pattern: "*command*", caps: { contextWindow: 128000 } },

  // ── Perplexity (web search native) ───────────────────────────────
  { pattern: "*sonar*", caps: { search: true, contextWindow: 128000 } },
  { pattern: "*pplx*", caps: { search: true, contextWindow: 128000 } },
  { pattern: "*perplexity*", caps: { search: true, contextWindow: 128000 } },

  // ── Muse Spark (Meta Model API) ───────────────────────────────────
  // Multimodal (text+image); OpenAI Responses reasoning supports up to xhigh.
  { pattern: "*muse*spark*", caps: { vision: true, reasoning: true, thinkingFormat: "openai", contextWindow: 1048576, maxOutput: 131072 } },

  // ── Others ───────────────────────────────────────────────────────
  {
    pattern: "*hunyuan*",
    caps: {
      reasoning: true,
      thinkingFormat: "hunyuan",
      contextWindow: 262144,
      maxOutput: 262144,
    },
  },
  {
    pattern: "hy3*",
    caps: {
      reasoning: true,
      thinkingFormat: "hunyuan",
      contextWindow: 262144,
      maxOutput: 262144,
    },
  },
  {
    pattern: "*step-*",
    caps: { reasoning: true, thinkingFormat: "step", contextWindow: 128000 },
  },
  { pattern: "*nemotron*", caps: { reasoning: true, contextWindow: 128000 } },
  { pattern: "*ling-*", caps: { reasoning: true, contextWindow: 128000 } },
];

/**
 * Resolve capabilities for a model using the 4-step fallback chain,
 * merged over DEFAULT_CAPABILITIES so the result is always complete.
 *
 * @param {string} provider
 * @param {string} model
 * @returns {object} full capabilities object
 */
const MODALITY_KEYS = ["vision", "pdf", "audioInput", "videoInput"];

// Catalog lookups, installed by the server at startup. Left as no-ops in the
// browser bundle, where there is no file to read.
//
// The server bundles this module into every route chunk that needs it, and each
// copy carries its own module state, so an install landing in the copy the
// startup hook imported stays invisible to the copy resolving requests. The slot
// lives on globalThis instead, and every read goes through it: caching it locally
// would keep a reader alive in other copies after setCatalogSource(null).
let catalogSource = null;

/**
 * Install the synced catalog reader (server only).
 * @param {{ getModalities: (provider: string, model: string) => object|null,
 *           getLimits: (provider: string, model: string) => object|null } | null} source
 */
export function setCatalogSource(source) {
  catalogSource = source;
  if (typeof globalThis !== "undefined") globalThis.__9rCatalogSource = source;
}

function getCatalogSource() {
  if (typeof globalThis === "undefined") return catalogSource;
  return globalThis.__9rCatalogSource || null;
}

// Apply the synced catalog + name heuristic on top of a table-resolved result.
// Strictly additive: a capability already true stays true, and a false one only
// flips when an outside source positively declares support.
function refine(base, provider, model) {
  const result = { ...DEFAULT_CAPABILITIES, ...base };

  const source = getCatalogSource();
  if (source) {
    const modalities = source.getModalities(provider, model);
    if (modalities) {
      for (const key of MODALITY_KEYS) {
        if (modalities[key] === true) result[key] = true;
      }
    }

    const limits = source.getLimits(provider, model);
    if (limits) {
      if (limits.contextWindow > 0) result.contextWindow = limits.contextWindow;
      if (limits.maxOutput > 0) result.maxOutput = limits.maxOutput;
    }
  }

  if (!result.vision && looksLikeVisionModel(model)) result.vision = true;

  return result;
}

// Mirrors the Command Code CLI text-only list (no image input). Everything else
// on this provider takes images; only these ids stay text-only.
const COMMANDCODE_TEXT_ONLY = new Set([
  "deepseek/deepseek-v4-pro",
  "deepseek/deepseek-v4-flash",
  "deepseek/deepseek-v4-flash-fast",
  "zai-org/glm-5.3",
  "zai-org/glm-5.2",
  "zai-org/glm-5.2-fast",
  "zai-org/glm-5.1",
  "zai-org/glm-5",
  "minimaxai/minimax-m2.7",
  "minimax/minimax-m2.7-free",
  "minimaxai/minimax-m2.5",
  "xiaomi/mimo-v2.5-pro",
  "qwen/qwen3.6-max-preview",
  "qwen/qwen3.7-max",
  "meituan/longcat-2.0:free",
  "stepfun/step-3.5-flash",
  "tencent/hy4-preview",
  "tencent/hy3",
  "tencent/hy3-paid",
  "nvidia/nemotron-3-ultra-550b-a55b",
  "poolside/laguna-s-2.1-free",
  "inclusionai/ling-3.0-flash-free",
  "inclusionai/ling-3.0-flash-sante:free",
]);

function isCommandCodeTextOnly(model) {
  const key = String(model || "").toLowerCase();
  if (COMMANDCODE_TEXT_ONLY.has(key)) return true;
  for (const id of COMMANDCODE_TEXT_ONLY) {
    const base = id.slice(id.lastIndexOf("/") + 1);
    if (key === base || key.endsWith("/" + base)) return true;
  }
  return false;
}

export function getCapabilitiesForModel(provider, model) {
  if (!model) return { ...DEFAULT_CAPABILITIES };

  // Canonical exact lookup strips vendor prefix: "anthropic/claude-opus-4.7" -> "claude-opus-4.7".
  const baseModel = model.includes("/") ? model.split("/").pop() : model;

  // CommandCode serves every model over one /alpha/generate wire, so the family
  // patterns below (deepseek-v4 → thinkingFormat deepseek, no vision) must not win.
  if (provider === "commandcode" || provider === "cmc") {
    return {
      ...DEFAULT_CAPABILITIES,
      reasoning: true,
      thinkingFormat: "commandcode",
      thinkingEffortSupported: true,
      vision: !isCommandCodeTextOnly(model),
      contextWindow: 1000000,
      maxOutput: 384000,
    };
  }

  // 1. Provider-specific override
  if (provider) {
    const providerCaps = PROVIDER_CAPABILITIES[provider];
    if (providerCaps?.[model])
      return { ...DEFAULT_CAPABILITIES, ...providerCaps[model] };
    if (providerCaps?.[baseModel])
      return { ...DEFAULT_CAPABILITIES, ...providerCaps[baseModel] };
  }

  // 2. Canonical exact, then catalog overlay so provider-scoped models.dev
  //    deltas still apply. Step 1 above still short-circuits.
  if (MODEL_CAPABILITIES[baseModel]) return refine(MODEL_CAPABILITIES[baseModel], provider, model);
  if (MODEL_CAPABILITIES[model]) return refine(MODEL_CAPABILITIES[model], provider, model);

  // 3. Pattern match (first match wins), refined by catalog + name heuristic
  for (const { pattern, caps } of PATTERN_CAPABILITIES) {
    if (matchPattern(pattern, baseModel) || matchPattern(pattern, model)) {
      return refine(caps, provider, model);
    }
  }

  // 4. Floor
  return refine(null, provider, model);
}

// Gemini 4 (Argon) merged user turns must keep functionResponse as the last part.
export function isGemini4Model(model) {
  return /(?:^|\/)gemini-4(?:$|[-.])/i.test(String(model || ""));
}
