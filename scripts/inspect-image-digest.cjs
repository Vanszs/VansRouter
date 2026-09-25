#!/usr/bin/env node

const { spawnSync } = require("child_process");

const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const MISSING_PATTERN = /(?:\b404\b|not found|manifest unknown|name unknown)/i;
const HARD_FAILURE_PATTERN = /(?:unauthori[sz]|forbidden|denied|authentication|required|connection refused|timeout|tls|certificate)/i;

function parseDigest(stdout = "") {
  const lines = stdout.trim().split(/\r?\n/).filter(Boolean).reverse();
  for (const line of lines) {
    try {
      const value = JSON.parse(line);
      if (typeof value === "string" && DIGEST_PATTERN.test(value)) return value;
    } catch {}
  }
  const raw = stdout.trim();
  if (DIGEST_PATTERN.test(raw)) return raw;
  throw new Error(`docker buildx returned an invalid image digest: ${JSON.stringify(raw)}`);
}

function classifyInspectResult({ status, stdout = "", stderr = "" } = {}) {
  if (status === 0) return { kind: "found", digest: parseDigest(stdout) };
  const output = `${stdout}\n${stderr}`;
  if (HARD_FAILURE_PATTERN.test(output)) {
    throw new Error(`image digest inspection failed (${status}): ${stderr || stdout || "authentication or transport error"}`);
  }
  if (MISSING_PATTERN.test(output)) return { kind: "missing" };
  throw new Error(`image digest inspection failed (${status}): ${stderr || stdout || "unknown error"}`);
}

function inspectImageDigest(reference, { run = spawnSync } = {}) {
  const result = run(
    "docker",
    ["buildx", "imagetools", "inspect", reference, "--format", "{{json .Manifest.Digest}}"],
    { encoding: "utf8" },
  );
  if (result.error) throw result.error;
  return classifyInspectResult(result);
}

module.exports = { DIGEST_PATTERN, parseDigest, classifyInspectResult, inspectImageDigest };

if (require.main === module) {
  const reference = process.argv[2];
  if (!reference) {
    console.error("Usage: inspect-image-digest.cjs <image-reference>");
    process.exitCode = 2;
  } else {
    try {
      const result = inspectImageDigest(reference);
      console.log(result.kind === "missing" ? "MISSING" : result.digest);
    } catch (error) {
      console.error(error.message);
      process.exitCode = 2;
    }
  }
}
