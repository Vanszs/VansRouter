import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";

const require = createRequire(import.meta.url);
const { buildEnvWithRuntime, getRuntimeNodeModules } = require("../../cli/hooks/sqliteRuntime.js");

describe("CLI SQLite runtime packaging", () => {
  it("keeps the bundled and user runtime module paths available", () => {
    const env = buildEnvWithRuntime({ NODE_PATH: "existing-path" });
    const paths = env.NODE_PATH.split(path.delimiter);

    const bundledPath = fs.existsSync(path.resolve("cli/app/_nm"))
      ? path.resolve("cli/app/_nm")
      : path.resolve("cli/app/node_modules");
    const bundledWasm = fs.existsSync(path.join(bundledPath, "sql.js", "dist", "sql-wasm.wasm"));
    const runtimePath = getRuntimeNodeModules();
    expect(paths).toContain(bundledPath);
    expect(paths).toContain(runtimePath);
    expect(paths).toContain("existing-path");
    const bundledIndex = paths.indexOf(bundledPath);
    const runtimeIndex = paths.indexOf(runtimePath);
    expect(bundledWasm ? bundledIndex < runtimeIndex : runtimeIndex < bundledIndex).toBe(true);
  });

  it("does not install runtime dependencies for --version", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cli-version-runtime-"));
    const binDir = path.join(root, "bin");
    const homeDir = path.join(root, "home");
    const marker = path.join(root, "npm-invoked");
    fs.mkdirSync(binDir, { recursive: true });
    fs.mkdirSync(homeDir, { recursive: true });
    fs.writeFileSync(path.join(binDir, "npm"), `#!/bin/sh\ntouch "${marker}"\nexit 1\n`, { mode: 0o755 });

    const output = execFileSync(process.execPath, [path.resolve("cli/cli.js"), "--version"], {
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH}`,
        HOME: homeDir,
        DATA_DIR: path.join(homeDir, "data"),
      },
      encoding: "utf8",
    });

    expect(output.trim()).toBe(require("../../cli/package.json").version);
    expect(fs.existsSync(marker)).toBe(false);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("publishes the sql.js WASM asset through the CLI allowlist", () => {
    const npmignore = fs.readFileSync(path.resolve("cli/.npmignore"), "utf8");
    expect(npmignore).toContain("!app/_nm/sql.js/**");
  });
});
