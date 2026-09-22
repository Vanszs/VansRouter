import { describe, expect, it } from "vitest";
import { budgetToLevel } from "../../open-sse/translator/concerns/thinking.js";
import { applyThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

// budgetToLevel is the reverse of LEVEL_TO_BUDGET: the xhigh/max boundary sits
// at the midpoint of their budgets (32768 / 128000 = 80384). A larger budget
// used to clamp to "xhigh", leaving "max" unreachable from budget_tokens.
describe("budgetToLevel reaches max tier", () => {
  it("budget 98304 → \"max\"", () => {
    expect(budgetToLevel(98304)).toBe("max");
  });

  it("budget 128000 → \"max\"", () => {
    expect(budgetToLevel(128000)).toBe("max");
  });

  it("budget 80385 → \"max\" (just above midpoint)", () => {
    expect(budgetToLevel(80385)).toBe("max");
  });

  it("budget 80384 → \"xhigh\" (midpoint still xhigh)", () => {
    expect(budgetToLevel(80384)).toBe("xhigh");
  });

  it("budget 31999 stays \"xhigh\"", () => {
    expect(budgetToLevel(31999)).toBe("xhigh");
  });
});

describe("applyThinking: a large budget reaches the max tier on an adaptive upstream", () => {
  // The openai wire clamps "max"→"xhigh" on purpose (its enum stops at xhigh),
  // so the reachable consumer of the new tier is the claude-adaptive effort path.
  it("budget 98304 → output_config.effort \"max\" for claude-opus-4.7", () => {
    const body = { thinking: { type: "enabled", budget_tokens: 98304 } };
    const out = applyThinking(FORMATS.CLAUDE, "claude-opus-4.7", body, "anthropic");
    expect(out?.output_config?.effort).toBe("max");
  });
});
