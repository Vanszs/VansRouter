/**
 * Native fetch helper for client-side API requests.
 * Uses cache: "no-store" to ensure real-time accuracy from local SQLite.
 */
export async function fetchCached(url, options = {}) {
  return fetch(url, { cache: "no-store", ...options });
}

export async function fetchCachedJson(url, options = {}) {
  const res = await fetchCached(url, options);
  return res.json();
}

export function invalidateCache() {}
export function clearFetchCache() {}


