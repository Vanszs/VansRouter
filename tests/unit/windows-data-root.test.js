import fs from "node:fs";
import { describe, expect, it } from "vitest";

// The Windows data root is duplicated across the app, the CLI and the deploy
// scripts. They drifted: two files used %APPDATA%\VansRoute, and only the
// server-side resolver rejected a Unix DATA_DIR on Windows.
const DATA_ROOT_FILES = [
  "src/lib/dataDir.js",
  "src/lib/appUpdater.js",
  "src/lib/updater/updater.js",
  "src/lib/mitmAliasCache.js",
  "src/mitm/paths.js",
  "scripts/runtime-paths.cjs",
  "cli/cli.js",
  "cli/hooks/sqliteRuntime.js",
  "cli/src/cli/api/client.js",
  "src/shared/utils/apiKey.js",
];

describe("Windows data root", () => {
  it("uses one directory name everywhere, never the stale VansRoute brand", () => {
    const offenders = DATA_ROOT_FILES.filter((file) => {
      const source = fs.readFileSync(file, "utf8");
      return /APPDATA[^\n]*VansRoute|"VansRoute"\s*\)/.test(source);
    });
    expect(offenders).toEqual([]);
  });

  it("defaults the npm package name the updater installs to a real package", () => {
    const source = fs.readFileSync("src/lib/updater/updater.js", "utf8");
    const fallback = source.match(/UPDATER_PKG_NAME\s*\|\|\s*"([^"]+)"/)?.[1];
    expect(fallback).toBe("vansrouter");
  });

  it("rejects a Unix DATA_DIR on Windows wherever the data root is resolved", () => {
    const resolvers = [
      "src/lib/dataDir.js",
      "src/shared/utils/apiKey.js",
      "cli/cli.js",
      "cli/hooks/sqliteRuntime.js",
      "cli/src/cli/api/client.js",
    ];
    for (const file of resolvers) {
      const source = fs.readFileSync(file, "utf8");
      expect(source.includes("win32"), `${file} should branch on win32`).toBe(true);
      expect(source.includes("/^\\//"), `${file} should reject a leading-slash DATA_DIR`).toBe(true);
    }
  });
});
