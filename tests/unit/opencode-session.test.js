import { describe, expect, it } from "vitest";
import {
  OpenCodeExecutor,
  translateRequestId,
  translateSessionId,
} from "../../open-sse/executors/opencode.js";

// OpenCode's free tier (403 FreeTierError) requires UA version >= 1.17.0 and
// canonical ses_/msg_ id formats.
const CANONICAL_SESSION = /^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/;
const CANONICAL_REQUEST = /^msg_[0-9a-f]{12}[0-9A-Za-z]{14}$/;

describe("OpenCode free-tier request identity", () => {
  const executor = new OpenCodeExecutor();

  it("defaults to a versioned User-Agent and canonical session/request ids", () => {
    const headers = executor.buildHeaders({}, true);
    expect(headers["User-Agent"]).toBe("opencode/1.18.31");
    expect(headers["x-opencode-session"]).toMatch(CANONICAL_SESSION);
    expect(headers["x-opencode-request"]).toMatch(CANONICAL_REQUEST);
  });

  it("keeps a client User-Agent that carries a supported version", () => {
    const headers = executor.buildHeaders({ rawHeaders: { "user-agent": "opencode/1.17.2" } }, true);
    expect(headers["User-Agent"]).toBe("opencode/1.17.2");
  });

  it("replaces a version-less or too-old client User-Agent", () => {
    for (const ua of ["opencode", "opencode/1.4.0", "claude-cli/2.0"]) {
      const headers = executor.buildHeaders({ rawHeaders: { "user-agent": ua } }, true);
      expect(headers["User-Agent"]).toBe("opencode/1.18.31");
    }
  });

  it("generates a fresh canonical session when credentials carry none", () => {
    const first = executor.buildHeaders({}, true)["x-opencode-session"];
    const second = executor.buildHeaders({}, true)["x-opencode-session"];
    expect(first).toMatch(CANONICAL_SESSION);
    expect(second).toMatch(CANONICAL_SESSION);
    expect(first).not.toBe(second);
  });

  it("prefers the stored runtime session and explicit raw headers", () => {
    const stored = executor.buildHeaders({ runtimeOpencodeSession: "ses_abcdef012345ABCDEFGHIJKLMN" }, true);
    expect(stored["x-opencode-session"]).toBe("ses_abcdef012345ABCDEFGHIJKLMN");

    const explicit = executor.buildHeaders({
      rawHeaders: { "x-opencode-session": "ses_001122334455ABCDEFGHIJKLMN" },
    }, true);
    expect(explicit["x-opencode-session"]).toBe("ses_001122334455ABCDEFGHIJKLMN");
  });

  it("ignores a non-canonical client session id instead of forwarding a 403", () => {
    for (const bad of ["ses_abc", "3f8d1c2e-0000-4000-8000-000000000000", "ses_" + "0".repeat(32)]) {
      const headers = executor.buildHeaders({ rawHeaders: { "x-opencode-session": bad } }, true);
      expect(headers["x-opencode-session"]).not.toBe(bad);
      expect(headers["x-opencode-session"]).toMatch(CANONICAL_SESSION);
    }
  });

  it("translates foreign ids deterministically and preserves canonical ids", () => {
    const translated = translateSessionId("foreign-id", "desktop");
    expect(translateSessionId("foreign-id", "desktop")).toBe(translated);
    expect(translated).toMatch(CANONICAL_SESSION);
    expect(translateSessionId("another-id", "desktop")).not.toBe(translated);
    expect(translateSessionId("ses_001122334455ABCDEFGHIJKLMN", "desktop"))
      .toBe("ses_001122334455ABCDEFGHIJKLMN");
    expect(translateRequestId("foreign-id")).toMatch(CANONICAL_REQUEST);
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
    expect(first["x-opencode-session"]).toMatch(CANONICAL_SESSION);
    expect(first["x-opencode-session"]).toBe(second["x-opencode-session"]);
    expect(first["x-opencode-request"]).toMatch(CANONICAL_REQUEST);
    expect(first["x-opencode-request"]).toBe(second["x-opencode-request"]);
  });

  it("still reuses the stored runtime session over a rejected client header", () => {
    const headers = executor.buildHeaders({
      runtimeOpencodeSession: "ses_abcdef012345ABCDEFGHIJKLMN",
      rawHeaders: { "x-opencode-session": "bogus" },
    }, true);
    expect(headers["x-opencode-session"]).not.toBe("ses_abcdef012345ABCDEFGHIJKLMN");
    expect(headers["x-opencode-session"]).toMatch(CANONICAL_SESSION);
  });

  it("stores a canonical session during request transformation", () => {
    const credentials = {
      rawHeaders: { "x-opencode-session": "foreign-session", "x-opencode-client": "desktop" },
    };
    executor.transformRequest("big-pickle", { messages: [{ role: "user", content: "hi" }] }, true, credentials);
    expect(credentials.runtimeOpencodeSession).toMatch(CANONICAL_SESSION);
  });
});
