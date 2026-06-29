import { describe, it, expect } from "vitest";
import { execFileSync } from "child_process";
import path from "path";

/**
 * Regression guard: assert the project lints clean with no react-hooks/*
 * errors. If this test fails, a new commit reintroduced a React Hooks
 * anti-pattern (refs during render, setState in effect, mutating state,
 * impure functions during render) that React 19's lint plugin flagged.
 *
 * Run `pnpm run lint:reacthooks` (wraps this same logic) in CI to fail
 * the build early.
 */
describe("eslint react-hooks regression guard", () => {
  it("the project has zero react-hooks errors", { timeout: 300_000 }, () => {
    let stdout;
    try {
      stdout = execFileSync(
        "node",
        [
          path.resolve("node_modules/eslint/bin/eslint.js"),
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
          "--format",
          "json",
        ],
        { cwd: process.cwd(), encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
      );
    } catch (e) {
      stdout = e.stdout?.toString() ?? "";
      if (!stdout) throw e;
    }

    const results = JSON.parse(stdout);
    const offenders = [];
    for (const file of results) {
      for (const msg of file.messages) {
        if (msg.severity !== 2) continue; // errors only, not warnings
        if (msg.ruleId && msg.ruleId.startsWith("react-hooks")) {
          offenders.push({
            file: file.filePath.replace(process.cwd() + "/", ""),
            line: msg.line,
            rule: msg.ruleId,
            message: msg.message.split("\n")[0],
          });
        }
      }
    }

    if (offenders.length > 0) {
      const lines = offenders
        .slice(0, 25)
        .map((o) => `  ${o.file}:${o.line}  [${o.rule}]  ${o.message}`)
        .join("\n");
      const more = offenders.length > 25 ? `\n  ... and ${offenders.length - 25} more` : "";
      throw new Error(
        `Found ${offenders.length} react-hooks error(s) — fix before merging:\n${lines}${more}`,
      );
    }

    expect(offenders.length).toBe(0);
  });
});
