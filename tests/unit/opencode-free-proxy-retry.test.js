import { afterEach, describe, expect, it, vi } from "vitest";

async function loadProxyFetch(fetchMock) {
  vi.resetModules();
  vi.stubGlobal("fetch", fetchMock);
  return import("../../open-sse/utils/proxyFetch.js");
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("OpenCode Free proxy 403 retry", () => {
  it("retries FreeTierError once without the proxy unless strictProxy is required", async () => {
    const body = JSON.stringify({ error: { type: "FreeTierError" } });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(body, { status: 403 }))
      .mockResolvedValueOnce(new Response("data: ok", { status: 200 }));
    const { proxyAwareFetch } = await loadProxyFetch(fetchMock);

    const response = await proxyAwareFetch(
      "https://opencode.ai/zen/v1/chat/completions",
      { method: "POST", headers: { "content-type": "application/json" }, body: "{}", provider: "opencode" },
      { enabled: true, url: "http://proxy.example:8080" },
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1].dispatcher).toBeDefined();
    expect(fetchMock.mock.calls[1][1].dispatcher).toBeUndefined();
  });

  it("replays a relay-routed FreeTierError to the original endpoint directly", async () => {
    const body = JSON.stringify({ error: { type: "FreeTierError" } });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(body, { status: 403 }))
      .mockResolvedValueOnce(new Response("data: ok", { status: 200 }));
    const { proxyAwareFetch } = await loadProxyFetch(fetchMock);

    const response = await proxyAwareFetch(
      "https://opencode.ai/zen/v1/chat/completions",
      { method: "POST", headers: { authorization: "Bearer public" }, body: "{}", provider: "opencode" },
      { vercelRelayUrl: "https://relay.example" },
    );

    expect(response.status).toBe(200);
    expect(fetchMock.mock.calls[0][0]).toBe("https://relay.example");
    expect(fetchMock.mock.calls[1][0]).toBe("https://opencode.ai/zen/v1/chat/completions");
    expect(fetchMock.mock.calls[1][1].headers["x-relay-target"]).toBeUndefined();
  });

  it("preserves relay rejection body without stale framing headers", async () => {
    const body = JSON.stringify({ error: { type: "permission_error" } });
    const fetchMock = vi.fn().mockResolvedValue(new Response(body, {
      status: 403,
      headers: { "content-length": "999", "content-encoding": "gzip", "x-upstream": "preserved" },
    }));
    const { proxyAwareFetch } = await loadProxyFetch(fetchMock);

    const response = await proxyAwareFetch(
      "https://opencode.ai/zen/v1/chat/completions",
      { method: "POST", body: "{}", provider: "opencode" },
      { vercelRelayUrl: "https://relay.example" },
    );

    expect(response.status).toBe(403);
    expect(await response.text()).toBe(body);
    expect(response.headers.get("content-length")).toBeNull();
    expect(response.headers.get("content-encoding")).toBeNull();
    expect(response.headers.get("x-upstream")).toBe("preserved");
  });

  it("returns the original gate error when direct retry fails", async () => {
    const body = JSON.stringify({ error: { type: "FreeTierError" } });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(body, { status: 403 }))
      .mockRejectedValueOnce(new Error("direct egress failed"));
    const { proxyAwareFetch } = await loadProxyFetch(fetchMock);

    const response = await proxyAwareFetch(
      "https://opencode.ai/zen/v1/chat/completions",
      { method: "POST", body: "{}", provider: "opencode" },
      { enabled: true, url: "http://proxy.example:8080" },
    );

    expect(response.status).toBe(403);
    expect(await response.text()).toBe(body);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not replay a non-FreeTierError 403", async () => {
    const body = JSON.stringify({ error: { type: "permission_error" } });
    const fetchMock = vi.fn().mockResolvedValue(new Response(body, { status: 403 }));
    const { proxyAwareFetch } = await loadProxyFetch(fetchMock);

    const response = await proxyAwareFetch(
      "https://opencode.ai/zen/v1/chat/completions",
      { method: "POST", body: "{}", provider: "opencode" },
      { enabled: true, url: "http://proxy.example:8080" },
    );

    expect(response.status).toBe(403);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not replay FreeTierError on another OpenCode endpoint", async () => {
    const body = JSON.stringify({ error: { type: "FreeTierError" } });
    const fetchMock = vi.fn().mockResolvedValue(new Response(body, { status: 403 }));
    const { proxyAwareFetch } = await loadProxyFetch(fetchMock);

    const response = await proxyAwareFetch(
      "https://opencode.ai/inference/v1/chat/completions",
      { method: "POST", body: "{}", provider: "opencode" },
      { enabled: true, url: "http://proxy.example:8080" },
    );

    expect(response.status).toBe(403);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("preserves relay error response when a streamed body cannot be replayed", async () => {
    const body = JSON.stringify({ error: { type: "FreeTierError" } });
    const fetchMock = vi.fn().mockResolvedValue(new Response(body, { status: 403 }));
    const { proxyAwareFetch } = await loadProxyFetch(fetchMock);
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("{}")); } });

    const response = await proxyAwareFetch(
      "https://opencode.ai/zen/v1/chat/completions",
      { method: "POST", body: stream, provider: "opencode" },
      { vercelRelayUrl: "https://relay.example" },
    );

    expect(response.status).toBe(403);
    expect(await response.text()).toBe(body);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not replay through direct egress when strictProxy is set", async () => {
    const body = JSON.stringify({ error: { type: "FreeTierError" } });
    const fetchMock = vi.fn().mockResolvedValue(new Response(body, { status: 403 }));
    const { proxyAwareFetch } = await loadProxyFetch(fetchMock);

    const response = await proxyAwareFetch(
      "https://opencode.ai/zen/v1/chat/completions",
      { method: "POST", body: "{}", provider: "opencode" },
      { enabled: true, url: "http://proxy.example:8080", strictProxy: true },
    );

    expect(response.status).toBe(403);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
