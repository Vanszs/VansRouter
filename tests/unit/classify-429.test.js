// Tests for classify429 — 429 response classification.
import { describe, it, expect } from "vitest";
import {
  classify429,
  classify429FromError,
  looksLikeDailyQuota,
  looksLikeQuotaExhausted,
  getMsUntilTomorrowMidnightUTC,
  parseRetryAfter,
  retryAfterFromResponse,
  RATE_LIMIT_COOLDOWN_MS,
  QUOTA_EXHAUSTED_COOLDOWN_MS,
} from "open-sse/utils/classify429.js";

describe("classify429 — constants", () => {
  it("rate_limit cooldown is ~60s", () => {
    expect(RATE_LIMIT_COOLDOWN_MS).toBe(60_000);
  });
  it("quota_exhausted cooldown is ~1h", () => {
    expect(QUOTA_EXHAUSTED_COOLDOWN_MS).toBe(3_600_000);
  });
});

describe("classify429 — rate_limit (default)", () => {
  it("classifies a bare 429 with no body as rate_limit", () => {
    const result = classify429({ status: 429 });
    expect(result.kind).toBe("rate_limit");
    expect(result.cooldownMs).toBe(RATE_LIMIT_COOLDOWN_MS);
  });

  it("classifies a 429 with a generic 'too many requests' message as rate_limit", () => {
    const result = classify429({ status: 429, body: "Too many requests" });
    expect(result.kind).toBe("rate_limit");
  });

  it("classifies a 429 with JSON body { error: { message: 'rate limited' } } as rate_limit", () => {
    const result = classify429({ status: 429, body: { error: { message: "rate limited, retry later" } } });
    expect(result.kind).toBe("rate_limit");
  });

  it("returns rate_limit fallback when response is null/undefined", () => {
    expect(classify429(null).kind).toBe("rate_limit");
    expect(classify429(undefined).kind).toBe("rate_limit");
  });

  it("treats a 429 without quota keywords as rate_limit even with a body", () => {
    const result = classify429({ status: 429, body: "Request was throttled" });
    expect(result.kind).toBe("rate_limit");
  });
});

describe("classify429 — quota_exhausted", () => {
  it("classifies 'insufficient_quota' as quota_exhausted", () => {
    const result = classify429({ status: 429, body: "insufficient_quota" });
    expect(result.kind).toBe("quota_exhausted");
    expect(result.cooldownMs).toBe(QUOTA_EXHAUSTED_COOLDOWN_MS);
  });

  it("classifies 'monthly limit reached' as quota_exhausted", () => {
    const result = classify429({ status: 429, body: "You have reached your monthly limit" });
    expect(result.kind).toBe("quota_exhausted");
  });

  it("classifies 'out of credits' as quota_exhausted", () => {
    const result = classify429({ status: 429, body: "You are out of credits" });
    expect(result.kind).toBe("quota_exhausted");
  });

  it("classifies nested JSON { error: { message: 'insufficient quota' } } as quota_exhausted", () => {
    const result = classify429({ status: 429, body: { error: { message: "insufficient quota for this plan" } } });
    expect(result.kind).toBe("quota_exhausted");
  });

  it("classifies 'billing required' as quota_exhausted", () => {
    const result = classify429({ status: 429, body: "billing required to continue" });
    expect(result.kind).toBe("quota_exhausted");
  });

  it("classifies 'individual quota reached' as quota_exhausted", () => {
    const result = classify429({ status: 429, body: "Individual quota reached. Contact your administrator." });
    expect(result.kind).toBe("quota_exhausted");
  });
});

describe("classify429 — daily_quota", () => {
  it("classifies 'today's quota exhausted' as daily_quota", () => {
    const result = classify429({ status: 429, body: "today's quota exhausted" });
    expect(result.kind).toBe("daily_quota");
  });

  it("classifies 'daily quota exhausted' as daily_quota", () => {
    const result = classify429({ status: 429, body: "daily quota exhausted" });
    expect(result.kind).toBe("daily_quota");
  });

  it("classifies 'daily limit reached' as daily_quota", () => {
    const result = classify429({ status: 429, body: "daily limit reached" });
    expect(result.kind).toBe("daily_quota");
  });

  it("classifies 'try again tomorrow' as daily_quota", () => {
    const result = classify429({ status: 429, body: "Please try again tomorrow" });
    expect(result.kind).toBe("daily_quota");
  });

  it("classifies 'reset tomorrow' as daily_quota", () => {
    const result = classify429({ status: 429, body: "Your quota will reset tomorrow" });
    expect(result.kind).toBe("daily_quota");
  });

  it("daily_quota cooldown is until tomorrow midnight (1s to ~24h range)", () => {
    const result = classify429({ status: 429, body: "daily quota exhausted" });
    expect(result.cooldownMs).toBeGreaterThan(0);
    expect(result.cooldownMs).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
  });
});

describe("classify429 — Grok CLI free-usage-exhausted is daily_quota (00:00 UTC)", () => {
  it("classifies subscription:free-usage-exhausted JSON as daily_quota", () => {
    const body = {
      code: "subscription:free-usage-exhausted",
      error: "You've used all the included free usage",
    };
    const result = classify429({ status: 429, body, provider: "grok-cli" });
    expect(result.kind).toBe("daily_quota");
    expect(result.cooldownMs).toBeGreaterThan(0);
    expect(result.cooldownMs).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
  });

  it("classifies 'You've used all the included free usage' as daily_quota", () => {
    const result = classify429({
      status: 429,
      body: "You've used all the included free usage",
      provider: "grok-cli",
    });
    expect(result.kind).toBe("daily_quota");
  });

  it("classifies 'free usage exhausted' as daily_quota", () => {
    const result = classify429({ status: 429, body: "free usage exhausted", provider: "grok-cli" });
    expect(result.kind).toBe("daily_quota");
  });

  it("does not treat plain rate-limit text as daily_quota", () => {
    const result = classify429({ status: 429, body: "rate limit exceeded", provider: "grok-cli" });
    expect(result.kind).toBe("rate_limit");
    expect(result.cooldownMs).toBe(RATE_LIMIT_COOLDOWN_MS);
  });
});

describe("classify429 — daily_quota takes priority over quota_exhausted", () => {
  it("classifies 'daily quota exceeded' as daily_quota (not quota_exhausted)", () => {
    // "exceed.*quota" would match quota_exhausted, but "daily" prefix makes it daily_quota
    const result = classify429({ status: 429, body: "daily quota exceeded" });
    expect(result.kind).toBe("daily_quota");
  });
});

describe("classify429FromError", () => {
  it("classifies a fetch-style error { status, body }", () => {
    const result = classify429FromError({ status: 429, body: "insufficient quota" });
    expect(result.kind).toBe("quota_exhausted");
  });

  it("classifies an axios-style error { response: { status, data } }", () => {
    const result = classify429FromError({ response: { status: 429, data: "daily limit reached" } });
    expect(result.kind).toBe("daily_quota");
  });

  it("falls back to err.message as body", () => {
    const result = classify429FromError({ status: 429, message: "out of credits" });
    expect(result.kind).toBe("quota_exhausted");
  });

  it("returns null for non-429 status", () => {
    const result = classify429FromError({ status: 500, body: "server error" });
    expect(result).toBe(null);
  });

  it("returns null for non-object errors", () => {
    expect(classify429FromError(null)).toBe(null);
    expect(classify429FromError("string")).toBe(null);
    expect(classify429FromError(42)).toBe(null);
  });

  it("classifies a 429 error with statusCode alias", () => {
    const result = classify429FromError({ statusCode: 429, body: "too many requests" });
    expect(result.kind).toBe("rate_limit");
  });
});

describe("looksLikeDailyQuota / looksLikeQuotaExhausted", () => {
  it("looksLikeDailyQuota returns false for empty/null body", () => {
    expect(looksLikeDailyQuota("")).toBe(false);
    expect(looksLikeDailyQuota(null)).toBe(false);
    expect(looksLikeDailyQuota(undefined)).toBe(false);
  });

  it("looksLikeQuotaExhausted returns false for empty/null body", () => {
    expect(looksLikeQuotaExhausted("")).toBe(false);
    expect(looksLikeQuotaExhausted(null)).toBe(false);
    expect(looksLikeQuotaExhausted(undefined)).toBe(false);
  });

  it("looksLikeQuotaExhausted returns true for monthly limit", () => {
    expect(looksLikeQuotaExhausted("monthly limit reached")).toBe(true);
  });

  it("looksLikeDailyQuota returns true for today's quota", () => {
    expect(looksLikeDailyQuota("today's quota used up")).toBe(true);
  });
});

describe("getMsUntilTomorrowMidnightUTC", () => {
  it("returns a positive value", () => {
    const ms = getMsUntilTomorrowMidnightUTC();
    expect(ms).toBeGreaterThan(0);
  });

  it("returns at most 24h", () => {
    const ms = getMsUntilTomorrowMidnightUTC();
    expect(ms).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
  });

  it("returns ~23h59m when called just after midnight UTC", () => {
    const justAfterMidnight = new Date(Date.UTC(2026, 0, 15, 0, 0, 1));
    const ms = getMsUntilTomorrowMidnightUTC(justAfterMidnight);
    const expected = 24 * 60 * 60 * 1000 - 1000; // ~23h59m59s
    expect(ms).toBeGreaterThan(expected - 2000);
    expect(ms).toBeLessThan(expected + 2000);
  });

  it("returns ~1s when called just before midnight UTC", () => {
    const justBeforeMidnight = new Date(Date.UTC(2026, 0, 15, 23, 59, 59));
    const ms = getMsUntilTomorrowMidnightUTC(justBeforeMidnight);
    expect(ms).toBeGreaterThan(0);
    expect(ms).toBeLessThan(2000);
  });
});

describe("parseRetryAfter", () => {
  it("parses integer seconds", () => {
    expect(parseRetryAfter("60")).toBe(60);
    expect(parseRetryAfter("120")).toBe(120);
  });

  it("parses Groq-style relative units", () => {
    expect(parseRetryAfter("60s")).toBe(60);
    expect(parseRetryAfter("5m")).toBe(300);
    expect(parseRetryAfter("2h")).toBe(7200);
  });

  it("parses HTTP dates relative to now", () => {
    const future = new Date(Date.now() + 120_000); // 2 min from now
    const secs = parseRetryAfter(future.toUTCString());
    expect(secs).toBeGreaterThanOrEqual(118);
    expect(secs).toBeLessThanOrEqual(122);
  });

  it("returns null for unparseable values", () => {
    expect(parseRetryAfter("")).toBe(null);
    expect(parseRetryAfter(null)).toBe(null);
    expect(parseRetryAfter(undefined)).toBe(null);
    expect(parseRetryAfter("not a date or number")).toBe(null);
  });
});

describe("retryAfterFromResponse", () => {
  it("reads Retry-After from a plain object (case-insensitive)", () => {
    const result = retryAfterFromResponse({ headers: { "retry-after": "60" } });
    expect(result).toBe(60);
  });

  it("reads Retry-After from a Headers-like object with .get()", () => {
    const headers = { get: (name) => (name === "retry-after" ? "30" : null) };
    const result = retryAfterFromResponse({ headers });
    expect(result).toBe(30);
  });

  it("returns null when Retry-After is absent", () => {
    expect(retryAfterFromResponse({ headers: {} })).toBe(null);
    expect(retryAfterFromResponse(null)).toBe(null);
  });
});

describe("classify429 — Gemini per-minute RPM 429 must NOT be a 1h quota lock", () => {
  it("classifies Gemini 'Resource has been exhausted' RPM 429 as rate_limit (60s)", () => {
    const result = classify429({
      status: 429,
      provider: "gemini",
      body: { error: { code: 429, message: "Resource has been exhausted (e.g. check quota).", status: "RESOURCE_EXHAUSTED" } },
    });
    expect(result.kind).toBe("rate_limit");
    expect(result.cooldownMs).toBe(RATE_LIMIT_COOLDOWN_MS);
  });

  it("classifies Gemini 'You exceeded your current quota' RPM 429 as rate_limit (60s)", () => {
    const result = classify429({
      status: 429,
      provider: "gemini",
      body: "[429]: You exceeded your current quota, please check your plan and billing details. For more informa",
    });
    expect(result.kind).toBe("rate_limit");
    expect(result.cooldownMs).toBe(RATE_LIMIT_COOLDOWN_MS);
  });

  it("still locks on a genuine Gemini quota cap (quota exceeded)", () => {
    const result = classify429({
      status: 429,
      provider: "gemini",
      body: { error: { message: "Quota exceeded for this project." } },
    });
    expect(result.kind).toBe("quota_exhausted");
    expect(result.cooldownMs).toBe(QUOTA_EXHAUSTED_COOLDOWN_MS);
  });

  it("does NOT apply the gemini RPM rule to other providers", () => {
    const result = classify429({
      status: 429,
      provider: "anthropic",
      body: "[429]: You exceeded your current quota, please check your plan and billing details.",
    });
    expect(result.kind).toBe("quota_exhausted");
  });
});
