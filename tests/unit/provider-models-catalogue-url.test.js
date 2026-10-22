import { describe, expect, it } from "vitest";

import { PROVIDERS, PROVIDER_MEDIA } from "../../open-sse/providers/index.js";
import { deriveValidateUrl } from "../../open-sse/providers/schema.js";

// The catalogue a provider serves is declared in the registry as
// `modelsFetcher.url`. Deriving it from the chat base instead points at the
// wrong path — the OpenCode Free lane's base is https://opencode.ai, so the
// derived URL was https://opencode.ai/models while the catalogue lives at
// https://opencode.ai/zen/v1/models (issue #166).
function resolveModelsUrl(providerId) {
  const regCfg = PROVIDERS[providerId];
  return PROVIDER_MEDIA[providerId]?.modelsFetcher?.url || deriveValidateUrl(regCfg);
}

describe("provider models catalogue URL (issue #166)", () => {
  it("uses the registry's modelsFetcher URL for the OpenCode Free lane", () => {
    expect(resolveModelsUrl("opencode")).toBe("https://opencode.ai/zen/v1/models");
    expect(resolveModelsUrl("opencode-zen")).toBe("https://opencode.ai/zen/v1/models");
  });

  it("never derives the OpenCode Free catalogue from the chat base", () => {
    const derived = deriveValidateUrl(PROVIDERS.opencode);
    expect(derived).toBe("https://opencode.ai/models");
    expect(resolveModelsUrl("opencode")).not.toBe(derived);
  });

  it("leaves the providers without a modelsFetcher on the derived URL", () => {
    expect(resolveModelsUrl("openai")).toBe("https://api.openai.com/v1/models");
    expect(resolveModelsUrl("anthropic")).toBe("https://api.anthropic.com/v1/models");
  });
});
