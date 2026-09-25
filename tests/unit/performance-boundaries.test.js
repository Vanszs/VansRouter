import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import nextConfig from "../../next.config.mjs";

const read = (file) => fs.readFileSync(path.resolve(file), "utf8");

describe("performance boundaries", () => {
  it("keeps the login route off the shared component barrel", () => {
    const source = read("src/app/masuk/MasukClient.js");
    expect(source).not.toMatch(/from ["']@\/shared\/components["']/);
    expect(source).toContain('from "@/shared/components/Card"');
    expect(source).toContain('from "@/shared/components/Button"');
    expect(source).toContain('from "@/shared/components/Input"');
  });

  it("mounts one dashboard sidebar and lazy-loads the changelog", () => {
    const layout = read("src/shared/components/layouts/DashboardLayout.js");
    const sidebar = read("src/shared/components/Sidebar.js");
    const headerMenu = read("src/shared/components/HeaderMenu.js");
    expect(layout.match(/<Sidebar\b/g)).toHaveLength(1);
    expect(layout).not.toContain("preloadProviderIcons");
    expect(sidebar).toContain('dynamic(() => import("./ChangelogModal")');
    expect(headerMenu).toContain('dynamic(() => import("./ChangelogModal")');
  });

  it("keeps authenticated HTML private and provider assets bounded", async () => {
    const headers = await nextConfig.headers();
    const valueFor = (source) => headers.find((entry) => entry.source === source)?.headers?.[0]?.value;
    expect(valueFor("/dashboard/:path*")).toBe("private, no-store");
    expect(valueFor("/masuk")).toBe("private, no-store");
    expect(valueFor("/landing")).toContain("s-maxage=300");
    expect(valueFor("/providers/:path*")).toContain("max-age=86400");
    expect(valueFor("/providers/:path*")).not.toContain("immutable");
    expect(valueFor("/_next/static/:path*")).toContain("immutable");
  });

  it("does not let CLI smoke tests resolve Next from the host", () => {
    const source = read("cli/scripts/smoke-package.cjs");
    expect(source).toContain('path.join(bundledModules, "next", "package.json")');
    expect(source).toContain("NODE_PATH: bundledModules");
    expect(source).not.toContain("process.env.NODE_PATH");
  });

  it("keeps the external open runtime dependency in the CLI artifact", () => {
    const build = read("cli/scripts/build-cli.js");
    const validator = read("cli/scripts/validate-package.cjs");
    expect(build).toContain('ensureModuleInBundle("open"');
    expect(validator).toContain('package/app/_nm/open/package.json');
  });

  it("keeps the documented custom-server port contract and Bun artifact", () => {
    expect(read("custom-server.js")).toContain('indexOf("--port")');
    expect(read("scripts/build.js")).toContain('path.join(standaloneDir, "custom-server.js")');
  });

  it("isolates release smoke tests from the persistent data directory", () => {
    const source = read("scripts/deploy-atomic.cjs");
    expect(source).toContain('path.join(os.tmpdir(), "vansrouter-atomic-check-")');
    expect(source).toContain("HOME: homeDir");
    expect(source).toContain("DATA_DIR: dataDir");
    expect(source).toContain('fs.existsSync(path.join(dataDir, "db"))');
    expect(source).toContain('"custom-server.js"');
  });

  it("exposes readiness without dashboard authentication", () => {
    expect(read("src/dashboardGuard.js")).toContain('"/api/ready"');
  });

  it("keeps usage SSE lightweight and proxy-safe", () => {
    const source = read("src/app/api/usage/stream/route.js");
    expect(source).toContain("getActiveRequests");
    expect(source).not.toContain("getUsageStats");
    expect(source).toContain('request.signal.addEventListener("abort"');
    expect(source).toContain("SSE_HEADERS_DASHBOARD");
  });
});
