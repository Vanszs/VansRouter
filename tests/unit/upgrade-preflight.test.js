import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { evaluateUpgradePreflight } = require("../../scripts/preflight-upgrade.cjs");

describe("upgrade preflight", () => {
  it("accepts an explicit immutable version and canonical Compose storage", () => {
    const result = evaluateUpgradePreflight({
      envText: "VANSROUTER_VERSION=0.91.34\n",
      composeText: "9router-data:/app/data\n",
    });
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("fails closed for missing or mutable image versions", () => {
    const result = evaluateUpgradePreflight({
      envText: "VANSROUTER_VERSION=latest\n",
      composeText: "image: ghcr.io/vanszs/vansrouter:${VANSROUTER_VERSION}\n",
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/VANSROUTER_VERSION/);
  });

  it("rejects legacy image references before an upgrade", () => {
    const result = evaluateUpgradePreflight({
      envText: "VANSROUTER_VERSION=0.91.34\nIMAGE=9router/9router:latest\n",
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/legacy image/i);
  });

  it("warns when a host data path is hidden by Compose's canonical volume", () => {
    const result = evaluateUpgradePreflight({
      envText: "VANSROUTER_VERSION=0.91.34\nDATA_DIR=/var/lib/9router\n",
      composeText: "9router-data:/app/data\n",
    });
    expect(result.ok).toBe(true);
    expect(result.warnings.join(" ")).toMatch(/bind mount|DATA_DIR/i);
  });

  it("fails when PM2 and the deploy shell use different data roots", () => {
    const result = evaluateUpgradePreflight({
      envText: "VANSROUTER_VERSION=0.91.34\n",
      pm2Env: { DATA_DIR: "/var/lib/9router" },
      shellEnv: { DATA_DIR: "/home/user/.9router" },
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/PM2|DATA_DIR/);
  });

  it("accepts an explicitly aligned PM2 data root", () => {
    const result = evaluateUpgradePreflight({
      envText: "VANSROUTER_VERSION=0.91.34\n",
      pm2Env: { DATA_DIR: "/var/lib/9router" },
      shellEnv: { DATA_DIR: "/var/lib/9router" },
    });
    expect(result.ok).toBe(true);
  });
});
