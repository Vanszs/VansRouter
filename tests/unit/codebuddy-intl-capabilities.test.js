import { describe, expect, it } from "vitest";

import REGISTRY from "../../open-sse/providers/registry/index.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { getThinkingLevels } from "../../open-sse/providers/thinkingLevels.js";

describe("CodeBuddy international registry parity", () => {
  it("keeps the CodeBuddy CN and international transport capability in step", () => {
    const cn = REGISTRY.find((entry) => entry.id === "codebuddy-cn");
    const intl = REGISTRY.find((entry) => entry.id === "codebuddy-intl");

    expect(intl).toBeDefined();
    // The model lists are NOT the same any more: each gateway publishes its own
    // product-config payload, and the CN one was re-synced against the
    // 2026-09-30 server snapshot (upstream 63de82b8e). What still has to hold
    // is that both registries speak the same transport dialect.
    expect(intl.transport.thinkingFormat).toBe(cn.transport.thinkingFormat);
    expect(intl.transport.forceStream).toBe(cn.transport.forceStream);
  });

  it("keeps the model catalogues distinct where the gateways differ", () => {
    const cn = REGISTRY.find((entry) => entry.id === "codebuddy-cn");
    const intl = REGISTRY.find((entry) => entry.id === "codebuddy-intl");
    const cnIds = cn.models.map(({ id }) => id);
    const intlIds = intl.models.map(({ id }) => id);

    // CN follows the 2026-09-30 server snapshot.
    expect(cnIds).toContain("glm-5.3");
    expect(cnIds).toContain("hy4-preview");
    expect(cnIds).toContain("kimi-k3-1");
    // INTL still publishes the older catalogue.
    expect(intlIds).toContain("glm-5.0");
    expect(intlIds).toContain("hy3-preview");
    expect(intlIds).not.toContain("glm-5.3");
    // The DeepSeek entries are common to both.
    for (const id of ["deepseek-v4-pro", "deepseek-v4.1-flash"]) {
      expect(cnIds, id).toContain(id);
      expect(intlIds, id).toContain(id);
    }
  });

  it("resolves usage capability parity for every CodeBuddy model", () => {
    const intl = REGISTRY.find((entry) => entry.id === "codebuddy-intl");
    for (const { id } of intl.models) {
      const capabilities = getCapabilitiesForModel("codebuddy-intl", id);
      expect(capabilities.reasoning, id).toBe(true);
      expect(capabilities.thinkingFormat, id).toBeDefined();
    }
  });

  it("keeps deepseek-v4.1-flash on the gateway's OpenAI reasoning_effort path", () => {
    expect(getCapabilitiesForModel("codebuddy-intl", "deepseek-v4.1-flash")).toMatchObject({
      vision: true,
      reasoning: true,
      thinkingFormat: "openai",
      contextWindow: 1000000,
      maxOutput: 128000,
    });
    expect(getThinkingLevels("codebuddy-intl", "deepseek-v4.1-flash")).toEqual(["low", "high", "xhigh"]);
  });
});
