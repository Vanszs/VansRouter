/**
 * In-memory LRU request cache with configurable TTL.
 *
 * - Cache key = SHA-256(model + messages/input + temperature + other params)
 * - Only non-streaming requests are cached
 * - Per-request opt-out via X-9Router-No-Cache: true header
 * - Env: REQUEST_CACHE_TTL_MS (default 30000), REQUEST_CACHE_MAX_ENTRIES (default 1000)
 */
import { createHash } from "node:crypto";

const DEFAULT_TTL_MS = parseInt(process.env.REQUEST_CACHE_TTL_MS, 10) || 30000;
const MAX_ENTRIES = parseInt(process.env.REQUEST_CACHE_MAX_ENTRIES, 10) || 1000;

// LRU doubly-linked-list node + Map for O(1) access
class LRUCache {
  constructor(maxSize, ttlMs) {
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
    this.map = new Map();        // key → { key, value, expiresAt, prev, next }
    this.head = null;            // MRU
    this.tail = null;            // LRU
    this.stats = { hits: 0, misses: 0, evictions: 0 };
  }

  _detach(node) {
    if (node.prev) node.prev.next = node.next;
    else this.head = node.next;
    if (node.next) node.next.prev = node.prev;
    else this.tail = node.prev;
    node.prev = null;
    node.next = null;
  }

  _pushFront(node) {
    node.prev = null;
    node.next = this.head;
    if (this.head) this.head.prev = node;
    this.head = node;
    if (!this.tail) this.tail = node;
  }

  get(key) {
    const node = this.map.get(key);
    if (!node) {
      this.stats.misses++;
      return undefined;
    }
    if (Date.now() > node.expiresAt) {
      // expired
      this._detach(node);
      this.map.delete(key);
      this.stats.misses++;
      return undefined;
    }
    // Move to front (MRU)
    this._detach(node);
    this._pushFront(node);
    this.stats.hits++;
    return node.value;
  }

  set(key, value) {
    const existing = this.map.get(key);
    if (existing) {
      existing.value = value;
      existing.expiresAt = Date.now() + this.ttlMs;
      this._detach(existing);
      this._pushFront(existing);
      return;
    }
    // Evict LRU if full
    while (this.map.size >= this.maxSize) {
      const lru = this.tail;
      if (!lru) break;
      this._detach(lru);
      this.map.delete(lru.key);
      this.stats.evictions++;
    }
    const node = { key, value, expiresAt: Date.now() + this.ttlMs, prev: null, next: null };
    this.map.set(key, node);
    this._pushFront(node);
  }

  get size() {
    return this.map.size;
  }

  clear() {
    this.map.clear();
    this.head = null;
    this.tail = null;
  }
}

const cache = new LRUCache(MAX_ENTRIES, DEFAULT_TTL_MS);

/**
 * Build a deterministic cache key from the request body.
 */
export function buildCacheKey(body) {
  const keyParts = {
    model: body.model || "",
    messages: body.messages || body.input || "",
    temperature: body.temperature,
    top_p: body.top_p,
    max_tokens: body.max_tokens,
    max_completion_tokens: body.max_completion_tokens,
    tools: body.tools,
    tool_choice: body.tool_choice,
    response_format: body.response_format,
  };
  const raw = JSON.stringify(keyParts);
  return createHash("sha256").update(raw).digest("hex");
}

/**
 * Check whether a request should skip the cache.
 * Streaming, or X-9Router-No-Cache header present → skip.
 */
export function shouldSkipCache(body, headers) {
  if (body.stream === true) return true;
  const noCache = headers?.get?.("x-9router-no-cache") || headers?.["x-9router-no-cache"];
  if (noCache === "true" || noCache === "1") return true;
  return false;
}

/**
 * Attempt to retrieve a cached response.
 * Returns { hit: true, response: Response } or { hit: false }.
 */
export function getCachedResponse(cacheKey) {
  const cached = cache.get(cacheKey);
  if (cached) {
    return { hit: true, data: cached };
  }
  return { hit: false };
}

/**
 * Store a successful non-streaming response in cache.
 * `data` should be the JSON response body (already parsed/stringified).
 */
export function setCachedResponse(cacheKey, data) {
  cache.set(cacheKey, data);
}

/**
 * Get cache statistics.
 */
export function getCacheStats() {
  return {
    hits: cache.stats.hits,
    misses: cache.stats.misses,
    size: cache.size,
    maxSize: MAX_ENTRIES,
    ttlMs: DEFAULT_TTL_MS,
    evictions: cache.stats.evictions,
  };
}

/**
 * Clear the entire cache.
 */
export function clearCache() {
  cache.clear();
}
