import { describe, expect, it } from "vitest";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { getThinkingLevels } from "../../open-sse/providers/thinkingLevels.js";

describe("getCapabilitiesForModel", () => {
  it("reports DeepSeek V4.1-Flash ids as vision-capable without dropping their thinking/context", () => {
    const v41 = { vision: true, reasoning: true, thinkingFormat: "deepseek", contextWindow: 1000000, maxOutput: 384000 };
    expect(getCapabilitiesForModel(undefined, "deepseek-v4.1-flash")).toMatchObject(v41);
    expect(getCapabilitiesForModel("opencode-go", "deepseek-v4.1-flash")).toMatchObject(v41);
    expect(getCapabilitiesForModel("openrouter", "deepseek/deepseek-v4.1-flash")).toMatchObject(v41);
    // "deepseek-flash" is the GA id for V4.1-Flash on the DeepSeek API; the pattern it
    // used to fall through to gives it 128K/64K, which the exact entry keeps.
    expect(getCapabilitiesForModel("opencode-go", "deepseek-flash")).toMatchObject({
      vision: true,
      reasoning: true,
      thinkingFormat: "deepseek",
      contextWindow: 128000,
      maxOutput: 64000,
    });
    // the superseded text-only Flash id stays text-only
    expect(getCapabilitiesForModel("opencode-go", "deepseek-v4-flash").vision).toBe(false);
  });

  const claudeSonnet5Expected = {
    contextWindow: 1000000,
    maxOutput: 128000,
    thinkingFormat: "claude-adaptive",
    reasoning: true,
    vision: true,
    search: true,
  };

  const kiroGpt56Expected = {
    contextWindow: 272000,
    maxOutput: 128000,
    thinkingFormat: "openai",
    reasoning: true,
    vision: true,
    search: true,
  };

  it("reports Kiro Claude Opus 5 variants as 1M adaptive-thinking models", () => {
    for (const model of [
      "claude-opus-5",
      "anthropic/claude-opus-5",
      "claude-opus-5-thinking",
      "claude-opus-5-agentic",
      "claude-opus-5-thinking-agentic",
    ]) {
      expect(getCapabilitiesForModel("kiro", model)).toMatchObject(claudeSonnet5Expected);
    }
  });

  it("advertises PDF input on current Claude model families", () => {
    for (const model of [
      "claude-fable-5-1",
      "claude-opus-5.5",
      "claude-opus-4.6",
      "claude-opus-4.7",
      "claude-opus-4.8",
      "claude-sonnet-4.6",
      "claude-sonnet-5-5",
    ]) {
      expect(getCapabilitiesForModel("claude", model).pdf, model).toBe(true);
    }
  });

  it("reports Kiro Claude Opus 4.8 as a 1M context model", () => {
    expect(getCapabilitiesForModel("kiro", "claude-opus-4.8").contextWindow).toBe(1000000);
    expect(getCapabilitiesForModel("kiro", "anthropic/claude-opus-4.8").contextWindow).toBe(1000000);
    expect(getCapabilitiesForModel("kiro", "claude-opus-4-8").contextWindow).toBe(1000000);
    expect(getCapabilitiesForModel("kiro", "claude-opus-4.8-thinking").contextWindow).toBe(1000000);
    expect(getCapabilitiesForModel("kiro", "claude-opus-4-8-thinking").contextWindow).toBe(1000000);
  });

  it("reports Kiro Claude Sonnet 5 as a 1M adaptive-thinking model", () => {
    expect(getCapabilitiesForModel("kiro", "claude-sonnet-5")).toMatchObject(claudeSonnet5Expected);
    expect(getCapabilitiesForModel("kiro", "anthropic/claude-sonnet-5")).toMatchObject(claudeSonnet5Expected);
    expect(getCapabilitiesForModel("kiro", "claude-sonnet-5-thinking")).toMatchObject(claudeSonnet5Expected);
    expect(getCapabilitiesForModel("kiro", "claude-sonnet-5-agentic")).toMatchObject(claudeSonnet5Expected);
    expect(getCapabilitiesForModel("kiro", "claude-sonnet-5-thinking-agentic")).toMatchObject(claudeSonnet5Expected);
  });

  it("reports Claude 4.6 thinking variants as adaptive-thinking models", () => {
    for (const model of [
      "claude-opus-4-6-thinking",
      "anthropic/claude-opus-4-6-thinking",
      "claude-sonnet-4-6-thinking",
      "anthropic/claude-sonnet-4-6-thinking",
    ]) {
      expect(getCapabilitiesForModel("antigravity", model)).toMatchObject({
        thinkingFormat: "claude-adaptive",
        reasoning: true,
        vision: true,
        search: true,
      });
    }
  });

  it("reports Kiro GPT 5.6 models with the Kiro 272k context window", () => {
    expect(getCapabilitiesForModel("kiro", "gpt-5.6-sol")).toMatchObject(kiroGpt56Expected);
    expect(getCapabilitiesForModel("kiro", "openai/gpt-5.6-sol")).toMatchObject(kiroGpt56Expected);
    expect(getCapabilitiesForModel("kiro", "gpt-5.6-terra-thinking")).toMatchObject(kiroGpt56Expected);
    expect(getCapabilitiesForModel("kiro", "gpt-5.6-luna-agentic")).toMatchObject(kiroGpt56Expected);
    expect(getCapabilitiesForModel("kiro", "gpt-5.6-sol-thinking-agentic")).toMatchObject(kiroGpt56Expected);
  });

  it("gives every CommandCode model the /alpha/generate thinking format", () => {
    for (const provider of ["commandcode", "cmc"]) {
      expect(getCapabilitiesForModel(provider, "deepseek/deepseek-v4.1-flash")).toMatchObject({
        vision: true,
        reasoning: true,
        thinkingFormat: "commandcode",
        thinkingEffortSupported: true,
      });
      // CLI text-only denylist wins over the default-to-vision rule
      expect(getCapabilitiesForModel(provider, "deepseek/deepseek-v4-flash").vision).toBe(false);
      expect(getCapabilitiesForModel(provider, "deepseek-v4-flash").vision).toBe(false);
      expect(getCapabilitiesForModel(provider, "MiniMaxAI/MiniMax-M3").vision).toBe(true);
    }
  });
});

describe("getThinkingLevels — CommandCode", () => {
  it("exposes the effort levels the CLI passes through unmapped", () => {
    expect(getThinkingLevels("commandcode", "deepseek/deepseek-v4.1-flash")).toEqual([
      "none", "low", "medium", "high", "xhigh", "max",
    ]);
  });
});

describe("opencode-go glm-5.3-flash", () => {
  it("sends reasoning_effort instead of the z.ai thinking object", () => {
    expect(getCapabilitiesForModel("opencode-go", "glm-5.3-flash")).toMatchObject({
      vision: true,
      videoInput: true,
      pdf: true,
      reasoning: true,
      thinkingFormat: "openai",
      thinkingCanDisable: false,
      contextWindow: 1000000,
      maxOutput: 131072,
    });
    expect(getThinkingLevels("opencode-go", "glm-5.3-flash")).toEqual([
      "minimal", "low", "medium", "high", "xhigh",
    ]);
  });
});

describe("OpenCode Free ids newer than the capability tables", () => {
  // ids missing here fall through to DEFAULT_CAPABILITIES (reasoning: false),
  // and applyThinking() then deletes the client's reasoning_effort — see #2690.
  // Modalities/limits are taken verbatim from models.dev.
  it.each([
    ["beam-free", { reasoning: true, vision: false, contextWindow: 1048576, maxOutput: 131072 }],
    ["mimo-v2.6-flash-free", { reasoning: true, vision: true, audioInput: true, videoInput: true, contextWindow: 200000, maxOutput: 32000 }],
    ["nemotron-3.5-super-vl-free", { reasoning: true, vision: true, contextWindow: 1048576, maxOutput: 131072 }],
    ["nemotron-3.5-lightning-free", { reasoning: true, vision: false, contextWindow: 262144, maxOutput: 262144 }],
    ["deepseek-v4.1-flash-free", { reasoning: true, vision: true, thinkingFormat: "deepseek", contextWindow: 200000, maxOutput: 32000 }],
    ["glm-5.3-flash-free", { reasoning: true, vision: true, videoInput: true, pdf: true, contextWindow: 200000, maxOutput: 32000 }],
    ["minimax-m3.1-flash-free", { reasoning: true, vision: true, videoInput: true, contextWindow: 1000000, maxOutput: 512000 }],
  ])("reports current upstream metadata for %s", (model, expected) => {
    expect(getCapabilitiesForModel("opencode", model)).toMatchObject(expected);
  });

  it("keeps per-id modalities and limits instead of a generic floor", () => {
    // text-only, small context — a shared pattern rule would overstate both.
    expect(getCapabilitiesForModel(undefined, "big-pickle")).toMatchObject({
      reasoning: true,
      vision: false,
      contextWindow: 200000,
      maxOutput: 32000,
    });
    expect(getCapabilitiesForModel(undefined, "ring-2.6-1t-free")).toMatchObject({
      reasoning: true,
      vision: false,
      contextWindow: 262000,
      maxOutput: 66000,
    });
    expect(getCapabilitiesForModel(undefined, "exo-free")).toMatchObject({
      reasoning: true,
      vision: true,
      contextWindow: 1048576,
      maxOutput: 131072,
    });
  });
});
