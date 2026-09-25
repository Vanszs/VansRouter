import { PROVIDERS } from "../config/providers.js";
import { OPENAI_COMPAT_BASE, ANTHROPIC_COMPAT_BASE } from "../providers/shared.js";

const OPENAI_COMPATIBLE_PREFIX = "openai-compatible-";
const OPENAI_COMPATIBLE_DEFAULTS = {
  baseUrl: OPENAI_COMPAT_BASE,
};

const ANTHROPIC_COMPATIBLE_PREFIX = "anthropic-compatible-";
const ANTHROPIC_COMPATIBLE_DEFAULTS = {
  baseUrl: ANTHROPIC_COMPAT_BASE,
};

function isOpenAICompatible(provider) {
  return typeof provider === "string" && provider.startsWith(OPENAI_COMPATIBLE_PREFIX);
}

function isAnthropicCompatible(provider) {
  return typeof provider === "string" && provider.startsWith(ANTHROPIC_COMPATIBLE_PREFIX);
}

function getOpenAICompatibleType(provider) {
  if (!isOpenAICompatible(provider)) return "chat";
  return provider.includes("responses") ? "responses" : "chat";
}

// Detect request format from body structure
export function detectFormat(body) {
  // OpenAI Responses API: has input (array or string) instead of messages[]
  // The Responses API accepts both input as array and input as a plain string
  if (body.input && (Array.isArray(body.input) || typeof body.input === "string") && !body.messages) {
    return "openai-responses";
  }

  // Antigravity format: Gemini wrapped in body.request
  if (body.request?.contents && body.userAgent === "antigravity") {
    return "antigravity";
  }

  // Gemini format: has contents array
  if (body.contents && Array.isArray(body.contents)) {
    return "gemini";
  }

  // OpenAI-specific indicators (check BEFORE Claude)
  // These fields are OpenAI-specific and never appear in Claude format
  if (
    body.stream_options ||           // OpenAI streaming options
    body.response_format ||           // JSON mode, etc.
    body.logprobs !== undefined ||    // Log probabilities
    body.top_logprobs !== undefined ||
    body.n !== undefined ||           // Number of completions
    body.presence_penalty !== undefined ||  // Penalties
    body.frequency_penalty !== undefined ||
    body.logit_bias ||                // Token biasing
    body.user                         // User identifier
  ) {
    return "openai";
  }

  // Claude format: messages with content as array of objects with type
  // Claude requires content to be array with specific structure
  if (body.messages && Array.isArray(body.messages)) {
    // Inspect every turn: later messages may contain Claude tools/images even
    // when the first turn is plain text.
    if (body.messages.length && !body.model?.includes("/")) {
      if (body.system || body.anthropic_version) {
        return "claude";
      }

      let hasClaudeImage = false;
      let hasOpenAIImage = false;
      let hasClaudeTool = false;
      for (const message of body.messages) {
        if (!Array.isArray(message?.content)) continue;
        for (const content of message.content) {
          if (!content || typeof content !== "object") continue;
          if (content.type === "image" && content.source?.type === "base64") hasClaudeImage = true;
          else if (content.type === "image_url" && content.image_url?.url) hasOpenAIImage = true;
          else if (content.type === "tool_use" || content.type === "tool_result") hasClaudeTool = true;
        }
      }
      if (hasClaudeImage || hasClaudeTool) return "claude";
      if (hasOpenAIImage) return "openai";
    }
    
    // If content is string, it's likely OpenAI (Claude also supports this)
    // Check for other Claude-specific indicators
    if (body.system !== undefined || body.anthropic_version) {
      return "claude";
    }
  }

  // Default to OpenAI format
  return "openai";
}

// Get provider config (internal — no external runtime consumer)
function getProviderConfig(provider) {
  if (isOpenAICompatible(provider)) {
    const apiType = getOpenAICompatibleType(provider);
    return {
      ...PROVIDERS.openai,
      format: apiType === "responses" ? "openai-responses" : "openai",
      baseUrl: OPENAI_COMPATIBLE_DEFAULTS.baseUrl,
    };
  }
  if (isAnthropicCompatible(provider)) {
    return {
      ...PROVIDERS.anthropic, // Use Anthropic defaults (header: x-api-key)
      format: "claude",
      baseUrl: ANTHROPIC_COMPATIBLE_DEFAULTS.baseUrl,
    };
  }
  return PROVIDERS[provider] || PROVIDERS.openai;
}

// Get target format for provider
export function getTargetFormat(provider) {
  if (isOpenAICompatible(provider)) {
    return getOpenAICompatibleType(provider) === "responses" ? "openai-responses" : "openai";
  }
  if (isAnthropicCompatible(provider)) {
    return "claude";
  }
  const config = getProviderConfig(provider);
  return config.format || "openai";
}

// Resolve which transport to use for a provider given the client sourceFormat.
// Multi-endpoint providers (transport.transports[]) pick the entry matching sourceFormat
// to avoid lossy translation; falls back to the default transport when no match.
export function resolveTransport(provider, sourceFormat) {
  const config = PROVIDERS[provider];
  const transports = config?.transports;
  if (!Array.isArray(transports) || !transports.length) return null;
  return transports.find(t => t.format === sourceFormat) || null;
}

// Check if last message is from user
export function isLastMessageFromUser(body) {
  const messages = body.messages || body.contents;
  if (!messages?.length) return true;
  const lastMsg = messages[messages.length - 1];
  return lastMsg?.role === "user";
}

// Check if request has thinking config
export function hasThinkingConfig(body) {
  return !!(body.reasoning_effort || body.thinking?.type === "enabled");
}

// Normalize provider-native thinking config based on last message role.
// OpenAI reasoning_effort is request-level and must survive tool-result turns.
export function normalizeThinkingConfig(body) {
  if (!isLastMessageFromUser(body)) {
    delete body.thinking;
  }
  return body;
}
