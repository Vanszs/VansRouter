import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/auth/routeAuth.js", () => ({ requireDashboardAuth: vi.fn() }));
vi.mock("@/models", () => ({
  createProxyPool: vi.fn(),
  getProxyPools: vi.fn(),
}));

import { fetchPublicProxyEntries, getPublicProxySource, resolveVpsLabFile } from "@/lib/network/publicProxySources.js";

const VPSLAB_FIXTURE = [
  "# Updated Proxies: 2026-10-04 00:15 UTC",
  "# Protocol: http | SSL: all | Anonymity: all",
  "",
  "45.91.248.107:80",
  "201.4.64.153:8080",
  "999.999.999.999:8080",
  "not-a-proxy",
  "45.91.248.107:80",
  "159.196.182.72:8080",
].join("\r\n");

const FREEPROXYDB_FIXTURE = {
  status: 1,
  message: "success",
  data: {
    total_count: 4,
    data: [
      {
        ip: "101.251.204.174", port: 8080, protocol: "http", country: "CN",
        anonymity: "elite", speed: 2.4, is_valid: 1, connect_string: "http://101.251.204.174:8080",
      },
      {
        ip: "47.105.122.72", port: 9080, protocol: "http", country: "CN",
        anonymity: "transparent", speed: 9.9, is_valid: 0, connect_string: "http://47.105.122.72:9080",
      },
      {
        ip: "203.0.113.10", port: 1080, protocol: "socks5", country: "US",
        anonymity: "anonymous", speed: 0, is_valid: 1, connect_string: "socks5://203.0.113.10:1080",
      },
      {
        ip: "198.51.100.7", port: 1080, protocol: "socks4", country: "DE",
        anonymity: "elite", speed: 1, is_valid: 1, connect_string: "socks4://198.51.100.7:1080",
      },
    ],
  },
};

function jsonResponse(payload, status = 200) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(payload), json: async () => payload };
}

function textResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, text: async () => body, json: async () => { throw new Error("not json"); } };
}

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

describe("resolveVpsLabFile", () => {
  it("maps protocol/ssl/anonymity to the published file matrix", () => {
    expect(resolveVpsLabFile({ protocol: "http" })).toBe("http_all.txt");
    expect(resolveVpsLabFile({ protocol: "http", httpsOnly: true })).toBe("http_ssl.txt");
    expect(resolveVpsLabFile({ protocol: "http", anonymity: "elite" })).toBe("http_elite.txt");
    expect(resolveVpsLabFile({ protocol: "http", httpsOnly: true, anonymity: "elite" })).toBe("http_ssl_elite.txt");
    expect(resolveVpsLabFile({ protocol: "http", httpsOnly: true, anonymity: "anonymous" })).toBe("http_ssl_anonymous.txt");
    expect(resolveVpsLabFile({ protocol: "http", anonymity: "transparent" })).toBe("http_transparent.txt");
    expect(resolveVpsLabFile({ protocol: "socks5", httpsOnly: true, anonymity: "elite" })).toBe("socks5_all.txt");
  });

  it("falls back to the plain SSL list when ssl+transparent has no dedicated file", () => {
    expect(resolveVpsLabFile({ protocol: "http", httpsOnly: true, anonymity: "transparent" })).toBe("http_ssl.txt");
  });
});

describe("getPublicProxySource", () => {
  it("returns source metadata for known ids", () => {
    expect(getPublicProxySource("freeproxydb").label).toBe("FreeProxyDB");
    expect(getPublicProxySource("vpslab").label).toBe("VPSLab");
  });

  it("throws for unknown ids", () => {
    expect(() => getPublicProxySource("nope")).toThrow(/Unknown proxy source/);
  });
});

describe("fetchPublicProxyEntries (vpslab)", () => {
  it("parses CRLF ip:port lists, skipping comments, invalid lines, and duplicates", async () => {
    fetchMock.mockResolvedValueOnce(textResponse(VPSLAB_FIXTURE));

    const entries = await fetchPublicProxyEntries("vpslab", { protocol: "http", count: 100 });

    expect(fetchMock).toHaveBeenCalledOnce();
    const url = fetchMock.mock.calls[0][0];
    expect(url).toBe("https://raw.githubusercontent.com/VPSLabCloud/VPSLab-Free-Proxy-List/main/http_all.txt");
    // URL.toString() canonicalization: special schemes drop the default port
    // (":80" → nothing) and gain a trailing "/". parseProxyLine (batch import)
    // normalizes the same way, so dedupe keys stay consistent across paths.
    expect(entries).toEqual([
      { name: "VPSLab 45.91.248.107:80", proxyUrl: "http://45.91.248.107/", type: "http" },
      { name: "VPSLab 201.4.64.153:8080", proxyUrl: "http://201.4.64.153:8080/", type: "http" },
      { name: "VPSLab 159.196.182.72:8080", proxyUrl: "http://159.196.182.72:8080/", type: "http" },
    ]);
  });

  it("prefixes socks5 scheme for socks5 lists", async () => {
    fetchMock.mockResolvedValueOnce(textResponse("1.2.3.4:1080"));

    const entries = await fetchPublicProxyEntries("vpslab", { protocol: "socks5", count: 50 });

    expect(fetchMock.mock.calls[0][0]).toContain("/socks5_all.txt");
    expect(entries).toEqual([{ name: "VPSLab 1.2.3.4:1080", proxyUrl: "socks5://1.2.3.4:1080", type: "http" }]);
  });

  it("caps results at the requested count", async () => {
    fetchMock.mockResolvedValueOnce(textResponse("1.2.3.4:80\r\n5.6.7.8:80\r\n9.10.11.12:80"));

    const entries = await fetchPublicProxyEntries("vpslab", { protocol: "http", count: 2 });

    expect(entries).toHaveLength(2);
  });
});

describe("fetchPublicProxyEntries (freeproxydb)", () => {
  it("builds the documented search query and keeps only valid runtime-supported entries", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(FREEPROXYDB_FIXTURE));

    const entries = await fetchPublicProxyEntries("freeproxydb", {
      count: 100, protocol: "http,socks5", country: "US,CN", anonymity: "elite",
      httpsOnly: true, maxSpeed: 10,
    });

    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.origin + url.pathname).toBe("https://freeproxydb.com/api/proxy/search");
    // Always fetch the freshest full page — it carries the highest density of
    // currently-valid rows; ranking happens client-side.
    expect(url.searchParams.get("order_by")).toBe("last_checked");
    expect(url.searchParams.get("order_dir")).toBe("desc");
    expect(url.searchParams.get("page_size")).toBe("100");
    expect(url.searchParams.get("https")).toBe("1");
    expect(url.searchParams.get("speed")).toBe("0,10");

    // Names carry the filter metadata (country, anonymity, measured speed) so
    // the applied filters are visible in the pool list.
    expect(entries).toEqual([
      { name: "FreeProxyDB CN elite 2.4s 101.251.204.174:8080", proxyUrl: "http://101.251.204.174:8080/", type: "http" },
      { name: "FreeProxyDB US anonymous 203.0.113.10:1080", proxyUrl: "socks5://203.0.113.10:1080", type: "http" },
    ]);
  });

  it("ranks by latency client-side and demotes unmeasured (speed=0) proxies", async () => {
    const rows = [
      { ip: "1.1.1.1", port: 1, country: "US", anonymity: "elite", speed: 0, is_valid: 1, connect_string: "http://1.1.1.1:1" },
      { ip: "2.2.2.2", port: 2, country: "US", anonymity: "elite", speed: 5.5, is_valid: 1, connect_string: "http://2.2.2.2:2" },
      { ip: "3.3.3.3", port: 3, country: "US", anonymity: "elite", speed: 1.5, is_valid: 1, connect_string: "http://3.3.3.3:3" },
    ];
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { data: rows } }));

    const entries = await fetchPublicProxyEntries("freeproxydb", { count: 10, protocol: "http", orderBy: "latency" });

    expect(entries.map((entry) => entry.proxyUrl)).toEqual([
      "http://3.3.3.3:3/",
      "http://2.2.2.2:2/",
      "http://1.1.1.1:1/",
    ]);
  });

  it("ranks by success client-side among the valid rows", async () => {
    const rows = [
      { ip: "1.1.1.1", port: 1, country: "US", anonymity: "elite", check_success_count: 2, is_valid: 1, connect_string: "http://1.1.1.1:1" },
      { ip: "2.2.2.2", port: 2, country: "US", anonymity: "elite", check_success_count: 42, is_valid: 1, connect_string: "http://2.2.2.2:2" },
      { ip: "3.3.3.3", port: 3, country: "US", anonymity: "elite", check_success_count: 7, is_valid: 1, connect_string: "http://3.3.3.3:3" },
    ];
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { data: rows } }));

    const entries = await fetchPublicProxyEntries("freeproxydb", { count: 10, protocol: "http", orderBy: "success" });

    expect(entries.map((entry) => entry.proxyUrl)).toEqual([
      "http://2.2.2.2:2/",
      "http://3.3.3.3:3/",
      "http://1.1.1.1:1/",
    ]);
  });

  it("surfaces 429 with the public rate-limit hint", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: "rate limited" }, 429));

    await expect(fetchPublicProxyEntries("freeproxydb", { count: 50, protocol: "http" }))
      .rejects.toMatchObject({ status: 429, message: expect.stringContaining("rate limit") });
  });

  it("wraps timeouts as a 504-style error", async () => {
    fetchMock.mockRejectedValueOnce(Object.assign(new Error("aborted"), { name: "AbortError" }));

    await expect(fetchPublicProxyEntries("freeproxydb", { count: 50, protocol: "http" }))
      .rejects.toMatchObject({ status: 504, message: expect.stringContaining("timed out") });
  });

  it("rejects non-JSON payloads as a 502", async () => {
    fetchMock.mockResolvedValueOnce(textResponse("<html>gateway error</html>"));

    await expect(fetchPublicProxyEntries("freeproxydb", { count: 50, protocol: "http" }))
      .rejects.toMatchObject({ status: 502, message: expect.stringContaining("non-JSON") });
  });
});
