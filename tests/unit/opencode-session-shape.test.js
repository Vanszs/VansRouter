import { describe, it, expect } from "vitest";
import { OpenCodeExecutor } from "../../open-sse/executors/opencode.js";
import { PROVIDERS } from "../../open-sse/config/providers.js";

// Zen rejects anything outside this shape with 403 FreeTierError
// ("can only be used from within OpenCode") — live-verified A/B: same wire,
// RE-invalid session → 403, RE-valid → 200.
const SESS_RE = /^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/;
const REQ_RE = /^msg_[0-9a-f]{12}[0-9A-Za-z]{14}$/;

describe("opencode free-tier wire contract", () => {
  it("forces upstream streaming through the transport quirk", () => {
    // chatCore overrides the client's stream:false when the provider declares
    // forceStream, so the free-tier stream requirement is enforced there and
    // declared in the registry rather than inside transformRequest.
    expect(PROVIDERS.opencode.forceStream).toBe(true);
  });

  it("emits RE-shape session/request ids and a versioned User-Agent", () => {
    const executor = new OpenCodeExecutor();
    const credentials = {};
    executor.transformRequest("mimo-v2.6-flash-free", { messages: [{ role: "user", content: "hi" }] }, true, credentials);
    const headers = executor.buildHeaders(credentials, true);
    expect(headers["x-opencode-session"]).toMatch(SESS_RE);
    expect(headers["x-opencode-request"]).toMatch(REQ_RE);
    expect(headers["User-Agent"]).toMatch(/^opencode\/\d+\./);
  });

  it("passes a downstream client session through when already RE-shape", () => {
    const valid = "ses_0123456789abABCDEFGHIJKLMN";
    const executor = new OpenCodeExecutor();
    const headers = executor.buildHeaders({ rawHeaders: { "x-opencode-session": valid } }, true);
    expect(headers["x-opencode-session"]).toBe(valid);
  });

  it("reshapes an invalid downstream session instead of forwarding it", () => {
    const invalid = `ses_${"a".repeat(32)}`; // old uuid-style shape — 403 upstream
    const executor = new OpenCodeExecutor();
    const credentials = { rawHeaders: { "x-opencode-session": invalid } };
    executor.transformRequest("mimo-v2.6-flash-free", { messages: [{ role: "user", content: "hi" }] }, true, credentials);
    const headers = executor.buildHeaders(credentials, true);
    expect(headers["x-opencode-session"]).toMatch(SESS_RE);
    expect(headers["x-opencode-session"]).not.toBe(invalid);
  });
});
