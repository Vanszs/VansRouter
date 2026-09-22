import { describe, expect, it } from "vitest";

import REGISTRY from "../../open-sse/providers/registry/index.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { getThinkingLevels } from "../../open-sse/providers/thinkingLevels.js";

describe("CodeBuddy international registry parity", () => {
  it("matches CodeBuddy CN model coverage and transport capability", () => {
    const cn = REGISTRY.find((entry) => entry.id === "codebuddy-cn");
    const intl = REGISTRY.find((entry) => entry.id === "codebuddy-intl");

    expect(intl).toBeDefined();
    expect(intl.models.map(({ id }) => id)).toEqual(cn.models.map(({ id }) => id));
    expect(intl.transport.thinkingFormat).toBe(cn.transport.thinkingFormat);
    expect(intl.transport.forceStream).toBe(cn.transport.forceStream);
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
