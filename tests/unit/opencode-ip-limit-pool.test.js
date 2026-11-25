import { describe, expect, it } from "vitest";
import { OpenCodeExecutor } from "../../open-sse/executors/opencode.js";
import { OpenCodeGoExecutor } from "../../open-sse/executors/opencode-go.js";
import { PROVIDERS } from "../../open-sse/config/providers.js";
import { OPENCODE_IP_LIMIT_POOL_TTL_MS, OPENCODE_TRANSIENT_POOL_TTL_MS } from "../../open-sse/config/runtimeConfig.js";
import { rotationInProgressResponse } from "../../open-sse/utils/error.js";

const executor = new OpenCodeExecutor();
const parse = (status, text) => executor.parseError({ status }, text);

describe("OpenCode free-tier egress refusal", () => {
  it("marks an abusive-traffic 403 as pool-scoped and benches it for a day", () => {
    const body = "OpenCode's free models aren't available from your current network because we've detected abusive traffic from this IP address.";
    const result = parse(403, body);

    expect(result?.poolScoped).toMatchObject({
      reason: "ip-limit",
      deferRotation: true,
    });
    expect(result.resetsAtMs).toBeGreaterThan(Date.now() + 23 * 60 * 60 * 1000);
    expect(result.resetsAtMs).toBeLessThanOrEqual(Date.now() + OPENCODE_IP_LIMIT_POOL_TTL_MS + 1000);
  });

  it("marks a free-usage-limit 429 as pool-scoped", () => {
    const body = JSON.stringify({
      type: "error",
      error: { type: "FreeUsageLimitError", message: "Free usage limit reached. Free models work in OpenCode." },
    });
    const result = parse(429, body);

    expect(result?.poolScoped).toMatchObject({ reason: "ip-limit", deferRotation: true });
    expect(result.resetsAtMs).toBeGreaterThan(Date.now() + 23 * 60 * 60 * 1000);
  });

  it("treats a plain rate limit as transient, not a 24h IP ban", () => {
    const result = parse(429, "Rate limit exceeded. Please try again later.");
    expect(result?.poolScoped).toMatchObject({ reason: "rate-limit", deferRotation: true });
    expect(result.resetsAtMs).toBeGreaterThan(Date.now() + OPENCODE_TRANSIENT_POOL_TTL_MS - 5000);
    expect(result.resetsAtMs).toBeLessThan(Date.now() + OPENCODE_TRANSIENT_POOL_TTL_MS + 5000);
  });

  it("rotates a 403 without a recognizable body", () => {
    const result = parse(403, "Forbidden");
    expect(result?.poolScoped).toMatchObject({ reason: "egress", deferRotation: true });
  });

  it("rotates a 5xx upstream failure", () => {
    const result = parse(503, "Service unavailable");
    expect(result?.poolScoped).toMatchObject({ reason: "upstream-5xx", deferRotation: true });
  });

  it("keeps the model-unavailable classification", () => {
    const result = parse(400, "Model is unavailable");
    expect(result).toMatchObject({ status: 503, code: "model_unavailable" });
    expect(result.poolScoped).toBeUndefined();
  });
});

describe("rotation wait response", () => {
  it("returns 503 + retry-after + rotation hint", async () => {
    const res = rotationInProgressResponse({
      message: "rotating",
      retryAfterMs: 1500,
      fromPoolId: "pool-a",
      toPoolId: "pool-b",
      reason: "ip-limit",
    });
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("2");
    expect(res.headers.get("x-vansroute-rotation")).toBe("pool-a>pool-b");
    expect(await res.json()).toMatchObject({
      error: { code: "rotation_in_progress", message: "rotating", reason: "ip-limit" },
    });
  });
});

describe("OpenCode Go stays account-scoped", () => {
  const go = new OpenCodeGoExecutor();
  const parseGo = (status, text) => go.parseError({ status }, text);

  it("does not mark HTTP refusals as pool-scoped", () => {
    for (const [status, text] of [
      [403, "we've detected abusive traffic from this IP address"],
      [429, "Rate limit exceeded"],
      [503, "Service unavailable"],
    ]) {
      expect(parseGo(status, text).poolScoped).toBeUndefined();
    }
  });

  it("keeps the default retry policy instead of egress retries=0", () => {
    expect(PROVIDERS["opencode-go"].retry).toBeUndefined();
    expect(PROVIDERS.opencode.retry[503].attempts).toBe(0);
  });
});
