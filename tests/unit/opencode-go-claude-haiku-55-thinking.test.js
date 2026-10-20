import { describe, expect, it } from "vitest";
import { applyThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";

const claudeWireBody = () => ({
  model: "claude-haiku-5-5",
  max_tokens: 4096,
  thinking: { type: "enabled", budget_tokens: 8000 },
  messages: [{ role: "user", content: "hi" }],
});

describe("opencode-go claude-haiku-5-5 thinking shape", () => {
  it("capability override selects adaptive for this provider only", () => {
    expect(getCapabilitiesForModel("opencode-go", "claude-haiku-5-5").thinkingFormat).toBe("claude-adaptive");
    expect(getCapabilitiesForModel(undefined, "claude-haiku-5-5").thinkingFormat).toBe("claude-budget");
  });

  it("emits thinking.type=adaptive + output_config.effort (never type=enabled)", () => {
    const body = applyThinking("claude", "claude-haiku-5-5", claudeWireBody(), "opencode-go");

    expect(body.thinking?.type).toBe("adaptive");
    expect(body.thinking).not.toHaveProperty("budget_tokens");
    expect(body.output_config?.effort).toBeTruthy();
  });

  it("other providers keep the budget shape for the same model id", () => {
    const body = applyThinking("claude", "claude-haiku-5-5", claudeWireBody(), "claude");

    expect(body.thinking?.type).toBe("enabled");
    expect(body.thinking?.budget_tokens).toBeGreaterThan(0);
    expect(body.output_config).toBeUndefined();
  });
});
