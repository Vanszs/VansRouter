import { describe, expect, it } from "vitest";
import {
  PROVIDER_MODELS,
  getModelSupportedFormats,
  getModelTargetFormat,
  isValidModel,
} from "../../open-sse/config/providerModels.js";
import { PROVIDERS } from "../../open-sse/config/providers.js";
import { APIKEY_PROVIDERS, getAclProviderList } from "../../src/shared/constants/providers.js";
import { resolveTransport } from "../../open-sse/services/provider.js";
import { resolveProviderAlias } from "../../open-sse/services/model.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import "../translator/registerAll.js";

const ZEN_BASE = "https://opencode.ai/zen/v1";

// Chat-only models (no /messages, no /responses support on opencode-zen)
const CHAT_ONLY = [
  "deepseek-v4-pro",
  "deepseek-v4-flash",
  "deepseek-v4-flash-vision-exp",
  "glm-5.3-flash",
  "glm-5.3",
  "glm-5.2",
  "glm-5.1",
  "glm-5",
  "minimax-m3",
  "minimax-m2.7",
  "minimax-m2.5",
  "kimi-k3",
  "kimi-k2.7-code",
  "kimi-k2.6",
  "kimi-k2.5",
  "big-pickle",
];
// Models that also expose the Anthropic /messages endpoint
// Gemini models on the chat completions transport
const GEMINI = [
  "gemini-3.6-flash",
  "gemini-3.8-flash",
  "gemini-3.7-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.5-flash",
  "gemini-3.1-pro",
  "gemini-3-flash",
];
// Models that also expose the Anthropic /messages endpoint
const CLAUDE_CAPABLE = [
  "claude-fable-5",
  "claude-fable-5-1",
  "claude-opus-5",
  "claude-opus-4-8",
  "claude-opus-4-7",
  "claude-opus-4-6",
  "claude-opus-4-5",
  "claude-sonnet-5",
  "claude-sonnet-4-6",
  "claude-sonnet-4-5",
  "claude-sonnet-4",
  "claude-haiku-4-5",
  "qwen3.6-plus",
  "qwen3.5-plus",
  "union-alpha",
];
// Models served by the OpenAI /responses endpoint
const RESPONSES_CAPABLE = [
  "gpt-6-astra",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
  "gpt-5.5",
  "gpt-5.5-pro",
  "gpt-5.4",
  "gpt-5.4-pro",
  "gpt-5.4-mini",
  "gpt-5.4-nano",
  "gpt-5.3-codex-spark",
  "gpt-5.3-codex",
  "gpt-5.2",
  "gpt-5.2-codex",
  "gpt-5.1",
  "gpt-5.1-codex-max",
  "gpt-5.1-codex",
  "gpt-5.1-codex-mini",
  "gpt-5",
  "gpt-5-codex",
  "gpt-5-nano",
  "grok-build-0.1",
  "grok-4.6",
  "grok-4.5",
  "muse-spark-1.3",
  "muse-spark-1.2",
];

// Mirror of chatCore's per-model transport guard: use the sourceFormat-matched
// transport only when the model declares support for that sourceFormat.
function pickTransport(provider, sourceFormat, alias, model) {
  const supported = getModelSupportedFormats(alias, model);
  const rt = resolveTransport(provider, sourceFormat);
  return supported?.includes(sourceFormat) ? rt : null;
}

describe("OpenCode Zen model catalog", () => {
  it("matches the documented paid model IDs", () => {
    const ids = (PROVIDER_MODELS["ocz"] || []).map((m) => m.id);
    expect(ids).toContain("claude-opus-5");
    expect(ids).toContain("gpt-5.5");
    expect(ids).toContain("kimi-k3");
    expect(ids).toContain("deepseek-v4-pro");
    expect(ids).toHaveLength(
      CHAT_ONLY.length + GEMINI.length + CLAUDE_CAPABLE.length + RESPONSES_CAPABLE.length,
    );
  });

  it("keeps the paid catalog free of -free ids (passthroughModels serves them)", () => {
    const ids = (PROVIDER_MODELS["ocz"] || []).map((m) => m.id);
    expect(ids.filter((id) => id.endsWith("-free"))).toEqual([]);
  });
});

describe("OpenCode Zen provider exposure", () => {
  it("appears in the API-key provider list and the ACL picker", () => {
    expect(Object.keys(APIKEY_PROVIDERS)).toContain("opencode-zen");
    expect(getAclProviderList().map((p) => p.alias)).toContain("ocz");
  });

  it("resolves both alias tokens and their models", () => {
    expect(resolveProviderAlias("ocz")).toBe("opencode-zen");
    expect(resolveProviderAlias("opencode-zen")).toBe("opencode-zen");
    expect(isValidModel("ocz", "claude-opus-5", new Set())).toBe(true);
    expect(isValidModel("ocz", "not-a-zen-model", new Set())).toBe(false);
  });
});

describe("OpenCode Zen per-model supportedFormats", () => {
  it("declares [claude] for Claude + Qwen + union-alpha models", () => {
    for (const m of CLAUDE_CAPABLE) {
      expect(getModelSupportedFormats("ocz", m)).toEqual(["claude"]);
    }
  });

  it("declares [openai-responses] for GPT/Grok/Spark responses models", () => {
    for (const m of RESPONSES_CAPABLE) {
      expect(getModelSupportedFormats("ocz", m)).toEqual(["openai-responses"]);
    }
  });

  it("declares [openai] only for chat-only models (GLM/Kimi/MiniMax/DeepSeek)", () => {
    for (const m of CHAT_ONLY) {
      expect(getModelSupportedFormats("ocz", m)).toEqual(["openai"]);
    }
  });
});

describe("OpenCode Zen multi-endpoint transports", () => {
  it("declares openai / claude / openai-responses transports", () => {
    const formats = (PROVIDERS["opencode-zen"].transports || []).map((t) => t.format);
    expect(formats).toEqual(["openai", "claude", "openai-responses"]);
  });

  it("resolveTransport picks the endpoint matching the client sourceFormat", () => {
    expect(resolveTransport("opencode-zen", "openai").baseUrl).toBe(`${ZEN_BASE}/chat/completions`);
    expect(resolveTransport("opencode-zen", "claude").baseUrl).toBe(`${ZEN_BASE}/messages`);
    expect(resolveTransport("opencode-zen", "openai-responses").baseUrl).toBe(`${ZEN_BASE}/responses`);
  });

  it("uses x-api-key + anthropicVersion on the claude transport", () => {
    const t = resolveTransport("opencode-zen", "claude");
    expect(t.auth.header).toBe("x-api-key");
    expect(t.auth.anthropicVersion).toBe(true);
  });

  it("exposes the usage endpoint from the registry", () => {
    expect(PROVIDERS["opencode-zen"].usage.url).toBe(`${ZEN_BASE}/usage`);
  });
});

describe("OpenCode Zen per-model transport guard (chatCore logic)", () => {
  it("routes Claude/Qwen + claude-format client to /messages", () => {
    for (const m of CLAUDE_CAPABLE) {
      expect(pickTransport("opencode-zen", "claude", "ocz", m)?.baseUrl).toBe(`${ZEN_BASE}/messages`);
    }
  });

  it("does NOT route chat-only models to /messages on a claude-format request", () => {
    for (const m of CHAT_ONLY) {
      expect(pickTransport("opencode-zen", "claude", "ocz", m)).toBeNull();
    }
  });

  it("routes GPT/Grok/Spark + responses-format client to /responses", () => {
    for (const m of RESPONSES_CAPABLE) {
      expect(pickTransport("opencode-zen", "openai-responses", "ocz", m)?.baseUrl).toBe(`${ZEN_BASE}/responses`);
    }
  });

  it("never routes a claude-format request to a responses-only model", () => {
    for (const m of RESPONSES_CAPABLE) {
      expect(pickTransport("opencode-zen", "claude", "ocz", m)).toBeNull();
      expect(pickTransport("opencode-zen", "openai", "ocz", m)).toBeNull();
    }
  });
});

describe("OpenCode Zen responses-only models", () => {
  it("declares openai-responses as the target format", () => {
    for (const m of ["gpt-5.5", "grok-4.6", "muse-spark-1.3"]) {
      expect(getModelTargetFormat("ocz", m)).toBe("openai-responses");
    }
  });

  it("translates an OpenAI Chat request to the Responses shape (no `messages` upstream)", () => {
    const body = {
      model: "ocz/muse-spark-1.3",
      messages: [{ role: "user", content: "Think, then answer: 2 + 2?" }],
      reasoning_effort: "high",
      max_tokens: 131072,
    };

    const translated = translateRequest(
      FORMATS.OPENAI,
      FORMATS.OPENAI_RESPONSES,
      "muse-spark-1.3",
      body,
      true,
      {},
      "opencode-zen",
    );

    expect(translated.input).toBeDefined();
    expect(translated.messages).toBeUndefined();
    expect(translated.max_output_tokens).toBe(131072);
    expect(translated.max_tokens).toBeUndefined();
  });
});
