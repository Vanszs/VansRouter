#!/usr/bin/env node

const fs = require("fs");
const http = require("http");
const net = require("net");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

function parseArgs(args) {
  const image = args[0];
  const expectedVersion = args[1];
  if (!image || !expectedVersion) {
    throw new Error("Usage: smoke-container.cjs <image> <version> [--platform <platform>] [--pull]");
  }

  let platform = "linux/amd64";
  let pull = false;
  for (let index = 2; index < args.length; index += 1) {
    if (args[index] === "--pull") {
      pull = true;
      continue;
    }
    if (args[index] !== "--platform" || !args[index + 1]) {
      throw new Error(`Unknown or incomplete option: ${args[index]}`);
    }
    platform = args[index + 1];
    index += 1;
  }
  return { image, expectedVersion, platform, pull };
}

function requestJson(url, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, { timeout: timeoutMs }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => {
        let parsed;
        try {
          parsed = JSON.parse(body);
        } catch {
          parsed = body;
        }
        resolve({ status: response.statusCode, body: parsed });
      });
    });
    request.on("timeout", () => request.destroy(new Error("request timeout")));
    request.on("error", reject);
  });
}

async function waitForJson(url, predicate, {
  timeoutMs = 45000,
  intervalMs = 250,
  request = requestJson,
} = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "no response";
  while (Date.now() < deadline) {
    try {
      const response = await request(url);
      if (response.status >= 200 && response.status < 300 && predicate(response.body)) {
        return response.body;
      }
      lastError = `status=${response.status}`;
    } catch (error) {
      lastError = error.message;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Timed out waiting for ${url}: ${lastError}`);
}

async function verifyProductionLogin(baseUrl, password, requestFn = fetch) {
  const response = await requestFn(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  let body = null;
  try {
    body = await response.json();
  } catch {}
  if (response.status !== 200 || body?.success !== true) {
    throw new Error(`Production login smoke failed: HTTP ${response.status}`);
  }
  return body;
}

// The compatibility default password must stay local-only. X-Forwarded-For makes
// custom-server.js stamp x-9r-via-proxy, so the app treats the request as
// arriving from somewhere other than the operator's own machine.
async function verifyRemoteDefaultPasswordRejected(baseUrl, password, requestFn = fetch) {
  const response = await requestFn(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": "203.0.113.10" },
    body: JSON.stringify({ password }),
  });
  let body = null;
  try {
    body = await response.json();
  } catch {}
  if (response.status !== 403 || body?.mustChangePassword !== true) {
    throw new Error(`Remote default-password gate smoke failed: HTTP ${response.status}`);
  }
  return body;
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

function docker(args, options = {}) {
  return execFileSync("docker", args, { encoding: "utf8", ...options });
}

function verifyContainerOpenClosure(containerName, dockerFn = docker) {
  const script = [
    "const { createRequire } = require('node:module');",
    "const req = createRequire('/app/package.json');",
    "for (const name of ['open', 'wsl-utils', 'powershell-utils', 'default-browser', 'define-lazy-prop', 'is-in-ssh', 'is-inside-container']) req.resolve(name);",
  ].join("");
  dockerFn(["exec", containerName, "node", "-e", script], { stdio: "inherit" });
}

function platformPair(platform) {
  const parts = String(platform).split("/");
  if (parts.length < 2 || !parts[0] || !parts[1]) {
    throw new Error(`Invalid Docker platform: ${platform}`);
  }
  return `${parts[0]}/${parts[1]}`;
}

function inspectLocalPlatform(image) {
  try {
    return docker(
      ["image", "inspect", image, "--format", "{{.Os}}/{{.Architecture}}"],
      { stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
  } catch {
    return null;
  }
}

function ensureImageForPlatform(image, platform, {
  dockerFn = docker,
  inspectFn = inspectLocalPlatform,
  pull = false,
} = {}) {
  const expected = platformPair(platform);
  const local = inspectFn(image);
  if (!pull && local === expected) return;

  if (local !== null) {
    try {
      dockerFn(["image", "rm", image], { stdio: "ignore" });
    } catch (error) {
      throw new Error(`Local image ${image} is ${local}, not ${expected}, and cannot be replaced: ${error.message}`);
    }
  }

  dockerFn(["pull", "--platform", platform, image], { stdio: "inherit" });
  const pulled = inspectFn(image);
  if (pulled !== expected) {
    throw new Error(`Pulled image ${image} reports platform ${pulled || "unknown"}, expected ${expected}`);
  }
}

async function runContainerSmoke({ image, expectedVersion, platform = "linux/amd64", pull = false }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vansrouter-container-smoke-"));
  const dataDir = path.join(root, "data");
  const name = `vansrouter-release-smoke-${process.pid}-${Date.now()}`;
  fs.mkdirSync(dataDir, { recursive: true });
  const port = await getFreePort();
  if (!port) throw new Error("Could not allocate a local smoke-test port");

  try {
    ensureImageForPlatform(image, platform, { pull });
    docker([
      "run", "--rm", "-d", "--name", name, "--platform", platform,
      "-p", `127.0.0.1:${port}:20128`,
      "-e", "DATA_DIR=/app/data",
      "-e", "PORT=20128",
      "-e", "HOSTNAME=0.0.0.0",
      "-e", "NODE_ENV=production",
      "-e", "INITIAL_PASSWORD=123456",
      "-e", "NEXT_TELEMETRY_DISABLED=1",
      "-e", "VANROUTER_SKIP_UPDATE_CHECK=1",
      "-v", `${dataDir}:/app/data`,
      image,
    ], { stdio: "inherit" });

    const baseUrl = `http://127.0.0.1:${port}`;
    await waitForJson(`${baseUrl}/api/ready`, (body) => body?.ok === true && body?.database === "ready");
    verifyContainerOpenClosure(name);
    const health = await requestJson(`${baseUrl}/api/health`);
    if (health.status !== 200) throw new Error(`Health check failed: ${health.status}`);
    await verifyProductionLogin(baseUrl, "123456");
    await verifyRemoteDefaultPasswordRejected(baseUrl, "123456");
    const version = await waitForJson(
      `${baseUrl}/api/version`,
      (body) => body?.currentVersion === expectedVersion,
    );
    console.log(`Smoke-tested ${image} on ${platform}: ${version.currentVersion}`);
  } catch (error) {
    let logs = "";
    try {
      logs = docker(["logs", name], { stdio: ["ignore", "pipe", "pipe"] });
    } catch {}
    throw new Error(`${error.message}${logs ? `\nContainer logs:\n${logs}` : ""}`);
  } finally {
    try {
      docker(["rm", "-f", name], { stdio: "ignore" });
    } catch {}
    fs.rmSync(root, { recursive: true, force: true });
  }
}

module.exports = {
  parseArgs,
  requestJson,
  waitForJson,
  platformPair,
  inspectLocalPlatform,
  ensureImageForPlatform,
  verifyContainerOpenClosure,
  verifyProductionLogin,
  verifyRemoteDefaultPasswordRejected,
  runContainerSmoke,
};

if (require.main === module) {
  runContainerSmoke(parseArgs(process.argv.slice(2))).catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
