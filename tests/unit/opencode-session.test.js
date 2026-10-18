import { describe, expect, it } from "vitest";
import {
  OpenCodeExecutor,
  plausibleOpencodeId,
  translateRequestId,
  translateSessionId,
} from "../../open-sse/executors/opencode.js";
import { PROVIDERS } from "../../open-sse/config/providers.js";

// OpenCode's free tier requires UA >= 1.18.0 and a ses_/msg_ id whose 12 hex
// are the client's inverted timestamp. A shape-valid id with the high bit clear
// (an ascending timestamp, or a hash) is refused with 403 FreeTierError.
const SESSION_RE = /^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/;
const REQUEST_RE = /^msg_[0-9a-f]{12}[0-9A-Za-z]{14}$/;

const assertCanonical = (id, prefix) => {
  const pattern = prefix === "ses" ? SESSION_RE : REQUEST_RE;
  expect(plausibleOpencodeId(id, pattern)).toBe(id);
  if (prefix === "ses") expect(BigInt(`0x${id.slice(4, 16)}`) >> 47n).toBe(1n);
};

describe("OpenCode free-tier request identity", () => {
  const executor = new OpenCodeExecutor();

  it("defaults to a versioned User-Agent and canonical session/request ids", () => {
    const headers = executor.buildHeaders({}, true);
    expect(headers["User-Agent"]).toBe("opencode/1.18.31");
    assertCanonical(headers["x-opencode-session"], "ses");
    assertCanonical(headers["x-opencode-request"], "msg");
  });

  it("keeps a client User-Agent that carries a supported version", () => {
    for (const ua of ["opencode/1.18.0", "opencode/stable/1.18.2/opencode"]) {
      const headers = executor.buildHeaders({ rawHeaders: { "user-agent": ua } }, true);
      expect(headers["User-Agent"]).toBe(ua);
    }
  });

  it("replaces a version-less or too-old client User-Agent", () => {
    for (const ua of ["opencode", "opencode/1.17.2", "opencode/stable/1.3.17/opencode", "claude-cli/2.0"]) {
      const headers = executor.buildHeaders({ rawHeaders: { "user-agent": ua } }, true);
      expect(headers["User-Agent"]).toBe("opencode/1.18.31");
    }
  });

  it("uses the public bearer token for the no-auth free lane", () => {
    const headers = executor.buildHeaders({ connectionId: "opencode-free-test" }, true, "big-pickle");
    expect(headers.Authorization).toBe("Bearer public");
  });

  it("generates a fresh canonical session when credentials carry none", () => {
    const first = executor.buildHeaders({}, true)["x-opencode-session"];
    const second = executor.buildHeaders({}, true)["x-opencode-session"];
    assertCanonical(first, "ses");
    assertCanonical(second, "ses");
    expect(first).not.toBe(second);
  });

  it("forwards a client session that carries the inverted timestamp", () => {
    const live = executor.buildHeaders({}, true)["x-opencode-session"];
    const explicit = executor.buildHeaders({
      rawHeaders: { "x-opencode-session": live },
    }, true);
    expect(explicit["x-opencode-session"]).toBe(live);
  });

  it("replaces a shape-valid session that was not inverted", () => {
    // High bit clear: an ascending timestamp and a low hash, both refused live.
    for (const stale of ["ses_14d380c78001ABCDEFGHIJKLMN", "ses_001122334455ABCDEFGHIJKLMN"]) {
      const headers = executor.buildHeaders({ rawHeaders: { "x-opencode-session": stale } }, true);
      expect(headers["x-opencode-session"]).not.toBe(stale);
      assertCanonical(headers["x-opencode-session"], "ses");
    }
  });

  it("ignores a non-canonical client session id instead of forwarding a 403", () => {
    for (const bad of ["ses_abc", "3f8d1c2e-0000-4000-8000-000000000000", "ses_" + "0".repeat(32)]) {
      const headers = executor.buildHeaders({ rawHeaders: { "x-opencode-session": bad } }, true);
      expect(headers["x-opencode-session"]).not.toBe(bad);
      assertCanonical(headers["x-opencode-session"], "ses");
    }
  });

  it("reuses one minted session per foreign id and drops one that was not inverted", () => {
    const translated = translateSessionId("foreign-id", "desktop");
    expect(translateSessionId("foreign-id", "desktop")).toBe(translated);
    assertCanonical(translated, "ses");
    expect(translateSessionId("another-id", "desktop")).not.toBe(translated);
    const replaced = translateSessionId("ses_001122334455ABCDEFGHIJKLMN", "desktop");
    expect(replaced).not.toBe("ses_001122334455ABCDEFGHIJKLMN");
    assertCanonical(replaced, "ses");
    assertCanonical(translateRequestId("foreign-id"), "msg");
    expect(translateRequestId("foreign-id")).not.toBe(translateRequestId("foreign-id"));
  });

  it("stably translates non-canonical raw session and request headers", () => {
    const credentials = {
      rawHeaders: {
        "x-opencode-session": "foreign-session",
        "x-opencode-request": "foreign-request",
        "x-opencode-client": "desktop",
      },
    };
    const first = executor.buildHeaders(credentials, true);
    const second = executor.buildHeaders(credentials, true);
    assertCanonical(first["x-opencode-session"], "ses");
    expect(first["x-opencode-session"]).toBe(second["x-opencode-session"]);
    assertCanonical(first["x-opencode-request"], "msg");
  });

  it("mints a fresh session when neither the stored nor the client id was inverted", () => {
    const headers = executor.buildHeaders({
      runtimeOpencodeSession: "ses_abcdef012345ABCDEFGHIJKLMN",
      rawHeaders: { "x-opencode-session": "bogus" },
    }, true);
    expect(headers["x-opencode-session"]).not.toBe("ses_abcdef012345ABCDEFGHIJKLMN");
    expect(headers["x-opencode-session"]).not.toBe("bogus");
    assertCanonical(headers["x-opencode-session"], "ses");
  });

  it("stores a canonical session during request transformation", () => {
    const credentials = {
      rawHeaders: { "x-opencode-session": "foreign-session", "x-opencode-client": "desktop" },
    };
    executor.transformRequest("big-pickle", { messages: [{ role: "user", content: "hi" }] }, true, credentials);
    assertCanonical(credentials.runtimeOpencodeSession, "ses");
  });

  // The free tier 403s a non-streaming body; chatCore reads this flag to force
  // upstream streaming and aggregate the SSE back for non-stream clients.
  it("declares forceStream on the free-lane registry entry", () => {
    expect(PROVIDERS.opencode.forceStream).toBe(true);
  });
});
