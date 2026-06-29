import { describe, it, expect } from "vitest";
import { Linter } from "eslint";
import path from "path";
import { pathToFileURL } from "url";

/**
 * Meta-test for the project's eslint.config.mjs.
 *
 * The remote config enables `no-undef` for two scopes:
 *   1. Server-side modules under src/app/api, open-sse, src/lib, src/sse, cli —
 *      with explicit Node globals (console, process, Buffer, setTimeout, etc.).
 *   2. Dashboard client components under src/app/(dashboard)/** — with no extra
 *      globals declared, so browser globals like `window` are NOT pre-declared
 *      and would still be flagged by no-undef.
 *
 * These tests verify both scopes behave as documented.
 */

const configPath = path.resolve("eslint.config.mjs");
const configUrl = pathToFileURL(configPath).href;

describe("eslint no-undef config (eslint.config.mjs)", () => {
  it("flags an undefined identifier in a server-module file", async () => {
    const cfg = (await import(configUrl)).default;
    const linter = new Linter();
    const code = `export function broken() { return fooBar + 1; }`;
    const messages = linter.verify(code, cfg, { filename: "src/lib/server-bad.js" });
    const undef = messages.filter(
      (m) => m.ruleId === "no-undef" && /fooBar/.test(m.message),
    );
    expect(undef.length, "expected no-undef to flag fooBar").toBeGreaterThan(0);
  });

  it("does NOT flag Node globals (Buffer, process, setTimeout) in a server-module file", async () => {
    const cfg = (await import(configUrl)).default;
    const linter = new Linter();
    const code = `export const x = Buffer.from("hi").length + process.env.NODE_ENV + setTimeout;`;
    const messages = linter.verify(code, cfg, { filename: "src/lib/server-good.js" });
    const undef = messages.filter((m) => m.ruleId === "no-undef");
    expect(undef.map((m) => m.message)).toEqual([]);
  });

  it("flags an undefined identifier in a dashboard client-component file", async () => {
    const cfg = (await import(configUrl)).default;
    const linter = new Linter();
    const code = `export function broken() { return bazQux + 1; }`;
    const messages = linter.verify(code, cfg, {
      filename: "src/app/(dashboard)/client-bad.js",
    });
    const undef = messages.filter(
      (m) => m.ruleId === "no-undef" && /bazQux/.test(m.message),
    );
    expect(undef.length, "expected no-undef to flag bazQux").toBeGreaterThan(0);
  });

  it("does NOT flag identifiers declared at function scope in dashboard client files", async () => {
    // Regression guard for the original bug: variables returned by hooks
    // (useState, useReducer, etc.) MUST be visible to nested JSX in the
    // same component. If ESLint ever starts flagging them, this test fails.
    const cfg = (await import(configUrl)).default;
    const linter = new Linter();
    const code = `export function Good() {
      const [name, setName] = ["x", () => {}];
      const handler = () => setName("y");
      return <button onClick={handler}>{name}</button>;
    }`;
    const messages = linter.verify(code, cfg, {
      filename: "src/app/(dashboard)/client-good.js",
    });
    const undef = messages.filter((m) => m.ruleId === "no-undef");
    expect(undef.map((m) => m.message)).toEqual([]);
  });

  it("flags a clearly undefined identifier in a dashboard client file", async () => {
    const cfg = (await import(configUrl)).default;
    const linter = new Linter();
    const code = `export const a = thisIdentifierIsDefinitelyNotDefined123;`;
    const messages = linter.verify(code, cfg, {
      filename: "src/app/(dashboard)/should-error.js",
    });
    const undef = messages.filter((m) => m.ruleId === "no-undef");
    expect(
      undef.find((m) => /thisIdentifierIsDefinitelyNotDefined123/.test(m.message)),
      "expected no-undef to flag the unknown identifier",
    ).toBeDefined();
  });

  it("does NOT flag SW `clients` global in cli/app/public/sw.js", async () => {
    const cfg = (await import(configUrl)).default;
    const linter = new Linter();
    const code = `self.addEventListener("fetch", (e) => { clients.claim(); });`;
    const messages = linter.verify(code, cfg, { filename: "cli/app/public/sw.js" });
    const undef = messages.filter((m) => m.ruleId === "no-undef");
    expect(undef.map((m) => m.message)).toEqual([]);
  });
});
