import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const MIN_ACCEPTED = [1, 0, 13]; // upstream answers 426 below this (issue #153)
const readSource = (relativePath) =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");

const asTuple = (version) => version.split(".").map((part) => Number.parseInt(part, 10));

const loadWithEnv = async (value) => {
  vi.resetModules();
  if (value === undefined) delete process.env.GROK_CLI_VERSION;
  else process.env.GROK_CLI_VERSION = value;
  const mod = await import("../../open-sse/config/grokCli.js");
  delete process.env.GROK_CLI_VERSION;
  return mod.GROK_CLI_VERSION;
};

describe("grok-cli client version (issue #153)", () => {
  it("defaults to a version the upstream accepts", async () => {
    const version = await loadWithEnv(undefined);
    const [major, minor, patch] = asTuple(version);
    const [minMajor, minMinor, minPatch] = MIN_ACCEPTED;
    const accepted =
      major > minMajor ||
      (major === minMajor && minor > minMinor) ||
      (major === minMajor && minor === minMinor && patch >= minPatch);
    expect(accepted, `${version} must be >= 1.0.13`).toBe(true);
  });

  it("honours a valid GROK_CLI_VERSION override", async () => {
    expect(await loadWithEnv("1.4.2")).toBe("1.4.2");
    expect(await loadWithEnv(" 2.0 ")).toBe("2.0");
  });

  it("ignores a malformed override instead of sending junk upstream", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const fallback = await loadWithEnv(undefined);
      expect(warn).not.toHaveBeenCalled();
      for (const bad of ["latest", "1.x", "1.0.13-beta", ""]) {
        expect(await loadWithEnv(bad)).toBe(fallback);
      }
      // "" means unset, the others are malformed and warned about.
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("keeps one source of truth for the OAuth handshake headers", () => {
    for (const file of [
      "../../src/lib/oauth/providers.js",
      "../../src/app/api/providers/[id]/test/oauthTestConfig.js",
    ]) {
      const source = readSource(file);
      expect(source, `${file} must not pin the old version`).not.toMatch(/0\.2\.9[0-9]/);
      expect(source, `${file} must use the shared constant`).toMatch(/GROK_CLI_VERSION/);
    }
  });
});
