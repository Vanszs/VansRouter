import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// getDataDir() runs at import time, so each case re-imports the module with
// process.env and process.platform staged. The guard keeps a temp DATA_DIR from
// becoming the persistent store; the artifact check needs the opposite.
const GUARD_WARNING = "looks like a temp/smoke directory";

async function loadDataDir({ platform, env }) {
  vi.resetModules();
  const originalPlatform = process.platform;
  const originalEnv = { ...process.env };
  const staged = { ...env };

  for (const key of Object.keys(process.env)) {
    if (key.startsWith("DATA_DIR") || key === "NODE_ENV" || key === "pm_id") delete process.env[key];
  }
  Object.defineProperty(process, "platform", { value: platform, configurable: true });
  Object.assign(process.env, staged);

  try {
    return (await import("../../src/lib/dataDir.js")).getDataDir();
  } finally {
    Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) delete process.env[key];
    }
    Object.assign(process.env, originalEnv);
  }
}

let warn;

function guardFired() {
  return warn.mock.calls.some(([message]) => String(message).includes(GUARD_WARNING));
}

describe("temporary DATA_DIR guard", () => {
  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it("redirects a production deployment off a temp DATA_DIR by default", async () => {
    const temp = mkdtempSync(path.join(os.tmpdir(), "9router-data-smoke-"));
    const dir = await loadDataDir({
      platform: "linux",
      env: { DATA_DIR: temp, NODE_ENV: "production" },
    });

    expect(dir).not.toBe(temp);
    expect(guardFired()).toBe(true);
    rmSync(temp, { recursive: true, force: true });
  });

  it("honours the opt-out so a disposable sandbox keeps its DATA_DIR", async () => {
    const temp = mkdtempSync(path.join(os.tmpdir(), "9router-data-smoke-"));
    const dir = await loadDataDir({
      platform: "linux",
      env: { DATA_DIR: temp, DATA_DIR_ALLOW_TEMP: "1", NODE_ENV: "production" },
    });

    expect(dir).toBe(temp);
    expect(guardFired()).toBe(false);
    rmSync(temp, { recursive: true, force: true });
  });

  it("ignores an opt-out that is not exactly \"1\", like every other flag here", async () => {
    // Matches VANSROUTER_SKIP_UPDATE_CHECK, NINE_ROUTER_PROXY_MANAGED and
    // TRAY_MODE, which all compare to "1": any non-empty string as true would let
    // DATA_DIR_ALLOW_TEMP=false switch the guard off.
    const temp = mkdtempSync(path.join(os.tmpdir(), "9router-data-smoke-"));
    const dir = await loadDataDir({
      platform: "linux",
      env: { DATA_DIR: temp, DATA_DIR_ALLOW_TEMP: "false", NODE_ENV: "production" },
    });

    expect(dir).not.toBe(temp);
    expect(guardFired()).toBe(true);
    rmSync(temp, { recursive: true, force: true });
  });

  it("classifies the macOS per-user temp root as temporary, and the opt-out covers it", async () => {
    const macTemp = "/var/folders/zz/T/vansrouter-atomic-check-1/data";
    const guarded = await loadDataDir({ platform: "darwin", env: { DATA_DIR: macTemp, NODE_ENV: "production" } });
    expect(guardFired()).toBe(true);
    expect(guarded).not.toBe(macTemp);

    warn.mockClear();
    await loadDataDir({
      platform: "darwin",
      env: { DATA_DIR: macTemp, DATA_DIR_ALLOW_TEMP: "1", NODE_ENV: "production" },
    });
    expect(guardFired()).toBe(false);
  });

  it("leaves a DATA_DIR the guard does not flag alone", async () => {
    const persistent = mkdtempSync(path.join(os.tmpdir(), "9router-persistent-"));
    const dir = await loadDataDir({
      platform: "darwin",
      env: { DATA_DIR: persistent, NODE_ENV: "production" },
    });

    expect(dir).toBe(persistent);
    expect(guardFired()).toBe(false);
    rmSync(persistent, { recursive: true, force: true });
  });
});
