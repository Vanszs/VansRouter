#!/usr/bin/env node

// Build-artifact verification for CI and local release checks.
// It exercises the same copy/link normalization and cold-start smoke path as
// deploy-atomic.cjs, without touching PM2 or the production database.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  finalizeReleaseSymlinks,
  makeReleaseSelfContained,
  removeRuntimeEnvFiles,
  smokeRelease,
  verifyRelease,
} = require("./deploy-atomic.cjs");

const root = path.resolve(__dirname, "..");
const distDir = path.resolve(root, process.env.NEXT_DIST_DIR || ".next-ci");
const source = path.join(distDir, "standalone");

async function main() {
  if (!fs.existsSync(source)) throw new Error(`Missing standalone build: ${source}`);

  const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vansrouter-release-check-"));
  const staged = path.join(workRoot, "release.staging");
  const finalRelease = path.join(workRoot, "release");

  try {
    fs.cpSync(source, staged, { recursive: true, verbatimSymlinks: true });
    removeRuntimeEnvFiles(staged);
    makeReleaseSelfContained(staged, source);
    fs.renameSync(staged, finalRelease);
    fs.rmSync(distDir, { recursive: true, force: true });
    finalizeReleaseSymlinks(finalRelease);

    const release = verifyRelease(finalRelease, {
      selfContained: true,
      distDir: path.basename(distDir),
      requireCustomServer: true,
    });
    await smokeRelease(finalRelease, path.basename(distDir));
    console.log(JSON.stringify({
      ok: true,
      buildId: release.buildId,
      symlinks: release.symlinkCount,
      requiredFiles: release.requiredFileCount,
      coldStart: true,
    }));
  } finally {
    fs.rmSync(workRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`Release artifact verification failed: ${error.message}`);
  process.exitCode = 1;
});
