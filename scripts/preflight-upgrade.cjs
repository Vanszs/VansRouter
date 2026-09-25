#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

function parseEnv(text = "") {
  const values = {};
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/i);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}

function normalizePath(value, platform = process.platform) {
  if (typeof value !== "string" || !value.trim()) return "";
  const trimmed = value.trim();
  const implementation = platform === "win32" ? path.win32 : path;
  const normalized = implementation.normalize(trimmed).replace(/[\\/]$/, "");
  return platform === "win32" ? normalized.toLowerCase() : normalized;
}

function evaluateUpgradePreflight({
  envText = "",
  composeText = "",
  pm2Env = {},
  shellEnv = {},
  platform = process.platform,
} = {}) {
  const env = parseEnv(envText);
  const errors = [];
  const warnings = [];
  const version = env.VANSROUTER_VERSION?.trim();

  if (!version) {
    errors.push("VANSROUTER_VERSION is required; set an explicit immutable X.Y.Z version in .env");
  } else if (!/^\d+\.\d+\.\d+$/.test(version)) {
    errors.push(`VANSROUTER_VERSION must be an explicit X.Y.Z version (received ${version})`);
  }

  const deploymentText = `${envText}\n${composeText}`;
  if (/(?:^|[\s"'=])(?:9router\/9router|9router:latest|docker\.io\/[^\s"']*9router|decolua\/9router)/im.test(deploymentText)) {
    errors.push("Legacy image reference detected; use ghcr.io/vanszs/vansrouter:X.Y.Z");
  }

  const configuredDataDir = env.DATA_DIR?.trim();
  const composeUsesCanonicalVolume = /9router-data\s*:\s*\/app\/data/.test(composeText);
  if (configuredDataDir && configuredDataDir !== "/app/data" && composeUsesCanonicalVolume) {
    warnings.push(
      `DATA_DIR=${configuredDataDir} in .env is hidden by Compose's canonical 9router-data volume; ` +
      "use a ${HOME}/.9router:/app/data bind mount or copy the data explicitly before upgrading",
    );
  }

  for (const key of ["DATA_DIR", "RELEASE_ROOT", "CURRENT_LINK"]) {
    const pm2Value = pm2Env?.[key];
    if (pm2Value === undefined || pm2Value === null || pm2Value === "") continue;
    const shellValue = shellEnv?.[key];
    if (!shellValue) {
      errors.push(`PM2 ${key}=${pm2Value} has no explicit shell override; export the same path before deploying`);
      continue;
    }
    if (normalizePath(pm2Value, platform) !== normalizePath(shellValue, platform)) {
      errors.push(`PM2 ${key} (${pm2Value}) differs from the shell value (${shellValue}); align them explicitly before deploying`);
    }
  }

  return { ok: errors.length === 0, errors, warnings, env };
}

function readPm2Environment({ run = execFileSync } = {}) {
  const result = run("pm2", ["jlist"], { encoding: "utf8" });
  const apps = JSON.parse(result || "[]");
  const app = apps.find((entry) => entry?.name === "vansrouter" || entry?.name === "9router");
  return app?.pm2_env?.env || {};
}

function parseArgs(args) {
  const values = { envFile: ".env", composeFile: "docker-compose.yml", checkPm2: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--pm2") {
      values.checkPm2 = true;
    } else if (arg === "--env-file") {
      values.envFile = args[++index];
    } else if (arg === "--compose-file") {
      values.composeFile = args[++index];
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  for (const key of ["envFile", "composeFile"]) {
    if (!values[key]) throw new Error(`Missing value for --${key.replace("File", "-file")}`);
  }
  return values;
}

function main(args = process.argv.slice(2)) {
  const options = parseArgs(args);
  const envText = fs.existsSync(options.envFile) ? fs.readFileSync(options.envFile, "utf8") : "";
  const composeText = fs.existsSync(options.composeFile) ? fs.readFileSync(options.composeFile, "utf8") : "";
  let pm2Env = {};
  let pm2Error = null;
  if (options.checkPm2) {
    try {
      pm2Env = readPm2Environment();
    } catch (error) {
      pm2Error = error.message;
    }
  }
  const result = evaluateUpgradePreflight({
    envText,
    composeText,
    pm2Env,
    shellEnv: process.env,
  });
  if (pm2Error) result.errors.push(`Unable to inspect PM2 state: ${pm2Error}`);
  result.ok = result.errors.length === 0;
  for (const warning of result.warnings) console.warn(`[preflight] WARNING: ${warning}`);
  for (const error of result.errors) console.error(`[preflight] ERROR: ${error}`);
  if (!result.ok) process.exitCode = 1;
  else console.log("[preflight] Upgrade configuration is safe to continue.");
  return result;
}

module.exports = {
  evaluateUpgradePreflight,
  main,
  normalizePath,
  parseArgs,
  parseEnv,
  readPm2Environment,
};

if (require.main === module) main();
