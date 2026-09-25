#!/usr/bin/env node

const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const { execFileSync, spawn } = require("child_process");

const [tarball, expectedVersion] = process.argv.slice(2);
if (!tarball || !expectedVersion) {
  throw new Error("Usage: smoke-package.cjs <tarball> <version>");
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "vansrouter-release-"));
const dataDir = path.join(root, "data");
const port = 43000 + (process.pid % 1000);
fs.mkdirSync(dataDir, { recursive: true });
fs.writeFileSync(path.join(dataDir, "db.json"), JSON.stringify({
  settings: { requireLogin: false },
}));
execFileSync("tar", ["-xzf", tarball, "-C", root]);

const appDir = path.join(root, "package", "app");
const bundledModules = path.join(appDir, "_nm");
const serverPath = path.join(appDir, "custom-server.js");
if (!fs.existsSync(serverPath)) throw new Error(`Bundled custom server missing: ${serverPath}`);
const runtimeSecretsPath = path.join(appDir, "runtime-secrets.cjs");
if (!fs.existsSync(runtimeSecretsPath)) throw new Error(`Bundled runtime secret validator missing: ${runtimeSecretsPath}`);
const nextPackage = path.join(bundledModules, "next", "package.json");
if (!fs.existsSync(nextPackage)) {
  throw new Error(`Bundled Next.js dependency missing: ${nextPackage}`);
}

let output = "";
const child = spawn(process.execPath, [serverPath], {
  cwd: appDir,
  env: {
    ...process.env,
    DATA_DIR: dataDir,
    HOSTNAME: "127.0.0.1",
    NODE_ENV: "production",
    NODE_PATH: bundledModules,
    NEXT_TELEMETRY_DISABLED: "1",
    VANROUTER_SKIP_UPDATE_CHECK: "1",
    PORT: String(port),
  },
  stdio: ["ignore", "pipe", "pipe"],
});
child.stdout.on("data", (chunk) => { output += chunk; });
child.stderr.on("data", (chunk) => { output += chunk; });

function request(pathname) {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://127.0.0.1:${port}${pathname}`, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, body }));
    });
    req.setTimeout(1000, () => req.destroy(new Error("request timeout")));
    req.on("error", reject);
  });
}

async function waitForSettings() {
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    try {
      const response = await request("/api/settings");
      if (response.status === 200) return response;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Bundled server did not initialize in time:\n${output}`);
}

async function main() {
  try {
    const response = await waitForSettings();
    const settings = JSON.parse(response.body);
    if (settings.requireLogin !== false) {
      throw new Error(`Legacy db.json was not migrated: ${response.body}`);
    }
    const health = await request("/api/health");
    if (health.status !== 200) throw new Error(`Health check failed: ${health.status}`);
    const version = await request("/api/version");
    const versionBody = JSON.parse(version.body);
    if (version.status !== 200 || versionBody.currentVersion !== expectedVersion) {
      throw new Error(`Version check failed: ${version.status} ${version.body}`);
    }

    // sql.js persists on a short debounce after writes; observe the durable file,
    // not only the in-memory HTTP response.
    await new Promise((resolve) => setTimeout(resolve, 250));
    const dbFile = path.join(dataDir, "db", "data.sqlite");
    const marker = path.join(dataDir, "db", ".migrated-from-json");
    if (!fs.existsSync(dbFile)) throw new Error(`SQLite database missing: ${dbFile}`);
    if (!fs.existsSync(marker)) throw new Error(`Migration marker missing: ${marker}`);
    console.log(`Smoke-tested vansrouter@${expectedVersion}: bundled server, SQLite, legacy migration`);
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        resolve();
      }, 5000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
