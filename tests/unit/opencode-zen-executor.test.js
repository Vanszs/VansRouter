// Zen keyed lane: OpenCodeExecutor carries the official-client fingerprint
// (UA, RE-shape ids, tool quartet, SSE) with the user's key instead of
// "Bearer public" (issue Vanszs/VansRouter#2507).
import { describe, expect, it } from "vitest";
import { OpenCodeExecutor } from "../../open-sse/executors/opencode.js";
import { getExecutor, hasSpecializedExecutor } from "../../open-sse/executors/index.js";
import { PROVIDERS } from "../../open-sse/config/providers.js";
import { ANTHROPIC_API_VERSION } from "../../open-sse/providers/shared.js";

const SESS_RE = /^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/;
const REQ_RE = /^msg_[0-9a-f]{12}[0-9A-Za-z]{14}$/;
const CLAUDE_RT = PROVIDERS["opencode-zen"].transports.find((t) => t.format === "claude");

describe("opencode-zen fingerprint executor (issue #2507)", () => {
  it("registers on the executor map under id and alias", () => {
    expect(hasSpecializedExecutor("opencode-zen")).toBe(true);
    expect(hasSpecializedExecutor("ocz")).toBe(true);
    expect(getExecutor("opencode-zen")).toBeInstanceOf(OpenCodeExecutor);
    expect(getExecutor("ocz")).toBeInstanceOf(OpenCodeExecutor);
  });

  it("forces streaming like the free lane", () => {
    expect(PROVIDERS["opencode-zen"].forceStream).toBe(true);
  });

  it("pins body.stream from the stream param (identity translator keeps the client's flag)", () => {
    const executor = new OpenCodeExecutor("opencode-zen");
    const creds = { apiKey: "sk-zen-test", connectionId: "opencode-zen-executor-test" };
    const body = { messages: [{ role: "user", content: "hi" }], stream: false };
    executor.transformRequest("mimo-v2.6-flash-free", body, true, creds);
    expect(body.stream).toBe(true);
    const jsonBody = { messages: [{ role: "user", content: "hi" }], stream: false };
    executor.transformRequest("mimo-v2.6-flash-free", jsonBody, false, creds);
    expect(jsonBody.stream).toBe(false);
  });

  it("sends the official-client fingerprint with the user's key", () => {
    const executor = new OpenCodeExecutor("opencode-zen");
    const credentials = { apiKey: "sk-zen-test", connectionId: "opencode-zen-executor-test" };
    executor.transformRequest(
      "deepseek-v4-flash-free",
      { messages: [{ role: "user", content: "hi" }] },
      true,
      credentials,
    );
    const headers = executor.buildHeaders(credentials, true, "deepseek-v4-flash-free");
    expect(headers["Authorization"]).toBe("Bearer sk-zen-test");
    expect(headers["User-Agent"]).toMatch(/^opencode\/\d+\./);
    expect(headers["x-opencode-session"]).toMatch(SESS_RE);
    expect(headers["x-opencode-request"]).toMatch(REQ_RE);
  });

  it("cloaks the fingerprint tool quartet on the keyed lane", () => {
    const executor = new OpenCodeExecutor("opencode-zen");
    const body = { messages: [{ role: "user", content: "hi" }] };
    executor.transformRequest("deepseek-v4-flash-free", body, true, {
      apiKey: "sk-zen-test",
      connectionId: "opencode-zen-executor-test",
    });
    const names = (body.tools || []).map((t) => (t.function || t).name);
    for (const quartet of ["bash", "glob", "grep", "read"]) {
      expect(names.filter((n) => n === quartet)).toHaveLength(1);
    }
  });

  it("routes lanes to /zen/v1 endpoints by model and transport", () => {
    const executor = new OpenCodeExecutor("opencode-zen");
    // chat lane: paid chat id + passthrough "-free" id (no responses/claude pin)
    expect(executor.buildUrl("deepseek-v4-pro")).toBe("https://opencode.ai/zen/v1/chat/completions");
    expect(executor.buildUrl("deepseek-v4-flash-free")).toBe("https://opencode.ai/zen/v1/chat/completions");
    // responses-only catalog ids pin /responses
    expect(executor.buildUrl("gpt-5.5")).toBe("https://opencode.ai/zen/v1/responses");
    // claude lane follows the source-format transport chatCore picked
    const claudeCreds = { apiKey: "sk-zen-test", runtimeTransport: CLAUDE_RT };
    expect(executor.buildUrl("claude-fable-5", true, 0, claudeCreds)).toBe("https://opencode.ai/zen/v1/messages");
    expect(executor.buildUrl("claude-fable-5")).toBe("https://opencode.ai/zen/v1/chat/completions");
  });

  it("uses the claude transport auth contract (x-api-key + version)", () => {
    const executor = new OpenCodeExecutor("opencode-zen");
    const headers = executor.buildHeaders(
      { apiKey: "sk-zen-test", runtimeTransport: CLAUDE_RT },
      true,
      "claude-fable-5",
    );
    expect(headers["x-api-key"]).toBe("sk-zen-test");
    expect(headers["anthropic-version"]).toBe(ANTHROPIC_API_VERSION);
    expect(headers["Authorization"]).toBeUndefined();
  });

  it("keeps the keyless free lane on Bearer public", () => {
    const executor = new OpenCodeExecutor();
    // The noAuth virtual connection carries accessToken "public" (src/sse/services/auth.js).
    const freeCredentials = { accessToken: "public" };
    expect(executor.buildHeaders(freeCredentials, true, "big-pickle")["Authorization"]).toBe("Bearer public");
    expect(executor.buildUrl("big-pickle")).toBe("https://opencode.ai/zen/v1/chat/completions");
  });

  // The keyed zen lane used to guard the "public" fallback behind
  // `provider === "opencode"`, so a connection that lost its key sent
  // "Bearer undefined" — which the upstream reads as no credential at all.
  it("never sends Bearer undefined on the keyed zen lane", () => {
    const executor = new OpenCodeExecutor("opencode-zen");
    const headers = executor.buildHeaders({ connectionId: "ocz-no-key" }, true, "big-pickle");
    expect(headers["Authorization"]).toBe("Bearer public");
  });

  it("still prefers a real key over the public fallback", () => {
    const executor = new OpenCodeExecutor("opencode-zen");
    expect(executor.buildHeaders({ apiKey: "sk-real" }, true, "big-pickle")["Authorization"]).toBe("Bearer sk-real");
  });
});
