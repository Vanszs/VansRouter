import { describe, expect, it } from "vitest";
import { translateRequestId, translateSessionId } from "../../open-sse/executors/opencode.js";

const SESSION_RE = /^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/;
const REQUEST_RE = /^msg_[0-9a-f]{12}[0-9A-Za-z]{14}$/;

const prefixHex = (id) => id.slice(4, 16);
const prefixValue = (id) => BigInt(`0x${prefixHex(id)}`);
const topByte = (id) => Number.parseInt(prefixHex(id).slice(0, 2), 16);

// The prefix is the low 48 bits of `ts * 0x1000 + counter` — the top 16 bits of
// the 56-bit value are dropped, so the epoch millisecond is only recoverable as
// `ts mod 2^36` (the counter occupies the low 12 bits).
const LOW48 = 0xffffffffffffn;
const encodedMs = (id) => prefixValue(id) >> 12n;
const encodesNow = (id, inverted) => {
  const found = encodedMs(id);
  const now = BigInt(Date.now());
  for (let delta = -1000n; delta <= 1000n; delta += 1n) {
    const raw = (now + delta) << 12n;
    if ((((inverted ? ~raw : raw) & LOW48) >> 12n) === found) return true;
  }
  return false;
};

describe("OpenCode canonical id timestamp encoding", () => {
  it("mints a canonical session id", () => {
    expect(translateSessionId("some-raw-value")).toMatch(SESSION_RE);
  });

  // Upstream's free tier decodes the 12 hex chars as a timestamp and 403s any
  // prefix that does not decode to one; a random prefix (the old behaviour) is
  // rejected. Session ids carry the inverted form.
  it("encodes the inverted timestamp in a session id prefix", () => {
    const id = translateSessionId("some-raw-value");
    expect(topByte(id)).toBeGreaterThanOrEqual(0x80);
    expect(encodesNow(id, true)).toBe(true);
  });

  it("encodes the forward timestamp in a request id prefix", () => {
    const id = translateRequestId("some-raw-value");
    expect(id).toMatch(REQUEST_RE);
    expect(encodesNow(id, false)).toBe(true);
  });

  it("returns the same session id for a repeated input", () => {
    expect(translateSessionId("repeat-session-value")).toBe(translateSessionId("repeat-session-value"));
  });

  it("returns the same request id for a repeated input", () => {
    expect(translateRequestId("repeat-request-value")).toBe(translateRequestId("repeat-request-value"));
  });

  it("returns different ids for different inputs", () => {
    expect(translateSessionId("input-a")).not.toBe(translateSessionId("input-b"));
    expect(translateRequestId("input-a")).not.toBe(translateRequestId("input-b"));
  });

  it("passes an already-canonical id through unchanged", () => {
    const session = `ses_${"0123456789ab"}ABCDEFGHIJKLMN`;
    const request = `msg_${"0123456789ab"}ABCDEFGHIJKLMN`;
    expect(session).toMatch(SESSION_RE);
    expect(request).toMatch(REQUEST_RE);
    expect(translateSessionId(session)).toBe(session);
    expect(translateRequestId(request)).toBe(request);
  });
});
