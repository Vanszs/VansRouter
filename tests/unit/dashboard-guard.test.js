import fs from "node:fs";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
  nextResponse: Symbol("next"),
  jsonResponse: vi.fn((body, init) => ({
    status: init?.status || 200,
    body,
  })),
  getSettings: vi.fn(),
  validateApiKey: vi.fn(),
  getConsistentMachineId: vi.fn(),
  verifyDashboardAuthToken: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: {
    next: vi.fn(() => mocks.nextResponse),
    json: mocks.jsonResponse,
    redirect: vi.fn((url) => ({ status: 307, url })),
  },
}));

vi.mock("@/lib/localDb", () => ({
  getSettings: mocks.getSettings,
  validateApiKey: mocks.validateApiKey,
}));

vi.mock("@/shared/utils/machineId", () => ({
  getConsistentMachineId: mocks.getConsistentMachineId,
}));

vi.mock("@/lib/auth/dashboardSession", () => ({
  verifyDashboardAuthToken: mocks.verifyDashboardAuthToken,
}));

const { proxy, __test__ } = await import("../../src/dashboardGuard.js");

process.env.NINEROUTER_PEER_TOKEN = "test-peer-token";

function request(pathname, headers = {}) {
  const peerHeaders = String(headers.host || "").startsWith("localhost")
    ? { "x-9r-real-ip": "127.0.0.1" }
    : {};
  const normalizedHeaders = new Headers({
    ...peerHeaders,
    "x-9r-peer-token": "test-peer-token",
    ...headers,
  });
  return {
    nextUrl: { pathname, searchParams: new URL(`http://localhost${pathname}`).searchParams },
    headers: normalizedHeaders,
    cookies: { get: vi.fn(() => undefined) },
    url: `http://localhost${pathname}`,
  };
}

describe("dashboard guard root route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifyDashboardAuthToken.mockResolvedValue(false);
  });

  it("redirects an unauthenticated root visit to the login page", async () => {
    const response = await proxy(request("/"));

    expect(response.status).toBe(307);
    expect(response.url).toBeInstanceOf(URL);
    expect(response.url.href).toBe("http://localhost/masuk");
  });
});

describe("dashboard guard public LLM API access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSettings.mockResolvedValue({ requireLogin: true });
    mocks.validateApiKey.mockResolvedValue(false);
    mocks.getConsistentMachineId.mockResolvedValue("cli-token");
    mocks.verifyDashboardAuthToken.mockResolvedValue(false);
  });

  it("allows loopback public LLM API without API key", async () => {
    const response = await proxy(request("/v1/chat/completions", { host: "localhost:20128" }));

    expect(response).toBe(mocks.nextResponse);
    expect(mocks.validateApiKey).not.toHaveBeenCalled();
  });

  it("rejects remote Host-spoof when real peer IP is non-loopback", async () => {
    const response = await proxy(request("/v1/chat/completions", {
      host: "localhost",
      "x-9r-real-ip": "10.204.111.34",
    }));

    expect(response.status).toBe(401);
    expect(response.body.error).toBe("API key required for remote API access");
  });

  it("allows loopback peer IP regardless of Host", async () => {
    const response = await proxy(request("/v1/chat/completions", {
      host: "localhost:20128",
      "x-9r-real-ip": "127.0.0.1",
    }));

    expect(response).toBe(mocks.nextResponse);
    expect(mocks.validateApiKey).not.toHaveBeenCalled();
  });

  it("rejects remote rewritten public LLM API without API key", async () => {
    const response = await proxy(request("/api/v1/chat/completions", { host: "router.example.com" }));

    expect(response.status).toBe(401);
    expect(response.body.error).toBe("API key required for remote API access");
  });

  it("allows loopback rewritten public LLM API without API key", async () => {
    const response = await proxy(request("/api/v1/chat/completions", { host: "localhost:20128" }));

    expect(response).toBe(mocks.nextResponse);
    expect(mocks.validateApiKey).not.toHaveBeenCalled();
  });

  it("rejects remote beta public LLM API without API key", async () => {
    const response = await proxy(request("/v1beta/models", { host: "router.example.com" }));

    expect(response.status).toBe(401);
    expect(response.body.error).toBe("API key required for remote API access");
  });

  it("rejects remote rewritten beta public LLM API without API key", async () => {
    const response = await proxy(request("/api/v1beta/models", { host: "router.example.com" }));

    expect(response.status).toBe(401);
    expect(response.body.error).toBe("API key required for remote API access");
  });

  it("rejects remote codex rewrite without API key", async () => {
    const response = await proxy(request("/codex/x", { host: "router.example.com" }));

    expect(response.status).toBe(401);
    expect(response.body.error).toBe("API key required for remote API access");
  });

  it("allows remote codex rewrite with valid API key", async () => {
    mocks.validateApiKey.mockResolvedValue(true);

    const response = await proxy(request("/codex/x", {
      host: "router.example.com",
      authorization: "Bearer sk-valid",
    }));

    expect(response).toBe(mocks.nextResponse);
    expect(mocks.validateApiKey).toHaveBeenCalledWith("sk-valid");
  });

  it("allows remote public LLM API with valid bearer API key", async () => {
    mocks.validateApiKey.mockResolvedValue(true);

    const response = await proxy(request("/api/v1/chat/completions", {
      host: "router.example.com",
      authorization: "Bearer sk-valid",
    }));

    expect(response).toBe(mocks.nextResponse);
    expect(mocks.validateApiKey).toHaveBeenCalledWith("sk-valid");
  });

  it("allows remote public LLM API with valid x-api-key", async () => {
    mocks.validateApiKey.mockResolvedValue(true);

    const response = await proxy(request("/v1/web/fetch", {
      host: "router.example.com",
      "x-api-key": "sk-valid",
    }));

    expect(response).toBe(mocks.nextResponse);
    expect(mocks.validateApiKey).toHaveBeenCalledWith("sk-valid");
  });

  it("allows remote rewritten beta public LLM API with valid API key", async () => {
    mocks.validateApiKey.mockResolvedValue(true);

    const response = await proxy(request("/api/v1beta/models", {
      host: "router.example.com",
      "x-api-key": "sk-valid",
    }));

    expect(response).toBe(mocks.nextResponse);
    expect(mocks.validateApiKey).toHaveBeenCalledWith("sk-valid");
  });

  it("allows remote beta public LLM API with valid Google API key header", async () => {
    mocks.validateApiKey.mockResolvedValue(true);

    const response = await proxy(request("/v1beta/models", {
      host: "router.example.com",
      "x-goog-api-key": "sk-valid",
    }));

    expect(response).toBe(mocks.nextResponse);
    expect(mocks.validateApiKey).toHaveBeenCalledWith("sk-valid");
  });

  it("allows remote beta public LLM API with valid Google key query parameter", async () => {
    mocks.validateApiKey.mockResolvedValue(true);

    const response = await proxy(request("/v1beta/models?key=sk-valid", {
      host: "router.example.com",
    }));

    expect(response).toBe(mocks.nextResponse);
    expect(mocks.validateApiKey).toHaveBeenCalledWith("sk-valid");
  });
});

describe("dashboard guard local-only access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSettings.mockResolvedValue({ requireLogin: true });
    mocks.validateApiKey.mockResolvedValue(false);
    mocks.getConsistentMachineId.mockResolvedValue("cli-token");
    mocks.verifyDashboardAuthToken.mockResolvedValue(false);
  });

  it("rejects local-only route from non-loopback host without CLI token", async () => {
    const response = await proxy(request("/api/mcp/filesystem/sse", {
      host: "router.example.com",
    }));

    expect(response.status).toBe(403);
    expect(response.body.error).toBe("Local only: CLI token required");
  });

  it("rejects local-only route on loopback when requireLogin=true and no JWT", async () => {
    const response = await proxy(request("/api/mcp/filesystem/sse", {
      host: "localhost:20128",
      origin: "http://localhost:20128",
    }));

    expect(response.status).toBe(403);
    expect(response.body.error).toBe("Local only: CLI token required");
  });

  it("allows local-only route on loopback when requireLogin=false", async () => {
    mocks.getSettings.mockResolvedValue({ requireLogin: false });

    const response = await proxy(request("/api/cli-tools/antigravity-mitm", {
      host: "localhost:20128",
      origin: "http://localhost:20128",
    }));

    expect(response).toBe(mocks.nextResponse);
  });

  it("rejects local-only route from tunnel host even when requireLogin=false", async () => {
    mocks.getSettings.mockResolvedValue({ requireLogin: false });

    const response = await proxy(request("/api/cli-tools/antigravity-mitm", {
      host: "router.example.com",
    }));

    expect(response.status).toBe(403);
  });

  it("rejects local-only route when Origin is non-loopback (CSRF block)", async () => {
    mocks.getSettings.mockResolvedValue({ requireLogin: false });

    const response = await proxy(request("/api/cli-tools/antigravity-mitm", {
      host: "localhost:20128",
      origin: "http://evil.example.com",
    }));

    expect(response.status).toBe(403);
  });

  it("allows local-only route with valid CLI token", async () => {
    const response = await proxy(request("/api/mcp/filesystem/sse", {
      host: "router.example.com",
      "x-9r-cli-token": "cli-token",
    }));

    expect(response).toBe(mocks.nextResponse);
  });
});

describe("dashboard guard allowRemoteNoApiKey (open remote access)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validateApiKey.mockResolvedValue(false);
    mocks.getConsistentMachineId.mockResolvedValue("cli-token");
    mocks.verifyDashboardAuthToken.mockResolvedValue(false);
  });

  it("allows remote keyless access when requireApiKey=false and allowRemoteNoApiKey=true", async () => {
    mocks.getSettings.mockResolvedValue({ requireLogin: true, requireApiKey: false, allowRemoteNoApiKey: true });

    const response = await proxy(request("/v1/chat/completions", { host: "router.example.com" }));

    expect(response).toBe(mocks.nextResponse);
    expect(mocks.validateApiKey).not.toHaveBeenCalled();
  });

  it("allows remote keyless access on rewritten /api/v1 path too", async () => {
    mocks.getSettings.mockResolvedValue({ requireLogin: true, requireApiKey: false, allowRemoteNoApiKey: true });

    const response = await proxy(request("/api/v1/chat/completions", { host: "router.example.com" }));

    expect(response).toBe(mocks.nextResponse);
  });

  it("allows remote keyless access when requireApiKey is unset (undefined) and allowRemoteNoApiKey=true", async () => {
    mocks.getSettings.mockResolvedValue({ requireLogin: true, allowRemoteNoApiKey: true });

    const response = await proxy(request("/v1beta/models", { host: "router.example.com" }));

    expect(response).toBe(mocks.nextResponse);
  });

  it("rejects remote keyless access when allowRemoteNoApiKey=false", async () => {
    mocks.getSettings.mockResolvedValue({ requireLogin: true, requireApiKey: false, allowRemoteNoApiKey: false });

    const response = await proxy(request("/v1/chat/completions", { host: "router.example.com" }));

    expect(response.status).toBe(401);
    expect(response.body.error).toBe("API key required for remote API access");
  });

  it("rejects remote keyless access when allowRemoteNoApiKey is unset", async () => {
    mocks.getSettings.mockResolvedValue({ requireLogin: true, requireApiKey: false });

    const response = await proxy(request("/v1/chat/completions", { host: "router.example.com" }));

    expect(response.status).toBe(401);
  });

  it("does NOT bypass when requireApiKey=true even if allowRemoteNoApiKey=true (no contradiction)", async () => {
    mocks.getSettings.mockResolvedValue({ requireLogin: true, requireApiKey: true, allowRemoteNoApiKey: true });

    const response = await proxy(request("/v1/chat/completions", { host: "router.example.com" }));

    expect(response.status).toBe(401);
  });

  it("still allows remote access with a valid API key while open access is enabled", async () => {
    mocks.validateApiKey.mockResolvedValue(true);
    mocks.getSettings.mockResolvedValue({ requireLogin: true, requireApiKey: false, allowRemoteNoApiKey: true });

    const response = await proxy(request("/v1/chat/completions", {
      host: "router.example.com",
      authorization: "Bearer sk-valid",
    }));

    expect(response).toBe(mocks.nextResponse);
  });

  it("rejects remote keyless access when settings cannot be loaded (fail-closed)", async () => {
    mocks.getSettings.mockRejectedValue(new Error("db down"));

    const response = await proxy(request("/v1/chat/completions", { host: "router.example.com" }));

    expect(response.status).toBe(401);
  });

  it("loopback access is unaffected and never consults open-access setting", async () => {
    mocks.getSettings.mockResolvedValue({ requireLogin: true, requireApiKey: false, allowRemoteNoApiKey: false });

    const response = await proxy(request("/v1/chat/completions", { host: "localhost:20128" }));

    expect(response).toBe(mocks.nextResponse);
    expect(mocks.validateApiKey).not.toHaveBeenCalled();
  });
});

describe("dashboard guard helpers", () => {
  it("extracts bearer API keys before x-api-key", () => {
    const apiRequest = request("/v1/chat/completions", {
      authorization: "Bearer bearer-key",
      "x-api-key": "header-key",
    });

    expect(__test__.extractApiKey(apiRequest)).toBe("bearer-key");
  });

  it("extracts Google API keys after x-api-key", () => {
    const apiRequest = request("/v1beta/models?key=query-key", {
      "x-api-key": "header-key",
      "x-goog-api-key": "google-key",
    });

    expect(__test__.extractApiKey(apiRequest)).toBe("header-key");
  });
});

describe("dashboard guard docker host-gateway peer", () => {
  const GATEWAY = "172.17.0.1";

  afterEach(() => {
    delete process.env.VANSROUTER_HOST_GATEWAY;
  });

  // Docker NATs host traffic to the container gateway, but on Docker Desktop /
  // rootless / userland-proxy the LAN is masqueraded to the same address. So no
  // peer address beyond loopback may confer locality, and there is no env knob.
  it("never treats the container gateway peer as a local request", () => {
    const fromGateway = request("/v1/chat/completions", { host: "localhost:20128", "x-9r-real-ip": GATEWAY });

    expect(__test__.isLocalRequest(fromGateway)).toBe(false);
  });

  it("keeps ignoring VANSROUTER_HOST_GATEWAY even when it is set", async () => {
    process.env.VANSROUTER_HOST_GATEWAY = GATEWAY;
    mocks.getSettings.mockResolvedValue({ requireLogin: true, requireApiKey: true });
    mocks.validateApiKey.mockResolvedValue(false);

    const response = await proxy(request("/v1/chat/completions", {
      host: "localhost:20128",
      "x-9r-real-ip": GATEWAY,
    }));

    expect(response.status).toBe(401);
  });

  it("ships no gateway locality knob in the entrypoint", () => {
    const entrypoint = fs.readFileSync("docker/entrypoint.sh", "utf8");
    expect(entrypoint).not.toContain("VANSROUTER_HOST_GATEWAY");
  });
});
