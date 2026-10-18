import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertPublicUrl, RELAY_TARGET_GUARD_SOURCE } from "@/shared/utils/ssrfGuard.js";

const projectRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const relayRoutes = [
  "src/app/api/proxy-pools/vercel-deploy/route.js",
  "src/app/api/proxy-pools/cloudflare-deploy/route.js",
  "src/app/api/proxy-pools/deno-deploy/route.js",
];

async function expectBlocked(url) {
  await expect(assertPublicUrl(url)).rejects.toThrow(/Blocked URL|Invalid URL/);
}

describe("assertPublicUrl", () => {
  it.each(["https://example.com/models", "http://example.com/"])(
    "accepts public URL %s",
    async (url) => {
      await expect(assertPublicUrl(url)).resolves.toMatchObject({ url: expect.any(URL), addresses: expect.any(Array) });
    }
  );

  it.each([
    "file:///etc/passwd",
    "javascript:alert(1)",
    "https://user:pass@example.com/models",
  ])("rejects non-HTTP or credential URL %s", (url) => {
    expectBlocked(url);
  });

  it.each([
    "http://localhost/",
    "http://127.0.0.1/",
    "http://127.42.0.1/",
    "http://10.0.0.1/",
    "http://172.20.0.1/",
    "http://192.168.1.1/",
    "http://169.254.169.254/latest/meta-data/",
    "http://metadata.google.internal/",
    "http://service.local/",
    "http://100.64.0.1/",
    "http://224.0.0.1/",
  ])("rejects internal IPv4 or metadata target %s", (url) => {
    expectBlocked(url);
  });

  it.each([
    "http://[::1]/",
    "http://[::]/",
    "http://[fe80::1]/",
    "http://[fc00::1]/",
    "http://[fd12::1]/",
    "http://[::ffff:127.0.0.1]/",
  ])("rejects internal IPv6 target %s", (url) => {
    expectBlocked(url);
  });

  it.each(["not a URL", "https://", "//example.com/path", ""]) (
    "rejects malformed URL %j",
    async (url) => {
      await expectBlocked(url);
    }
  );
});

describe("generated relay source", () => {
  it.each(relayRoutes)("embeds the SSRF guard in %s", (routePath) => {
    const source = fs.readFileSync(path.join(projectRoot, routePath), "utf8");
    expect(source).toContain("RELAY_TARGET_GUARD_SOURCE");
    expect(source).toContain("assertTrustedTarget(targetUrl)");
  });

  it("keeps the embedded guard dependency-free", () => {
    expect(RELAY_TARGET_GUARD_SOURCE).toContain("function assertTrustedTarget(rawUrl)");
    expect(RELAY_TARGET_GUARD_SOURCE).toContain("parsed.username || parsed.password");
    expect(RELAY_TARGET_GUARD_SOURCE).toContain("Blocked URL: private IP");
    expect(RELAY_TARGET_GUARD_SOURCE).toContain("[4026531840, 4]");
  });

  it("uses the SSRF guard and bounded timeout for suggested models", () => {
    const source = fs.readFileSync(
      path.join(projectRoot, "src/app/api/providers/suggested-models/route.js"),
      "utf8"
    );
    expect(source).toContain("guardedFetch(url");
    expect(source).toMatch(/AbortSignal\.timeout\(\d+\)/);
    expect(source).not.toMatch(/return NextResponse\.json\(\{ data: \[\] \}\)/);
  });
});

