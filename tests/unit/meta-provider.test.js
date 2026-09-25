import { describe, it, expect } from "vitest";
import { PROVIDERS, PROVIDER_MODELS } from "../../open-sse/config/providers.js";
import { resolveProviderAlias } from "../../open-sse/services/model.js";
import { resolveProviderId } from "../../src/shared/constants/providers.js";

describe("Meta Provider (Meta Model API)", () => {
  it("registers meta in PROVIDERS with correct base URL and transports", () => {
    const meta = PROVIDERS["meta"];
    expect(meta).toBeDefined();
    expect(meta.baseUrl).toBe("https://api.meta.ai/v1/chat/completions");
    expect(meta.validateUrl).toBe("https://api.meta.ai/v1/models");

    const formats = (meta.transports || []).map((t) => t.format);
    expect(formats).toContain("openai");
    expect(formats).toContain("claude");
    expect(formats).toContain("openai-responses");
  });

  it("contains standard Meta models", () => {
    const models = (PROVIDER_MODELS["meta"] || []).map((m) => m.id);
    expect(models).toContain("muse-spark");
    expect(models).toContain("muse-image-1.0");
    expect(models).toContain("muse-voice-transcribe-1.0");
    expect(models).toContain("sam-3.1");
    expect(models).toContain("llama-3.3-70b-instruct");
  });

  it("resolves alias 'meta' and 'meta-ai'", () => {
    expect(resolveProviderAlias("meta")).toBe("meta");
    expect(resolveProviderAlias("meta-ai")).toBe("meta");
    expect(resolveProviderId("meta")).toBe("meta");
  });
});
