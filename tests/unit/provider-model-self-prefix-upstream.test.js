// Regression: some registries name models with the provider's own prefix already
// attached (nvidia/nemotron-*, poolside/laguna-*, fal-ai/flux/*). parseModel()
// splits a client model string at the FIRST slash, so parallel requests for the
// id /v1/models advertises arrive with the prefix stripped:
//   "nvidia/nemotron-3-ultra-550b-a55b" -> provider "nvidia", model "nemotron-...".
// findModel() exact-matched only, missed, and the bare id reached NVIDIA, whose
// edge answers "404 page not found" (observed live). The retry in findModel()
// must re-attach the provider prefix for these lookups.
import { describe, it, expect } from "vitest";
import { getModelUpstreamId, getModelType, isValidModel } from "../../open-sse/config/providerModels.js";
import { parseModel } from "../../open-sse/services/model.js";

describe("self-prefixed registry ids resolve to their full upstream id", () => {
  it("nvidia: bare model resolves to the org-prefixed registry id", () => {
    expect(getModelUpstreamId("nvidia", "nemotron-3-ultra-550b-a55b"))
      .toBe("nvidia/nemotron-3-ultra-550b-a55b");
    expect(getModelUpstreamId("nvidia", "nemotron-3-super-120b-a12b"))
      .toBe("nvidia/nemotron-3-super-120b-a12b");
  });

  it("poolside and fal-ai (slash-bearing ids) resolve too", () => {
    expect(getModelUpstreamId("poolside", "laguna-s-2.1")).toBe("poolside/laguna-s-2.1");
    expect(getModelUpstreamId("fal-ai", "flux/schnell")).toBe("fal-ai/flux/schnell");
  });

  it("exact ids are unchanged", () => {
    expect(getModelUpstreamId("nvidia", "nvidia/nemotron-3-ultra-550b-a55b"))
      .toBe("nvidia/nemotron-3-ultra-550b-a55b");
    expect(getModelUpstreamId("nvidia", "moonshotai/kimi-k2.6")).toBe("moonshotai/kimi-k2.6");
  });

  it("does not hijack another provider's namespaced model", () => {
    // openrouter serves poolside models under its own namespace; the alias/id
    // retry must not rewrite them to a nonexistent openrouter/local id.
    expect(getModelUpstreamId("openrouter", "poolside/laguna-s-2.1-free"))
      .toBe("poolside/laguna-s-2.1-free");
    // unknown provider falls through to the raw id
    expect(getModelUpstreamId("doesnotexist", "whatever")).toBe("whatever");
  });

  it("preserves Kiro dash/dot version normalization", () => {
    expect(getModelUpstreamId("kr", "claude-sonnet-4-5")).toBe("claude-sonnet-4.5");
  });

  it("getModelType/isValidModel agree with the retry", () => {
    // fal-ai entries declare kind:"image"; resolution must go through the retry.
    expect(getModelType("fal-ai", "flux/schnell")).toBe("image");
    expect(getModelType("nvidia", "nemotron-3-ultra-550b-a55b")).toBe(null);
    expect(isValidModel("nvidia", "nemotron-3-ultra-550b-a55b")).toBe(true);
  });

  it("both client forms the gateway accepts converge on one upstream id", () => {
    // Combo members carry the fully-qualified double form (picker stores
    // `${alias}/${registryId}`), while /v1/models advertises the single form.
    const combo = parseModel("nvidia/nvidia/nemotron-3-ultra-550b-a55b");
    const direct = parseModel("nvidia/nemotron-3-ultra-550b-a55b");
    expect(combo.provider).toBe("nvidia");
    expect(direct.provider).toBe("nvidia");
    const comboUpstream = getModelUpstreamId(combo.provider, combo.model);
    const directUpstream = getModelUpstreamId(direct.provider, direct.model);
    expect(comboUpstream).toBe("nvidia/nemotron-3-ultra-550b-a55b");
    expect(directUpstream).toBe(comboUpstream);
  });
});
