// Verify markAccountUnavailable uses classify429 cooldowns for 429 responses
// instead of generic exponential backoff, and that daily_quota gets the
// until-midnight-UTC cooldown (not overwritten by a shorter backoff).
import { describe, it, expect, vi, beforeEach } from "vitest";

const updateProviderConnection = vi.fn();
const getProviderConnections = vi.fn();

vi.mock("@/lib/localDb", () => ({
  getProviderConnections,
  updateProviderConnection,
  validateApiKey: vi.fn(),
  getSettings: vi.fn(),
  getProviderNodeById: vi.fn(),
}));

// Import after mock
const { markAccountUnavailable } = await import("../../src/sse/services/auth.js");

describe("markAccountUnavailable 429 cooldown classification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getProviderConnections.mockResolvedValue([
      { id: "conn-1", displayName: "Test Account", backoffLevel: 0 }
    ]);
    updateProviderConnection.mockResolvedValue({});
  });

  it("uses 60s cooldown for generic rate_limit 429", async () => {
    const result = await markAccountUnavailable(
      "conn-1", 429, "rate limit exceeded", "openai", "gpt-4o"
    );
    expect(result.shouldFallback).toBe(true);
    expect(result.cooldownMs).toBe(60_000);

    const update = updateProviderConnection.mock.calls[0][1];
    expect(update["modelLock_gpt-4o"]).toBeDefined();
    const lockMs = new Date(update["modelLock_gpt-4o"]).getTime() - Date.now();
    expect(lockMs).toBeGreaterThanOrEqual(59_000);
    expect(lockMs).toBeLessThanOrEqual(61_000);
  });

  it("uses 1h cooldown for quota_exhausted 429", async () => {
    const result = await markAccountUnavailable(
      "conn-1", 429, "monthly limit reached", "openai", "gpt-4o"
    );
    expect(result.shouldFallback).toBe(true);
    expect(result.cooldownMs).toBe(3_600_000);

    const update = updateProviderConnection.mock.calls[0][1];
    const lockMs = new Date(update["modelLock_gpt-4o"]).getTime() - Date.now();
    expect(lockMs).toBeGreaterThanOrEqual(3_590_000);
    expect(lockMs).toBeLessThanOrEqual(3_610_000);
  });

  it("uses until-midnight-UTC cooldown for daily_quota 429", async () => {
    const result = await markAccountUnavailable(
      "conn-1", 429, "today's quota exhausted", "openai", "gpt-4o"
    );
    expect(result.shouldFallback).toBe(true);

    const now = Date.now();
    const tomorrowMidnight = Date.UTC(
      new Date().getUTCFullYear(),
      new Date().getUTCMonth(),
      new Date().getUTCDate() + 1,
      0, 0, 0, 0
    );
    expect(result.cooldownMs).toBeCloseTo(tomorrowMidnight - now, -2);
    expect(result.cooldownMs).toBeGreaterThan(0);
    expect(result.cooldownMs).toBeLessThanOrEqual(24 * 60 * 60 * 1000);

    const update = updateProviderConnection.mock.calls[0][1];
    const lockMs = new Date(update["modelLock_gpt-4o"]).getTime() - now;
    expect(lockMs).toBeGreaterThanOrEqual(result.cooldownMs - 1000);
    expect(lockMs).toBeLessThanOrEqual(result.cooldownMs + 1000);
  });

  it("falls back to checkFallbackError for non-429 errors", async () => {
    const result = await markAccountUnavailable(
      "conn-1", 401, "invalid api key", "openai", "gpt-4o"
    );
    expect(result.shouldFallback).toBe(true);
    // Non-429 uses ERROR_RULES: 401 → 2min
    expect(result.cooldownMs).toBe(2 * 60 * 1000);
  });

  it("still respects provider-specific resetsAtMs override", async () => {
    const resetsAtMs = Date.now() + 90_000;
    const result = await markAccountUnavailable(
      "conn-1", 429, "rate limit exceeded", "openai", "gpt-4o", resetsAtMs
    );
    expect(result.shouldFallback).toBe(true);
    expect(result.cooldownMs).toBeGreaterThanOrEqual(89_000);
    expect(result.cooldownMs).toBeLessThanOrEqual(90_000);
  });

  it("returns no fallback for noauth connection", async () => {
    const result = await markAccountUnavailable(
      "noauth", 429, "rate limit exceeded", "openai", "gpt-4o"
    );
    expect(result.shouldFallback).toBe(false);
    expect(result.cooldownMs).toBe(0);
    expect(updateProviderConnection).not.toHaveBeenCalled();
  });
});
