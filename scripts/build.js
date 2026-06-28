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

const appDir = path.resolve(__dirname, "..");
const fakeHome = path.join(appDir, ".fakehome");

// Run focused no-undef lint before building so "X is not defined" runtime
// crashes are caught early (e.g., GitHub Issue #1, OpenCode CLI setup).
console.log("▶ running no-undef lint");
execFileSync(process.execPath, [path.join(appDir, "scripts", "lint-undef.cjs")], {
  stdio: "inherit",
  cwd: appDir,
});

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

console.log(`▶ next build --webpack  (HOME=${fakeHome})`);
// execFileSync throws on a non-zero exit, which propagates build failure correctly.
execFileSync(process.execPath, [nextBin, "build", "--webpack"], {
  stdio: "inherit",
  cwd: appDir,
  env,
});

// Copy static assets into the standalone output.
console.log("▶ copying public/ + .next/static into .next/standalone");
fs.cpSync(path.join(appDir, "public"), path.join(appDir, ".next", "standalone", "public"), { recursive: true });
fs.cpSync(path.join(appDir, ".next", "static"), path.join(appDir, ".next", "standalone", ".next", "static"), { recursive: true });

console.log("✅ build complete");
