#!/usr/bin/env node
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const net = require("node:net");
const { setTimeout: sleep } = require("node:timers/promises");
const { resolveRuntimePaths } = require("./runtime-paths.cjs");

const root = path.resolve(__dirname, "..");
const appName = process.env.PM2_APP_NAME || "9router";
const port = Number(process.env.PORT || 3003);
const { dataDir: defaultDataDir, releaseRoot, currentLink } = resolveRuntimePaths();
const smokeTimeoutMs = Number(process.env.SMOKE_TIMEOUT_MS || 30000);

function isUnder(candidate, parent) {
  const relative = path.relative(parent, candidate);
  if (path.isAbsolute(relative)) return false;
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

/**
 * Collect symbolic links without following them.  pnpm's standalone output
 * contains a virtual-store graph, so following a link while walking would
 * either recurse forever or miss links in the copied release.
 */
function collectSymlinks(root) {
  const rootPath = path.resolve(root);
  const links = [];

  function walk(directory) {
    let entries;
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch (error) {
      throw new Error(`Unable to inspect release directory ${directory}: ${error.message}`, { cause: error });
    }

    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        links.push(entryPath);
      } else if (entry.isDirectory()) {
        walk(entryPath);
      }
    }
  }

  walk(rootPath);
  return links;
}

/**
 * Next standalone output can contain pnpm symlinks whose targets point at the
 * temporary build directory.  Copying those links verbatim creates a release
 * that works during the smoke test and breaks as soon as the build directory
 * is removed.  Rewrite links copied from sourceStandalone to targets inside
 * releaseRoot instead.
 *
 * On POSIX, relative links make the artifact movable.  On Windows, directory
 * links are junctions (which require an absolute target); file links are
 * materialized to avoid requiring symlink privileges.
 */
function removeRuntimeEnvFiles(releasePath) {
  const releaseRoot = path.resolve(releasePath);
  let removed = 0;

  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        walk(entryPath);
      } else if (entry.name === ".env" || entry.name.startsWith(".env.")) {
        fs.rmSync(entryPath, { force: true });
        removed += 1;
      }
    }
  }

  walk(releaseRoot);
  return removed;
}

function makeReleaseSelfContained(releasePath, sourceStandalone = releasePath, { platform = process.platform } = {}) {
  const releaseRoot = path.resolve(releasePath);
  const sourceRoot = path.resolve(sourceStandalone);
  const links = collectSymlinks(releaseRoot);
  const deferredWindowsLinks = [];

  for (const linkPath of links) {
    const rawTarget = fs.readlinkSync(linkPath);
    const observedTarget = path.resolve(path.dirname(linkPath), rawTarget);
    let target;

    if (isUnder(observedTarget, sourceRoot)) {
      target = path.join(releaseRoot, path.relative(sourceRoot, observedTarget));
    } else if (isUnder(observedTarget, releaseRoot)) {
      target = observedTarget;
    } else {
      throw new Error(`Standalone symlink escapes release: ${linkPath} -> ${rawTarget}`);
    }

    if (!isUnder(target, releaseRoot)) {
      throw new Error(`Standalone symlink target escapes release: ${linkPath} -> ${target}`);
    }

    let targetStat;
    try {
      targetStat = fs.statSync(observedTarget);
    } catch (error) {
      throw new Error(`Standalone symlink target is missing: ${linkPath} -> ${rawTarget}`, { cause: error });
    }

    fs.unlinkSync(linkPath);

    if (platform === "win32" && !targetStat.isDirectory()) {
      fs.copyFileSync(target, linkPath);
      continue;
    }

    if (platform === "win32") {
      // A junction must be created only after the staging directory has its
      // final name.  Keep a relative manifest and finalize it after rename.
      deferredWindowsLinks.push({
        link: path.relative(releaseRoot, linkPath),
        target: path.relative(releaseRoot, target),
      });
      continue;
    }

    const linkTarget = path.relative(path.dirname(linkPath), target) || ".";
    const linkType = targetStat.isDirectory() ? "dir" : "file";
    fs.symlinkSync(linkTarget, linkPath, linkType);
  }

  if (deferredWindowsLinks.length) {
    fs.writeFileSync(
      path.join(releaseRoot, ".standalone-link-manifest.json"),
      JSON.stringify(deferredWindowsLinks),
      "utf8",
    );
  }

  if (links.length) {
    const deferred = deferredWindowsLinks.length ? ` (${deferredWindowsLinks.length} Windows link(s) deferred)` : "";
    console.log(`[deploy] normalized ${links.length} standalone symlink(s)${deferred}`);
  }
  return links.length;
}

/** Complete Windows directory junctions after staging has its final path. */
function finalizeReleaseSymlinks(releasePath) {
  const releaseRoot = path.resolve(releasePath);
  const manifestPath = path.join(releaseRoot, ".standalone-link-manifest.json");
  if (!fs.existsSync(manifestPath)) return 0;

  const links = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (!Array.isArray(links)) throw new Error(`Invalid standalone link manifest: ${manifestPath}`);

  // Create deeper targets first.  This handles a link graph where one package
  // link points at another package link without relying on target existence
  // while the manifest is being materialized.
  links.sort((left, right) => String(left.target).length - String(right.target).length);
  for (const entry of links) {
    const linkPath = path.resolve(releaseRoot, entry.link);
    const target = path.resolve(releaseRoot, entry.target);
    if (!isUnder(linkPath, releaseRoot) || !isUnder(target, releaseRoot)) {
      throw new Error(`Standalone link manifest escapes release: ${manifestPath}`);
    }
    if (fs.existsSync(linkPath) || fs.lstatSync(linkPath, { throwIfNoEntry: false })) {
      fs.unlinkSync(linkPath);
    }
    fs.symlinkSync(target, linkPath, "junction");
  }

  fs.rmSync(manifestPath, { force: true });
  return links.length;
}

/** Verify that a release has no dangling or external runtime links. */
function verifyStandaloneLinks(releasePath) {
  const releaseRoot = path.resolve(releasePath);
  const links = collectSymlinks(releaseRoot);

  for (const linkPath of links) {
    const rawTarget = fs.readlinkSync(linkPath);
    const target = path.resolve(path.dirname(linkPath), rawTarget);
    if (!isUnder(target, releaseRoot)) {
      throw new Error(`Standalone symlink escapes release: ${linkPath} -> ${rawTarget}`);
    }
    if (!fs.existsSync(target)) {
      throw new Error(`Standalone symlink is dangling: ${linkPath} -> ${rawTarget}`);
    }
  }

  return links.length;
}

function verifyBundledPackage(releaseRoot, packageName) {
  const packageJson = path.join(releaseRoot, "node_modules", packageName, "package.json");
  if (!fs.existsSync(packageJson)) {
    throw new Error(`Incomplete release: ${packageName} is not bundled in ${releaseRoot}`);
  }
  try {
    const realRelease = fs.realpathSync(releaseRoot);
    const realPackage = fs.realpathSync(packageJson);
    if (!isUnder(realPackage, realRelease)) {
      throw new Error(`${packageName} resolved outside release: ${packageJson}`);
    }
  } catch (error) {
    throw new Error(`Incomplete release: ${packageName} cannot be resolved from ${releaseRoot}`, { cause: error });
  }
}

function verifyRelease(releasePath, {
  selfContained = false,
  distDir = null,
  requireCustomServer = false,
  requireExternalPackages = selfContained,
} = {}) {
  const releaseRoot = path.resolve(releasePath);
  const server = path.join(releaseRoot, "server.js");
  const staticDir = staticDirOf(releaseRoot, distDir);
  const metadataDir = staticDir ? path.dirname(staticDir) : path.join(releaseRoot, ".next");
  const metadata = [
    "BUILD_ID",
    "routes-manifest.json",
    "build-manifest.json",
    path.join("server", "pages-manifest.json"),
  ];
  if (!fs.existsSync(server)) throw new Error(`Incomplete release: missing ${server}`);
  if (requireCustomServer && !fs.existsSync(path.join(releaseRoot, "custom-server.js"))) {
    throw new Error(`Incomplete release: missing custom-server.js in ${releaseRoot}`);
  }
  if (!staticDir) throw new Error(`Incomplete release: missing static assets in ${releaseRoot}`);
  for (const file of metadata) {
    if (!fs.existsSync(path.join(metadataDir, file))) {
      throw new Error(`Incomplete release: missing build metadata ${path.join(metadataDir, file)}`);
    }
  }

  const staticFiles = fs.readdirSync(staticDir, { recursive: true })
    .filter((file) => typeof file === "string");
  const chunks = staticFiles.filter((file) => file.endsWith(".js"));
  const styles = staticFiles.filter((file) => file.endsWith(".css"));
  if (!chunks.length) throw new Error(`Incomplete release: no JavaScript chunks in ${staticDir}`);
  if (selfContained && !styles.length) throw new Error(`Incomplete release: no CSS assets in ${staticDir}`);

  const serverDir = path.join(metadataDir, "server");
  const serverFiles = fs.existsSync(serverDir)
    ? fs.readdirSync(serverDir, { recursive: true }).filter((file) => typeof file === "string" && file.endsWith(".js"))
    : [];
  if (selfContained && !serverFiles.length) throw new Error(`Incomplete release: no server chunks in ${serverDir}`);

  const buildId = fs.readFileSync(path.join(metadataDir, "BUILD_ID"), "utf8").trim();
  if (!buildId) throw new Error(`Incomplete release: empty build ID in ${releaseRoot}`);

  let requiredFileCount = 0;
  const requiredServerFiles = path.join(metadataDir, "required-server-files.json");
  if (selfContained) {
    if (!fs.existsSync(path.join(releaseRoot, "public"))) {
      throw new Error(`Incomplete release: missing public assets in ${releaseRoot}`);
    }
    if (!fs.existsSync(requiredServerFiles)) {
      throw new Error(`Incomplete release: missing required-server-files.json`);
    }
    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(requiredServerFiles, "utf8"));
    } catch (error) {
      throw new Error(`Incomplete release: invalid required-server-files.json`, { cause: error });
    }
    for (const file of manifest.files || []) {
      const requiredPath = path.resolve(releaseRoot, file);
      if (!isUnder(requiredPath, releaseRoot) || !fs.existsSync(requiredPath)) {
        throw new Error(`Incomplete release: required server file is missing: ${file}`);
      }
      requiredFileCount += 1;
    }
  }

  let symlinkCount = 0;
  if (selfContained) {
    symlinkCount = verifyStandaloneLinks(releaseRoot);
    verifyBundledPackage(releaseRoot, "next");
    if (requireExternalPackages) {
      // `open` is deliberately external in next.config.mjs; it must be part
      // of the self-contained release rather than resolved from the build host.
      verifyBundledPackage(releaseRoot, "open");
    }
  }

  return {
    server,
    staticDir,
    chunkCount: chunks.length,
    styleCount: styles.length,
    serverChunkCount: serverFiles.length,
    requiredFileCount,
    buildId,
    symlinkCount,
  };
}

function assertSafePaths() {
  const forbidden = [...new Set([os.tmpdir(), "/tmp", "/var/tmp"].map((value) => path.resolve(value)))];
  if (forbidden.some((prefix) => isUnder(releaseRoot, prefix))) {
    throw new Error(`Refusing ephemeral RELEASE_ROOT: ${releaseRoot}`);
  }
  if (forbidden.some((prefix) => isUnder(currentLink, prefix))) {
    throw new Error(`Refusing ephemeral CURRENT_LINK: ${currentLink}`);
  }

  const sourceRoot = path.resolve(root);
  const dangerousRoots = new Set([
    path.parse(releaseRoot).root,
    sourceRoot,
    path.dirname(sourceRoot),
    path.resolve(os.homedir()),
  ]);
  if (dangerousRoots.has(releaseRoot) || isUnder(releaseRoot, sourceRoot) || isUnder(sourceRoot, releaseRoot)) {
    throw new Error(`Refusing unsafe RELEASE_ROOT: ${releaseRoot}`);
  }
  if (isUnder(currentLink, sourceRoot) || isUnder(sourceRoot, currentLink)) {
    throw new Error(`Refusing unsafe CURRENT_LINK: ${currentLink}`);
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

const RELEASE_ID_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-\d+$/;

function releaseId() {
  return `${new Date().toISOString().replace(/[:.]/g, "-")}-${process.pid}`;
}

function isReleaseDirectory(entry) {
  return entry.isDirectory() && !entry.name.startsWith(".") && RELEASE_ID_PATTERN.test(entry.name);
}

function staticDirOf(releasePath, expectedDistDir = null) {
  if (expectedDistDir) {
    const expectedStaticDir = path.join(releasePath, expectedDistDir, "static");
    return fs.existsSync(expectedStaticDir) ? expectedStaticDir : null;
  }
  const candidates = fs.readdirSync(releasePath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(".next"))
    .map((entry) => path.join(releasePath, entry.name, "static"));
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function acquireLock(rootPath = releaseRoot) {
  const lockPath = `${rootPath}.lock`;
  const token = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  try {
    const fd = fs.openSync(lockPath, "wx");
    fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, token, startedAt: new Date().toISOString() }));
    fs.closeSync(fd);
    return () => {
      try {
        const owner = JSON.parse(fs.readFileSync(lockPath, "utf8"));
        if (owner.token !== token) return;
      } catch {
        return;
      }
      fs.rmSync(lockPath, { force: true });
    };
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    let owner = null;
    try { owner = JSON.parse(fs.readFileSync(lockPath, "utf8")); } catch {}
    if (owner?.pid) {
      try {
        process.kill(owner.pid, 0);
      } catch (killError) {
        if (killError.code !== "ESRCH") {
          throw new Error(`Deployment lock ownership check failed for PID ${owner.pid}: ${killError.message}`);
        }
        fs.rmSync(lockPath, { force: true });
        return acquireLock(rootPath);
      }
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
  fs.symlinkSync(releasePath, temporaryLink, process.platform === "win32" ? "junction" : "dir");
  fs.renameSync(temporaryLink, link);
}

function readPm2App({ failOnError = false, run = spawnSync } = {}) {
  const result = run("pm2", ["jlist"], { encoding: "utf8" });
  if (result.error) {
    if (failOnError) throw new Error(`Unable to query PM2 state: ${result.error.message}`);
    return null;
  }
  if (result.status !== 0) {
    if (failOnError) throw new Error(`Unable to query PM2 state (exit ${result.status}): ${result.stderr || "unknown error"}`);
    return null;
  }
  try {
    const apps = JSON.parse(result.stdout || "[]");
    return apps.find((entry) => entry.name === appName) || null;
  } catch (error) {
    if (failOnError) throw new Error(`PM2 returned invalid application state: ${error.message}`);
    return null;
  }
}

function readPm2Environment({ failOnError = false, run = spawnSync } = {}) {
  return readPm2App({ failOnError, run })?.pm2_env?.env || {};
}

function switchPm2(buildId = null) {
  // Preserve credentials and DATA_DIR already held by PM2.  A deploy shell
  // often has only a subset of the production environment; blindly spreading
  // its environment with --update-env can silently remove provider secrets.
  const pm2Environment = readPm2Environment({ failOnError: true });
  const env = {
    ...process.env,
    ...pm2Environment,
    NODE_PATH: "",
    PORT: String(port),
    NODE_ENV: "production",
    DATA_DIR: pm2Environment.DATA_DIR || process.env.DATA_DIR || defaultDataDir,
    RELEASE_ROOT: releaseRoot,
    CURRENT_LINK: currentLink,
    RELEASE_SERVER: path.join(currentLink, "server.js"),
    RELEASE_BUILD_ID: buildId || "",
  };
  const ecosystem = path.join(root, "ecosystem.config.cjs");
  const expectedScript = path.join(root, "custom-server.js");
  const restarted = spawnSync("pm2", ["reload", ecosystem, "--only", appName, "--update-env"], {
    cwd: root,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (restarted.status !== 0) {
    const restartOutput = `${restarted.stdout || ""}${restarted.stderr || ""}`;
    if (!/not found|not launched/i.test(restartOutput)) {
      throw new Error(`pm2 reload ${appName} failed: ${restartOutput.trim() || restarted.status}`);
    }
    run("pm2", ["start", ecosystem, "--only", appName, "--update-env"], env);
  }

  // PM2 reload keeps the old script path when the ecosystem entry changes.
  // Replace the app only when its actual entry differs; the surrounding
  // rollback handler restores the previous release if the replacement fails.
  const app = readPm2App();
  const activeScript = app?.pm2_env?.pm_exec_path;
  if (activeScript && path.resolve(activeScript) !== path.resolve(expectedScript)) {
    console.log(`[deploy] replacing PM2 script path ${activeScript} -> ${expectedScript}`);
    run("pm2", ["delete", appName], env);
    run("pm2", ["start", ecosystem, "--only", appName, "--update-env"], env);
  }
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
    .filter(isReleaseDirectory)
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
    .filter(isReleaseDirectory)
    .map((entry) => path.join(rootPath, entry.name))
    .filter((release) => release !== currentPath)
    .sort()
    .reverse();
  for (const release of releases) {
    try {
      // Keep pre-external-package releases eligible for emergency rollback.
      verifyRelease(release, { selfContained: true, requireExternalPackages: false });
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
      const ready = await fetch(`http://127.0.0.1:${checkPort}/api/ready`);
      if (ready.ok) return;
      // Releases before /api/ready was introduced are still valid rollback
      // targets. Do not mask a real 503 from the readiness endpoint.
      if (![401, 404].includes(ready.status)) throw new Error(`Readiness check returned HTTP ${ready.status}`);
      const health = await fetch(`http://127.0.0.1:${checkPort}/api/health`);
      if (health.ok) return;
    } catch (error) {
      if (error instanceof Error && /Readiness check/.test(error.message)) throw error;
    }
    await sleep(250);
  }
  throw new Error(`Smoke health check timed out on port ${checkPort}`);
}

async function verifyRenderedPage(checkPort) {
  const baseUrl = `http://127.0.0.1:${checkPort}`;
  const response = await fetch(`${baseUrl}/masuk`);
  if (!response.ok) throw new Error(`HTML check returned HTTP ${response.status}`);
  const html = await response.text();
  if (!/<html(?:\s|>)/i.test(html)) throw new Error("HTML check did not return an HTML document");

  const assets = [...new Set(
    [...html.matchAll(/(?:src|href)="(\/_next\/static\/[^"#]+)"/g)].map((match) => match[1]),
  )];
  for (const asset of assets) {
    const assetResponse = await fetch(new URL(asset, baseUrl));
    if (!assetResponse.ok) throw new Error(`Referenced asset returned HTTP ${assetResponse.status}: ${asset}`);
    if (asset.includes("/_next/static/")) {
      const cacheControl = assetResponse.headers.get("cache-control") || "";
      if (!cacheControl.includes("immutable")) {
        throw new Error(`Hashed asset is not immutable: ${asset}`);
      }
    }
  }
  return assets.length;
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
  await verifyRenderedPage(checkPort);
}

async function smokeRelease(releasePath, distDir = null) {
  const checkPort = await getFreePort();
  const release = verifyRelease(releasePath, { selfContained: true, distDir });
  // Next standalone forces NODE_ENV=production before loading app modules. Use
  // an isolated HOME as a second boundary in case DATA_DIR is ever rejected by
  // the runtime's smoke-path guard; never let verification touch ~/.9router.
  const sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vansrouter-atomic-check-"));
  const dataDir = path.join(sandboxRoot, "data");
  const homeDir = path.join(sandboxRoot, "home");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(homeDir, { recursive: true });
  const releaseEntry = fs.existsSync(path.join(releasePath, "custom-server.js"))
    ? "custom-server.js"
    : "server.js";
  const child = spawn(process.execPath, [path.join(releasePath, releaseEntry)], {
    cwd: releasePath,
    env: {
      ...process.env,
      APPDATA: path.join(homeDir, "AppData", "Roaming"),
      DATA_DIR: dataDir,
      HOME: homeDir,
      NODE_PATH: "",
      NODE_ENV: "production",
      PORT: String(checkPort),
      RELEASE_BUILD_ID: release.buildId,
      USERPROFILE: homeDir,
      XDG_CONFIG_HOME: path.join(homeDir, ".config"),
    },
    stdio: "ignore",
  });
  try {
    await verifyRunningApp(checkPort, child, release.buildId);
    if (!fs.existsSync(path.join(dataDir, "db"))) {
      throw new Error("Smoke server did not use the isolated DATA_DIR");
    }
  } finally {
    child.kill("SIGTERM");
    await sleep(100);
    fs.rmSync(sandboxRoot, { recursive: true, force: true });
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
  let activated = false;
  fs.mkdirSync(releaseRoot, { recursive: true });
  try {
    run("pnpm", ["run", "build"], { NEXT_DIST_DIR: buildDist });
    const builtStandalone = path.join(buildPath, "standalone");
    verifyRelease(builtStandalone, { distDir: buildDist, requireCustomServer: true });
    fs.cpSync(builtStandalone, stagedRelease, { recursive: true, verbatimSymlinks: true });
    const removedEnvFiles = removeRuntimeEnvFiles(stagedRelease);
    if (removedEnvFiles) console.log(`[deploy] removed ${removedEnvFiles} runtime env file(s) from release`);
    makeReleaseSelfContained(stagedRelease, builtStandalone);
    verifyRelease(stagedRelease, { distDir: buildDist, requireCustomServer: true });
    // The staged release must not depend on the temporary build directory.
    // Remove it before the final-path smoke test so this exact failure mode is covered.
    fs.rmSync(buildPath, { recursive: true, force: true });
    fs.renameSync(stagedRelease, targetRelease);
    finalizeReleaseSymlinks(targetRelease);
    const buildId = verifyRelease(targetRelease, { selfContained: true, distDir: buildDist, requireCustomServer: true }).buildId;
    await smokeRelease(targetRelease, buildDist);
    activate(targetRelease);
    activated = true;
    try {
      switchPm2(buildId);
      await verifyRunningApp(port, null, buildId);
    } catch (error) {
      if (previous) {
        activate(previous);
        try {
          const previousBuildId = verifyRelease(previous, {
            selfContained: true,
            requireExternalPackages: false,
          }).buildId;
          switchPm2(previousBuildId);
          await verifyRunningApp(port, null, previousBuildId);
          activated = false;
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
    if (!activated && fs.existsSync(targetRelease) && readCurrentTarget() !== targetRelease) {
      fs.rmSync(targetRelease, { recursive: true, force: true });
    }
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
      const buildId = verifyRelease(previous, {
        selfContained: true,
        requireExternalPackages: false,
      }).buildId;
      switchPm2(buildId);
      await verifyRunningApp(port, null, buildId);
    } catch (error) {
      activate(current);
      try {
        const buildId = verifyRelease(current, {
          selfContained: true,
          requireExternalPackages: false,
        }).buildId;
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
  finalizeReleaseSymlinks,
  getFreePort,
  makeReleaseSelfContained,
  readCurrentTarget,
  readPm2App,
  readPm2Environment,
  removeRuntimeEnvFiles,
  rollback,
  selectRollbackRelease,
  smokeRelease,
  pruneReleases,
  staticDirOf,
  verifyRelease,
  verifyStandaloneLinks,
};
