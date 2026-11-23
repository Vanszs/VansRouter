import { describe, it, expect, afterEach } from "vitest";
import { execFileSync } from "child_process";
import { createRequire } from "module";
import fs from "fs";
import os from "os";
import path from "path";

const require = createRequire(import.meta.url);
const {
  restrictPrivateKeyPermissions,
  PRIVATE_KEY_MODE,
} = require("../../src/mitm/cert/keyPermissions.js");

const IS_POSIX = process.platform !== "win32";
const tmpDirs = [];

function makeTmpDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

function makeKey(mode) {
  const keyPath = path.join(makeTmpDir("mitm-key-perm-"), "rootCA.key");
  fs.writeFileSync(keyPath, "-----BEGIN RSA PRIVATE KEY-----\nfake\n-----END RSA PRIVATE KEY-----\n");
  fs.chmodSync(keyPath, mode);
  return keyPath;
}

function modeOf(file) {
  return fs.statSync(file).mode & 0o777;
}

afterEach(() => {
  while (tmpDirs.length) {
    fs.rmSync(tmpDirs.pop(), { recursive: true, force: true });
  }
});

// ============================================================
// #108: MITM Root CA private key must not be world-readable
// ============================================================
describe("MITM Root CA private key permissions", () => {
  it("targets owner-only mode (0600)", () => {
    expect(PRIVATE_KEY_MODE).toBe(0o600);
  });

  it.skipIf(!IS_POSIX)("restricts an existing world-readable key to 0600", () => {
    const keyPath = makeKey(0o644);
    expect(modeOf(keyPath)).toBe(0o644);

    expect(restrictPrivateKeyPermissions(keyPath)).toBe(true);
    expect(modeOf(keyPath)).toBe(0o600);
  });

  it.skipIf(!IS_POSIX)("keeps an already-restricted key unchanged", () => {
    const keyPath = makeKey(0o600);
    expect(restrictPrivateKeyPermissions(keyPath)).toBe(true);
    expect(modeOf(keyPath)).toBe(0o600);
  });

  it("returns false when the key does not exist", () => {
    const missing = path.join(makeTmpDir("mitm-key-missing-"), "rootCA.key");
    expect(restrictPrivateKeyPermissions(missing)).toBe(false);
    expect(fs.existsSync(missing)).toBe(false);
  });

  it("never throws on unusable input", () => {
    expect(restrictPrivateKeyPermissions("")).toBe(false);
    expect(restrictPrivateKeyPermissions(null)).toBe(false);
    expect(restrictPrivateKeyPermissions(undefined)).toBe(false);
  });

  it.skipIf(!IS_POSIX)(
    "generateRootCA writes rootCA.key with owner-only mode",
    () => {
      const dataDir = makeTmpDir("mitm-rootca-gen-");
      const rootCAPath = path.resolve("src/mitm/cert/rootCA.js");
      const script = `
        process.env.DATA_DIR = ${JSON.stringify(dataDir)};
        const fs = require("fs");
        const { generateRootCA, ROOT_CA_KEY_PATH } = require(${JSON.stringify(rootCAPath)});
        generateRootCA()
          .then(() => process.stdout.write(String(fs.statSync(ROOT_CA_KEY_PATH).mode & 0o777)))
          .catch((error) => { console.error(error); process.exit(1); });
      `;

      const output = execFileSync(process.execPath, ["-e", script], {
        encoding: "utf8",
        timeout: 60000,
      });

      // The generator also logs to stdout; the decimal mode is the final line.
      const lastLine = output.trim().split("\n").pop().trim();
      expect(Number(lastLine)).toBe(0o600);
    },
    60000,
  );
});
