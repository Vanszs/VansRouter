import { describe, it, expect } from "vitest";
import { detectFormat, normalizeThinkingConfig } from "../../open-sse/services/provider.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { getThinkingLevels } from "../../open-sse/providers/thinkingLevels.js";
import { PROVIDER_MODELS } from "../../open-sse/config/providers.js";

const registryModels = (id) => PROVIDER_MODELS[id].map((m) => m.id);

describe("detectFormat", () => {
  it("detects Claude when the first content block is an image", () => {
    expect(detectFormat({
      model: "claude-opus-4-6-thinking",
      messages: [{
        role: "user",
        content: [{
          type: "image",
          source: { type: "base64", media_type: "image/png", data: "x" },
        }],
      }],
    })).toBe("claude");
  });
});

describe("normalizeThinkingConfig", () => {
  it("keeps openai reasoning_effort on non-user turns", () => {
    const body = {
      messages: [{ role: "assistant", content: "ok" }],
      reasoning_effort: "xhigh",
      thinking: { type: "enabled" },
    };

    normalizeThinkingConfig(body);

    expect(body.reasoning_effort).toBe("xhigh");
    expect(body.thinking).toBeUndefined();
  });
});

describe("deepseek-v4.1-flash", () => {
  it("is served by the deepseek and ollama registries", () => {
    expect(registryModels("deepseek")).toContain("deepseek-v4.1-flash");
    expect(registryModels("ollama")).toContain("deepseek-v4.1-flash:cloud");
  });

  it("resolves with vision + full low..max effort on the deepseek provider", () => {
    expect(getCapabilitiesForModel("deepseek", "deepseek-v4.1-flash")).toMatchObject({
      vision: true,
      reasoning: true,
      thinkingFormat: "deepseek",
      contextWindow: 1000000,
    });
    expect(getThinkingLevels("deepseek", "deepseek-v4.1-flash")).toEqual([
      "none", "low", "medium", "high", "xhigh", "max",
    ]);
  });

  it("resolves with vision on the ollama cloud provider", () => {
    expect(getCapabilitiesForModel("ollama", "deepseek-v4.1-flash:cloud")).toMatchObject({
      vision: true,
      reasoning: true,
      thinkingFormat: "deepseek",
      contextWindow: 1000000,
    });
    expect(getThinkingLevels("ollama", "deepseek-v4.1-flash:cloud")).toEqual([
      "none", "low", "medium", "high", "xhigh", "max",
    ]);
  });
});
