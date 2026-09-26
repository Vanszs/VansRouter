// Antigravity 403 VALIDATION_REQUIRED (Google asks the account owner to verify
// in a browser) was falling through to the generic 403 rule — a 2-minute
// cooldown. The account then re-enters rotation while still unverified, so it
// burns another fallback slot and the request dies on the attempt limit.
// Observed live: 6 accounts burned (429/403) then "fallback attempt limit
// reached (6) — aborting to prevent gateway timeout".
import { describe, it, expect } from "vitest";
import { checkFallbackError } from "open-sse/services/accountFallback.js";

const googleBody = JSON.stringify({
  error: {
    code: 403,
    status: "PERMISSION_DENIED",
    details: [{
      "@type": "type.googleapis.com/google.rpc.ErrorInfo",
      reason: "VALIDATION_REQUIRED",
      domain: "cloudcode-pa.googleapis.com",
      metadata: { validation_url: "https://accounts.google.com/signin/continue?..." },
    }],
  },
});

const TWO_MINUTES = 2 * 60 * 1000;

describe("antigravity VALIDATION_REQUIRED cooldown", () => {
  it("cools the account down far longer than the generic 403 rule", () => {
    const { shouldFallback, cooldownMs } = checkFallbackError(403, googleBody, 0);
    expect(shouldFallback).toBe(true);
    expect(cooldownMs).toBeGreaterThan(TWO_MINUTES);
  });

  it("still falls back, so rotation reaches a working account", () => {
    expect(checkFallbackError(403, googleBody, 0).shouldFallback).toBe(true);
  });

  it("does not change a plain 403 with no validation reason", () => {
    // A generic permission error stays a generic permission error.
    expect(checkFallbackError(403, '{"error":{"code":403}}', 0).cooldownMs).toBe(TWO_MINUTES);
  });

  it("does not change 429 quota handling", () => {
    const quota = checkFallbackError(429, '{"error":{"message":"quota exceeded"}}', 0);
    expect(quota.shouldFallback).toBe(true);
    expect(quota.cooldownMs).toBeLessThanOrEqual(4 * 60 * 1000);
  });
});
