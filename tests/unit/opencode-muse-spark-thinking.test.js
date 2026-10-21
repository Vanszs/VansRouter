import { describe, expect, it } from "vitest";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { PROVIDER_MODELS, getModelTargetFormat } from "../../open-sse/config/providerModels.js";
import { OpenCodeExecutor } from "../../open-sse/executors/opencode.js";

const AVAILABLE_FREE_IDS = [
  "beam-free",
  "mimo-v2.6-flash-free",
  "nemotron-3.5-super-vl-free",
  "nemotron-3.5-lightning-free",
  "deepseek-v4.1-flash-free",
  "glm-5.3-flash-free",
  "minimax-m3.1-flash-free",
];

describe("OpenCode Free available catalog", () => {
  it("contains only the verified chat-capable Free IDs", () => {
    // The registry also declares jev-1.13-free, a decision model served on the
    // SystemOne endpoint — it is not a chat model and is not in the chat list.
    const registryIds = PROVIDER_MODELS.oc.map(({ id }) => id);
    expect(registryIds.filter((id) => !AVAILABLE_FREE_IDS.includes(id))).toEqual(["jev-1.13-free"]);
    expect(AVAILABLE_FREE_IDS.every((id) => registryIds.includes(id))).toBe(true);
    expect(getCapabilitiesForModel("opencode", "minimax-m3.1-flash-free")).toMatchObject({
      reasoning: true,
      vision: true,
      videoInput: true,
      contextWindow: 1000000,
      maxOutput: 512000,
    });
  });

  it("routes available models to Chat Completions and exposes verified DeepSeek limits", () => {
    const executor = new OpenCodeExecutor();
    for (const id of AVAILABLE_FREE_IDS) {
      expect(executor.buildUrl(id)).toBe("https://opencode.ai/zen/v1/chat/completions");
    }
    expect(getModelTargetFormat("oc", "deepseek-v4.1-flash-free")).toBeNull();
    expect(getCapabilitiesForModel("opencode", "deepseek-v4.1-flash-free")).toMatchObject({
      reasoning: true,
      vision: true,
      thinkingFormat: "deepseek",
      contextWindow: 200000,
      maxOutput: 32000,
    });
  });
});
