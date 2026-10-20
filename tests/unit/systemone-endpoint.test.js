import { describe, expect, it, vi, beforeEach } from "vitest";
import { handleSystemoneCore } from "../../open-sse/handlers/systemoneCore.js";
import { getProvidersByKind } from "@/shared/constants/providers";
import { HTTP_STATUS } from "../../open-sse/config/runtimeConfig.js";

describe("System One Registry & Providers", () => {
  it("registers systemone providers correctly", () => {
    const list = getProvidersByKind("systemone");
    const ids = list.map((p) => p.id);
    expect(ids).toContain("v1m");
    expect(ids).toContain("opencode");
    expect(ids).toContain("opencode-zen");
    expect(ids).toContain("openrouter");
    expect(ids).toContain("cloudflare-ai");
  });

  it("cloudflare-ai provides clef-flash with template baseUrl", () => {
    const list = getProvidersByKind("systemone");
    const cf = list.find((p) => p.id === "cloudflare-ai");
    expect(cf).toBeDefined();
    expect(cf.systemoneConfig?.baseUrl).toContain("{accountId}");
    expect(cf.systemoneConfig?.baseUrl).toContain("{model}");
  });
});

describe("handleSystemoneCore", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("validates missing state", async () => {
    const result = await handleSystemoneCore({
      body: { questions: { q: { type: "noul" } } },
      modelInfo: { provider: "v1m", model: "rev-latest" },
      credentials: { apiKey: "test-key" },
    });
    expect(result.success).toBe(false);
    expect(result.status).toBe(HTTP_STATUS.BAD_REQUEST);
    expect(result.error).toContain("Missing required field: state");
  });

  it("validates missing questions", async () => {
    const result = await handleSystemoneCore({
      body: { state: "test state" },
      modelInfo: { provider: "v1m", model: "rev-latest" },
      credentials: { apiKey: "test-key" },
    });
    expect(result.success).toBe(false);
    expect(result.status).toBe(HTTP_STATUS.BAD_REQUEST);
    expect(result.error).toContain("Missing required field: questions");
  });

  it("rejects providers without systemone support", async () => {
    const result = await handleSystemoneCore({
      body: { state: "test state", questions: { q: { type: "noul" } } },
      modelInfo: { provider: "non-existent-provider", model: "some-model" },
      credentials: { apiKey: "test-key" },
    });
    expect(result.success).toBe(false);
    expect(result.status).toBe(HTTP_STATUS.BAD_REQUEST);
    expect(result.error).toContain("does not support System One");
  });

  it("interpolates accountId and model in Cloudflare URLs", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          answers: { is_urgent: { type: "noul", noul: 0.95 } },
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", mockFetch);

    const result = await handleSystemoneCore({
      body: { state: "test state", questions: { is_urgent: { type: "noul" } } },
      modelInfo: { provider: "cloudflare-ai", model: "@cf/cloudflare/clef-flash" },
      credentials: {
        apiKey: "cf-token",
        providerSpecificData: { accountId: "acc-12345" },
      },
    });

    expect(result.success).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const calledUrl = mockFetch.mock.calls[0][0];
    expect(calledUrl).toContain("acc-12345");
    expect(calledUrl).toContain("@cf/cloudflare/clef-flash");
    expect(result.usage).toEqual({ prompt_tokens: 10, completion_tokens: 5 });
  });

  it("forwards requests to v1m and parses response", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          answers: { verdict: { type: "noul", noul: 0.88 } },
          usage: { prompt_tokens: 42, completion_tokens: 12 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", mockFetch);

    let successHookCalled = false;
    const result = await handleSystemoneCore({
      body: { state: "evaluating input", questions: { verdict: { type: "noul" } } },
      modelInfo: { provider: "v1m", model: "rev-latest" },
      credentials: { apiKey: "v1m-secret-key" },
      onRequestSuccess: async () => {
        successHookCalled = true;
      },
    });

    expect(result.success).toBe(true);
    expect(successHookCalled).toBe(true);
    expect(result.usage).toEqual({ prompt_tokens: 42, completion_tokens: 12 });
    const json = await result.response.json();
    expect(json.answers.verdict.noul).toBe(0.88);
  });
});

describe("handleSystemone Request Handler", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("handles malformed JSON body", async () => {
    const { handleSystemone } = await import("@/sse/handlers/systemone.js");
    const req = new Request("http://localhost:20128/v1/systemone", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-json{",
    });

    const res = await handleSystemone(req);
    expect(res.status).toBe(HTTP_STATUS.BAD_REQUEST);
    const json = await res.json();
    expect(json.error.message).toContain("Invalid JSON body");
  });

  it("validates missing model field", async () => {
    const { handleSystemone } = await import("@/sse/handlers/systemone.js");
    const req = new Request("http://localhost:20128/v1/systemone", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state: "hello", questions: { q: { type: "noul" } } }),
    });

    const res = await handleSystemone(req);
    expect(res.status).toBe(HTTP_STATUS.BAD_REQUEST);
    const json = await res.json();
    expect(json.error.message).toContain("Missing model");
  });

  it("validates missing state field", async () => {
    const { handleSystemone } = await import("@/sse/handlers/systemone.js");
    const req = new Request("http://localhost:20128/v1/systemone", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "v1m/rev-latest", questions: { q: { type: "noul" } } }),
    });

    const res = await handleSystemone(req);
    expect(res.status).toBe(HTTP_STATUS.BAD_REQUEST);
    const json = await res.json();
    expect(json.error.message).toContain("Missing required field: state");
  });

  it("validates invalid questions structure", async () => {
    const { handleSystemone } = await import("@/sse/handlers/systemone.js");
    const req = new Request("http://localhost:20128/v1/systemone", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "v1m/rev-latest", state: "test", questions: ["not-an-object"] }),
    });

    const res = await handleSystemone(req);
    expect(res.status).toBe(HTTP_STATUS.BAD_REQUEST);
    const json = await res.json();
    expect(json.error.message).toContain("Missing required field: questions");
  });
});

