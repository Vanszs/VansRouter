import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: vi.fn(async () => []),
  getCombos: vi.fn(async () => [
    { id: "1", name: "probe-combo", kind: null, models: ["opencode-go/deepseek-v4-pro", "opencode-go/mimo-v2.5"] },
    { id: "2", name: "web-probe", kind: "webSearch", models: ["tavily/search"] },
  ]),
  getCustomModels: vi.fn(async () => []),
  getModelAliases: vi.fn(async () => ({})),
  getCachedProviderModels: vi.fn(async () => []),
  saveCachedProviderModels: vi.fn(async () => {}),
}));
vi.mock("@/lib/disabledModelsDb", () => ({ getDisabledModels: vi.fn(async () => ({})) }));

import { aggregateComboCapabilities } from "../../open-sse/services/combo.js";
import { DEFAULT_CAPABILITIES } from "../../open-sse/providers/capabilities.js";
import { buildModelsList } from "../../src/sse/services/allowedModels.js";

// Fixture models (fork capability table):
//   mimo-v2.5        vision, 1048576 ctx / 131072 out, tools
//   mimo-omni-x      vision + audioInput
//   deepseek-v4-pro  text-only, deepseek reasoning, 1000000 / 384000
//   kimi-k2.5        vision, kimi reasoning, 262144 / 262144
//   gpt-5            search, openai reasoning
//   gpt-image-1      no tools

describe("aggregateComboCapabilities — empty input", () => {
  it("returns null for null and empty array", () => {
    expect(aggregateComboCapabilities(null)).toBeNull();
    expect(aggregateComboCapabilities([])).toBeNull();
  });

  it("ignores non-string members instead of throwing", () => {
    expect(aggregateComboCapabilities([123, null, {}])).toBeNull();
  });
});

describe("aggregateComboCapabilities — single target passthrough", () => {
  it("keeps the target's own capabilities and limits", () => {
    const caps = aggregateComboCapabilities(["opencode-go/mimo-v2.5"]);
    expect(caps.vision).toBe(true);
    expect(caps.tools).toBe(true);
    expect(caps.contextWindow).toBe(1048576);
    expect(caps.maxOutput).toBe(131072);
  });

  it("accepts a member without a provider prefix", () => {
    const caps = aggregateComboCapabilities(["mimo-v2.5"]);
    expect(caps.vision).toBe(true);
    expect(caps.contextWindow).toBe(1048576);
  });
});

describe("aggregateComboCapabilities — union of features", () => {
  it("vision is true when any target reads images", () => {
    const caps = aggregateComboCapabilities(["opencode-go/deepseek-v4-pro", "opencode-go/mimo-v2.5"]);
    expect(caps.vision).toBe(true);
  });

  it("vision is false when no target reads images", () => {
    const caps = aggregateComboCapabilities(["opencode-go/deepseek-v4-pro", "deepseek/deepseek-v4-pro"]);
    expect(caps.vision).toBe(false);
  });

  it("audioInput and search come from whichever target has them", () => {
    expect(aggregateComboCapabilities(["opencode-go/mimo-v2.5", "xiaomi/mimo-omni-x"]).audioInput).toBe(true);
    expect(aggregateComboCapabilities(["openai/gpt-5", "opencode-go/mimo-v2.5"]).search).toBe(true);
  });
});

describe("aggregateComboCapabilities — tools intersected", () => {
  it("tools is false when one target cannot call them", () => {
    const caps = aggregateComboCapabilities(["openai/gpt-5", "openai/gpt-image-1"]);
    expect(caps.tools).toBe(false);
  });

  it("tools is true when every target supports them", () => {
    const caps = aggregateComboCapabilities(["opencode-go/mimo-v2.5", "kimi/kimi-k2.5"]);
    expect(caps.tools).toBe(true);
  });
});

describe("aggregateComboCapabilities — reasoning follows the primary target", () => {
  it("thinking fields come from the first target", () => {
    const caps = aggregateComboCapabilities(["opencode-go/deepseek-v4-pro", "kimi/kimi-k2.5"]);
    expect(caps.reasoning).toBe(true);
    expect(caps.thinkingFormat).toBe("deepseek");
  });

  it("flipping the order switches the reasoning format", () => {
    const caps = aggregateComboCapabilities(["kimi/kimi-k2.5", "opencode-go/deepseek-v4-pro"]);
    expect(caps.thinkingFormat).toBe("kimi");
  });
});

describe("aggregateComboCapabilities — limits", () => {
  it("contextWindow is the smallest window that works for every target", () => {
    const caps = aggregateComboCapabilities(["opencode-go/deepseek-v4-pro", "kimi/kimi-k2.5"]);
    expect(caps.contextWindow).toBe(262144);
  });

  it("maxOutput is the largest output any target offers", () => {
    const caps = aggregateComboCapabilities(["opencode-go/deepseek-v4-pro", "kimi/kimi-k2.5"]);
    expect(caps.maxOutput).toBe(384000);
  });
});

describe("aggregateComboCapabilities — nested combos via comboLookup", () => {
  const lookup = {
    "inner-combo": ["opencode-go/deepseek-v4-pro", "opencode-go/mimo-v2.5"],
    "outer-combo": ["combo/inner-combo", "kimi/kimi-k2.5"],
  };

  it("unions capabilities of a nested combo's members", () => {
    const caps = aggregateComboCapabilities(["inner-combo"], lookup);
    expect(caps.vision).toBe(true);
    expect(caps.contextWindow).toBe(1000000);
  });

  it("resolves a nested reference written as combo/<name>", () => {
    const caps = aggregateComboCapabilities(["outer-combo"], lookup);
    expect(caps.vision).toBe(true);
    expect(caps.contextWindow).toBe(262144);
  });

  it("mixes nested and direct members", () => {
    const caps = aggregateComboCapabilities(["outer-combo", "openai/gpt-5"], lookup);
    expect(caps.search).toBe(true);
    expect(caps.thinkingFormat).toBe("deepseek");
  });

  it("survives a reference cycle", () => {
    const cyclic = { a: ["b"], a2: ["a"], b: ["a2"] };
    expect(() => aggregateComboCapabilities(["a"], cyclic)).not.toThrow();
  });

  it("unknown bare name falls back to pattern matching, not a crash", () => {
    const caps = aggregateComboCapabilities(["no-such-combo"], { other: ["openai/gpt-5"] });
    expect(caps.contextWindow).toBe(DEFAULT_CAPABILITIES.contextWindow);
    expect(caps.vision).toBe(false);
  });
});

describe("buildModelsList — combo capability metadata on /v1/models", () => {
  it("combo entry exposes aggregated capabilities and derived limits", async () => {
    const list = await buildModelsList(["llm"], { skipDynamicFetch: true });
    const combo = list.find((m) => m.id === "combo/probe-combo");

    expect(combo.owned_by).toBe("combo");
    expect(combo.capabilities.vision).toBe(true); // union: mimo-v2.5 reads images
    expect(combo.capabilities.thinkingFormat).toBe("deepseek"); // primary target
    expect(combo.context_length).toBe(1000000); // min across targets
    expect(combo.max_completion_tokens).toBe(384000); // max across targets
  });

  it("web combos keep their kind instead of capability metadata", async () => {
    const list = await buildModelsList(["webSearch"], { skipDynamicFetch: true });
    const combo = list.find((m) => m.id === "combo/web-probe");

    expect(combo.kind).toBe("webSearch");
    expect(combo.capabilities).toBeUndefined();
  });
});
