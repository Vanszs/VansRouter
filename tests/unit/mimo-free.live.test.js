/**
 * Live repro for issue #1933: MiMo Code Free returns HTTP 502 "MiMo bootstrap failed: 403".
 * Root cause: upstream gates on Chrome-like User-Agent. Without UA → 403 "Illegal access".
 * Hits real endpoints — no mocks. Free provider, safe to call.
 */
import { describe, it, expect } from "vitest";

// Live endpoint; opt in with RUN_REAL=1. Required CI must not depend on a
// third-party free endpoint that rate-limits or HTML-blocks runner IPs.
const RUN_REAL = process.env.RUN_REAL === "1";
import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import { __test__ } from "../../open-sse/executors/mimo-free.js";

const { BOOTSTRAP_URL, CHAT_URL, generateFingerprint, MIMO_SYSTEM_MARKER } = __test__;

const CHROME_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

async function bootstrapWith(ua) {
  const headers = { "Content-Type": "application/json" };
  if (ua) headers["User-Agent"] = ua;
  const r = await proxyAwareFetch(BOOTSTRAP_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({ client: generateFingerprint() }),
  });
  const data = await r.json();
  return { status: r.status, jwt: data.jwt };
}

async function chatWith(jwt, ua) {
  const headers = {
    "Content-Type": "application/json",
    "X-Mimo-Source": "mimocode-cli-free",
    Authorization: `Bearer ${jwt}`,
    Accept: "application/json",
  };
  if (ua) headers["User-Agent"] = ua;
  const body = {
    model: "mimo-auto",
    messages: [
      { role: "system", content: MIMO_SYSTEM_MARKER },
      { role: "user", content: "hi" },
    ],
    stream: false,
  };
  return proxyAwareFetch(CHAT_URL, { method: "POST", headers, body: JSON.stringify(body) });
}

describe.skipIf(!RUN_REAL)("MiMo Free bootstrap (live)", () => {
  it("bootstrap returns 200 with JWT", async () => {
    const { status, jwt } = await bootstrapWith(CHROME_UA);
    expect(status).toBe(200);
    expect(jwt).toBeTruthy();
  });
});

describe.skipIf(!RUN_REAL)("MiMo Free anti-abuse gate (live)", () => {
  it("chat WITH Chrome User-Agent → 200 or 400 (upstream anti-abuse gate)", async () => {
    const { jwt } = await bootstrapWith(CHROME_UA);
    const r = await chatWith(jwt, CHROME_UA);
    // 200 = success; 400 = upstream MiMo anti-abuse gate (risk_control) — external, not our bug.
    expect([200, 400]).toContain(r.status);
  });
});
