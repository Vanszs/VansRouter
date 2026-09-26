#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const [tarballArg, expectedVersion] = process.argv.slice(2);

if (!tarballArg || !expectedVersion) {
  throw new Error("Usage: validate-package.cjs <tarball> <version>");
}
const tarball = path.resolve(tarballArg);
if (!fs.existsSync(tarball)) {
  throw new Error(`Tarball does not exist: ${tarball}`);
}

const entries = execFileSync("tar", ["-tzf", "-"], {
  input: fs.readFileSync(tarball),
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
})
  .trim()
  .split("\n")
  .filter(Boolean);
const requiredWasm = "package/app/_nm/sql.js/dist/sql-wasm.wasm";
const requiredNext = "package/app/_nm/next/package.json";
const requiredOpen = "package/app/_nm/open/package.json";
const requiredServer = "package/app/server.js";
const requiredCustomServer = "package/app/custom-server.js";
const requiredRuntimeSecrets = "package/app/runtime-secrets.cjs";
const requiredPagesManifest = "package/app/.next-cli-build/server/pages-manifest.json";
const requiredServerFiles = "package/app/.next-cli-build/required-server-files.json";
const requiredLocalDbShim = "package/app/.next-cli-build/lib/localDb.js";

for (const required of [requiredWasm, requiredNext, requiredOpen, requiredServer, requiredCustomServer, requiredRuntimeSecrets, requiredPagesManifest, requiredServerFiles, requiredLocalDbShim]) {
  if (!entries.includes(required)) {
    throw new Error(`Required CLI artifact missing: ${required}`);
  }
}
const openPackageJson = JSON.parse(execFileSync("tar", ["-xzOf", "-", requiredOpen], {
  input: fs.readFileSync(tarball),
  encoding: "utf8",
}));
for (const dependency of Object.keys(openPackageJson.dependencies || {})) {
  const requiredDependency = `package/app/_nm/${dependency}/package.json`;
  if (!entries.includes(requiredDependency)) {
    throw new Error(`Bundled open dependency missing: ${dependency}`);
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

const packageJson = JSON.parse(execFileSync("tar", ["-xzOf", "-", "package/package.json"], {
  input: fs.readFileSync(tarball),
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
