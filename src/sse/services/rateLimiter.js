/**
 * Sliding-window rate limiter (in-memory).
 * Default: 60 RPM per API key, configurable per key in apiKeys table.
 */

const DEFAULT_RPM = 60;
const WINDOW_MS = 60_000; // 1 minute

// Map<string, number[]> — key → sorted array of request timestamps
const _windows = new Map();

// Periodic cleanup to prevent memory leaks
const CLEANUP_INTERVAL = 5 * 60_000; // 5 min
let _cleanupTimer = null;

function ensureCleanup() {
  if (_cleanupTimer) return;
  _cleanupTimer = setInterval(() => {
    const cutoff = Date.now() - WINDOW_MS;
    for (const [key, timestamps] of _windows) {
      const filtered = timestamps.filter(t => t > cutoff);
      if (filtered.length === 0) {
        _windows.delete(key);
      } else {
        _windows.set(key, filtered);
      }
    }
  }, CLEANUP_INTERVAL);
  // Don't keep process alive just for cleanup
  if (_cleanupTimer.unref) _cleanupTimer.unref();
}

/**
 * Check if a request is rate-limited.
 * @param {string} key - API key or identifier
 * @param {number} [maxRpm] - Maximum requests per minute (default: 60)
 * @returns {{ allowed: boolean, remaining: number, retryAfterMs: number }}
 */
export function checkRateLimit(key, maxRpm = DEFAULT_RPM) {
  ensureCleanup();

  const now = Date.now();
  const cutoff = now - WINDOW_MS;
  
  let timestamps = _windows.get(key);
  if (!timestamps) {
    timestamps = [];
    _windows.set(key, timestamps);
  }
  
  // Remove expired entries (sliding window)
  while (timestamps.length > 0 && timestamps[0] <= cutoff) {
    timestamps.shift();
  }
  
  const currentCount = timestamps.length;
  
  if (currentCount >= maxRpm) {
    // Rate limited — calculate retry-after
    const oldestInWindow = timestamps[0];
    const retryAfterMs = oldestInWindow + WINDOW_MS - now;
    return {
      allowed: false,
      remaining: 0,
      retryAfterMs: Math.max(retryAfterMs, 1000),
      retryAfterSec: Math.ceil(Math.max(retryAfterMs, 1000) / 1000),
    };
  }
  
  // Allowed — record this request
  timestamps.push(now);
  
  return {
    allowed: true,
    remaining: maxRpm - currentCount - 1,
    retryAfterMs: 0,
    retryAfterSec: 0,
  };
}

/**
 * Build a 429 Response for rate-limited requests.
 */
export function rateLimitResponse(retryAfterSec) {
  return new Response(
    JSON.stringify({
      error: {
        message: "Rate limit exceeded. Please slow down.",
        type: "rate_limit_error",
        code: "rate_limit_exceeded",
      },
    }),
    {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(retryAfterSec),
        "X-RateLimit-Reset-After": `${retryAfterSec}s`,
      },
    }
  );
}

/**
 * Middleware-style rate limit check for SSE handlers.
 * Returns null if allowed, or a 429 Response if rate-limited.
 * @param {string|null} apiKey - The API key (null = no rate limiting)
 * @param {object|null} apiKeyInfo - API key info from DB (may have rateLimit field)
 */
export function enforceRateLimit(apiKey, apiKeyInfo = null) {
  if (!apiKey) return null; // No key = local mode, no rate limiting
  
  const maxRpm = apiKeyInfo?.rateLimit || apiKeyInfo?.rateLimitRpm || DEFAULT_RPM;
  const result = checkRateLimit(apiKey, maxRpm);
  
  if (!result.allowed) {
    return rateLimitResponse(result.retryAfterSec);
  }
  
  return null;
}
