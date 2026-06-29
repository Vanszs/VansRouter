/**
 * In-memory fetch cache for the browser session.
 *
 * Many dashboard pages/components fetch the same read-only endpoints
 * (e.g. /api/providers, /api/models). This utility deduplicates those
 * requests in-flight and across renders so we do not download the same
 * JSON multiple times per page load.
 *
 * Only safe for GET endpoints whose data is acceptable to cache for the
 * lifetime of the session tab. Mutating endpoints should use plain fetch.
 */

const cache = new Map();

function makeKey(url, options = {}) {
  return `${options.method || "GET"}|${url}`;
}

export async function fetchCached(url, options = {}) {
  const key = makeKey(url, options);

  if (cache.has(key)) {
    // Return a fresh Response built from the cached body so the consumer
    // can freely call .json() / .text() on it.
    const { body, status, statusText, headers } = cache.get(key);
    return new Response(body, { status, statusText, headers });
  }

  const res = await fetch(url, options);
  // Snapshot the body once; subsequent calls reuse this snapshot.
  const body = await res.clone().arrayBuffer();
  const headers = res.headers;
  const status = res.status;
  const statusText = res.statusText;
  cache.set(key, { body, status, statusText, headers });
  // Return a fresh Response for this caller.
  return new Response(body, { status, statusText, headers });
}

export async function fetchCachedJson(url, options = {}) {
  const res = await fetchCached(url, options);
  return res.json();
}

export function invalidateCache(url, method = "GET") {
  cache.delete(makeKey(url, { method }));
}

export function clearFetchCache() {
  cache.clear();
}
