/**
 * Unit tests for Qoder encoding + COSY signing primitives.
 *
 * These cover the parts that would silently produce wrong-but-plausible
 * output if logic regressed:
 *   - body encoder boundary cases (empty input, lengths not divisible by 3)
 *   - COSY header production (signature deterministic given fixed inputs,
 *     all required headers present, sigPath correctly stripped)
 *   - device flow URL construction
 */

import { describe, it, expect, vi } from "vitest";

// execute() reaches Qoder through proxyAwareFetch and fetches the live model
// config over the network — both stubbed so it can be driven offline.
const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: fetchMock }));
vi.mock("../../open-sse/services/qoderModels.js", async (importOriginal) => ({
  ...(await importOriginal()),
  getQoderModelConfig: async (_credentials, key) => ({
    key,
    is_reasoning: false,
    max_output_tokens: 8192,
    source: "system",
  }),
}));
import crypto from "crypto";

import { qoderEncodeBody } from "../../src/lib/qoder/encoding.js";
import { buildCosyHeaders } from "../../src/lib/qoder/cosy.js";
import { QoderService } from "../../src/lib/oauth/services/qoder.js";
import {
  QODER_CHAT_URL_ENCODED,
  QODER_MODEL_LIST_URL,
  QODER_MODEL_MAP,
} from "../../src/lib/qoder/constants.js";
import { PROVIDER_MODELS } from "../../open-sse/config/providerModels.js";
import { QoderExecutor, __test__ as qoderExecutorInternals } from "../../open-sse/executors/qoder.js";
import { isQoderPat } from "../../open-sse/services/qoderModels.js";

// Convenience aliases — tests were originally written against module-level
// helpers; the QoderService class wraps them so each test creates its own
// instance to avoid hidden state.
const generatePkcePair = () => new QoderService().generatePkcePair();
const initiateDeviceFlow = () => new QoderService().initiateDeviceFlow();
const parseExpiry = QoderService.parseExpiry;

describe("Qoder PAT credentials", () => {
  it("recognizes only Qoder personal tokens", () => {
    expect(isQoderPat("pt-example")).toBe(true);
    expect(isQoderPat("jt-example")).toBe(false);
    expect(isQoderPat("")).toBe(false);
    expect(isQoderPat(null)).toBe(false);
  });

  it("routes resolved job tokens to api2", () => {
    const executor = new QoderExecutor();
    expect(executor.buildUrl({ accessToken: "jt-example" })).toContain("https://api2.qoder.sh");
    expect(executor.buildUrl({ accessToken: "dt-example" })).toContain("https://api3.qoder.sh");
  });
});

describe("QODER_MODEL_MAP", () => {
  it("allows Qoder's latest model key", () => {
    expect(QODER_MODEL_MAP.qmodel_latest).toBe("qmodel_latest");
  });

  it("exposes Qoder's latest model in the static provider catalog", () => {
    expect(PROVIDER_MODELS.qd.some((model) => model.id === "qmodel_latest")).toBe(true);
  });
});

describe("qoderEncodeBody", () => {
  it("preserves base64 length (input length divisible by 3)", () => {
    const input = Buffer.from("abcdef", "utf8"); // 6 bytes → 8 base64 chars
    const encoded = qoderEncodeBody(input);
    expect(encoded.length).toBe(8);
  });

  it("preserves base64 length (input length not divisible by 3)", () => {
    const input = Buffer.from("hello", "utf8"); // 5 bytes → 8 base64 chars (with padding)
    const encoded = qoderEncodeBody(input);
    expect(encoded.length).toBe(8);
  });

  it("handles empty input without throwing", () => {
    const encoded = qoderEncodeBody(Buffer.alloc(0));
    expect(encoded).toBe("");
  });

  it("accepts string and Buffer inputs equivalently", () => {
    const a = qoderEncodeBody("hello");
    const b = qoderEncodeBody(Buffer.from("hello", "utf8"));
    expect(a).toBe(b);
  });

  it("only emits characters from the custom alphabet", () => {
    // The custom alphabet is "_doRTgHZBKcGVjlvpC,@aFSx#DPuNJme&i*MzLOEn)sUrthbf%Y^w.(kIQyXqWA!"
    // plus "$" for the padding char. If the substitution step regresses,
    // characters outside that set would leak into the output.
    const allowed = new Set(
      "_doRTgHZBKcGVjlvpC,@aFSx#DPuNJme&i*MzLOEn)sUrthbf%Y^w.(kIQyXqWA!$",
    );
    const encoded = qoderEncodeBody(
      "hello world this is a longer string for testing 0123456789",
    );
    for (const ch of encoded) {
      expect(allowed.has(ch), `unexpected char in output: ${JSON.stringify(ch)}`).toBe(true);
    }
  });

  it("is deterministic for identical input", () => {
    const a = qoderEncodeBody("abc");
    const b = qoderEncodeBody("abc");
    expect(a).toBe(b);
  });

  it("produces different output for different input", () => {
    const a = qoderEncodeBody("abc");
    const b = qoderEncodeBody("xyz");
    expect(a).not.toBe(b);
  });
});

describe("generatePkcePair", () => {
  it("produces base64url-safe verifier and challenge of the right length", () => {
    const { verifier, challenge } = generatePkcePair();
    // 32 bytes → 43 base64url chars (no padding)
    expect(verifier.length).toBe(43);
    expect(challenge.length).toBe(43);
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("verifier and challenge are different (challenge is sha256 of verifier)", () => {
    const { verifier, challenge } = generatePkcePair();
    expect(verifier).not.toBe(challenge);
    // S256: challenge should be base64url(sha256(verifier))
    const expected = crypto
      .createHash("sha256")
      .update(verifier)
      .digest("base64")
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
    expect(challenge).toBe(expected);
  });

  it("returns codeVerifier (not verifier) on the higher-level helper", () => {
    // Regression: the providers.js qoder entry once read flow.verifier (undefined)
    // because initiateDeviceFlow returns the field as `codeVerifier`.
    const flow = initiateDeviceFlow();
    expect(typeof flow.codeVerifier).toBe("string");
    expect(flow.codeVerifier.length).toBe(43);
    expect(flow.verifier).toBeUndefined();
  });
});

describe("initiateDeviceFlow", () => {
  it("produces a verification URL pointing at qoder.com/device/selectAccounts", () => {
    const flow = initiateDeviceFlow();
    expect(flow.verificationUriComplete).toMatch(
      /^https:\/\/qoder\.com\/device\/selectAccounts\?/,
    );
    expect(flow.verificationUriComplete).toContain("challenge_method=S256");
    expect(flow.verificationUriComplete).toContain(`nonce=${flow.nonce}`);
    expect(flow.verificationUriComplete).toContain(`machine_id=${flow.machineId}`);
  });

  it("returns nonce and machineId as UUIDs", () => {
    const flow = initiateDeviceFlow();
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    expect(flow.nonce).toMatch(uuidRe);
    expect(flow.machineId).toMatch(uuidRe);
  });
});

describe("buildCosyHeaders", () => {
  const creds = {
    userId: "test-user-id",
    authToken: "dt-test-token",
    name: "Test",
    email: "test@example.com",
    machineId: "fixed-machine-id",
  };

  it("produces all required Cosy-* headers", () => {
    const headers = buildCosyHeaders(Buffer.alloc(0), QODER_MODEL_LIST_URL, creds);
    const required = [
      "Authorization",
      "Cosy-Key",
      "Cosy-User",
      "Cosy-Date",
      "Cosy-Version",
      "Cosy-Machineid",
      "Cosy-Machinetoken",
      "Cosy-Machinetype",
      "Cosy-Machineos",
      "Cosy-Clienttype",
      "Cosy-Clientip",
      "Cosy-Bodyhash",
      "Cosy-Bodylength",
      "Cosy-Sigpath",
      "Cosy-Data-Policy",
      "Login-Version",
      "X-Request-Id",
    ];
    for (const key of required) {
      expect(headers[key], `missing header ${key}`).toBeDefined();
    }
  });

  it("Authorization is a Bearer COSY token with payload+sig", () => {
    const headers = buildCosyHeaders(Buffer.alloc(0), QODER_MODEL_LIST_URL, creds);
    expect(headers.Authorization).toMatch(/^Bearer COSY\.[A-Za-z0-9+/=]+\.[a-f0-9]{32}$/);
  });

  it("Cosy-Sigpath strips the leading /algo prefix", () => {
    const headers = buildCosyHeaders(Buffer.alloc(0), QODER_MODEL_LIST_URL, creds);
    expect(headers["Cosy-Sigpath"]).toBe("/api/v2/model/list");
  });

  it("Cosy-Sigpath also handles the encoded chat URL", () => {
    const headers = buildCosyHeaders(Buffer.from("body", "utf8"), QODER_CHAT_URL_ENCODED, creds);
    expect(headers["Cosy-Sigpath"]).toBe(
      "/api/v2/service/pro/sse/agent_chat_generation",
    );
  });

  it("Cosy-Bodyhash is the MD5 of the request body, Cosy-Bodylength is the length", () => {
    const body = Buffer.from("hello qoder", "utf8");
    const headers = buildCosyHeaders(body, QODER_MODEL_LIST_URL, creds);
    const expectedHash = crypto.createHash("md5").update(body).digest("hex");
    expect(headers["Cosy-Bodyhash"]).toBe(expectedHash);
    expect(headers["Cosy-Bodylength"]).toBe(String(body.length));
  });

  it("empty body produces the canonical empty-MD5 hash", () => {
    const headers = buildCosyHeaders(Buffer.alloc(0), QODER_MODEL_LIST_URL, creds);
    expect(headers["Cosy-Bodyhash"]).toBe("d41d8cd98f00b204e9800998ecf8427e");
    expect(headers["Cosy-Bodylength"]).toBe("0");
  });

  it("Cosy-Machineid + Cosy-Machinetoken match the supplied machineId", () => {
    const headers = buildCosyHeaders(Buffer.alloc(0), QODER_MODEL_LIST_URL, creds);
    expect(headers["Cosy-Machineid"]).toBe("fixed-machine-id");
    expect(headers["Cosy-Machinetoken"]).toBe("fixed-machine-id");
  });

  it("auto-generates a machineId when none is supplied", () => {
    const headers = buildCosyHeaders(Buffer.alloc(0), QODER_MODEL_LIST_URL, {
      ...creds,
      machineId: "",
    });
    expect(headers["Cosy-Machineid"]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("throws when userId is missing", () => {
    expect(() =>
      buildCosyHeaders(Buffer.alloc(0), QODER_MODEL_LIST_URL, { ...creds, userId: "" }),
    ).toThrow(/user id is empty/);
  });

  it("throws when authToken is missing", () => {
    expect(() =>
      buildCosyHeaders(Buffer.alloc(0), QODER_MODEL_LIST_URL, { ...creds, authToken: "" }),
    ).toThrow(/auth token is empty/);
  });

  it("Cosy-User reflects the supplied userId verbatim", () => {
    const headers = buildCosyHeaders(Buffer.alloc(0), QODER_MODEL_LIST_URL, creds);
    expect(headers["Cosy-User"]).toBe("test-user-id");
  });

  it("two calls with identical inputs differ only in fields that include fresh randomness", () => {
    // The signature fingerprints a fresh AES key + UUID per call, so the
    // signature, Cosy-Key, X-Request-Id, and Cosy-Date (1s resolution)
    // can differ — but Cosy-User, Cosy-Bodyhash, Cosy-Bodylength,
    // Cosy-Sigpath, and the machineId-derived headers must be stable.
    const a = buildCosyHeaders(Buffer.from("payload", "utf8"), QODER_CHAT_URL_ENCODED, creds);
    const b = buildCosyHeaders(Buffer.from("payload", "utf8"), QODER_CHAT_URL_ENCODED, creds);
    expect(a["Cosy-User"]).toBe(b["Cosy-User"]);
    expect(a["Cosy-Bodyhash"]).toBe(b["Cosy-Bodyhash"]);
    expect(a["Cosy-Bodylength"]).toBe(b["Cosy-Bodylength"]);
    expect(a["Cosy-Sigpath"]).toBe(b["Cosy-Sigpath"]);
    expect(a["Cosy-Machineid"]).toBe(b["Cosy-Machineid"]);
    expect(a["X-Request-Id"]).not.toBe(b["X-Request-Id"]);
  });
});

describe("parseExpiry", () => {
  // Regression for review finding #2: numeric expires_at was silently
  // dropped because the function only inspected strings.
  it("accepts ms-epoch as a JSON number", () => {
    const future = Date.now() + 60_000;
    expect(parseExpiry(future, undefined)).toBe(future);
  });

  it("accepts ms-epoch as a numeric string", () => {
    const future = Date.now() + 60_000;
    expect(parseExpiry(String(future), undefined)).toBe(future);
  });

  it("accepts RFC3339 strings", () => {
    const iso = "2030-01-02T03:04:05Z";
    expect(parseExpiry(iso, undefined)).toBe(Date.parse(iso));
  });

  // Regression for review finding #5: Date.parse("2026") returns Jan 1 2026,
  // so a short numeric string like "2026" used to be interpreted as a year
  // instead of falling through to the integer-ms branch. We now try the
  // pure-numeric path first so this can't happen again.
  it("does not interpret short numeric strings as a year", () => {
    // "1700000000" (Unix seconds) should NOT come out as Date.parse("1700000000")
    const result = parseExpiry("1700000000", undefined);
    // 1.7e9 ms = 1970-01-20 — the function's contract is ms, so we expect
    // exactly that value, not a year interpretation.
    expect(result).toBe(1_700_000_000);
  });

  it("falls back to expiresInSeconds when expiresAt is missing", () => {
    const before = Date.now();
    const result = parseExpiry(undefined, 60);
    const after = Date.now();
    expect(result).toBeGreaterThanOrEqual(before + 60_000);
    expect(result).toBeLessThanOrEqual(after + 60_000);
  });

  // Regression for review finding #7: expiresInSeconds=0 used to be treated
  // as missing and silently fabricated 30-day default. We now honor 0 as
  // "already expired".
  it("treats expires_in: 0 as already expired (now), not 30-day fallback", () => {
    const before = Date.now();
    const result = parseExpiry(undefined, 0);
    const after = Date.now();
    expect(result).toBeGreaterThanOrEqual(before);
    expect(result).toBeLessThanOrEqual(after);
  });

  it("falls back to ~30 days when both inputs are missing", () => {
    const before = Date.now();
    const result = parseExpiry(undefined, undefined);
    const expected = before + 30 * 24 * 60 * 60 * 1000;
    // Allow a small skew to absorb test runtime.
    expect(result).toBeGreaterThanOrEqual(expected - 5_000);
    expect(result).toBeLessThanOrEqual(expected + 5_000);
  });

  it("falls back to ~30 days when both inputs are unparseable", () => {
    const before = Date.now();
    const result = parseExpiry("not-a-date", -5);
    const expected = before + 30 * 24 * 60 * 60 * 1000;
    expect(result).toBeGreaterThanOrEqual(expected - 5_000);
    expect(result).toBeLessThanOrEqual(expected + 5_000);
  });
});

describe("normalizeMessages", () => {
  const { normalizeMessages } = qoderExecutorInternals;

  it("hoists role:system out of messages into systemText", () => {
    const result = normalizeMessages([
      { role: "system", content: "you are helpful" },
      { role: "user", content: "hi" },
    ]);
    expect(result.systemText).toBe("you are helpful");
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].role).toBe("user");
  });

  it("flattens multipart text content into a string", () => {
    const result = normalizeMessages([
      {
        role: "user",
        content: [
          { type: "text", text: "part1" },
          { type: "text", text: "part2" },
        ],
      },
    ]);
    expect(result.messages[0].content).toBe("part1\npart2");
  });

  it("joins multiple system messages with a blank line", () => {
    const result = normalizeMessages([
      { role: "system", content: "rule 1" },
      { role: "system", content: "rule 2" },
      { role: "user", content: "hi" },
    ]);
    expect(result.systemText).toBe("rule 1\n\nrule 2");
  });

  it("returns empty results for empty input", () => {
    const result = normalizeMessages([]);
    expect(result.messages).toEqual([]);
    expect(result.systemText).toBe("");
  });
});

describe("isBillingBlock", () => {
  const { isBillingBlock } = qoderExecutorInternals;

  it("detects code 110 as a string", () => {
    expect(isBillingBlock('{"code":"110","message":"Billing daily count exceeded"}')).toBe(true);
  });

  it("detects code 110 as a number", () => {
    expect(isBillingBlock('{"code":110,"message":"Billing daily count exceeded"}')).toBe(true);
  });

  it("detects codes 112, 10605 and pricingUrl", () => {
    expect(isBillingBlock('{"code":"112","message":"Quota exhausted"}')).toBe(true);
    expect(isBillingBlock('{"code":"10605","message":"Queue limit"}')).toBe(true);
    expect(isBillingBlock('{"message":"Upgrade","pricingUrl":"https://x"}')).toBe(true);
  });

  it("ignores unrelated codes and code-110 prefixes", () => {
    expect(isBillingBlock('{"code":"500","message":"Internal error"}')).toBe(false);
    expect(isBillingBlock('{"code":"1105","message":"Other"}')).toBe(false);
    expect(isBillingBlock("error 110 means billing in the docs")).toBe(false);
    expect(isBillingBlock(null)).toBe(false);
  });
});

describe("wrapQoderSSE", () => {
  const { wrapQoderSSE } = qoderExecutorInternals;

  // Helper: build a fake Response carrying the given lines as the body.
  function makeResponse(lines, { status = 200, onCancel, close = true } = {}) {
    const body = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        for (const line of lines) controller.enqueue(encoder.encode(line));
        if (close) controller.close();
      },
      cancel: onCancel,
    });
    return new Response(body, { status });
  }

  // Helper: drain a wrapped response into an array of decoded SSE events.
  async function drain(response) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
    }
    buf += decoder.decode();
    return buf;
  }

  it("forwards an OpenAI envelope chunk and emits [DONE] in flush", async () => {
    const inner = JSON.stringify({ choices: [{ delta: { content: "hi" } }] });
    const upstream = `data: ${JSON.stringify({ statusCodeValue: 200, body: inner })}\n\n`;
    const wrapped = await wrapQoderSSE(makeResponse([upstream]), "qoder/auto");
    const out = await drain(wrapped);
    expect(out).toContain(`data: ${inner}\n\n`);
    expect(out).toContain("data: [DONE]\n\n");
  });

  // Regression for review finding #4: a final data: line without a trailing
  // newline used to be silently dropped from `buffer` in flush().
  it("drains a trailing partial line without a newline in flush()", async () => {
    const inner = JSON.stringify({ choices: [{ delta: { content: "tail" } }], finish_reason: "stop" });
    // Note: NO trailing \n on the final line.
    const upstream = `data: ${JSON.stringify({ statusCodeValue: 200, body: inner })}`;
    const wrapped = await wrapQoderSSE(makeResponse([upstream]), "qoder/auto");
    const out = await drain(wrapped);
    expect(out).toContain(`data: ${inner}\n\n`);
  });

  // Regression for review finding #3: chunks could leak past [DONE] when
  // the success branch had no doneEmitted guard. One good frame goes out
  // first (so the peek sees a healthy stream), then an error envelope which
  // sets doneEmitted=true; the valid envelope after it must NOT be forwarded.
  it("does not forward chunks after [DONE] has been emitted", async () => {
    const okEnv = JSON.stringify({
      statusCodeValue: 200,
      body: JSON.stringify({ choices: [{ delta: { content: "hi" } }] }),
    });
    const errorEnv = JSON.stringify({ statusCodeValue: 500, body: "boom" });
    const validInner = JSON.stringify({ choices: [{ delta: { content: "leak" } }] });
    const validEnv = JSON.stringify({ statusCodeValue: 200, body: validInner });
    const wrapped = await wrapQoderSSE(
      makeResponse([`data: ${okEnv}\n\ndata: ${errorEnv}\n\ndata: ${validEnv}\n\n`]),
      "qoder/auto",
    );
    const out = await drain(wrapped);
    expect(out).not.toContain("leak");
    // Should still have a single [DONE].
    const doneCount = (out.match(/data: \[DONE\]/g) || []).length;
    expect(doneCount).toBe(1);
  });

  // Regression for review finding #6: literal newlines inside the inner
  // OpenAI body would split the SSE frame across multiple data: lines.
  // We now strip them so the frame stays a single event.
  it("strips embedded newlines from inner body before forwarding", async () => {
    const innerWithNewlines = '{"choices":[{"delta":{"content":"a\nb"}}]}';
    const env = JSON.stringify({ statusCodeValue: 200, body: innerWithNewlines });
    const wrapped = await wrapQoderSSE(makeResponse([`data: ${env}\n\n`]), "qoder/auto");
    const out = await drain(wrapped);
    // The forwarded data: line should be a single event terminated by \n\n
    // and contain no internal \n other than the trailing pair.
    const dataLine = out.split("\n\n").find((l) => l.startsWith("data: ") && !l.includes("[DONE]"));
    expect(dataLine).toBeDefined();
    // Body sans "data: " prefix should be valid JSON.
    expect(() => JSON.parse(dataLine.slice("data: ".length))).not.toThrow();
  });

  it("cancels the upstream reader after a terminal event", async () => {
    let cancelled = false;
    const inner = JSON.stringify({ choices: [{ delta: { content: "hi" } }] });
    const upstream = `data: ${JSON.stringify({ statusCodeValue: 200, body: inner })}\n\ndata: [DONE]\n\n`;
    const wrapped = await wrapQoderSSE(
      makeResponse([upstream], { close: false, onCancel: () => { cancelled = true; } }),
      "qoder/auto",
    );
    await drain(wrapped);
    expect(cancelled).toBe(true);
  });

  it("upstream first-frame error envelope becomes a real HTTP error", async () => {
    const env = JSON.stringify({ statusCodeValue: 503, body: "service unavailable" });
    const wrapped = await wrapQoderSSE(makeResponse([`data: ${env}\n\n`]), "qoder/lite");
    expect(wrapped.status).toBe(503);
    expect(await wrapped.json()).toEqual({
      error: { message: "service unavailable", code: 503 },
    });
  });

  it("returns 403 when the first frame is a code-110 billing block", async () => {
    const billingEnv = JSON.stringify({
      statusCodeValue: 403,
      body: '{"code":"110","message":"Billing daily count exceeded"}',
    });
    const wrapped = await wrapQoderSSE(makeResponse([`data: ${billingEnv}\n\n`]), "qoder/qfmodel");
    expect(wrapped.status).toBe(403);
    const json = await wrapped.json();
    expect(json.error.message).toContain("Billing daily count exceeded");
  });

  it("accepts a numeric-string statusCodeValue and an object body", async () => {
    const billingEnv = JSON.stringify({
      statusCodeValue: "429",
      body: { code: 110, message: "Billing daily count exceeded" },
    });
    const wrapped = await wrapQoderSSE(makeResponse([`data: ${billingEnv}\n\n`]), "qoder/qfmodel");
    expect(wrapped.status).toBe(403);
  });

  it("maps an out-of-range first-frame error status to 502", async () => {
    const env = JSON.stringify({ statusCodeValue: "302", body: "weird redirect" });
    const wrapped = await wrapQoderSSE(makeResponse([`data: ${env}\n\n`]), "qoder/lite");
    expect(wrapped.status).toBe(502);
  });

  it("emits a structured 403 error chunk for a mid-stream billing envelope", async () => {
    const okEnv = JSON.stringify({
      statusCodeValue: 200,
      body: JSON.stringify({ choices: [{ delta: { content: "hi" } }] }),
    });
    const billingEnv = JSON.stringify({
      statusCodeValue: 403,
      body: '{"code":"110","message":"Billing daily count exceeded"}',
    });
    const wrapped = await wrapQoderSSE(
      makeResponse([`data: ${okEnv}\n\ndata: ${billingEnv}\n\n`]),
      "qoder/qfmodel",
    );
    const out = await drain(wrapped);
    expect(out).not.toContain("[qoder error");
    const errEvent = out.split("\n\n").find((e) => e.includes("quota_error"));
    expect(errEvent).toBeDefined();
    const errChunk = JSON.parse(errEvent.slice("data: ".length));
    expect(errChunk.error.status).toBe(403);
    expect(errChunk.error.message).toContain("Billing daily count exceeded");
    expect(errChunk.choices).toBeUndefined();
  });

  it("keeps assistant text that merely mentions code 110", async () => {
    const inner = JSON.stringify({
      choices: [{ delta: { content: "error 110 means billing daily count exceeded" } }],
    });
    const env = JSON.stringify({ statusCodeValue: 200, body: inner });
    const wrapped = await wrapQoderSSE(makeResponse([`data: ${env}\n\n`]), "qoder/qfmodel");
    expect(wrapped.status).toBe(200);
    const out = await drain(wrapped);
    expect(out).toContain("billing daily count exceeded");
    expect(out).not.toContain("[qoder error");
  });

  it("non-ok responses are returned unchanged (no transform)", async () => {
    const r = new Response("not ok", { status: 500 });
    const wrapped = await wrapQoderSSE(r, "qoder/auto");
    expect(wrapped).toBe(r);
  });

  it("fails the request when the proxy fails instead of replaying it direct", async () => {
    fetchMock.mockRejectedValueOnce(
      new Error("[ProxyFetch] Proxy required but failed (strictProxy=true): ECONNREFUSED"),
    );
    const executor = new QoderExecutor();
    const credentials = {
      accessToken: "dt-test",
      providerSpecificData: { userId: "u-test", machineId: "m-test" },
    };
    await expect(
      executor.execute({
        model: "qoder/auto",
        body: { messages: [{ role: "user", content: "hi" }] },
        credentials,
        log: null,
      }),
    ).rejects.toThrow(/strictProxy=true/);
    expect(fetchMock.mock.calls[0][2]).toMatchObject({ strictProxy: true });
  });

  it("keeps caller cancellation as the rejection reason", async () => {
    fetchMock.mockRejectedValueOnce(
      new Error("[ProxyFetch] Proxy required but failed (strictProxy=true): aborted"),
    );
    const executor = new QoderExecutor();
    const controller = new AbortController();
    controller.abort(new Error("client gone"));
    await expect(
      executor.execute({
        model: "qoder/auto",
        body: { messages: [{ role: "user", content: "hi" }] },
        credentials: { accessToken: "dt-test", providerSpecificData: { userId: "u-test" } },
        signal: controller.signal,
        log: null,
      }),
    ).rejects.toThrow("client gone");
  });
});
