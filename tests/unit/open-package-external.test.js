import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// `open` computes its own directory from import.meta.url. Bundling it rewrites
// that URL to the build machine's absolute path, which breaks packaged OAuth
// launchers on Windows/macOS. Keep this as an explicit release invariant.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("open must remain an external runtime dependency", () => {
  it("is listed in serverExternalPackages", () => {
    const config = readFileSync(path.join(repoRoot, "next.config.mjs"), "utf8");
    const match = config.match(/serverExternalPackages:\s*\[([^\]]*)\]/);
    expect(match).toBeTruthy();
    const packages = match[1].split(",").map((value) => value.trim().replace(/^["']|["']$/g, ""));
    expect(packages).toContain("open");
  });

  it("is a runtime dependency available to standalone output", () => {
    const pkg = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));
    expect(pkg.dependencies?.open).toBeTruthy();
  });

  it("uses import.meta.url internally", () => {
    const source = readFileSync(path.join(repoRoot, "node_modules", "open", "index.js"), "utf8");
    expect(source).toContain("import.meta.url");
  });
});
