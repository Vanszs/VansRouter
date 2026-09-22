// Regression: an unmatched 4xx (a request-scoped failure) used to hit the
// transient-cooldown default, which locked the account for 30s and — with a
// single connection — answered every other request in that window with a copy of
// the first error. A 400 "maximum context length" from one session therefore
// looked like the same failure in unrelated sessions.
import { describe, expect, it } from "vitest";
import { checkFallbackError } from "../../open-sse/services/accountFallback.js";
import { createErrorResult } from "../../open-sse/utils/error.js";
import { classifyError } from "../../open-sse/utils/errorLog.js";

describe("checkFallbackError — request-scoped vs account-scoped failures", () => {
  it("does not cool the account down for a 400 caused by the request", () => {
    const result = checkFallbackError(400, JSON.stringify({
      error: {
        message: "This model's maximum context length is 1048576 tokens. However, you requested 1186139 tokens",
        type: "invalid_request_error",
      },
    }));

    expect(result).toEqual({ shouldFallback: false, cooldownMs: 0 });
  });

  it("does not cool the account down for other request-scoped 4xx", () => {
    for (const status of [400, 406, 408, 409, 410, 422]) {
      expect(checkFallbackError(status, "nope")).toEqual({ shouldFallback: false, cooldownMs: 0 });
    }
  });

  it("still falls back for account-scoped statuses", () => {
    for (const status of [401, 402, 403, 404, 429]) {
      const result = checkFallbackError(status, "nope");
      expect(result.shouldFallback).toBe(true);
      expect(result.cooldownMs).toBeGreaterThan(0);
    }
  });

  it("still honours rate-limit / quota wording on any 4xx", () => {
    expect(checkFallbackError(400, "rate limit reached").shouldFallback).toBe(true);
    expect(checkFallbackError(422, "quota exceeded").shouldFallback).toBe(true);
  });

  it("keeps the fork's content-blocked and 499 no-fallback rules", () => {
    expect(checkFallbackError(400, '{"error":{"code":"content-blocked"}}').shouldFallback).toBe(false);
    expect(checkFallbackError(499, "client closed request").shouldFallback).toBe(false);
  });

  it("keeps the transient cooldown for unmatched server errors", () => {
    const result = checkFallbackError(503, "upstream exploded");

    expect(result.shouldFallback).toBe(true);
    expect(result.cooldownMs).toBeGreaterThan(0);
  });
});

// A provider moderation refusal ("Content Exists Risk" from DeepSeek via the
// OpenCode Go relay) is a policy answer about the request, not a provider
// failure: it must not cool the account down, and it must be distinguishable
// from a real provider error in the result the caller gets back.
describe("content-filter refusals", () => {
  const MODERATION =
    '{"error":{"message":"Upstream request failed: [invalid_request_error] Content Exists Risk"}}';

  it("never falls back or cools down, whatever status carries the refusal", () => {
    for (const status of [400, 403, 429, 500, 502]) {
      const result = checkFallbackError(status, MODERATION);

      expect(result.shouldFallback, `status ${status}`).toBe(false);
      expect(result.cooldownMs, `status ${status}`).toBe(0);
      expect(result.isContentFilter, `status ${status}`).toBe(true);
    }
  });

  it("covers every moderation wording the providers use", () => {
    for (const text of ["sensitive words detected", "sensitive content", '{"error":{"code":"content-blocked"}}']) {
      expect(checkFallbackError(400, text).isContentFilter, text).toBe(true);
    }
  });

  it("does not flag an unrelated request error as a content filter", () => {
    const result = checkFallbackError(400, "maximum context length exceeded");

    expect(result.shouldFallback).toBe(false);
    expect(result.isContentFilter).toBeUndefined();
  });

  it("surfaces the refusal to the caller as a policy error", () => {
    const { isContentFilter } = checkFallbackError(400, MODERATION);
    const result = createErrorResult(400, "Content Exists Risk", null, isContentFilter);

    expect(result.isPolicyError).toBe(true);
    expect(classifyError(result)).toBe("POLICY");
  });

  it("keeps a plain provider failure out of the policy class", () => {
    const result = createErrorResult(502, "upstream exploded");

    expect(result.isPolicyError).toBe(false);
    expect(classifyError(result)).toBe("PROVIDER");
  });
});
