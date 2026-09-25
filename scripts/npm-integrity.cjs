#!/usr/bin/env node

const { spawnSync } = require("child_process");

function parseNpmViewResult({ status, stdout = "", stderr = "" } = {}) {
  let payload;
  try {
    payload = JSON.parse(stdout.trim() || "null");
  } catch (error) {
    throw new Error(`npm view returned invalid JSON: ${error.message}`);
  }

  if (status !== 0) {
    if (payload?.error?.code === "E404" || /\bE404\b/i.test(stderr)) {
      return { kind: "missing" };
    }
    throw new Error(`npm view failed (${status}): ${stderr || stdout || "unknown error"}`);
  }

  if (typeof payload !== "string" || !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(payload)) {
    throw new Error(`npm view returned an invalid dist.integrity: ${JSON.stringify(payload)}`);
  }
  return { kind: "found", integrity: payload };
}

function getNpmIntegrity(spec, { run = spawnSync } = {}) {
  const result = run("npm", ["view", spec, "dist.integrity", "--json"], { encoding: "utf8" });
  if (result.error) throw result.error;
  return parseNpmViewResult(result);
}

module.exports = { parseNpmViewResult, getNpmIntegrity };

if (require.main === module) {
  const spec = process.argv[2];
  if (!spec) {
    console.error("Usage: npm-integrity.cjs <package-spec>");
    process.exitCode = 2;
  } else {
    try {
      const result = getNpmIntegrity(spec);
      if (result.kind === "missing") {
        console.log("MISSING");
      } else {
        console.log(result.integrity);
      }
    } catch (error) {
      console.error(error.message);
      process.exitCode = 2;
    }
  }
}
