// Tests for generalized daily quota detection (beyond Kimchi).
import { describe, it, expect } from "vitest";
import {
  detectDailyQuotaExhaustion,
  buildDailyQuotaLockUpdate,
  getModelLockKey,
  MODEL_LOCK_PREFIX,
} from "open-sse/services/accountFallback.js";

describe("detectDailyQuotaExhaustion", () => {
  it("returns daily_quota classification for 'today's quota exhausted'", () => {
    const result = detectDailyQuotaExhaustion("openai", "today's quota exhausted");
    expect(result).not.toBe(null);
    expect(result.kind).toBe("daily_quota");
    expect(result.cooldownMs).toBeGreaterThan(0);
  });

  it("returns daily_quota classification for 'daily quota exhausted'", () => {
    const result = detectDailyQuotaExhaustion("anthropic", "daily quota exhausted");
    expect(result?.kind).toBe("daily_quota");
  });

  it("returns daily_quota classification for 'daily limit reached'", () => {
    const result = detectDailyQuotaExhaustion("gemini", "daily limit reached");
    expect(result?.kind).toBe("daily_quota");
  });

  it("returns daily_quota classification for 'try again tomorrow'", () => {
    const result = detectDailyQuotaExhaustion("openrouter", "Please try again tomorrow");
    expect(result?.kind).toBe("daily_quota");
  });

  it("returns daily_quota for Grok CLI subscription:free-usage-exhausted", () => {
    const result = detectDailyQuotaExhaustion(
      "grok-cli",
      { code: "subscription:free-usage-exhausted", error: "You've used all the included free usage" },
    );
    expect(result?.kind).toBe("daily_quota");
  });

  it("returns daily_quota for nested JSON body with daily quota message", () => {
    const result = detectDailyQuotaExhaustion("openai", { error: { message: "daily quota used up" } });
    expect(result?.kind).toBe("daily_quota");
  });

  it("returns null for plain rate_limit (not daily quota)", () => {
    const result = detectDailyQuotaExhaustion("openai", "Too many requests");
    expect(result).toBe(null);
  });

  it("returns null for monthly quota_exhausted (not daily)", () => {
    const result = detectDailyQuotaExhaustion("openai", "monthly limit reached");
    expect(result).toBe(null);
  });

  it("returns null for Kimchi provider — Kimchi keeps its own next-month logic", () => {
    // Even if the message contains "daily quota", Kimchi is excluded
    const result = detectDailyQuotaExhaustion("kimchi", "daily quota exhausted");
    expect(result).toBe(null);
  });

  it("returns null for empty/null error text", () => {
    expect(detectDailyQuotaExhaustion("openai", "")).toBe(null);
    expect(detectDailyQuotaExhaustion("openai", null)).toBe(null);
    expect(detectDailyQuotaExhaustion("openai", undefined)).toBe(null);
  });
});

describe("buildDailyQuotaLockUpdate", () => {
  it("returns an object with the modelLock_<model> key set", () => {
    const update = buildDailyQuotaLockUpdate("gpt-4", new Date("2026-06-15T12:00:00Z"));
    const key = getModelLockKey("gpt-4");
    expect(update).toHaveProperty(key);
    expect(typeof update[key]).toBe("string");
  });

  it("sets the lock expiry to tomorrow 00:00 UTC", () => {
    const now = new Date("2026-06-15T12:00:00Z");
    const update = buildDailyQuotaLockUpdate("gpt-4", now);
    const key = getModelLockKey("gpt-4");
    const expiry = new Date(update[key]);
    // Tomorrow midnight UTC = 2026-06-16T00:00:00Z
    expect(expiry.toISOString()).toBe("2026-06-16T00:00:00.000Z");
  });

  it("handles midnight UTC edge case (just after midnight)", () => {
    const now = new Date("2026-06-15T00:00:01Z");
    const update = buildDailyQuotaLockUpdate("claude-3", now);
    const key = getModelLockKey("claude-3");
    const expiry = new Date(update[key]);
    // Should lock until 2026-06-16T00:00:00Z
    expect(expiry.toISOString()).toBe("2026-06-16T00:00:00.000Z");
  });

  it("handles just before midnight UTC edge case", () => {
    const now = new Date("2026-06-15T23:59:59Z");
    const update = buildDailyQuotaLockUpdate("claude-3", now);
    const key = getModelLockKey("claude-3");
    const expiry = new Date(update[key]);
    // Should lock until 2026-06-16T00:00:00Z (1 second later)
    expect(expiry.toISOString()).toBe("2026-06-16T00:00:00.000Z");
  });

  it("returns empty object when model is falsy", () => {
    expect(buildDailyQuotaLockUpdate(null)).toEqual({});
    expect(buildDailyQuotaLockUpdate("")).toEqual({});
    expect(buildDailyQuotaLockUpdate(undefined)).toEqual({});
  });

  it("uses the same model lock key format as isModelLockActive", () => {
    const update = buildDailyQuotaLockUpdate("gpt-4");
    const key = getModelLockKey("gpt-4");
    expect(key).toBe(`${MODEL_LOCK_PREFIX}gpt-4`);
    expect(update).toHaveProperty(key);
  });

  it("guarantees a minimum 1s lock (no zero/negative expiry)", () => {
    // Even if somehow called at exact midnight, the lock should be at least 1s
    const now = new Date("2026-06-15T00:00:00.000Z");
    const update = buildDailyQuotaLockUpdate("gpt-4", now);
    const key = getModelLockKey("gpt-4");
    const expiry = new Date(update[key]);
    const diff = expiry.getTime() - now.getTime();
    expect(diff).toBeGreaterThanOrEqual(1000);
  });
});
