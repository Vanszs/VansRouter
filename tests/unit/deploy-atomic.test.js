import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { acquireLock, activate, assertRuntimePathAlignment, finalizeReleaseSymlinks, getFreePort, makeReleaseSelfContained, pruneReleases, readCurrentTarget, removeRuntimeEnvFiles, resolveDeploymentEnvironment, selectRollbackRelease, staticDirOf, verifyRelease, verifyStandaloneLinks } from "../../scripts/deploy-atomic.cjs";

const tempRoots = [];

// readCurrentTarget() resolves the symlink, and on macOS that expands /var to
// /private/var while os.tmpdir() still reports /var. Compare resolved to resolved.
const real = (p) => fs.realpathSync(p);

function makeRelease(root, name, chunk = "chunk.js") {
  const release = path.join(root, name);
  const nextDir = path.join(release, ".next");
  fs.mkdirSync(path.join(nextDir, "static", "chunks"), { recursive: true });
  fs.mkdirSync(path.join(nextDir, "static"), { recursive: true });
  fs.mkdirSync(path.join(nextDir, "server"), { recursive: true });
  fs.mkdirSync(path.join(release, "public"), { recursive: true });
  fs.mkdirSync(path.join(release, "node_modules", "next"), { recursive: true });
  fs.mkdirSync(path.join(release, "node_modules", "open"), { recursive: true });
  fs.writeFileSync(path.join(release, "server.js"), "// test server");
  fs.writeFileSync(path.join(release, "public", "favicon.svg"), "<svg></svg>");
  fs.writeFileSync(path.join(release, "node_modules", "next", "package.json"), JSON.stringify({ name: "next", main: "index.js" }));
  fs.writeFileSync(path.join(release, "node_modules", "next", "index.js"), "module.exports = {};");
  fs.writeFileSync(path.join(release, "node_modules", "open", "package.json"), JSON.stringify({ name: "open", main: "index.js" }));
  fs.writeFileSync(path.join(release, "node_modules", "open", "index.js"), "module.exports = {};");
  fs.writeFileSync(path.join(nextDir, "static", "styles.css"), "body{}");
  fs.writeFileSync(path.join(nextDir, "static", "chunks", chunk), "self.webpackChunk_N_E=[];");
  fs.writeFileSync(path.join(nextDir, "server", "app.js"), "module.exports = {};");
  fs.writeFileSync(path.join(nextDir, "server", "pages-manifest.json"), "{}");
  fs.writeFileSync(path.join(nextDir, "BUILD_ID"), name);
  for (const file of ["routes-manifest.json", "build-manifest.json"]) fs.writeFileSync(path.join(nextDir, file), "{}");
  fs.writeFileSync(
    path.join(nextDir, "required-server-files.json"),
    JSON.stringify({ files: [".next/BUILD_ID", ".next/routes-manifest.json", ".next/server/pages-manifest.json"] }),
  );
  return release;
}

afterEach(() => {
  while (tempRoots.length) fs.rmSync(tempRoots.pop(), { recursive: true, force: true });
});

describe("atomic deployment artifact", () => {
  it("removes build-time environment files from a staged release", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "deploy-atomic-env-"));
    tempRoots.push(root);
    fs.mkdirSync(path.join(root, "nested"), { recursive: true });
    fs.writeFileSync(path.join(root, ".env"), "SECRET=should-not-ship");
    fs.writeFileSync(path.join(root, "nested", ".env.production"), "SECRET=also-not");
    fs.writeFileSync(path.join(root, "keep.txt"), "keep");
    expect(removeRuntimeEnvFiles(root)).toBe(2);
    expect(fs.existsSync(path.join(root, ".env"))).toBe(false);
    expect(fs.existsSync(path.join(root, "nested", ".env.production"))).toBe(false);
    expect(fs.existsSync(path.join(root, "keep.txt"))).toBe(true);
  });

  it("pins PM2 to the persistent launcher and switches entrypoints safely", () => {
    const script = fs.readFileSync(fileURLToPath(new URL("../../scripts/deploy-atomic.cjs", import.meta.url)), "utf8");
    expect(script).toContain('pm2", ["reload"');
    expect(script).toContain('path.join(root, "ecosystem.config.cjs")');
    expect(script).toContain("assertSafePaths");
    const ecosystem = fs.readFileSync(path.resolve("ecosystem.config.cjs"), "utf8");
    expect(ecosystem).toContain('NODE_PATH: ""');
    expect(ecosystem).toContain('custom-server.js');
    expect(ecosystem).toContain('RELEASE_SERVER:');
    expect(ecosystem).toContain('CURRENT_LINK: currentLink');
    expect(ecosystem).toContain('RELEASE_ROOT: releaseRoot');
    expect(ecosystem).toContain('DATA_DIR: dataDir');
    expect(ecosystem).toContain('resolveRuntimePaths');
    const runtimePaths = fs.readFileSync(path.resolve("scripts/runtime-paths.cjs"), "utf8");
    expect(runtimePaths).toContain('path.join(home, ".9router")');
    expect(runtimePaths).not.toContain('.local", "share", "9router');
    expect(ecosystem).not.toContain('/var/lib/9router/current');
    expect(script).toContain('if (activeScript && path.resolve(activeScript) !== path.resolve(expectedScript))');
    expect(script).toContain('run("pm2", ["delete", appName]');
    expect(script).not.toContain('pm2", ["start", path.join(releasePath');
    expect(() => execFileSync(process.execPath, ["scripts/deploy-atomic.cjs"], {
      cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."),
      env: { ...process.env, RELEASE_ROOT: path.join(os.tmpdir(), "unsafe-release-root") },
      stdio: "pipe",
    })).toThrow(/Refusing ephemeral RELEASE_ROOT/);
    expect(() => execFileSync(process.execPath, ["scripts/deploy-atomic.cjs"], {
      cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."),
      env: { ...process.env, RELEASE_ROOT: process.cwd() },
      stdio: "pipe",
    })).toThrow(/Refusing (unsafe|ephemeral) RELEASE_ROOT/);
  });

  it("resolves PM2 data and release paths from one merged environment", () => {
    const env = resolveDeploymentEnvironment({
      shellEnv: { PORT: "3003" },
      pm2Env: { DATA_DIR: "/var/lib/9router" },
    });

    // Resolve the expectation too: path.resolve is a no-op on POSIX but prepends
    // the drive letter on Windows, so a hardcoded "/var/..." only ever passed on
    // Linux. The contract under test is "an explicit DATA_DIR wins", not the
    // platform's spelling of it.
    const dataDir = path.resolve("/var/lib/9router");
    expect(env.DATA_DIR).toBe(dataDir);
    expect(env.RELEASE_ROOT).toBe(path.join(dataDir, "releases"));
    expect(env.CURRENT_LINK).toBe(path.join(dataDir, "current"));
    expect(env.RELEASE_SERVER).toBe(path.join(dataDir, "current", "server.js"));
  });

  it("blocks a deploy when PM2 and the shell resolve different implicit data roots", () => {
    expect(() => assertRuntimePathAlignment({
      shellEnv: { HOME: "/home/tester" },
      pm2Env: { DATA_DIR: "/var/lib/9router" },
    })).toThrow(/DATA_DIR/);

    expect(() => assertRuntimePathAlignment({
      shellEnv: { DATA_DIR: "/var/lib/9router" },
      pm2Env: { DATA_DIR: "/var/lib/9router" },
    })).not.toThrow();
  });

  it("also compares paths when PM2 only declares a release root", () => {
    expect(() => assertRuntimePathAlignment({
      shellEnv: { HOME: "/home/tester" },
      pm2Env: { RELEASE_ROOT: "/opt/9router/releases" },
    })).toThrow(/RELEASE_ROOT/);
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
    fs.rmSync(path.join(release, ".next", "server", "pages-manifest.json"));
    expect(() => verifyRelease(release)).toThrow(/pages-manifest\.json/);
  });

  it("fails closed when the external open runtime is absent", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "deploy-atomic-open-"));
    tempRoots.push(root);
    const release = makeRelease(root, "missing-open");
    fs.rmSync(path.join(release, "node_modules", "open"), { recursive: true, force: true });
    expect(() => verifyRelease(release, { selfContained: true })).toThrow(/open/);
    expect(() => verifyRelease(release, {
      selfContained: true,
      requireExternalPackages: false,
    })).not.toThrow();
  });

  it("rewrites pnpm links before the build directory is removed", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "deploy-atomic-portable-"));
    tempRoots.push(root);
    const source = path.join(root, "build", "standalone");
    const staged = path.join(root, "release.staging");
    const release = path.join(root, "release");
    const packageDir = path.join(source, "node_modules", ".pnpm", "next@1", "node_modules", "next");
    fs.mkdirSync(packageDir, { recursive: true });
    fs.writeFileSync(path.join(packageDir, "package.json"), "{}");
    fs.writeFileSync(path.join(packageDir, "index.js"), "module.exports = {};");
    fs.mkdirSync(path.join(source, "node_modules"), { recursive: true });
    fs.symlinkSync(
      packageDir,
      path.join(source, "node_modules", "next"),
      process.platform === "win32" ? "junction" : "dir",
    );

    fs.cpSync(source, staged, { recursive: true, verbatimSymlinks: true });
    const stagedLink = path.join(staged, "node_modules", "next");
    expect(fs.lstatSync(stagedLink).isSymbolicLink()).toBe(true);
    expect(makeReleaseSelfContained(staged, source)).toBe(1);
    expect(fs.readlinkSync(stagedLink)).not.toContain(source);

    fs.rmSync(path.join(root, "build"), { recursive: true, force: true });
    fs.renameSync(staged, release);
    const releaseLink = path.join(release, "node_modules", "next");
    expect(fs.existsSync(path.join(release, "node_modules", "next", "package.json"))).toBe(true);
    expect(verifyStandaloneLinks(release)).toBe(1);
    expect(createRequire(path.join(release, "package.json")).resolve("next")).toContain(release);
    expect(fs.readlinkSync(releaseLink)).not.toContain(source);
  });

  it("rejects a release that only resolves next from an ancestor", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "deploy-atomic-decoy-"));
    tempRoots.push(root);
    const release = makeRelease(root, "2026-01-04T00-00-00-000Z-4");
    const decoy = path.join(root, "node_modules", "next");
    fs.mkdirSync(decoy, { recursive: true });
    fs.writeFileSync(path.join(decoy, "package.json"), JSON.stringify({ name: "next", main: "index.js" }));
    fs.writeFileSync(path.join(decoy, "index.js"), "module.exports = {};");
    fs.rmSync(path.join(release, "node_modules"), { recursive: true, force: true });

    expect(() => verifyRelease(release, { selfContained: true })).toThrow(/next is not bundled/);
  });

  it("rejects external and dangling standalone links", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "deploy-atomic-links-"));
    tempRoots.push(root);
    const release = path.join(root, "release");
    const source = path.join(root, "source");
    const outside = path.join(root, "outside");
    fs.mkdirSync(path.join(release, "node_modules"), { recursive: true });
    fs.mkdirSync(source, { recursive: true });
    fs.mkdirSync(outside, { recursive: true });
    const link = path.join(release, "node_modules", "next");
    fs.symlinkSync(outside, link, process.platform === "win32" ? "junction" : "dir");
    expect(() => makeReleaseSelfContained(release, source)).toThrow(/escapes release/);

    fs.unlinkSync(link);
    fs.symlinkSync(path.join(release, "missing"), link, process.platform === "win32" ? "junction" : "dir");
    expect(() => verifyStandaloneLinks(release)).toThrow(/dangling/);
  });

  it("defers Windows directory links until the release has its final name", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "deploy-atomic-win-links-"));
    tempRoots.push(root);
    const source = path.join(root, "build", "standalone");
    const staged = path.join(root, "release.staging");
    const release = path.join(root, "release");
    const packageDir = path.join(source, "node_modules", ".pnpm", "next@1", "node_modules", "next");
    fs.mkdirSync(packageDir, { recursive: true });
    fs.writeFileSync(path.join(packageDir, "package.json"), "{}");
    fs.mkdirSync(path.join(source, "node_modules"), { recursive: true });
    fs.symlinkSync(packageDir, path.join(source, "node_modules", "next"), "dir");

    fs.cpSync(source, staged, { recursive: true, verbatimSymlinks: true });
    expect(makeReleaseSelfContained(staged, source, { platform: "win32" })).toBe(1);
    expect(fs.existsSync(path.join(staged, ".standalone-link-manifest.json"))).toBe(true);
    expect(fs.existsSync(path.join(staged, "node_modules", "next"))).toBe(false);

    fs.rmSync(path.join(root, "build"), { recursive: true, force: true });
    fs.renameSync(staged, release);
    expect(finalizeReleaseSymlinks(release)).toBe(1);
    expect(fs.lstatSync(path.join(release, "node_modules", "next")).isSymbolicLink()).toBe(true);
    expect(fs.existsSync(path.join(release, "node_modules", "next", "package.json"))).toBe(true);
  });

  it("activates a complete release with one symlink replacement", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "deploy-atomic-test-"));
    tempRoots.push(root);
    const current = path.join(root, "current");
    const oldRelease = makeRelease(root, "old");
    const newRelease = makeRelease(root, "new");
    const productionLink = readCurrentTarget();

    activate(oldRelease, current);
    // Activating an explicit path must leave the default (production) link alone —
    // asserting it is null only held on machines without a deployed release.
    expect(readCurrentTarget()).toBe(productionLink);

    expect(readCurrentTarget(current)).toBe(real(oldRelease));
    activate(newRelease, current);
    expect(fs.realpathSync(current)).toBe(real(newRelease));
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
      expect(readCurrentTarget(current)).toBe(real(newRelease));
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it("keeps release directories available for rollback selection", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "deploy-atomic-test-"));
    tempRoots.push(root);
    const oldRelease = makeRelease(root, "2026-01-01T00-00-00-000Z-1");
    const newRelease = makeRelease(root, "2026-01-02T00-00-00-000Z-2");
    const current = path.join(root, "current");
    activate(newRelease, current);

    expect(verifyRelease(oldRelease).chunkCount).toBe(1);
    expect(readCurrentTarget(current)).toBe(real(newRelease));
    expect(fs.existsSync(oldRelease)).toBe(true);
  });

  it("skips an incomplete newer release during rollback selection", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "deploy-atomic-test-"));
    tempRoots.push(root);
    const valid = makeRelease(root, "2026-01-01T00-00-00-000Z-1");
    const incomplete = path.join(root, "2026-01-03T00-00-00-000Z-3");
    fs.mkdirSync(incomplete);

    expect(selectRollbackRelease(root)).toBe(real(valid));
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
    const rel1 = makeRelease(root, "2026-01-01T00-00-00-000Z-1");
    const rel2 = makeRelease(root, "2026-01-02T00-00-00-000Z-2");
    const rel3 = makeRelease(root, "2026-01-03T00-00-00-000Z-3");
    const unrelated = path.join(root, "source");
    fs.mkdirSync(unrelated);
    fs.writeFileSync(path.join(unrelated, "keep.txt"), "keep");
    const staleStaging = path.join(root, ".staging-2026-01-04");
    fs.mkdirSync(staleStaging);

    pruneReleases(root, 2);

    expect(fs.existsSync(staleStaging)).toBe(false);
    expect(fs.existsSync(rel3)).toBe(true);
    expect(fs.existsSync(rel2)).toBe(true);
    expect(fs.existsSync(rel1)).toBe(false);
    expect(fs.existsSync(unrelated)).toBe(true);
  });
});
