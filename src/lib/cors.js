import { getSettings } from "@/lib/localDb";

let _cachedOrigins = null;
let _cachedTs = 0;
const CACHE_TTL = 10_000; // 10s

/**
 * Get configured CORS allowed origins.
 * Priority: env var > settings > default "*"
 */
export async function getCorsOrigin(requestOrigin = null) {
  const envOrigins = process.env.CORS_ALLOWED_ORIGINS;
  if (envOrigins) return resolveCorsOrigin(envOrigins, requestOrigin);

  const now = Date.now();
  if (_cachedOrigins && now - _cachedTs < CACHE_TTL) {
    return resolveCorsOrigin(_cachedOrigins, requestOrigin);
  }

  try {
    const settings = await getSettings();
    _cachedOrigins = settings.corsAllowedOrigins || "*";
    _cachedTs = now;
    return resolveCorsOrigin(_cachedOrigins, requestOrigin);
  } catch {
    return "*";
  }
}

/**
 * Resolve CORS origin for a specific request.
 * If configured as "*", return "*".
 * If configured as comma-separated list, check if request origin is allowed.
 */
function resolveCorsOrigin(configured, requestOrigin) {
  if (!configured || configured === "*") return "*";
  const allowed = configured.split(",").map(o => o.trim()).filter(Boolean);
  if (allowed.length === 0) return "*";
  if (!requestOrigin) return allowed[0];
  if (allowed.includes(requestOrigin)) return requestOrigin;
  return "null"; // Explicitly deny non-matching origins
}

/**
 * Build CORS headers object.
 */
export async function getCorsHeaders(request = null) {
  const requestOrigin = request?.headers?.get?.("origin") || null;
  const origin = await getCorsOrigin(requestOrigin);
  return {
    "Access-Control-Allow-Origin": origin,
    ...(origin !== "*" ? { "Vary": "Origin" } : {}),
  };
}

/**
 * Synchronous version using cached value (for use in response headers).
 * Falls back to "*" if cache is empty.
 */
export function getCorsOriginSync() {
  const envOrigins = process.env.CORS_ALLOWED_ORIGINS;
  if (envOrigins) return envOrigins === "*" ? "*" : envOrigins.split(",")[0].trim();
  return _cachedOrigins || "*";
}
