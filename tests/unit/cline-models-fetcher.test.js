// Regression: the Cline registry entry declared only 8 static models and no
// modelsFetcher, so the ACL / model-picker surfaces left users to hand-type
// owner/model ids ("cl/meituan/longcat-2.0") and get the case wrong.
// https://api.cline.bot/api/v1/models is public (no token) and returns the
// OpenAI list shape, so fetchModelsFetcherIds can read it directly.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The per-provider route reads the connection row; stub it so no DB is touched.
const mocks = vi.hoisted(() => ({ getProviderConnectionById: vi.fn() }));

vi.mock("@/models", () => ({
  getProviderConnectionById: mocks.getProviderConnectionById,
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json(body, init = {}) {
      return new Response(JSON.stringify(body), {
        status: init.status || 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  },
}));

const CLINE_MODELS_URL = "https://api.cline.bot/api/v1/models";

// Mirrors the live response shape: { object: "list", data: [{ id, object, created, owned_by }] }
const catalogueFixture = {
  object: "list",
  data: [
    { id: "meituan/longcat-2.0", object: "model", created: 1791933050, owned_by: "meituan" },
    { id: "z-ai/glm-5.3-flash", object: "model", created: 1791930537, owned_by: "z-ai" },
    { id: "anthropic/claude-opus-4.7", object: "model", created: 1791912025, owned_by: "anthropic" },
  ],
};

let originalFetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("cline provider modelsFetcher", () => {
  it("declares a public fetcher for the Cline catalogue", async () => {
    const cline = (await import("../../open-sse/providers/registry/cline.js")).default;
    expect(cline.modelsFetcher).toEqual({ url: CLINE_MODELS_URL, type: "openai" });
    // The endpoint needs no credentials, so the URL must be the bare catalogue.
    expect(cline.modelsFetcher.url).not.toMatch(/token|key|secret/i);
  });
});

describe("fetchModelsFetcherIds for cline", () => {
  // Fresh module per case: the fetcher caches per providerId for 300s.
  const loadFetcher = async () => {
    vi.resetModules();
    return import("../../src/sse/services/allowedModels.js");
  };

  it("returns the live owner/model ids the user was typing by hand", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => catalogueFixture,
    });
    vi.stubGlobal("fetch", fetchMock);

    const cline = (await import("../../open-sse/providers/registry/cline.js")).default;
    const { fetchModelsFetcherIds } = await loadFetcher();

    const ids = await fetchModelsFetcherIds("cline", cline);

    expect(Array.isArray(ids)).toBe(true);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids).toContain("meituan/longcat-2.0");
    expect(ids).toContain("z-ai/glm-5.3-flash");
    // Auth-less fetch: no Authorization header is invented for a public catalogue.
    expect(fetchMock).toHaveBeenCalledWith(CLINE_MODELS_URL, expect.objectContaining({ method: "GET" }));
    expect(JSON.stringify(fetchMock.mock.calls[0][1].headers || {})).not.toMatch(/Authorization/i);
  });

  it("returns [] instead of throwing when the catalogue is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    const cline = (await import("../../open-sse/providers/registry/cline.js")).default;
    const { fetchModelsFetcherIds } = await loadFetcher();

    await expect(fetchModelsFetcherIds("cline", cline)).resolves.toEqual([]);
  });

  it("returns [] instead of throwing on a non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => "upstream unavailable",
    }));

    const cline = (await import("../../open-sse/providers/registry/cline.js")).default;
    const { fetchModelsFetcherIds } = await loadFetcher();

    await expect(fetchModelsFetcherIds("cline", cline)).resolves.toEqual([]);
  });
});

describe("GET /api/providers/[id]/models for cline", () => {
  const getModels = async () => {
    vi.resetModules();
    const { GET } = await import("../../src/app/api/providers/[id]/models/route.js");
    const response = await GET(new Request("http://localhost/api/providers/conn-cline/models"), {
      params: Promise.resolve({ id: "conn-cline" }),
    });
    return { status: response.status, body: await response.json() };
  };

  let fetchMock;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => catalogueFixture,
    });
    vi.stubGlobal("fetch", fetchMock);
    mocks.getProviderConnectionById.mockResolvedValue({
      id: "conn-cline",
      provider: "cline",
      accessToken: "oauth-token-not-used",
    });
  });

  it("serves the live catalogue without needing the connection token", async () => {
    const { status, body } = await getModels();

    expect(status).toBe(200);
    expect(body.models.map((m) => m.id)).toContain("meituan/longcat-2.0");
    expect(body.models.map((m) => m.id)).toContain("z-ai/glm-5.3-flash");
    expect(fetchMock).toHaveBeenCalledWith(CLINE_MODELS_URL, expect.objectContaining({ method: "GET" }));
  });

  it("degrades to the static catalog with a warning when the fetch fails", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));

    const { status, body } = await getModels();

    expect(status).toBe(200);
    expect(body.warning).toMatch(/falling back to static/i);
    expect(body.models.map((m) => m.id)).toContain("anthropic/claude-opus-4.7");
  });
});
