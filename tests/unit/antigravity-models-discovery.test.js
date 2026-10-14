// Regression: Antigravity model discovery pointed at
// https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:models, which
// answers 404 with an HTML error page, so the picker could never show a live
// model. The working endpoint is the production host's
// v1internal:fetchAvailableModels (POST {project}) and it only answers 200 when
// the request carries the Antigravity IDE User-Agent (otherwise 403
// PERMISSION_DENIED). The catalogue's placeholder slots must stay hidden.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

// proxyFetch.js patches globalThis.fetch at import time and would capture the
// real fetch before vi.stubGlobal runs. Same guard the sibling suites use.
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  default: (url, options) => globalThis.fetch(url, options),
  proxyAwareFetch: (url, options) => globalThis.fetch(url, options),
  resolveAntigravityProxyConfig: vi.fn(),
}));

const ANTIGRAVITY_MODELS_URL = "https://daily-cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels";

// Mirrors the live payload shape: { models: { <id>: {...} } }.
// Important: the payload's own `model` field is MODEL_PLACEHOLDER_* for REAL
// models too (gemini-3.8-flash-tiered is MODEL_PLACEHOLDER_M322 live), so that
// field must never be used to decide visibility. Only `tab_` ids are slots.
const catalogueFixture = {
  models: {
    "gemini-3.8-flash-tiered": { model: "MODEL_PLACEHOLDER_M322", maxTokens: 1048576 },
    "claude-sonnet-4-6": { model: "MODEL_PLACEHOLDER_M999" },
    "chat_20706": { isInternal: true },
    "tab_flash_lite_preview": { model: "MODEL_PLACEHOLDER_M19" },
  },
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

describe("GET /api/providers/[id]/models for antigravity", () => {
  const getModels = async () => {
    vi.resetModules();
    const { GET } = await import("../../src/app/api/providers/[id]/models/route.js");
    const response = await GET(new Request("http://localhost/api/providers/conn-ag/models"), {
      params: Promise.resolve({ id: "conn-ag" }),
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
      id: "conn-ag",
      provider: "antigravity",
      accessToken: "antigravity-access-token",
      refreshToken: "antigravity-refresh-token",
      projectId: "project-123",
    });
  });

  it("returns the live catalogue without the internal and placeholder slots", async () => {
    const { status, body } = await getModels();
    const ids = body.models.map((m) => m.id);

    expect(status).toBe(200);
    expect(ids).toContain("gemini-3.8-flash-tiered");
    expect(ids).not.toContain("chat_20706");
    expect(ids).not.toContain("tab_flash_lite_preview");
  });

  // A real model whose `model` field is MODEL_PLACEHOLDER_* must survive: that
  // field is Google's internal naming for genuinely served models, so filtering
  // on it silently deletes valid entries.
  it("keeps real models whose model field is a MODEL_PLACEHOLDER value", async () => {
    const { body } = await getModels();
    const ids = body.models.map((m) => m.id);

    expect(ids).toContain("gemini-3.8-flash-tiered");
    expect(ids).toContain("claude-sonnet-4-6");
  });

  it("calls fetchAvailableModels on the production host with the IDE User-Agent", async () => {
    await getModels();

    expect(fetchMock.mock.calls[0][0]).toBe(ANTIGRAVITY_MODELS_URL);
    const options = fetchMock.mock.calls[0][1];
    expect(options.method).toBe("POST");
    expect(options.headers.Authorization).toBe("Bearer antigravity-access-token");
    expect(options.headers["User-Agent"]).toMatch(/antigravity/i);
    expect(JSON.parse(options.body)).toEqual({ project: "project-123" });
  });

  it("degrades to a warning instead of throwing when the endpoint fails", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => "PERMISSION_DENIED",
    });

    const { status, body } = await getModels();

    expect(status).toBe(200);
    expect(body.warning).toMatch(/Failed to fetch Antigravity models/);
    expect(body.models).toEqual([]);
  });

  // The placeholder filter lives in an antigravity-only wrapper, so gemini-cli
  // must keep returning exactly what parseGeminiCliModels always returned.
  it("leaves gemini-cli output untouched by the antigravity filter", async () => {
    mocks.getProviderConnectionById.mockResolvedValue({
      id: "conn-gc",
      provider: "gemini-cli",
      accessToken: "gemini-cli-access-token",
    });

    const { body } = await getModels();
    const ids = body.models.map((m) => m.id);

    expect(ids).toContain("tab_flash_lite_preview");
    expect(ids).not.toContain("chat_20706");
  });
});
