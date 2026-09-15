import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { acquireLock, activate, getFreePort, pruneReleases, readCurrentTarget, selectRollbackRelease, staticDirOf, verifyRelease } from "../../scripts/deploy-atomic.cjs";

const tempRoots = [];

function makeRelease(root, name, chunk = "chunk.js") {
  const release = path.join(root, name);
  const nextDir = path.join(release, ".next");
  fs.mkdirSync(path.join(nextDir, "static", "chunks"), { recursive: true });
  fs.writeFileSync(path.join(release, "server.js"), "// test server");
  fs.writeFileSync(path.join(nextDir, "static", "chunks", chunk), "self.webpackChunk_N_E=[];");
  fs.writeFileSync(path.join(nextDir, "BUILD_ID"), name);
  for (const file of ["routes-manifest.json", "build-manifest.json"]) fs.writeFileSync(path.join(nextDir, file), "{}");
  return release;
}

afterEach(() => {
  while (tempRoots.length) fs.rmSync(tempRoots.pop(), { recursive: true, force: true });
});

describe("atomic deployment artifact", () => {
  it("pins PM2 to the persistent launcher and refuses destructive switching", () => {
    const script = fs.readFileSync(fileURLToPath(new URL("../../scripts/deploy-atomic.cjs", import.meta.url)), "utf8");
    expect(script).toContain('pm2", ["reload"');
    expect(script).toContain('path.join(root, "ecosystem.config.cjs")');
    expect(script).toContain("assertSafePaths");
    expect(script).not.toContain('["delete", appName]');
    expect(script).not.toContain('pm2", ["start", path.join(releasePath');
    expect(() => execFileSync(process.execPath, ["scripts/deploy-atomic.cjs"], {
      cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."),
      env: { ...process.env, RELEASE_ROOT: path.join(os.tmpdir(), "unsafe-release-root") },
      stdio: "pipe",
    })).toThrow(/Refusing ephemeral RELEASE_ROOT/);
  });

  it("requires a server and JavaScript static chunk", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "deploy-atomic-test-"));
    tempRoots.push(root);
    const incomplete = path.join(root, "incomplete");
    fs.mkdirSync(incomplete, { recursive: true });
    expect(() => verifyRelease(incomplete)).toThrow("missing");

    const release = makeRelease(root, "complete");
    expect(verifyRelease(release)).toMatchObject({ chunkCount: 1, buildId: "complete" });
    expect(staticDirOf(release)).toBe(path.join(release, ".next", "static"));
  });

  it("activates a complete release with one symlink replacement", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "deploy-atomic-test-"));
    tempRoots.push(root);
    const current = path.join(root, "current");
    const oldRelease = makeRelease(root, "old");
    const newRelease = makeRelease(root, "new");

    activate(oldRelease, current);
    expect(readCurrentTarget()).toBe(null);

    expect(readCurrentTarget(current)).toBe(oldRelease);
    activate(newRelease, current);
    expect(fs.realpathSync(current)).toBe(newRelease);
    expect(fs.existsSync(path.join(newRelease, ".next", "static", "chunks", "chunk.js"))).toBe(true);
  });

  it("never exposes a missing asset to concurrent HTTP requests during activation", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "deploy-atomic-test-"));
    tempRoots.push(root);
    const current = path.join(root, "current");
    const oldRelease = makeRelease(root, "old", "chunk.js");
    const newRelease = makeRelease(root, "new", "chunk.js");
    activate(oldRelease, current);
    const server = http.createServer((request, response) => {
      setTimeout(() => {
        const active = readCurrentTarget(current);
        const asset = path.join(active, ".next", "static", "chunks", path.basename(request.url));
        response.writeHead(fs.existsSync(asset) ? 200 : 404);
        response.end();
      }, 1);
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address();
    try {
      const requests = Array.from({ length: 100 }, () => fetch(`http://127.0.0.1:${port}/chunk.js`));
      activate(newRelease, current);
      const responses = await Promise.all(requests);
      expect(responses.every((response) => response.status === 200)).toBe(true);
      expect(readCurrentTarget(current)).toBe(newRelease);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it("keeps release directories available for rollback selection", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "deploy-atomic-test-"));
    tempRoots.push(root);
    const oldRelease = makeRelease(root, "2026-01-01");
    const newRelease = makeRelease(root, "2026-01-02");
    const current = path.join(root, "current");
    activate(newRelease, current);

    expect(verifyRelease(oldRelease).chunkCount).toBe(1);
    expect(readCurrentTarget(current)).toBe(newRelease);
    expect(fs.existsSync(oldRelease)).toBe(true);
  });

  it("skips an incomplete newer release during rollback selection", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "deploy-atomic-test-"));
    tempRoots.push(root);
    const valid = makeRelease(root, "2026-01-01");
    const incomplete = path.join(root, "2026-01-03");
    fs.mkdirSync(incomplete);

    expect(selectRollbackRelease(root)).toBe(valid);
  });

  it("serializes deployment locks and removes the lock on release", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "deploy-atomic-test-"));
    tempRoots.push(root);
    const lockRoot = path.join(root, "releases");
    const unlock = acquireLock(lockRoot);
    expect(() => acquireLock(lockRoot)).toThrow(/Deployment lock is held/);
    unlock();
    const unlockAgain = acquireLock(lockRoot);
    expect(fs.existsSync(`${lockRoot}.lock`)).toBe(true);
    unlockAgain();
    expect(fs.existsSync(`${lockRoot}.lock`)).toBe(false);
  });

  it("allocates a free loopback smoke port", async () => {
    const assigned = await getFreePort();
    expect(assigned).toBeGreaterThan(0);
  });

  it("prunes older releases and stale staging directories while keeping active and rollback targets", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "deploy-atomic-prune-"));
    tempRoots.push(root);
    const rel1 = makeRelease(root, "2026-01-01");
    const rel2 = makeRelease(root, "2026-01-02");
    const rel3 = makeRelease(root, "2026-01-03");
    const staleStaging = path.join(root, ".staging-2026-01-04");
    fs.mkdirSync(staleStaging);

    pruneReleases(root, 2);

    expect(fs.existsSync(staleStaging)).toBe(false);
    expect(fs.existsSync(rel3)).toBe(true);
    expect(fs.existsSync(rel2)).toBe(true);
    expect(fs.existsSync(rel1)).toBe(false);
  });
});
