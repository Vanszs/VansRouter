const { spawnSync } = require("child_process");

// Run ESLint with the project's main config but only fail on no-undef errors.
// This prevents "X is not defined" runtime crashes (like Issue #1 and the
// OpenCode CLI "res is not defined" bug) without blocking on pre-existing
// react-hooks/import/style violations.
const result = spawnSync(
  "./node_modules/.bin/eslint",
  ["--ext", ".js", "src/", "open-sse/", "cli/"],
  { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
);

const output = (result.stdout || "") + (result.stderr || "");
const lines = output.split("\n").filter((line) =>
  /no-undef|is not defined/.test(line)
);

if (lines.length) {
  console.error(lines.join("\n"));
  process.exit(1);
}

console.log("no-undef lint: clean");
