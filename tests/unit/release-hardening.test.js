import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseNpmViewResult } from "../../scripts/npm-integrity.cjs";
import { classifyInspectResult } from "../../scripts/inspect-image-digest.cjs";

const root = path.resolve(import.meta.dirname, "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

describe("release hardening contracts", () => {
  it("distinguishes an unpublished npm version from registry failures", () => {
    expect(parseNpmViewResult({
      status: 1,
      stdout: JSON.stringify({ error: { code: "E404" } }),
      stderr: "npm error 404",
    })).toEqual({ kind: "missing" });
    expect(() => parseNpmViewResult({
      status: 1,
      stdout: JSON.stringify({ error: { code: "E401" } }),
      stderr: "unauthorized",
    })).toThrow(/npm view failed/);
    expect(parseNpmViewResult({
      status: 0,
      stdout: JSON.stringify("sha512-abc123="),
    })).toEqual({ kind: "found", integrity: "sha512-abc123=" });
  });

  it("does not treat registry inspection errors as missing tags", () => {
    expect(classifyInspectResult({
      status: 1,
      stderr: "ERROR: ghcr.io/example/app:missing: not found",
    })).toEqual({ kind: "missing" });
    expect(() => classifyInspectResult({
      status: 1,
      stderr: "failed to connect to registry: connection refused",
    })).toThrow(/inspection failed/);
    expect(() => classifyInspectResult({
      status: 1,
      stderr: "requested access to the resource is denied",
    })).toThrow(/inspection failed/);
    expect(classifyInspectResult({
      status: 0,
      stdout: JSON.stringify(`sha256:${"a".repeat(64)}`),
    })).toEqual({ kind: "found", digest: `sha256:${"a".repeat(64)}` });
  });

  it("keeps publication ordered after both package and image verification", () => {
    const workflow = read(".github/workflows/release.yml");
    expect(workflow).toMatch(/publish-npm:\n\s+needs: \[check-branch, package-npm, build-and-verify-ghcr\]/);
    expect(workflow).toMatch(/promote-ghcr:\n\s+needs: \[check-branch, build-and-verify-ghcr, package-npm, publish-npm\]/);
    expect(workflow).not.toMatch(/actions:\s+write/);
    expect(workflow).toMatch(/provenance: true/);
    expect(workflow).toMatch(/sbom: true/);
    expect((workflow.match(/name: release/g) || []).length).toBe(3);
    expect((workflow.match(/actions\/checkout@[0-9a-f]{40}/g) || []).length).toBe(5);
  });

  it("pins release actions and uses digest-based promotion", () => {
    const workflow = read(".github/workflows/release.yml");
    const uses = [...workflow.matchAll(/uses:\s+([^\s#]+)/g)].map((match) => match[1]);
    expect(uses.length).toBeGreaterThan(0);
    expect(uses.every((ref) => /@[0-9a-f]{40}$/.test(ref))).toBe(true);
    expect(workflow).toContain("STAGING_DIGEST");
    expect(workflow).toContain("image-digest");
    expect(workflow).toContain("scripts/inspect-image-digest.cjs");
    expect(workflow).toContain("scripts/npm-integrity.cjs");
    expect(workflow).not.toContain("get_digest()");
    expect(workflow).toContain("push-to-registry: true");
  });

  it("keeps Docker dependency installation locked and externally downloaded binaries verified", () => {
    const dockerfile = read("Dockerfile");
    expect(dockerfile).toContain("pnpm install --frozen-lockfile");
    expect(dockerfile).toContain("npm ci --ignore-scripts --no-audit --no-fund");
    expect(dockerfile).toContain("sha256sum -c -");
    expect(dockerfile).toContain("@sha256:");
    expect(dockerfile).toContain("npm_config_build_from_source=true");
    expect(dockerfile).toContain("npm ci --ignore-scripts --no-audit --no-fund");
    expect(dockerfile).toContain("linuxmusl-${bs_arch}.tar.gz");
    expect(dockerfile).toContain("9b14618f3d9aa9b70daade965bca892f324b063e1cc7532b030d7138a8f9d070");
    expect(dockerfile).toContain("b5e92ec2637bb578cc12b8b9b94877a82c3ef5e862ccc72d420706aab978bb9a");
    expect(dockerfile).toContain("TS_VERSION=1.102.4");
    expect(dockerfile).toContain("50748df1045e60b5b695f19f4c56b0da36c019948b440fb456b6584a50f0d8b9");
    expect(dockerfile).toContain("9dd1e6a592a014bbaea0103167ffe299adeda4ba14e078ce9c2895364f6c4c3f");
  });

  it("requires an explicit VansRouter version while preserving 9router storage", () => {
    const compose = read("docker-compose.yml");
    expect(compose).toContain("VANSROUTER_VERSION");
    expect(compose).not.toContain("vansrouter:latest");
    expect(compose).toContain("9router-data:/app/data");
    expect(compose).toContain("vansrouter-data:/migration-data:ro");
    expect(read(".env.example")).toMatch(/VANSROUTER_VERSION=\d+\.\d+\.\d+/);
  });

  it("keeps executable shell entrypoints LF across Windows checkouts", () => {
    const attributes = read(".gitattributes");
    expect(attributes).toMatch(/\*\.sh text eol=lf/);
    expect(attributes).toMatch(/docker\/entrypoint\.sh text eol=lf/);
  });

  it("uses the documented application port for the production start script", () => {
    const packageJson = JSON.parse(read("package.json"));
    expect(packageJson.scripts.start).toContain("--port 20128");
    expect(packageJson.scripts["preflight:upgrade"]).toContain("preflight-upgrade.cjs");
  });

  it("packages the production secret validator beside both launchers", () => {
    expect(read("Dockerfile")).toContain("COPY runtime-secrets.cjs");
    expect(read("cli/scripts/build-cli.js")).toContain("runtime-secrets.cjs");
    expect(read("cli/scripts/build-cli.js")).toContain('path.join(appDir, "runtime-secrets.cjs")');
    expect(read("cli/scripts/build-cli.js")).not.toContain('path.join(rootDir, "runtime-secrets.cjs")');
    expect(read("scripts/build.js")).toContain("runtime-secrets.cjs");
    expect(read("cli/scripts/validate-package.cjs")).toContain("runtime-secrets.cjs");
    expect(read("cli/scripts/smoke-package.cjs")).toContain("runtime-secrets.cjs");
  });

  it("keeps the native and documentation dependency lockfiles in the release graph", () => {
    const gitignore = read(".gitignore");
    const gitbookWorkflow = read(".github/workflows/gitbook-pages.yml");
    expect(fs.existsSync(path.join(root, "docker/native-deps/package-lock.json"))).toBe(true);
    expect(fs.existsSync(path.join(root, "gitbook/package-lock.json"))).toBe(true);
    expect(gitignore).toContain("!docker/native-deps/package-lock.json");
    expect(gitignore).toContain("!gitbook/package-lock.json");
    expect(gitbookWorkflow).toContain("npm ci --no-audit --no-fund --ignore-scripts");
    expect(read("scripts/smoke-container.cjs")).toContain("VANROUTER_SKIP_UPDATE_CHECK");
    expect(read("cli/scripts/smoke-package.cjs")).toContain("VANROUTER_SKIP_UPDATE_CHECK");
  });

  it("keeps the root package and the published CLI tarball on one version", () => {
    const root = JSON.parse(fs.readFileSync("package.json", "utf8"));
    const cli = JSON.parse(fs.readFileSync("cli/package.json", "utf8"));
    // The container reports package.json and the npm tarball reports the cli one.
    // A one-sided bump stays green until a tag is pushed, and the tag is immutable.
    expect(cli.version).toBe(root.version);
  });

  it("keeps landing onboarding copy on VansRouter, the current port, and the Windows data path", () => {
    const getStarted = read("src/app/landing/components/GetStarted.js");
    const navigation = read("src/app/landing/components/Navigation.js");
    expect(getStarted).toContain("npx vansrouter");
    expect(getStarted).toContain("http://localhost:20128/masuk");
    expect(getStarted).toContain("%APPDATA%\\9router\\db\\data.sqlite");
    expect(getStarted).not.toMatch(/\bVansAI\b/);
    expect(getStarted).not.toContain("npx VansRoute");
    expect(navigation).toContain("VansRouter");
  });
});
