import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const { parseArgs, verifyVersionOutput } = require("../../cli/scripts/smoke-installed-package.cjs");

describe("installed CLI package smoke test", () => {
  it("parses the tarball, version, and script mode", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "installed-cli-args-"));
    const tarball = path.join(root, "vansrouter.tgz");
    fs.writeFileSync(tarball, "fixture");

    expect(parseArgs([tarball, "1.2.3", "--run-scripts"])).toEqual({
      tarball,
      expectedVersion: "1.2.3",
      runScripts: true,
    });
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("rejects a CLI that reports the wrong version", () => {
    expect(() => verifyVersionOutput("1.2.4\n", "1.2.3")).toThrow(/version mismatch/i);
    expect(verifyVersionOutput("1.2.3\n", "1.2.3")).toBe("1.2.3");
  });
});
