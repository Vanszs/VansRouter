import { describe, expect, it } from "vitest";
import { PROVIDERS, PROVIDER_MODELS } from "../../open-sse/config/providers.js";
import { resolveProviderAlias } from "../../open-sse/services/model.js";
import { resolveProviderId } from "@/shared/constants/providers.js";

describe("TokenHarbor provider", () => {
  it("registers in PROVIDERS with expected baseUrl", () => {
    const provider = PROVIDERS["tokenharbor"];
    expect(provider).toBeDefined();
    expect(provider.baseUrl).toBe("https://tokenharbor.ai/v1/chat/completions");
  });

  it("configures openai, claude, and openai-responses transports", () => {
    const { transports } = PROVIDERS["tokenharbor"];
    expect(Array.isArray(transports)).toBe(true);

    const formats = transports.map((t) => t.format);
    expect(formats).toContain("openai");
    expect(formats).toContain("claude");
    expect(formats).toContain("openai-responses");

    const openaiTransport = transports.find((t) => t.format === "openai");
    expect(openaiTransport.baseUrl).toBe("https://tokenharbor.ai/v1/chat/completions");

    const responsesTransport = transports.find((t) => t.format === "openai-responses");
    expect(responsesTransport.baseUrl).toBe("https://tokenharbor.ai/v1/responses");
  });

  it("configures claude transport with x-api-key header and anthropicVersion", () => {
    const claudeTransport = PROVIDERS["tokenharbor"].transports.find((t) => t.format === "claude");
    expect(claudeTransport).toBeDefined();
    expect(claudeTransport.baseUrl).toBe("https://tokenharbor.ai/v1/messages");
    expect(claudeTransport.auth?.header).toBe("x-api-key");
    expect(claudeTransport.auth?.anthropicVersion).toBe(true);
  });

  it("exposes expected models in PROVIDER_MODELS", () => {
    const models = PROVIDER_MODELS["tokenharbor"];
    expect(Array.isArray(models)).toBe(true);

    const modelIds = models.map((m) => m.id);
    expect(modelIds).toContain("th-orchestra");
    expect(modelIds).toContain("claude-opus-5");
    expect(modelIds).toContain("deepseek-v4-flash");
    expect(modelIds).toContain("mimo-v2.6-flash:free");
    expect(modelIds).toContain("qwen3.8-flash:free");
    expect(modelIds).toContain("deepseek-v4.1-flash:free");
    expect(modelIds).toContain("glm-5.3-flash");
  });

  it("resolves alias 'th' to 'tokenharbor'", () => {
    expect(resolveProviderAlias("th")).toBe("tokenharbor");
  });

  it("resolves provider ID 'tokenharbor' correctly", () => {
    expect(resolveProviderId("tokenharbor")).toBe("tokenharbor");
    expect(resolveProviderId("th")).toBe("tokenharbor");
  });
});
