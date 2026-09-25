import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const tempRoots = [];

function makeTempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vansrouter-server-entry-"));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  while (tempRoots.length) {
    fs.rmSync(tempRoots.pop(), { recursive: true, force: true });
  }
});

describe("standalone server entrypoint", () => {
  it("derives the PM2 release server from CURRENT_LINK when saved env is stale", () => {
    const root = makeTempRoot();
    const currentRoot = path.join(root, "current");
    const releaseRoot = path.join(root, "releases");
    fs.mkdirSync(currentRoot, { recursive: true });
    fs.writeFileSync(path.join(currentRoot, "server.js"), "// fake release server");

    const result = spawnSync(process.execPath, ["-e", "process.stdout.write(JSON.stringify(require('./ecosystem.config.cjs').apps[0].env))"], {
      cwd: repoRoot,
      env: {
        ...process.env,
        CURRENT_LINK: currentRoot,
        DATA_DIR: path.join(root, "data"),
        RELEASE_ROOT: releaseRoot,
        RELEASE_SERVER: path.join(root, "missing", "server.js"),
      },
      encoding: "utf8",
    });

    expect(result.status, result.stderr).toBe(0);
    const env = JSON.parse(result.stdout);
    expect(env.CURRENT_LINK).toBe(currentRoot);
    expect(env.RELEASE_ROOT).toBe(releaseRoot);
    expect(env.RELEASE_SERVER).toBe(path.join(currentRoot, "server.js"));
  });

  it("prefers the atomic CURRENT_LINK over a stale RELEASE_SERVER", () => {
    const currentRoot = makeTempRoot();
    const marker = path.join(currentRoot, "selected.txt");
    fs.writeFileSync(
      path.join(currentRoot, "server.js"),
      `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "current");`,
    );

    const result = spawnSync(process.execPath, [path.join(repoRoot, "server.js")], {
      cwd: repoRoot,
      env: {
        ...process.env,
        CURRENT_LINK: currentRoot,
        RELEASE_SERVER: path.join(currentRoot, "missing", "server.js"),
        MARKER: marker,
        PORT: "0",
      },
      encoding: "utf8",
    });

    expect(result.status, result.stderr).toBe(0);
    expect(fs.readFileSync(marker, "utf8")).toBe("current");
  });
});
