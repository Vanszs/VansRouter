#!/usr/bin/env node

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");

function parseArgs(args) {
  const unknown = args.filter((arg) => arg.startsWith("--") && arg !== "--run-scripts");
  if (unknown.length) throw new Error(`Unknown option: ${unknown[0]}`);

  const positional = args.filter((arg) => !arg.startsWith("--"));
  if (positional.length !== 2) {
    throw new Error("Usage: smoke-installed-package.cjs <tarball> <version> [--run-scripts]");
  }

  const [tarball, expectedVersion] = positional;
  if (!fs.existsSync(tarball)) throw new Error(`Tarball does not exist: ${tarball}`);
  return { tarball, expectedVersion, runScripts: args.includes("--run-scripts") };
}

function verifyVersionOutput(output, expectedVersion) {
  const actualVersion = String(output).trim().split(/\r?\n/).filter(Boolean).at(-1);
  if (actualVersion !== expectedVersion) {
    throw new Error(`Installed CLI version mismatch: ${actualVersion || "<empty>"} !== ${expectedVersion}`);
  }
  return actualVersion;
}

function verifyBundledOpenClosure(appDir) {
  const bundleRoot = path.join(appDir, "_nm");
  const openManifestPath = path.join(bundleRoot, "open", "package.json");
  const manifest = JSON.parse(fs.readFileSync(openManifestPath, "utf8"));
  for (const dependency of Object.keys(manifest.dependencies || {})) {
    const dependencyManifest = path.join(bundleRoot, dependency, "package.json");
    if (!fs.existsSync(dependencyManifest)) {
      throw new Error(`Bundled open dependency missing: ${dependency}`);
    }
  }
}

function getNpmInvocation({
  platform = process.platform,
  npmExecPath = process.env.npm_execpath,
  execPath = process.execPath,
} = {}) {
  if (npmExecPath) {
    return { command: execPath, args: [npmExecPath], shell: false };
  }
  if (platform === "win32") {
    // `.cmd` files require the Windows command interpreter when launched
    // through execFile/execFileSync; direct execFileSync("npm.cmd") fails.
    return { command: "npm.cmd", args: [], shell: true };
  }
  return { command: "npm", args: [], shell: false };
}

function runInstallSmoke({ tarball, expectedVersion, runScripts = false }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vansrouter-install-smoke-"));
  const installDir = path.join(root, "install");
  const homeDir = path.join(root, "home");
  const dataDir = path.join(root, "data");
  fs.mkdirSync(installDir, { recursive: true });
  fs.mkdirSync(homeDir, { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });

  const env = {
    ...process.env,
    HOME: homeDir,
    USERPROFILE: homeDir,
    DATA_DIR: dataDir,
  };
  const npmInvocation = getNpmInvocation();
  const npmCommand = npmInvocation.command;
  const npmArgs = [
    ...npmInvocation.args,
    "install",
    "--prefix",
    installDir,
    tarball,
    "--no-audit",
    "--no-fund",
    ...(runScripts ? [] : ["--ignore-scripts"]),
  ];

  try {
    execFileSync(npmCommand, npmArgs, { env, stdio: "inherit", shell: npmInvocation.shell });
    const cliPath = path.join(installDir, "node_modules", "vansrouter", "cli.js");
    if (!fs.existsSync(cliPath)) throw new Error(`Installed CLI binary missing: ${cliPath}`);
    verifyBundledOpenClosure(path.join(installDir, "node_modules", "vansrouter", "app"));
    const result = spawnSync(process.execPath, [cliPath, "--version"], {
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(`Installed CLI --version failed (${result.status}): ${result.stderr || result.stdout}`);
    }
    const version = verifyVersionOutput(result.stdout, expectedVersion);
    console.log(`Smoke-tested installed vansrouter@${version}${runScripts ? " with lifecycle scripts" : " without lifecycle scripts"}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

module.exports = { parseArgs, verifyBundledOpenClosure, verifyVersionOutput, getNpmInvocation, runInstallSmoke };

if (require.main === module) {
  try {
    runInstallSmoke(parseArgs(process.argv.slice(2)));
  } catch (error) {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  }
}
