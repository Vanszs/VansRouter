const { spawnSync } = require("child_process");

// Run ESLint with only the react-hooks rules enabled, fail on any error.
// This catches regressions of the 92 errors fixed across 40 files:
//   - react-hooks/refs (47)
//   - react-hooks/set-state-in-effect (29)
//   - react-hooks/immutability (13)
//   - react-hooks/purity (3)
//
// Counterpart to scripts/lint-undef.cjs. CI runs both before build.
const result = spawnSync(
  "./node_modules/.bin/eslint",
  [
    "--ext", ".js",
    "src/",
    "open-sse/",
    "--no-warn-ignored",
    "--rule",
    JSON.stringify({
      "react-hooks/refs": "error",
      "react-hooks/set-state-in-effect": "error",
      "react-hooks/immutability": "error",
      "react-hooks/purity": "error",
    }),
  ],
  { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
);

const output = (result.stdout || "") + (result.stderr || "");
const lines = output.split("\n").filter((line) => {
  if (!/react-hooks\/(refs|set-state-in-effect|immutability|purity)/.test(line)) return false;
  // Skip unused-disable warnings — they only mean a disable comment is no
  // longer needed (a good thing). Only flag actual rule violations.
  if (/Unused eslint-disable directive/.test(line)) return false;
  return true;
});

if (lines.length) {
  console.error(lines.join("\n"));
  process.exit(1);
}

console.log("react-hooks lint: clean");
