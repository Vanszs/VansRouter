import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { auth, createProxyPool, getProxyPools } = vi.hoisted(() => ({
  auth: vi.fn(),
  createProxyPool: vi.fn(),
  getProxyPools: vi.fn(),
}));

vi.mock("@/lib/auth/routeAuth.js", () => ({ requireDashboardAuth: auth }));
vi.mock("@/models", () => ({ createProxyPool, getProxyPools }));

import { POST } from "@/app/api/proxy-pools/import-public/route.js";

const fetchMock = vi.fn();

const request = (body) => new Request("http://localhost/api/proxy-pools/import-public", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

function jsonResponse(payload, status = 200) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(payload), json: async () => payload };
}

function textResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, text: async () => body };
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  auth.mockResolvedValue(true);
  getProxyPools.mockResolvedValue([{ id: "p1", proxyUrl: "http://101.251.204.174:8080" }]);
  createProxyPool.mockImplementation(async (input) => ({ id: `created-${input.proxyUrl}`, ...input }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  fetchMock.mockReset();
});

describe("POST /api/proxy-pools/import-public", () => {
  it("rejects unauthenticated requests before any work", async () => {
    auth.mockResolvedValue(false);
    const response = await POST(request({ source: "freeproxydb" }));
    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getProxyPools).not.toHaveBeenCalled();
  });

  it("rejects unknown sources", async () => {
    const response = await POST(request({ source: "evil" }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Unknown proxy source" });
  });

  it("rejects prototype keys as unknown sources", async () => {
    const response = await POST(request({ source: "constructor" }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Unknown proxy source" });
  });

  it("rejects country filters on sources without country support", async () => {
    const response = await POST(request({ source: "vpslab", country: "US" }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid country filter for VPSLab" });
  });

  it("rejects malformed country filters", async () => {
    const response = await POST(request({ source: "freeproxydb", country: "USA" }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid country filter for FreeProxyDB" });
  });

  it("rejects speed filters on sources without speed support", async () => {
    const response = await POST(request({ source: "vpslab", maxSpeed: 10 }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Speed filter is not supported for VPSLab" });
  });

  it("rejects ordering on sources without ordering support", async () => {
    const response = await POST(request({ source: "vpslab", orderBy: "latency" }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Ordering is not supported for VPSLab" });
  });

  it("explains when filters match no currently-valid proxies", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      data: { data: [
        { ip: "47.105.122.72", port: 9080, country: "CN", is_valid: 0, connect_string: "http://47.105.122.72:9080" },
      ] },
    }));

    const response = await POST(request({ source: "freeproxydb", count: 50, protocol: "http", anonymity: "elite" }));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toMatchObject({ fetched: 0, imported: 0, duplicates: 0 });
    expect(data.reason).toContain("No currently-valid proxies matched");
  });

  it("imports only new valid proxies and reports duplicates", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      data: { data: [
        { ip: "101.251.204.174", port: 8080, country: "CN", is_valid: 1, connect_string: "http://101.251.204.174:8080" },
        { ip: "203.0.113.10", port: 1080, country: "US", is_valid: 1, connect_string: "socks5://203.0.113.10:1080" },
        { ip: "47.105.122.72", port: 9080, country: "CN", is_valid: 0, connect_string: "http://47.105.122.72:9080" },
      ] },
    }));

    const response = await POST(request({ source: "freeproxydb", count: 50, protocol: "http,socks5" }));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toMatchObject({ source: "freeproxydb", fetched: 2, imported: 1, duplicates: 1, failed: 0 });
    expect(createProxyPool).toHaveBeenCalledOnce();
    expect(createProxyPool).toHaveBeenCalledWith({
      name: "FreeProxyDB US 203.0.113.10:1080",
      proxyUrl: "socks5://203.0.113.10:1080",
      noProxy: "",
      isActive: true,
      type: "http",
    });
  });

  it("clamps the requested count into the source bounds", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { data: [] } }));

    await POST(request({ source: "freeproxydb", count: 5000, protocol: "http" }));

    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.searchParams.get("page_size")).toBe("100");
  });

  it("imports exactly the requested count when it is below the old floor", async () => {
    const rows = ["1.1.1.1", "2.2.2.2", "3.3.3.3", "4.4.4.4"].map((ip, i) => ({
      ip, port: 80 + i, country: "US", anonymity: "elite", speed: 1, is_valid: 1, connect_string: `http://${ip}:${80 + i}`,
    }));
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { data: rows } }));

    const response = await POST(request({ source: "freeproxydb", count: 2, protocol: "http" }));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.imported).toBe(2);
    expect(data.created).toHaveLength(2);
  });

  it("clamps a zero count up to the source minimum instead of importing ten", async () => {
    const rows = [{ ip: "1.1.1.1", port: 80, country: "US", is_valid: 1, connect_string: "http://1.1.1.1:80" }];
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { data: rows } }));

    const response = await POST(request({ source: "freeproxydb", count: 0, protocol: "http" }));
    const data = await response.json();

    expect(data.imported).toBe(1);
  });

  it("maps vpslab filters to the published file and imports ip:port entries", async () => {
    fetchMock.mockResolvedValueOnce(textResponse("# header\r\n1.2.3.4:8080\r\n5.6.7.8:80\r\n"));

    const response = await POST(request({ source: "vpslab", count: 100, protocol: "http", httpsOnly: true, anonymity: "elite" }));
    const data = await response.json();

    expect(fetchMock.mock.calls[0][0]).toBe("https://raw.githubusercontent.com/VPSLabCloud/VPSLab-Free-Proxy-List/main/http_ssl_elite.txt");
    expect(response.status).toBe(200);
    expect(data).toMatchObject({ source: "vpslab", file: "http_ssl_elite.txt", fetched: 2, imported: 2, duplicates: 0 });
  });

  it("passes upstream rate limits through as 429", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: "rate limited" }, 429));

    const response = await POST(request({ source: "freeproxydb", count: 50, protocol: "http" }));
    const data = await response.json();

    expect(response.status).toBe(429);
    expect(data.error).toContain("rate limit");
  });

  it("maps upstream failures to 502 without touching the database", async () => {
    fetchMock.mockRejectedValueOnce(new Error("boom"));

    const response = await POST(request({ source: "vpslab", count: 100, protocol: "http" }));

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "boom" });
    expect(getProxyPools).not.toHaveBeenCalled();
    expect(createProxyPool).not.toHaveBeenCalled();
  });
});
