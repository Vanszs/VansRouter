/**
 * Qoder context-window tiers (200K / 400K / 1M).
 *
 * A Qoder model advertises its tiers in model_config.context_config but only sends the
 * IDE-selected max_input_tokens; these tests pin the escalation policy, the payload
 * fields the IDE writes, and the executor wiring (no-op when context_config is absent).
 */
import { describe, it, expect, vi } from "vitest";

const { getQoderModelConfigMock } = vi.hoisted(() => ({ getQoderModelConfigMock: vi.fn() }));
vi.mock("../../open-sse/services/qoderModels.js", async (importOriginal) => ({
  ...(await importOriginal()),
  getQoderModelConfig: getQoderModelConfigMock,
}));

import {
  parseTierTokenCount,
  getQoderContextTiers,
  estimateQoderPromptTokens,
  resolveQoderContextTier,
  applyQoderContextTier,
} from "../../open-sse/shared/qoder/contextTier.js";
import { __test__ as qoderExecutorInternals } from "../../open-sse/executors/qoder.js";

// Shape mirrors the live /algo/api/v2/model/list entry for qmodel_38max.
const MODEL_CONFIG = {
  key: "qmodel_38max",
  display_name: "Qwen3.8-Max",
  is_reasoning: true,
  max_input_tokens: 180_000,
  max_output_tokens: 32_768,
  context_config: [
    { name: "200K", tokenCount: 200_000, isDefault: true },
    { name: "400K", tokenCount: 400_000, isDefault: false },
    { name: "1M", tokenCount: 1_000_000, isDefault: false },
  ],
};

function promptOfTokens(n) {
  // ~4 ASCII chars per token
  return { system: "", messages: [{ role: "user", content: "abcd".repeat(n) }], tools: [] };
}

describe("parseTierTokenCount", () => {
  it("accepts numbers and K/M suffixed strings", () => {
    expect(parseTierTokenCount(204800)).toBe(204800);
    expect(parseTierTokenCount("200K")).toBe(200_000);
    expect(parseTierTokenCount("1M")).toBe(1_000_000);
    expect(parseTierTokenCount("1.5m")).toBe(1_500_000);
    expect(parseTierTokenCount("131072")).toBe(131072);
  });

  it("returns 0 for garbage", () => {
    expect(parseTierTokenCount(null)).toBe(0);
    expect(parseTierTokenCount("big")).toBe(0);
    expect(parseTierTokenCount(-5)).toBe(0);
  });
});

describe("getQoderContextTiers", () => {
  it("sorts tiers ascending and keeps the default flag", () => {
    const tiers = getQoderContextTiers({
      context_config: [
        { name: "1M", tokenCount: 1_000_000 },
        { name: "200K", tokenCount: 200_000, isDefault: true },
      ],
    });
    expect(tiers.map((t) => t.tokenCount)).toEqual([200_000, 1_000_000]);
    expect(tiers[0].isDefault).toBe(true);
    expect(tiers[1].isDefault).toBe(false);
  });

  it("understands camelCase / snake_case variants and derives names", () => {
    const tiers = getQoderContextTiers({
      contextConfig: [{ token_count: "400K", is_default: true }, { max_input_tokens: 1_000_000 }],
    });
    expect(tiers).toEqual([
      { name: "400K", tokenCount: 400_000, isDefault: true },
      { name: "1M", tokenCount: 1_000_000, isDefault: false },
    ]);
  });

  it("returns [] when the model has no tiers", () => {
    expect(getQoderContextTiers({ max_input_tokens: 131072 })).toEqual([]);
    expect(getQoderContextTiers(null)).toEqual([]);
  });
});

describe("estimateQoderPromptTokens", () => {
  it("counts CJK characters as ~1 token each instead of chars/4", () => {
    const ascii = estimateQoderPromptTokens({ messages: [{ role: "user", content: "a".repeat(4000) }] });
    const cjk = estimateQoderPromptTokens({ messages: [{ role: "user", content: "中".repeat(4000) }] });
    expect(ascii).toBeLessThan(1_200);
    expect(cjk).toBeGreaterThan(4_000);
  });
});

describe("resolveQoderContextTier (auto)", () => {
  it("leaves the payload untouched while the prompt fits the current max_input_tokens", () => {
    expect(resolveQoderContextTier(MODEL_CONFIG, promptOfTokens(50_000))).toBeNull();
  });

  it("escalates to the smallest tier that fits once the prompt outgrows the default", () => {
    const choice = resolveQoderContextTier(MODEL_CONFIG, promptOfTokens(250_000));
    expect(choice).not.toBeNull();
    expect(choice.tier.name).toBe("400K");
    expect(choice.reason).toBe("auto:fits");
    expect(choice.estimatedTokens).toBeGreaterThan(240_000);
  });

  it("falls back to the largest tier when nothing fits (upstream decides)", () => {
    const choice = resolveQoderContextTier(MODEL_CONFIG, promptOfTokens(1_200_000));
    expect(choice.tier.name).toBe("1M");
    expect(choice.reason).toBe("auto:largest");
  });

  it("applies headroom so a prompt just under the limit still escalates", () => {
    // 170K estimated * 1.15 = 195.5K > 180K current → smallest tier above the current limit (200K)
    expect(resolveQoderContextTier(MODEL_CONFIG, promptOfTokens(170_000))?.tier.name).toBe("200K");
    // 190K * 1.15 = 218.5K → 200K no longer fits → 400K
    expect(resolveQoderContextTier(MODEL_CONFIG, promptOfTokens(190_000))?.tier.name).toBe("400K");
  });

  it("returns null for models without context_config", () => {
    expect(resolveQoderContextTier({ max_input_tokens: 131072 }, promptOfTokens(500_000))).toBeNull();
  });

  it("never escalates when the current limit is already the largest tier", () => {
    const cfg = { ...MODEL_CONFIG, max_input_tokens: 1_000_000 };
    expect(resolveQoderContextTier(cfg, promptOfTokens(1_500_000))).toBeNull();
  });
});

describe("resolveQoderContextTier (forced via QODER_CONTEXT_TIER)", () => {
  it("max picks the largest tier regardless of prompt size", () => {
    const choice = resolveQoderContextTier(MODEL_CONFIG, promptOfTokens(10), { preference: "max" });
    expect(choice.tier.name).toBe("1M");
    expect(choice.reason).toBe("forced:max");
  });

  it("default picks the isDefault tier", () => {
    const choice = resolveQoderContextTier(MODEL_CONFIG, promptOfTokens(10), { preference: "default" });
    expect(choice.tier.name).toBe("200K");
  });

  it("a tier name or token count selects that tier", () => {
    expect(resolveQoderContextTier(MODEL_CONFIG, promptOfTokens(10), { preference: "400k" }).tier.tokenCount).toBe(400_000);
    expect(resolveQoderContextTier(MODEL_CONFIG, promptOfTokens(10), { preference: "1000000" }).tier.name).toBe("1M");
  });

  it("an unknown tier name falls back to auto", () => {
    expect(resolveQoderContextTier(MODEL_CONFIG, promptOfTokens(10), { preference: "9M" })).toBeNull();
    expect(resolveQoderContextTier(MODEL_CONFIG, promptOfTokens(250_000), { preference: "9M" }).tier.name).toBe("400K");
  });
});

describe("applyQoderContextTier", () => {
  it("mirrors the tier into the three places the IDE writes", () => {
    const payload = {
      parameters: { max_tokens: 32_768 },
      chat_context: { extra: { context: [], modelConfig: { key: "qmodel_38max" } } },
      model_config: { ...MODEL_CONFIG },
    };
    applyQoderContextTier(payload, { name: "1M", tokenCount: 1_000_000 });
    expect(payload.parameters).toEqual({ max_tokens: 32_768, context_length: 1_000_000 });
    expect(payload.chat_context.extra.ideModelConfigOverride).toEqual({ max_input_tokens: 1_000_000 });
    expect(payload.chat_context.extra.modelConfig).toEqual({ key: "qmodel_38max" });
    expect(payload.model_config.max_input_tokens).toBe(1_000_000);
    expect(payload.model_config.context_config).toHaveLength(3);
  });

  it("is a no-op without a tier", () => {
    const payload = { parameters: { max_tokens: 1 } };
    expect(applyQoderContextTier(payload, null)).toBe(payload);
    expect(payload).toEqual({ parameters: { max_tokens: 1 } });
  });
});

describe("buildQoderRequestBody tier wiring", () => {
  const credentials = { providerSpecificData: { userId: "u1" } };
  const { buildQoderRequestBody } = qoderExecutorInternals;

  it("escalates a long prompt and writes context_length into the payload", async () => {
    getQoderModelConfigMock.mockResolvedValueOnce({ ...MODEL_CONFIG });
    const body = { messages: [{ role: "user", content: "abcd".repeat(250_000) }] };
    const { payload } = await buildQoderRequestBody({ model: "qoder/qmodel_38max", body, credentials });
    expect(payload.parameters.context_length).toBe(400_000);
    expect(payload.chat_context.extra.ideModelConfigOverride).toEqual({ max_input_tokens: 400_000 });
    expect(payload.model_config.max_input_tokens).toBe(400_000);
  });

  it("stays a no-op when the model advertises no context_config", async () => {
    getQoderModelConfigMock.mockResolvedValueOnce({ key: "qmodel_38max", max_input_tokens: 180_000 });
    const body = { messages: [{ role: "user", content: "abcd".repeat(250_000) }] };
    const { payload } = await buildQoderRequestBody({ model: "qoder/qmodel_38max", body, credentials });
    expect(payload.parameters).toEqual({ max_tokens: 32_768 });
    expect(payload.chat_context.extra).not.toHaveProperty("ideModelConfigOverride");
  });

  it("stays a no-op while the prompt fits the current tier", async () => {
    getQoderModelConfigMock.mockResolvedValueOnce({ ...MODEL_CONFIG });
    const body = { messages: [{ role: "user", content: "abcd".repeat(1_000) }] };
    const { payload } = await buildQoderRequestBody({ model: "qoder/qmodel_38max", body, credentials });
    expect(payload.parameters).toEqual({ max_tokens: 32_768 });
  });
});
