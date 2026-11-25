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

describe("OpenCode Free proxy egress policy", () => {
  it("returns the proxied FreeTierError without replaying from the server IP", async () => {
    const body = JSON.stringify({ error: { type: "FreeTierError" } });
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(body, { status: 403 }));
    const { proxyAwareFetch } = await loadProxyFetch(fetchMock);

    const response = await proxyAwareFetch(
      "https://opencode.ai/zen/v1/chat/completions",
      { method: "POST", headers: { "content-type": "application/json" }, body: "{}", provider: "opencode" },
      { enabled: true, url: "http://proxy.example:8080" },
    );

    expect(response.status).toBe(403);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].dispatcher).toBeDefined();
  });

  it("returns a relay-routed FreeTierError instead of replaying direct", async () => {
    const body = JSON.stringify({ error: { type: "FreeTierError" } });
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(body, { status: 403 }));
    const { proxyAwareFetch } = await loadProxyFetch(fetchMock);

    const response = await proxyAwareFetch(
      "https://opencode.ai/zen/v1/chat/completions",
      { method: "POST", headers: { authorization: "Bearer public" }, body: "{}", provider: "opencode" },
      { vercelRelayUrl: "https://relay.example" },
    );

    expect(response.status).toBe(403);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("https://relay.example");
  });

  it("fails closed when an OpenCode proxy fails instead of going direct", async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error("proxy down"));
    const { proxyAwareFetch } = await loadProxyFetch(fetchMock);

    await expect(proxyAwareFetch(
      "https://opencode.ai/zen/v1/chat/completions",
      { method: "POST", body: "{}", provider: "opencode" },
      { enabled: true, url: "http://proxy.example:8080" },
    )).rejects.toThrow(/Proxy required but failed/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
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
