#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const [tarball, expectedVersion] = process.argv.slice(2);

if (!tarball || !expectedVersion) {
  throw new Error("Usage: validate-package.cjs <tarball> <version>");
}
if (!fs.existsSync(tarball)) {
  throw new Error(`Tarball does not exist: ${tarball}`);
}

const entries = execFileSync("tar", ["-tzf", tarball], { encoding: "utf8" })
  .trim()
  .split("\n")
  .filter(Boolean);
const requiredWasm = "package/app/_nm/sql.js/dist/sql-wasm.wasm";
const requiredNext = "package/app/_nm/next/package.json";
const requiredOpen = "package/app/_nm/open/package.json";
const requiredServer = "package/app/server.js";
const requiredCustomServer = "package/app/custom-server.js";
const requiredPagesManifest = "package/app/.next-cli-build/server/pages-manifest.json";
const requiredServerFiles = "package/app/.next-cli-build/required-server-files.json";
const requiredLocalDbShim = "package/app/.next-cli-build/lib/localDb.js";

for (const required of [requiredWasm, requiredNext, requiredOpen, requiredServer, requiredCustomServer, requiredPagesManifest, requiredServerFiles, requiredLocalDbShim]) {
  if (!entries.includes(required)) {
    throw new Error(`Required CLI artifact missing: ${required}`);
  }
}
if (!entries.some((entry) => entry.startsWith("package/app/.next-cli-build/static/") && !entry.endsWith("/"))) {
  throw new Error("CLI static assets missing from final package");
}
if (!entries.some((entry) => entry.startsWith("package/app/public/") && !entry.endsWith("/"))) {
  throw new Error("CLI public assets missing from final package");
}
if (entries.some((entry) => /(^|\/)\.env(?:\.|$)/.test(entry))) {
  throw new Error("Environment file leaked into final CLI package");
}
if (entries.some((entry) => /(^|\/)better_sqlite3\.node$/.test(entry))) {
  throw new Error("native better-sqlite3 leaked into final CLI package");
}

const packageJson = JSON.parse(execFileSync("tar", ["-xOf", tarball, "package/package.json"], {
  encoding: "utf8",
}));
if (packageJson.name !== "vansrouter") {
  throw new Error(`Unexpected package name: ${packageJson.name}`);
}
if (packageJson.version !== expectedVersion) {
  throw new Error(`Tarball version mismatch: ${packageJson.version} !== ${expectedVersion}`);
}

const expectedFilename = `vansrouter-${expectedVersion}.tgz`;
if (path.basename(tarball) !== expectedFilename) {
  throw new Error(`Tarball filename mismatch: ${path.basename(tarball)} !== ${expectedFilename}`);
}

console.log(`Validated ${packageJson.name}@${packageJson.version}: ${tarball}`);
