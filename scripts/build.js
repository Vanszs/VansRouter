#!/usr/bin/env node
// Cross-platform production build for the VansAI app.
//
// Why this script exists:
//   On Windows, something in the Next.js build pipeline recursively globs the
//   user profile (HOME / USERPROFILE / APPDATA / LOCALAPPDATA). The legacy
//   compatibility junctions there ("Application Data", "Local Settings", ...)
//   are reparse points that throw `EPERM: scandir` and crash the build with an
//   unhandledRejection. The fix (mirrors cli/scripts/build-cli.js) is to point
//   those env vars at an empty local `.fakehome` dir for the duration of the
//   build, so the globs scan a clean, junction-free directory.
//
//   It also copies `public/` and `.next/static` into `.next/standalone` using
//   Node's fs API so the exact same command works on Windows and Linux (no `cp`).

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { fixStandaloneSymlinks } = require("./fix-standalone-symlinks.cjs");

function backupSqliteFile(dbFile, dest) {
  const script = [
    `const dbFile = ${JSON.stringify(dbFile)};`,
    `const dest = ${JSON.stringify(dest)};`,
    "const sqlString = (value) => `'${value.replace(/'/g, \"''\")}'`;",
    "const close = (db) => { try { db?.close(); } catch {} };",
    "(async () => {",
    "  let betterSqliteError;",
    "  try {",
    "    const Database = require('better-sqlite3');",
    "    const db = new Database(dbFile, { readonly: true, fileMustExist: true });",
    "    try { await db.backup(dest); } finally { close(db); }",
    "    return;",
    "  } catch (error) {",
    "    betterSqliteError = error;",
    "  }",
    "  try {",
    "    const { DatabaseSync } = require('node:sqlite');",
    "    const db = new DatabaseSync(dbFile, { readOnly: true });",
    "    try { db.exec(`VACUUM INTO ${sqlString(dest)}`); } finally { close(db); }",
    "  } catch (nodeSqliteError) {",
    "    console.error(nodeSqliteError.stack || nodeSqliteError);",
    "    console.error(`better-sqlite3 fallback failed: ${betterSqliteError.message}`);",
    "    process.exitCode = 1;",
    "  }",
    "})();",
  ].join("\n");
  try {
    execFileSync(process.execPath, ["-e", script], { stdio: "inherit", cwd: appDir });
  } catch (error) {
    if (error?.status === 1) throw new Error("better-sqlite3 backup failed", { cause: error });
    throw error;
  }
}

const appDir = path.resolve(__dirname, "..");
const fakeHome = path.join(appDir, ".fakehome");

// Safety net: back up the production database BEFORE the build wipes .next/.
// The DB lives at DATA_DIR (env or ~/.9router) — outside .next/ so `next build`
// does NOT delete it. But if someone mis-configures DATA_DIR to point inside
// .next/, or if a future change moves the DB, this backup prevents data loss.
function loadEnvFile(file) {
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/i);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}
function backupProductionDb() {
  const dotenv = loadEnvFile(path.join(appDir, ".env"));
  const dataDir = process.env.DATA_DIR || dotenv.DATA_DIR || path.join(require("os").homedir(), ".9router");
  const dbFile = path.join(dataDir, "db", "data.sqlite");
  if (!fs.existsSync(dbFile)) {
    console.log(`▶ DB safety backup skipped (no DB at ${dbFile})`);
    return;
  }
  const backupsDir = path.join(dataDir, "db", "backups");
  fs.mkdirSync(backupsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const dest = path.join(backupsDir, `pre-build-${stamp}.sqlite`);
  try {
    backupSqliteFile(dbFile, dest);
    for (const name of fs.readdirSync(backupsDir)) {
      if (name.startsWith("pre-build-") && name.endsWith(".sqlite") && name !== path.basename(dest)) {
        fs.unlinkSync(path.join(backupsDir, name));
      }
    }
    console.log(`▶ DB safety backup: ${dest}`);
  } catch (e) {
    throw new Error(`DB backup failed; refusing to continue build: ${e.message}`, { cause: e });
  }
}
// Run focused no-undef lint before building so "X is not defined" runtime
// crashes are caught early (e.g., GitHub Issue #1, OpenCode CLI setup).
// It peaks around 1.2 GB, so on a small or shared box it can be OOM-killed and
// surface as "Next.js build failed" even though Next never started. CI runs
// `pnpm lint:undef` as its own step; skip the in-build copy with
// SKIP_PREBUILD_LINT=1 when memory is tight.
if (process.env.SKIP_PREBUILD_LINT !== "1") {
  console.log("▶ running no-undef lint");
  execFileSync(process.execPath, [path.join(appDir, "scripts", "lint-undef.cjs")], {
    stdio: "inherit",
    cwd: appDir,
  });
} else {
  console.log("▶ skipping no-undef lint (SKIP_PREBUILD_LINT=1)");
}

// Empty, junction-free HOME for the build.
fs.mkdirSync(path.join(fakeHome, "AppData", "Roaming"), { recursive: true });
fs.mkdirSync(path.join(fakeHome, "AppData", "Local"), { recursive: true });

const env = {
  ...process.env,
  HOME: fakeHome,
  USERPROFILE: fakeHome,
  APPDATA: path.join(fakeHome, "AppData", "Roaming"),
  LOCALAPPDATA: path.join(fakeHome, "AppData", "Local"),
  // Windows: Next.js traces into TMP/TEMP too. Point them at .fakehome
  // so Cookies / Application Data junctions are never scanned (#EPERM).
  TMP: fakeHome,
  TEMP: fakeHome,
};

// Resolve Next's CLI entry and run it via the current Node binary (avoids
// .cmd/shell quoting differences across platforms).
const nextBin = require.resolve("next/dist/bin/next");

backupProductionDb();

console.log(`▶ next build --webpack  (HOME=${fakeHome})`);
// execFileSync throws on a non-zero exit, which propagates build failure correctly.
try {
  execFileSync(process.execPath, [nextBin, "build", "--webpack"], {
    stdio: "inherit",
    cwd: appDir,
    env,
  });
} catch (err) {
  // SIGKILL with no exit status is the kernel OOM killer, not a build error.
  // Without this the failure reads as a plain Next.js error and sends you
  // hunting for a regression that does not exist.
  if (err?.signal === "SIGKILL" && err?.status === null) {
    console.error("\n✖ next build was OOM-killed (SIGKILL) — it did not fail on its own.");
    console.error("  Retry with fewer static-generation workers: NEXT_BUILD_CPUS=2 npm run build");
    console.error("  The no-undef pre-step can also be skipped: SKIP_PREBUILD_LINT=1");
  }
  throw err;
}

// Copy static assets into the standalone output.
// Respect NEXT_DIST_DIR like next.config.mjs does (used by CLI builds).
const distDir = process.env.NEXT_DIST_DIR || ".next";
const standaloneBaseDir = path.join(appDir, distDir, "standalone");

function resolveStandaloneRoot(baseDir) {
  if (fs.existsSync(path.join(baseDir, "server.js"))) return baseDir;
  for (const entry of fs.readdirSync(baseDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(baseDir, entry.name);
    if (fs.existsSync(path.join(candidate, "server.js"))) return candidate;
  }
  throw new Error(`Next standalone server not found under ${baseDir}`);
}

const standaloneDir = resolveStandaloneRoot(standaloneBaseDir);
console.log(`▶ copying public/ + ${distDir}/static into ${standaloneDir}`);
fs.cpSync(path.join(appDir, "public"), path.join(standaloneDir, "public"), { recursive: true });
fs.cpSync(path.join(appDir, distDir, "static"), path.join(standaloneDir, distDir, "static"), { recursive: true });

// Bundle Next runtime packages that standalone output omits from top-level
// node_modules. On POSIX, Next resolves these through intra-release symlinks
// into .pnpm. On Windows, where junction copies dissolve into directories,
// Next's internal requires (e.g. @swc/helpers in constants.js, @next/env in config.js)
// must resolve directly from the release's node_modules.
const { copyPackageClosure, copyDirectory } = require("./package-closure.cjs");
const standaloneNodeModules = path.join(standaloneDir, "node_modules");
for (const pkg of ["@swc/helpers", "@next/env", "react", "react-dom"]) {
  copyPackageClosure(pkg, {
    sourceRoots: [appDir],
    destinationRoot: standaloneNodeModules,
    copyPackage: copyDirectory,
  });
}

fixStandaloneSymlinks(path.resolve(standaloneDir));
fs.copyFileSync(path.join(appDir, "custom-server.js"), path.join(standaloneDir, "custom-server.js"));
fs.copyFileSync(path.join(appDir, "runtime-secrets.cjs"), path.join(standaloneDir, "runtime-secrets.cjs"));

// ─── Fix standalone instrumentation import ───────────────────────────────────
// kimchiQuotaReactivation.js uses `import(/* webpackIgnore: true */ "../../lib/localDb.js")`
// which webpack rewrites relative to the output chunk (.next/server/chunks/).
// From there, `../../lib/localDb.js` resolves to `.next/lib/localDb.js` — a file
// that doesn't exist because webpack bundles localDb + its deps into server chunks
// for normal routes, but the webpackIgnore prevents bundling for the instrumentation path.
// Fix: copy src/lib/ into standalone and create a @/ alias shim so the runtime import resolves.
const srcLibDir = path.join(appDir, "src", "lib");
const standaloneSrcLibDir = path.join(standaloneDir, "src", "lib");
const standaloneNextLibDir = path.join(standaloneDir, distDir, "lib");

// Copy ALL of src/ into standalone (needed for instrumentation + MITM server runtime).
// MITM server.js lives at src/mitm/ and requires relative imports like ./logger,
// plus cross-references like ../../shared/constants/mitmToolHosts.js.
const srcAppDir = path.join(appDir, "src");
const standaloneSrcDir = path.join(standaloneDir, "src");
if (fs.existsSync(srcAppDir)) {
  console.log(`▶ copying src/ into ${distDir}/standalone/src/ (instrumentation + MITM runtime)`);
  fs.cpSync(srcAppDir, standaloneSrcDir, { recursive: true });
}

if (fs.existsSync(srcLibDir)) {
  // Create .next/lib/localDb.js shim — resolves the webpackIgnore dynamic import
  // that webpack rewrites as `../../lib/localDb.js` relative to .next/server/chunks/.
  fs.mkdirSync(standaloneNextLibDir, { recursive: true });
  // The instrumentation chunk uses `import("../../lib/localDb.js")` (dynamic ESM import).
  // Webpack rewrites this relative to .next/server/chunks/ → resolves to .next/lib/localDb.js.
  // We need a package.json with "type":"module" here so Node treats .js as ESM.
  fs.writeFileSync(
    path.join(standaloneNextLibDir, "package.json"),
    JSON.stringify({ type: "module" }),
    "utf8"
  );
  // Also create package.json in standalone/src to fix performance overhead warning on other esm files in standalone
  fs.writeFileSync(
    path.join(standaloneDir, "src", "package.json"),
    JSON.stringify({ type: "module" }),
    "utf8"
  );
  // Copy src/mitm/ into standalone (MITM server.js needs relative imports: ./logger, ./config, etc.)
  const srcMitmDir = path.join(appDir, "src", "mitm");
  const standaloneMitmDir = path.join(standaloneDir, "src", "mitm");
  if (fs.existsSync(srcMitmDir)) {
    fs.cpSync(srcMitmDir, standaloneMitmDir, { recursive: true });
    console.log(`▶ copied src/mitm/ into ${distDir}/standalone/src/mitm/ for MITM runtime`);
  }
  // localDb.js re-exports everything from src/lib/db/index.js (ESM barrel file).
  const shimContent = `// Auto-generated by build.js — resolves webpackIgnore import in instrumentation hook\n` +
    `export {\n` +
    `  getSettings, updateSettings, isCloudEnabled, getCloudUrl,\n` +
    `  getProviderConnections, getProviderConnectionById,\n` +
    `  createProviderConnection, updateProviderConnection,\n` +
    `  deleteProviderConnection, deleteProviderConnectionsByProvider,\n` +
    `  reorderProviderConnections, cleanupProviderConnections,\n` +
    `  getProviderNodes, getProviderNodeById,\n` +
    `  createProviderNode, updateProviderNode, deleteProviderNode,\n` +
    `  getProxyPools, getProxyPoolById,\n` +
    `  createProxyPool, updateProxyPool, deleteProxyPool,\n` +
    `  getApiKeys, getApiKeyById, createApiKey, updateApiKey, deleteApiKey, validateApiKey,\n` +
    `  getCombos, getComboById, getComboByName,\n` +
    `  createCombo, updateCombo, deleteCombo,\n` +
    `  getModelAliases, setModelAlias, deleteModelAlias,\n` +
    `  getCustomModels, addCustomModel, deleteCustomModel,\n` +
    `  getMitmAlias, setMitmAliasAll,\n` +
    `  getPricing, getPricingForModel, updatePricing, resetPricing, resetAllPricing,\n` +
    `  exportDb, importDb,\n` +
    `} from "../../src/lib/db/index.js";\n`;
  fs.writeFileSync(path.join(standaloneNextLibDir, "localDb.js"), shimContent, "utf8");
  console.log(`▶ created ${distDir}/lib/localDb.js shim for instrumentation hook`);
}

console.log("✅ build complete");
