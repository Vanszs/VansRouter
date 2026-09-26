import { createRequire } from "module";
import fs from "fs";
import path from "path";
import os from "os";

const require = createRequire(import.meta.url);
const { ensureModuleInBundle, stripBundledPackage, copyRecursive, shouldExclude, pruneVirtualStore } = require("../../cli/scripts/build-cli.js");

/**
 * Creates a directory symbolic link in a Windows-safe way.
 * On Windows, directory symlinks require the SeCreateSymbolicLinkPrivilege,
 * whereas junctions work without elevation. On non-Windows platforms a normal
 * directory symlink is used.
 */
function createDirLink(target, link) {
  fs.symlinkSync(target, link, process.platform === "win32" ? "junction" : "dir");
}

describe("build-helpers", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "build-helpers-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("excludes all environment files from the CLI bundle", () => {
    expect(shouldExclude(".env")).toBe(true);
    expect(shouldExclude(".env.production")).toBe(true);
    expect(shouldExclude(".env.local")).toBe(true);
    expect(shouldExclude("server.js")).toBe(false);
  });

  it("declares @swc/helpers in root package.json dependencies", () => {
    const rootPkg = JSON.parse(fs.readFileSync(path.resolve("package.json"), "utf8"));
    expect(rootPkg.dependencies).toHaveProperty("@swc/helpers");
  });

  it("resolves @swc/helpers/package.json from the project root", () => {
    const resolved = require.resolve("@swc/helpers/package.json", { paths: [process.cwd()] });
    expect(resolved).toMatch(/@swc[\\/]helpers[\\/]package\.json$/);
    expect(fs.existsSync(resolved)).toBe(true);
  });

  it("calls ensureModuleInBundle for @swc/helpers in build-cli.js", () => {
    const buildCliPath = path.resolve("cli/scripts/build-cli.js");
    const content = fs.readFileSync(buildCliPath, "utf8");
    expect(content).toMatch(/ensureModuleInBundle\s*\(\s*["']@swc\/helpers["']\s*,/);
  });

  it("bundles @swc/helpers into standalone node_modules in build.js", () => {
    const buildScriptPath = path.resolve("scripts/build.js");
    const content = fs.readFileSync(buildScriptPath, "utf8");
    expect(content).toMatch(/copyPackageClosure\s*\(\s*pkg/);
    expect(content).toContain('"@swc/helpers"');
  });

  it("copies a package into the bundle node_modules from the candidate path", () => {
    const appDir = path.join(tmpDir, "app");
    const rootDir = path.join(tmpDir, "root");
    const cliAppDir = path.join(tmpDir, "cli", "app");
    const pkgDir = path.join(appDir, "node_modules", "@swc", "helpers");
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(
      path.join(pkgDir, "package.json"),
      JSON.stringify({ name: "@swc/helpers", version: "0.5.0" })
    );
    fs.writeFileSync(path.join(pkgDir, "index.js"), "module.exports = {};");

    ensureModuleInBundle("@swc/helpers", { cliAppDir, appDir, rootDir, copyRecursive });

    const destDir = path.join(cliAppDir, "node_modules", "@swc", "helpers");
    expect(fs.existsSync(path.join(destDir, "package.json"))).toBe(true);
    expect(fs.existsSync(path.join(destDir, "index.js"))).toBe(true);
    expect(JSON.parse(fs.readFileSync(path.join(destDir, "package.json"), "utf8")).name).toBe("@swc/helpers");
  });

  it("copies a package from a pnpm-like virtual-store layout into the bundle node_modules", () => {
    const appDir = path.join(tmpDir, "app");
    const rootDir = path.join(tmpDir, "root");
    const cliAppDir = path.join(tmpDir, "cli", "app");
    const virtualStoreDir = path.join(
      appDir,
      "node_modules",
      ".pnpm",
      "@swc+helpers@0.5.0",
      "node_modules",
      "@swc",
      "helpers"
    );
    fs.mkdirSync(virtualStoreDir, { recursive: true });
    fs.writeFileSync(
      path.join(virtualStoreDir, "package.json"),
      JSON.stringify({ name: "@swc/helpers", version: "0.5.0" })
    );
    fs.writeFileSync(path.join(virtualStoreDir, "index.js"), "module.exports = {};");

    // pnpm creates a symlink at app/node_modules/@swc/helpers pointing into the virtual store.
    const pkgLinkDir = path.join(appDir, "node_modules", "@swc");
    fs.mkdirSync(pkgLinkDir, { recursive: true });
    createDirLink(
      path.relative(pkgLinkDir, virtualStoreDir),
      path.join(pkgLinkDir, "helpers")
    );

    ensureModuleInBundle("@swc/helpers", { cliAppDir, appDir, rootDir, copyRecursive });

    const destDir = path.join(cliAppDir, "node_modules", "@swc", "helpers");
    expect(fs.existsSync(path.join(destDir, "package.json"))).toBe(true);
    expect(fs.existsSync(path.join(destDir, "index.js"))).toBe(true);
    expect(fs.lstatSync(destDir).isSymbolicLink()).toBe(false);
  });

  it("falls back to require.resolve when the package is not in the direct candidate paths", () => {
    const appDir = path.join(tmpDir, "app");
    const rootDir = appDir;
    const cliAppDir = path.join(tmpDir, "cli", "app");
    // Package lives in an ancestor node_modules directory so direct candidates miss but
    // Node's module resolver walks up and finds it.
    const pkgDir = path.join(tmpDir, "node_modules", "@swc", "helpers");
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(
      path.join(pkgDir, "package.json"),
      JSON.stringify({ name: "@swc/helpers", version: "0.5.0" })
    );
    fs.writeFileSync(path.join(pkgDir, "index.js"), "module.exports = {};");

    ensureModuleInBundle("@swc/helpers", { cliAppDir, appDir, rootDir, copyRecursive });

    const destDir = path.join(cliAppDir, "node_modules", "@swc", "helpers");
    expect(fs.existsSync(path.join(destDir, "package.json"))).toBe(true);
    expect(fs.existsSync(path.join(destDir, "index.js"))).toBe(true);
  });

  it("copies the complete runtime dependency closure when requested", () => {
    const appDir = path.join(tmpDir, "app");
    const rootDir = path.join(tmpDir, "root");
    const cliAppDir = path.join(tmpDir, "cli", "app");
    const openDir = path.join(appDir, "node_modules", "open");
    const helperDir = path.join(appDir, "node_modules", "example-helper");
    fs.mkdirSync(openDir, { recursive: true });
    fs.mkdirSync(helperDir, { recursive: true });
    fs.writeFileSync(path.join(openDir, "package.json"), JSON.stringify({
      name: "open",
      version: "11.0.0",
      dependencies: { "example-helper": "1.0.0" },
    }));
    fs.writeFileSync(path.join(openDir, "index.js"), "module.exports = {};");
    fs.writeFileSync(path.join(helperDir, "package.json"), JSON.stringify({
      name: "example-helper",
      version: "1.0.0",
    }));
    fs.writeFileSync(path.join(helperDir, "index.js"), "module.exports = {};");

    ensureModuleInBundle("open", {
      cliAppDir,
      appDir,
      rootDir,
      copyRecursive,
      includeDependencies: true,
    });

    expect(fs.existsSync(path.join(cliAppDir, "node_modules", "open", "package.json"))).toBe(true);
    expect(fs.existsSync(path.join(cliAppDir, "node_modules", "example-helper", "package.json"))).toBe(true);
  });

  it("is a no-op when the package is already present in the bundle", () => {
    const appDir = path.join(tmpDir, "app");
    const rootDir = path.join(tmpDir, "root");
    const cliAppDir = path.join(tmpDir, "cli", "app");
    const destDir = path.join(cliAppDir, "node_modules", "@swc", "helpers");
    fs.mkdirSync(destDir, { recursive: true });
    fs.writeFileSync(
      path.join(destDir, "package.json"),
      JSON.stringify({ name: "@swc/helpers", version: "0.5.0" })
    );

    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    ensureModuleInBundle("@swc/helpers", { cliAppDir, appDir, rootDir, copyRecursive });
    spy.mockRestore();

    expect(fs.readdirSync(destDir)).toEqual(["package.json"]);
  });

  it("copies a package again when a required asset is missing", () => {
    const appDir = path.join(tmpDir, "app");
    const rootDir = path.join(tmpDir, "root");
    const cliAppDir = path.join(tmpDir, "cli", "app");
    const sourceDir = path.join(appDir, "node_modules", "sql.js");
    const destDir = path.join(cliAppDir, "node_modules", "sql.js");
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.mkdirSync(destDir, { recursive: true });
    fs.writeFileSync(path.join(sourceDir, "package.json"), JSON.stringify({ name: "sql.js" }));
    fs.writeFileSync(path.join(sourceDir, "sql-wasm.wasm"), "wasm");
    fs.writeFileSync(path.join(destDir, "package.json"), JSON.stringify({ name: "sql.js" }));

    ensureModuleInBundle("sql.js", {
      cliAppDir,
      appDir,
      rootDir,
      copyRecursive,
      requiredFiles: ["sql-wasm.wasm"],
    });

    expect(fs.readFileSync(path.join(destDir, "sql-wasm.wasm"), "utf8")).toBe("wasm");
  });

  it("strips direct and pnpm virtual-store package copies", () => {
    const cliAppDir = path.join(tmpDir, "cli", "app");
    const direct = path.join(cliAppDir, "node_modules", "better-sqlite3");
    const virtual = path.join(cliAppDir, "node_modules", ".pnpm", "better-sqlite3@1", "node_modules", "better-sqlite3");
    const renamedVirtual = path.join(cliAppDir, "_nm", ".pnpm", "better-sqlite3@2", "node_modules", "better-sqlite3");
    fs.mkdirSync(direct, { recursive: true });
    fs.mkdirSync(virtual, { recursive: true });
    fs.mkdirSync(renamedVirtual, { recursive: true });

    expect(stripBundledPackage(cliAppDir, "better-sqlite3")).toBe(true);
    expect(fs.existsSync(direct)).toBe(false);
    expect(fs.existsSync(virtual)).toBe(false);
    expect(fs.existsSync(renamedVirtual)).toBe(false);
  });

  it("removes the materialized pnpm virtual store after dependencies are flattened", () => {
    const cliAppDir = path.join(tmpDir, "cli", "app");
    const virtualStore = path.join(cliAppDir, "_nm", ".pnpm", "next@1", "node_modules", "next");
    const flattened = path.join(cliAppDir, "_nm", "next");
    fs.mkdirSync(virtualStore, { recursive: true });
    fs.mkdirSync(flattened, { recursive: true });
    fs.writeFileSync(path.join(virtualStore, "package.json"), "{}");
    fs.writeFileSync(path.join(flattened, "package.json"), "{}");

    expect(pruneVirtualStore(cliAppDir)).toBe(1);
    expect(fs.existsSync(path.join(cliAppDir, "_nm", ".pnpm"))).toBe(false);
    expect(fs.existsSync(path.join(flattened, "package.json"))).toBe(true);
  });

  it("fails closed when a required package cannot be resolved", () => {
    const appDir = path.join(tmpDir, "app");
    const rootDir = path.join(tmpDir, "root");
    const cliAppDir = path.join(tmpDir, "cli", "app");
    const missingPkg = "@swc/helpers-does-not-exist-xyz123";

    expect(() => ensureModuleInBundle(missingPkg, { cliAppDir, appDir, rootDir, copyRecursive }))
      .toThrow(`${missingPkg} not found locally`);
  });
});
