import { ROLE } from "../schema/index.js";

// Build OpenAI delta carrying reasoning_content (optional leading assistant role)
export function reasoningDelta(text, withRole = false) {
  return withRole
    ? { role: ROLE.ASSISTANT, reasoning_content: text }
    : { reasoning_content: text };
}

// Lazily add the canonical OpenAI reasoning field when an upstream streams the
// vendor aliases instead: `reasoning` (string) and `reasoning_details[]`. Only
// ever ADDS the field, so clients that read the aliases keep working.
export function liftReasoningAliases(delta) {
  if (!delta || typeof delta !== "object") return delta;
  if (typeof delta.reasoning_content === "string" && delta.reasoning_content) return delta;
  const text = extractReasoningText(delta);
  return text ? { ...delta, reasoning_content: text } : delta;
}

// Extract reasoning text from a streamed OpenAI-compatible delta across vendor shapes:
//   - reasoning_content (GLM, Qwen, DeepSeek, Kimi, Step, Hunyuan)
//   - reasoning (some compat layers)
//   - reasoning_details[] (MiniMax reasoning_split=true): [{ text|content }]
// Returns concatenated reasoning string, or "" when none.
export function extractReasoningText(delta) {
  if (!delta || typeof delta !== "object") return "";
  if (typeof delta.reasoning_content === "string" && delta.reasoning_content) return delta.reasoning_content;
  if (typeof delta.reasoning === "string" && delta.reasoning) return delta.reasoning;
  const details = delta.reasoning_details;
  if (Array.isArray(details)) {
    return details.map((d) => (typeof d === "string" ? d : d?.text || d?.content || "")).join("");
  }
  return "";
}
