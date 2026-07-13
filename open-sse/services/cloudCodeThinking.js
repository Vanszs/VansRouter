// Cloud Code (Antigravity/Gemini-CLI) thinking-config handling.
// Mirrors open-sse/services/cloudCodeThinking.ts in OmniRoute so behavior
// stays consistent across forks. Used by open-sse/executors/antigravity.js
// and any other executor that talks to cloudcode-pa.googleapis.com.
//
// Rules:
// - Claude/gpt-oss/tab_* use native thinking fields (Anthropic / harmony / custom)
//   and Google Cloud Code rejects them. We strip thinkingConfig for those.
// - Gemini reasoning-capable models use Google's own thinkingConfig — we keep it
//   so upstream streams thought parts back to the client.
// - Both `thinkingConfig` and `thinking_config` (snake_case) variants are handled.
// - Nested paths cleaned: body, body.request, body.generationConfig,
//   body.request.generationConfig.

const CLOUD_CODE_REASONING_UNSUPPORTED_PATTERNS = [
  /^claude-/i,
  /^gpt-oss-/i,
  /^tab_/i,
];

function isRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeCloudCodeModel(model) {
  return String(model || "")
    .trim()
    .replace(/^models\//i, "")
    .replace(/^antigravity\//i, "");
}

function stripGeminiThinkingConfig(value) {
  if (!isRecord(value)) return value;
  if (!("thinkingConfig" in value) && !("thinking_config" in value)) return value;
  const next = { ...value };
  delete next.thinkingConfig;
  delete next.thinking_config;
  return next;
}

export function shouldStripCloudCodeThinking(provider, model) {
  if (!model) return false;
  const normalized = normalizeCloudCodeModel(model);
  return CLOUD_CODE_REASONING_UNSUPPORTED_PATTERNS.some((p) => p.test(normalized));
}

export function stripCloudCodeThinkingConfig(body) {
  if (!isRecord(body)) return body;
  const next = { ...body };

  delete next.reasoning_effort;
  delete next.reasoning;
  delete next.thinking;

  if ("generationConfig" in next) {
    next.generationConfig = stripGeminiThinkingConfig(next.generationConfig);
  }

  if (isRecord(next.request)) {
    const request = { ...next.request };
    delete request.reasoning_effort;
    delete request.reasoning;
    delete request.thinking;
    if ("generationConfig" in request) {
      request.generationConfig = stripGeminiThinkingConfig(request.generationConfig);
    }
    next.request = request;
  }

  return next;
}
