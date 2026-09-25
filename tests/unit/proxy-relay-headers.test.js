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

describe("relay header forwarding", () => {
  it("preserves entries when callers pass a Headers instance", async () => {
    const fetchMock = vi.fn(async () => new Response("ok"));
    const { proxyAwareFetch } = await loadProxyFetch(fetchMock);
    const headers = new Headers({
      authorization: "Bearer test-token",
      "content-type": "application/json",
    });

    await proxyAwareFetch(
      "https://provider.example/v1/chat?stream=true",
      { method: "POST", headers, body: "{}" },
      { vercelRelayUrl: "https://relay.example" },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, request] = fetchMock.mock.calls[0];
    expect(request.headers.authorization).toBe("Bearer test-token");
    expect(request.headers["content-type"]).toBe("application/json");
    expect(request.headers["x-relay-target"]).toBe("https://provider.example");
    expect(request.headers["x-relay-path"]).toBe("/v1/chat?stream=true");
  });

  it("keeps plain-object headers working", async () => {
    const fetchMock = vi.fn(async () => new Response("ok"));
    const { proxyAwareFetch } = await loadProxyFetch(fetchMock);

    await proxyAwareFetch(
      "https://provider.example/health",
      { headers: { authorization: "Bearer plain-token" } },
      { vercelRelayUrl: "https://relay.example" },
    );

    const [, request] = fetchMock.mock.calls[0];
    expect(request.headers.authorization).toBe("Bearer plain-token");
    expect(request.headers["x-relay-target"]).toBe("https://provider.example");
  });
});
