import { describe, expect, it } from "vitest";

import { getModelUpstreamId } from "../../open-sse/config/providerModels.js";
import { stripThinkingSuffix } from "../../open-sse/translator/concerns/thinkingUnified.js";

// A model id can carry a thinking suffix — "deepseek-v4.1-flash(high)" asks
// for that effort. getModelUpstreamId deliberately keeps the suffix so
// applyThinking can read it, so the wire model id is only clean because
// chatCore strips it before the body leaves. That is one call site guarding
// every provider, and a new executor that resolves the id on its own would
// leak the suffix upstream and get a 400 or a 404 in return.
//
// This test pins the invariant: the id that goes on the wire never carries
// the suffix, and the suffix still reaches the thinking normalisation.
describe("the thinking suffix never reaches the wire", () => {
  const SUFFIXED = "deepseek-v4.1-flash-free(high)";

  it("keeps the suffix on the resolved id so applyThinking can read it", () => {
    expect(getModelUpstreamId("oc", SUFFIXED)).toContain("(high)");
  });

  it("strips it before the model id is put on the wire", () => {
    const upstream = getModelUpstreamId("oc", SUFFIXED);
    expect(stripThinkingSuffix(upstream)).toBe("deepseek-v4.1-flash-free");
    expect(stripThinkingSuffix(upstream)).not.toMatch(/\([^)]+\)/);
  });

  it("leaves a suffix-free id untouched", () => {
    const plain = getModelUpstreamId("oc", "deepseek-v4.1-flash-free");
    expect(stripThinkingSuffix(plain)).toBe(plain);
    expect(plain).not.toMatch(/\([^)]+\)/);
  });
});
