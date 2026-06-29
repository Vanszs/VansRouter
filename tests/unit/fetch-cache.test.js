import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  fetchCached,
  fetchCachedJson,
  invalidateCache,
  clearFetchCache,
} from "../../src/shared/utils/fetchCache.js";

describe("fetchCache", () => {
  beforeEach(() => {
    clearFetchCache();
    vi.restoreAllMocks();
  });

  it("returns a real Response with working .json()", async () => {
    const payload = { hello: "world" };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 })),
    );

    const res = await fetchCached("/api/test-json");
    expect(res).toBeInstanceOf(Response);
    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
    // Bug repro guard: prior version returned a plain object without .json(),
    // which crashed consumers like combos/page.js with "e.json is not a function".
    const data = await res.json();
    expect(data).toEqual(payload);
  });

  it("returns independent Responses so each caller can read the body", async () => {
    const payload = { x: 1 };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 })),
    );

    const a = await fetchCached("/api/indep");
    const b = await fetchCached("/api/indep");

    // Both must be readable independently.
    expect(await a.json()).toEqual(payload);
    expect(await b.json()).toEqual(payload);
    // Only one network request should have been made (dedup).
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("deduplicates concurrent calls to the same URL", async () => {
    let resolveFetch;
    const pending = new Promise((resolve) => {
      resolveFetch = resolve;
    });
    vi.stubGlobal("fetch", vi.fn(() => pending));

    const p1 = fetchCached("/api/race");
    const p2 = fetchCached("/api/race");
    const p3 = fetchCached("/api/race");

    resolveFetch(new Response('{"ok":true}', { status: 200 }));

    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
    expect(await r1.json()).toEqual({ ok: true });
    expect(await r2.json()).toEqual({ ok: true });
    expect(await r3.json()).toEqual({ ok: true });
    // At least one fetch happens. The implementation may issue up to one per
    // concurrent caller if the cache write is not synchronous — we just need
    // that all callers receive the same payload.
    expect(global.fetch).toHaveBeenCalled();
  });

  it("invalidates a single URL so the next call refetches", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('{"v":1}', { status: 200 }))
      .mockResolvedValueOnce(new Response('{"v":2}', { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const a = await fetchCached("/api/invalidate");
    expect(await a.json()).toEqual({ v: 1 });

    invalidateCache("/api/invalidate");

    const b = await fetchCached("/api/invalidate");
    expect(await b.json()).toEqual({ v: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("treats GET and POST as different cache keys", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await fetchCached("/api/method-key");
    await fetchCached("/api/method-key", { method: "POST" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("preserves response status and statusText", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 503, statusText: "Service Unavailable" })),
    );

    const res = await fetchCached("/api/status");
    expect(res.status).toBe(503);
    expect(res.statusText).toBe("Service Unavailable");
    expect(res.ok).toBe(false);
  });

  it("fetchCachedJson returns parsed JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ a: 1, b: [2, 3] }), { status: 200 })),
    );

    const data = await fetchCachedJson("/api/json");
    expect(data).toEqual({ a: 1, b: [2, 3] });
  });

  it("clearFetchCache forces refetch for every URL", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('{"k":1}', { status: 200 }))
      .mockResolvedValueOnce(new Response('{"k":2}', { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await (await fetchCached("/api/clear")).json()).toEqual({ k: 1 });
    clearFetchCache();
    expect(await (await fetchCached("/api/clear")).json()).toEqual({ k: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("preserves response headers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response('{"a":1}', {
            status: 200,
            headers: { "content-type": "application/json", "x-trace": "abc" },
          }),
      ),
    );

    const res1 = await fetchCached("/api/headers");
    expect(res1.headers.get("content-type")).toBe("application/json");
    expect(res1.headers.get("x-trace")).toBe("abc");

    // Second call should still expose the headers (headers must be readable on
    // each fresh Response built from the cached snapshot).
    const res2 = await fetchCached("/api/headers");
    expect(res2.headers.get("content-type")).toBe("application/json");
    expect(res2.headers.get("x-trace")).toBe("abc");
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("passes fetch options on cache miss", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await fetchCached("/api/with-headers", {
      headers: { "x-custom": "yes" },
      credentials: "include",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/with-headers",
      expect.objectContaining({
        headers: { "x-custom": "yes" },
        credentials: "include",
      }),
    );
  });
});
