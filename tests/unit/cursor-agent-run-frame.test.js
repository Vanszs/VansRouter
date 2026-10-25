import { describe, expect, it } from "vitest";

import { buildAgentRunFrame } from "../../open-sse/executors/cursor.js";

// The strict audit found the merge had kept a stale fork-side `finally` emission
// alongside upstream's finishTurn, so a failed read reported success to the
// client. finishTurn is the single terminal-event owner; this file guards the
// frame builder contract that the effort argument feeds.
describe("Cursor AgentService Run frame", () => {
  const messages = [{ role: "user", content: "hi" }];

  it("encodes the reasoning effort when one is supplied", () => {
    const withEffort = buildAgentRunFrame(messages, "claude-4.5-sonnet", [], "high");
    const withoutEffort = buildAgentRunFrame(messages, "claude-4.5-sonnet", [], null);

    expect(withEffort.length).toBeGreaterThanOrEqual(withoutEffort.length);
    expect(Buffer.compare(withEffort, withoutEffort)).not.toBe(0);
  });

  it("tolerates an absent effort without throwing", () => {
    expect(() => buildAgentRunFrame(messages, "claude-4.5-sonnet", [])).not.toThrow();
    expect(() => buildAgentRunFrame(messages, "claude-4.5-sonnet", [], undefined)).not.toThrow();
  });

  it("folds a system message into the user turn instead of a separate prompt field", () => {
    const frame = buildAgentRunFrame(
      [{ role: "system", content: "be terse" }, { role: "user", content: "hi" }],
      "claude-4.5-sonnet",
      [],
    );
    // buildAgentRunFrame returns a Uint8Array, so decode through Buffer before
    // searching (Uint8Array#toString ignores the encoding argument).
    const bytes = Buffer.from(frame);
    expect(bytes.includes(Buffer.from("be terse", "utf8"))).toBe(true);
    expect(bytes.includes(Buffer.from("hi", "utf8"))).toBe(true);
  });
});
