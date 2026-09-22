// Scoped weekly windows (Fable) arrive in limits[], not as seven_day_* keys:
// parse them, and never fabricate the row when the account has no such window.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn(),
}));

import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import { getUsageForProvider } from "../../open-sse/services/usage.js";
import { PROVIDERS } from "../../open-sse/providers/index.js";
import {
  parseQuotaData,
  getRemainingPercentage,
} from "../../src/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js";

const RESET = "2026-09-29T00:00:00Z";

const WINDOWS = {
  five_hour: { utilization: 12, resets_at: RESET },
  seven_day: { utilization: 40, resets_at: RESET },
};

function jsonResponse(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function fetchClaudeUsage(accessToken, payload) {
  proxyAwareFetch.mockResolvedValueOnce(jsonResponse(payload));
  return getUsageForProvider({ provider: "claude", accessToken });
}

describe("claude scoped weekly limits (limits[])", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("parses weekly_scoped limits[] into weekly <model> (7d) rows", async () => {
    const usage = await fetchClaudeUsage("limits-token", {
      ...WINDOWS,
      limits: [
        { kind: "weekly_scoped", percent: 87, resets_at: RESET, scope: { model: { display_name: "Fable" } } },
        { kind: "weekly_scoped", percent: 5, resets_at: RESET, scope: { model: { display_name: "Opus" } } },
        { kind: "session", percent: 99, resets_at: RESET },
      ],
    });

    expect(usage.quotas["weekly fable (7d)"]).toMatchObject({
      used: 87,
      total: 100,
      remaining: 13,
      remainingPercentage: 13,
    });
    expect(usage.quotas["weekly opus (7d)"].used).toBe(5);
    expect(usage.quotas["session (5h)"].used).toBe(12);
    expect(Object.keys(usage.quotas)).not.toContain("weekly session (7d)");
    // Positive control: the OAuth usage payload is what fed the parse.
    expect(proxyAwareFetch.mock.calls[0][0]).toBe(PROVIDERS.claude.usage.oauthUrl);
  });

  it("reaches the dashboard quota table as a remaining percentage", async () => {
    const usage = await fetchClaudeUsage("dashboard-token", {
      ...WINDOWS,
      limits: [{ kind: "weekly_scoped", percent: 87, resets_at: RESET, scope: { model: { display_name: "Fable" } } }],
    });

    const fable = parseQuotaData("claude", usage).find((row) => row.name === "weekly fable (7d)");
    expect(fable).toBeDefined();
    expect(getRemainingPercentage(fable)).toBe(13);
  });

  it("omits the row when the account has no scoped window", async () => {
    const usage = await fetchClaudeUsage("no-limits-token", WINDOWS);

    expect(Object.keys(usage.quotas)).not.toContain("weekly fable (7d)");
    expect(usage.quotas["weekly (7d)"].used).toBe(40);
  });

  it("clamps out-of-range percent and skips malformed scoped limits", async () => {
    const usage = await fetchClaudeUsage("clamp-token", {
      limits: [
        { kind: "weekly_scoped", percent: 140, scope: { model: { display_name: "Fable" } } },
        { kind: "weekly_scoped", percent: "high", scope: { model: { display_name: "Sonnet" } } },
        { kind: "weekly_scoped", percent: 20, scope: {} },
      ],
    });

    expect(usage.quotas["weekly fable (7d)"].used).toBe(100);
    expect(Object.keys(usage.quotas)).toEqual(["weekly fable (7d)"]);
  });
});
