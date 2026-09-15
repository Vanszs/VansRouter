#!/usr/bin/env node
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const net = require("node:net");
const { setTimeout: sleep } = require("node:timers/promises");

const root = path.resolve(__dirname, "..");
const appName = process.env.PM2_APP_NAME || "9router";
const port = Number(process.env.PORT || 3003);
const releaseRoot = path.resolve(process.env.RELEASE_ROOT || "/var/lib/9router/releases");
const currentLink = path.resolve(process.env.CURRENT_LINK || path.join(path.dirname(releaseRoot), "current"));
const smokeTimeoutMs = Number(process.env.SMOKE_TIMEOUT_MS || 30000);

function isUnder(candidate, parent) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

function assertSafePaths() {
  const forbidden = [...new Set([os.tmpdir(), "/tmp", "/var/tmp"].map((value) => path.resolve(value)))];
  if (forbidden.some((prefix) => isUnder(releaseRoot, prefix))) {
    throw new Error(`Refusing ephemeral RELEASE_ROOT: ${releaseRoot}`);
  }
  if (forbidden.some((prefix) => isUnder(currentLink, prefix))) {
    throw new Error(`Refusing ephemeral CURRENT_LINK: ${currentLink}`);
  }
}

function run(command, args, env = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: "inherit",
  });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} exited with ${result.status}`);
}

function releaseId() {
  return `${new Date().toISOString().replace(/[:.]/g, "-")}-${process.pid}`;
}

function staticDirOf(releasePath) {
  const candidates = fs.readdirSync(releasePath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(".next"))
    .map((entry) => path.join(releasePath, entry.name, "static"));
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function verifyRelease(releasePath) {
  const server = path.join(releasePath, "server.js");
  const staticDir = staticDirOf(releasePath);
  const metadataDir = staticDir ? path.dirname(staticDir) : path.join(releasePath, ".next");
  const metadata = ["BUILD_ID", "routes-manifest.json", "build-manifest.json"];
  if (!fs.existsSync(server)) throw new Error(`Incomplete release: missing ${server}`);
  if (!staticDir) throw new Error(`Incomplete release: missing static assets in ${releasePath}`);
  for (const file of metadata) {
    if (!fs.existsSync(path.join(metadataDir, file))) {
      throw new Error(`Incomplete release: missing build metadata ${path.join(metadataDir, file)}`);
    }
  }
  const chunks = fs.readdirSync(staticDir, { recursive: true })
    .filter((file) => typeof file === "string" && file.endsWith(".js"));
  if (!chunks.length) throw new Error(`Incomplete release: no JavaScript chunks in ${staticDir}`);
  const buildId = fs.readFileSync(path.join(metadataDir, "BUILD_ID"), "utf8").trim();
  if (!buildId) throw new Error(`Incomplete release: empty build ID in ${releasePath}`);
  return { server, staticDir, chunkCount: chunks.length, buildId };
}

function acquireLock(rootPath = releaseRoot) {
  const lockPath = `${rootPath}.lock`;
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  try {
    const fd = fs.openSync(lockPath, "wx");
    fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    fs.closeSync(fd);
    return () => fs.rmSync(lockPath, { force: true });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    let owner = null;
    try { owner = JSON.parse(fs.readFileSync(lockPath, "utf8")); } catch {}
    if (owner?.pid) {
      try { process.kill(owner.pid, 0); } catch { fs.rmSync(lockPath, { force: true }); return acquireLock(rootPath); }
    }
    throw new Error(`Deployment lock is held${owner?.pid ? ` by PID ${owner.pid}` : ""}`);
  }
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const assigned = server.address().port;
      server.close((error) => error ? reject(error) : resolve(assigned));
    });
  });
}

function readCurrentTarget(link = currentLink) {
  try {
    return fs.realpathSync(link);
  } catch {
    return null;
  }
}

function activate(releasePath, link = currentLink) {
  fs.mkdirSync(path.dirname(link), { recursive: true });
  const temporaryLink = `${link}.next-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  fs.symlinkSync(releasePath, temporaryLink, "dir");
  fs.renameSync(temporaryLink, link);
}

function switchPm2(buildId = null) {
  const env = {
    ...process.env,
    PORT: String(port),
    NODE_ENV: "production",
    RELEASE_SERVER: path.join(currentLink, "server.js"),
    RELEASE_BUILD_ID: buildId || "",
  };
  const ecosystem = path.join(root, "ecosystem.config.cjs");
  const restarted = spawnSync("pm2", ["reload", ecosystem, "--only", appName, "--update-env"], {
    cwd: root,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (restarted.status === 0) return;
  const restartOutput = `${restarted.stdout || ""}${restarted.stderr || ""}`;
  if (!/not found|not launched/i.test(restartOutput)) {
    throw new Error(`pm2 reload ${appName} failed: ${restartOutput.trim() || restarted.status}`);
  }
  run("pm2", ["start", ecosystem, "--only", appName, "--update-env"], env);
}

function pruneReleases(rootPath = releaseRoot, keep = 2) {
  if (!fs.existsSync(rootPath)) return;
  const current = readCurrentTarget();
  // Clean up any stale staging directories from previous failed/interrupted runs
  const entries = fs.readdirSync(rootPath, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && entry.name.startsWith(".staging-")) {
      try { fs.rmSync(path.join(rootPath, entry.name), { recursive: true, force: true }); } catch {}
    }
  }
  const releases = entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => path.join(rootPath, entry.name))
    .sort()
    .reverse();
  const toKeep = new Set(releases.slice(0, keep));
  if (current) toKeep.add(current);
  for (const rel of releases) {
    if (!toKeep.has(rel)) {
      try { fs.rmSync(rel, { recursive: true, force: true }); } catch {}
    }
  }
}

function selectRollbackRelease(rootPath, currentPath = null) {
  const releases = fs.readdirSync(rootPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => path.join(rootPath, entry.name))
    .filter((release) => release !== currentPath)
    .sort()
    .reverse();
  for (const release of releases) {
    try {
      verifyRelease(release);
      return release;
    } catch {}
  }
  return null;
}

async function waitForHealth(checkPort, child = null) {
  const deadline = Date.now() + smokeTimeoutMs;
  while (Date.now() < deadline) {
    if (child && child.exitCode !== null) throw new Error(`Smoke server exited with ${child.exitCode}`);
    try {
      const response = await fetch(`http://127.0.0.1:${checkPort}/api/health`);
      if (response.ok) return;
    } catch {}
    await sleep(250);
  }
  throw new Error(`Smoke health check timed out on port ${checkPort}`);
}

async function verifyRunningApp(checkPort, child = null, expectedBuildId = null) {
  await waitForHealth(checkPort, child);
  const response = await fetch(`http://127.0.0.1:${checkPort}/api/version`);
  if (!response.ok) throw new Error(`Version check returned HTTP ${response.status}`);
  if (expectedBuildId) {
    const body = await response.json();
    if (body.buildId !== expectedBuildId) {
      throw new Error(`Version check returned unexpected build ID: ${body.buildId || "missing"}`);
    }
  }
}

async function smokeRelease(releasePath) {
  const checkPort = await getFreePort();
  const release = verifyRelease(releasePath);
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "vansrouter-atomic-smoke-"));
  const child = spawn(process.execPath, [path.join(releasePath, "server.js")], {
    cwd: releasePath,
    env: {
      ...process.env,
      DATA_DIR: dataDir,
      NODE_ENV: "test",
      PORT: String(checkPort),
      RELEASE_BUILD_ID: release.buildId,
    },
    stdio: "ignore",
  });
  try {
    await verifyRunningApp(checkPort, child, release.buildId);
  } finally {
    child.kill("SIGTERM");
    await sleep(100);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

async function deploy() {
  assertSafePaths();
  const releaseLock = acquireLock();
  const id = releaseId();
  const buildDist = `.next-atomic-${id}`;
  const buildPath = path.join(root, buildDist);
  const stagedRelease = path.join(releaseRoot, `.staging-${id}`);
  const targetRelease = path.join(releaseRoot, id);
  const previous = readCurrentTarget();
  fs.mkdirSync(releaseRoot, { recursive: true });
  try {
    run("pnpm", ["run", "build"], { NEXT_DIST_DIR: buildDist });
    const builtStandalone = path.join(buildPath, "standalone");
    verifyRelease(builtStandalone);
    fs.cpSync(builtStandalone, stagedRelease, { recursive: true });
    verifyRelease(stagedRelease);
    await smokeRelease(stagedRelease);
    fs.renameSync(stagedRelease, targetRelease);
    activate(targetRelease);
    try {
      const buildId = verifyRelease(targetRelease).buildId;
      switchPm2(buildId);
      await verifyRunningApp(port, null, buildId);
    } catch (error) {
      if (previous) {
        activate(previous);
        try {
          const buildId = verifyRelease(previous).buildId;
          switchPm2(buildId);
          await verifyRunningApp(port, null, buildId);
        } catch (restartError) {
          error.message += `; previous PM2 restart failed: ${restartError.message}`;
        }
      }
      throw error;
    }
    console.log(`Activated ${targetRelease}`);
    pruneReleases();
  } catch (error) {
    fs.rmSync(stagedRelease, { recursive: true, force: true });
    throw error;
  } finally {
    fs.rmSync(buildPath, { recursive: true, force: true });
    releaseLock();
  }
}

async function rollback() {
  assertSafePaths();
  const releaseLock = acquireLock();
  try {
    const current = readCurrentTarget();
    if (!current) throw new Error("No active release available for rollback");
    const previous = selectRollbackRelease(releaseRoot, current);
    if (!previous) throw new Error("No valid previous release available for rollback");
    activate(previous);
    try {
      const buildId = verifyRelease(previous).buildId;
      switchPm2(buildId);
      await verifyRunningApp(port, null, buildId);
    } catch (error) {
      activate(current);
      try {
        const buildId = verifyRelease(current).buildId;
        switchPm2(buildId);
        await verifyRunningApp(port, null, buildId);
      } catch (restartError) {
        error.message += `; current PM2 restart failed: ${restartError.message}`;
      }
      throw error;
    }
    console.log(`Rolled back to ${previous}`);
  } finally {
    releaseLock();
  }
}

if (require.main === module) {
  const command = process.argv[2] || "deploy";
  const action = command === "rollback" ? rollback : deploy;
  Promise.resolve(action()).catch((error) => {
    console.error(`Atomic deployment failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  activate,
  acquireLock,
  getFreePort,
  readCurrentTarget,
  rollback,
  selectRollbackRelease,
  pruneReleases,
  staticDirOf,
  verifyRelease,
};
