import { getProxyPoolById } from "@/models";
import { fitPoolIds, loadPoolFitness } from "open-sse/services/proxyPoolFitness.js";

// Safely normalize any value into a trimmed string.
function normalizeString(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

/**
 * Normalize legacy proxy configuration.
 */
function normalizeLegacyProxy(providerSpecificData = {}) {
  const connectionProxyEnabled =
    providerSpecificData?.connectionProxyEnabled === true;

  const connectionProxyUrl = normalizeString(
    providerSpecificData?.connectionProxyUrl
  );

  const connectionNoProxy = normalizeString(
    providerSpecificData?.connectionNoProxy
  );

  return {
    connectionProxyEnabled,
    connectionProxyUrl,
    connectionNoProxy,
  };
}

/**
 * Resolve final proxy configuration.
 *
 * Priority:
 * 1. Proxy Pool
 * 2. Legacy Proxy
 * 3. No Proxy
 */
export async function resolveConnectionProxyConfig(
  providerSpecificData = {},
  connectionId = null,
  excludePoolIds = null
) {
  try {
    const proxyPoolIdRaw = normalizeString(
      providerSpecificData?.proxyPoolId
    );

    const proxyPoolId = proxyPoolIdRaw === "__none__" ? "" : proxyPoolIdRaw;
    const proxyPoolIds = Array.isArray(providerSpecificData?.proxyPoolIds) ? providerSpecificData.proxyPoolIds : [];
    const strategy = providerSpecificData?.proxyRotationStrategy || "none";
    const scope = providerSpecificData?.proxyPoolScope || null;
    if (strategy === "smart" && scope) {
      await Promise.all(proxyPoolIds.map((id) => loadPoolFitness(id)));
    }
    const selectedPoolId = proxyPoolIds.length
      ? pickProxyPoolId(proxyPoolIds, strategy, connectionId || "", providerSpecificData?.targetProxyPoolIds || [], { scope, excludeIds: excludePoolIds || [] })
      : proxyPoolId;

    const legacy = normalizeLegacyProxy(providerSpecificData);

    // A strict pool must keep its guarantee even when the pool itself is not
    // usable (inactive, or saved without a url). Otherwise the unusable-pool
    // path below reports strictProxy:false and the request silently leaves
    // over the direct IP — the leak strict mode exists to prevent (#4333).
    let poolStrictProxy = false;

    /**
     * -----------------------------
     * Proxy Pool Resolution
     * -----------------------------
     */
    if (selectedPoolId) {
      const proxyPool = await getProxyPoolById(selectedPoolId);

      const proxyUrl = normalizeString(proxyPool?.proxyUrl);
      const noProxy = normalizeString(proxyPool?.noProxy);

      const isValidPool =
        proxyPool &&
        proxyPool.isActive === true &&
        proxyUrl;

      poolStrictProxy = proxyPool?.strictProxy === true;

      if (isValidPool) {
        /**
         * Vercel/Cloudflare/Deno/Netlify relay proxies use base URL rewriting
         * instead of HTTP_PROXY environment variables.
         */
        if (proxyPool.type === "vercel" || proxyPool.type === "cloudflare" || proxyPool.type === "deno" || proxyPool.type === "netlify") {
          return {
            source: proxyPool.type,

            proxyPoolId: selectedPoolId,
            proxyPool,

            connectionProxyEnabled: false,
            connectionProxyUrl: "",
            connectionNoProxy: noProxy,

            strictProxy: proxyPool.strictProxy === true,

            vercelRelayUrl: proxyUrl, // Still mapped to vercelRelayUrl in the unified payload since they use the exact same header spec
          };
        }

        /**
         * Standard proxy pool
         */
        return {
          source: "pool",

          proxyPoolId: selectedPoolId,
          proxyPool,

          connectionProxyEnabled: true,
          connectionProxyUrl: proxyUrl,
          connectionNoProxy: noProxy,

          strictProxy: proxyPool.strictProxy === true,
        };
      }
    }

    /**
     * -----------------------------
     * Legacy Proxy Fallback
     * -----------------------------
     */
    if (
      legacy.connectionProxyEnabled &&
      legacy.connectionProxyUrl
    ) {
      return {
        source: "legacy",

        proxyPoolId: selectedPoolId || null,
        proxyPool: null,

        strictProxy: poolStrictProxy,

        ...legacy,
      };
    }

    if (scope?.startsWith("freebuff::")) {
      return {
        source: "pool",
        proxyPoolId: null,
        proxyPool: null,
        noFitPool: true,
        connectionProxyEnabled: false,
        connectionProxyUrl: "",
        connectionNoProxy: "",
        strictProxy: true,
      };
    }

    /**
     * -----------------------------
     * No Proxy Config
     * -----------------------------
     */
    return {
      source: "none",

      proxyPoolId: proxyPoolId || null,
      proxyPool: null,

      strictProxy: poolStrictProxy,

      ...legacy,
    };
  } catch (error) {
    console.error(
      "[resolveConnectionProxyConfig] Failed to resolve proxy config:",
      error
    );

    return {
      source: "error",

      proxyPoolId: null,
      proxyPool: null,

      connectionProxyEnabled: false,
      connectionProxyUrl: "",
      connectionNoProxy: "",

      noFitPool: providerSpecificData?.proxyPoolScope?.startsWith("freebuff::") === true,
      strictProxy: providerSpecificData?.proxyPoolScope?.startsWith("freebuff::") === true,
    };
  }
}

/**
 * Stable djb2 hash for short string fingerprints (non-cryptographic).
 */
function djb2(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

/**
 * Compute a stable proxy bucket key for an account.
 * Groups accounts by the proxy they share so the semaphore and circuit
 * breaker can isolate failures per proxy.
 * @param {object} providerSpecificData
 * @returns {string} "direct" if no proxy, "proxy-<hash>" if explicit proxy, "pool-<hash>" if proxy pool
 */
export function getProxyHash(providerSpecificData = {}) {
  const enabled = providerSpecificData?.connectionProxyEnabled === true;
  const url = enabled ? normalizeString(providerSpecificData?.connectionProxyUrl) : "";
  if (url) return `proxy-${djb2(url)}`;
  const poolId = normalizeString(providerSpecificData?.proxyPoolId)
    || (Array.isArray(providerSpecificData?.proxyPoolIds)
      ? normalizeString(providerSpecificData.proxyPoolIds[0])
      : "");
  if (poolId) return `pool-${djb2(poolId)}`;
  return "direct";
}

// In-memory counters for round-robin / fill-first proxy pool rotation.
// Keyed by `${providerId}:${strategy}:${poolIds}` so different providers,
// strategies, and selected pool subsets keep independent cursors.
const _poolCursors = new Map();

function normalizeTargetPoolIds(targetProxyPoolIds) {
  if (!Array.isArray(targetProxyPoolIds)) return [];
  return [...new Set(targetProxyPoolIds.map(normalizeString).filter(Boolean))];
}

export function filterTargetProxyPoolIds(poolIds, targetProxyPoolIds = []) {
  if (!Array.isArray(poolIds) || poolIds.length === 0) return [];
  const targets = normalizeTargetPoolIds(targetProxyPoolIds);
  if (targets.length === 0) return poolIds;
  const allowed = new Set(targets);
  return poolIds.filter((id) => allowed.has(id));
}

/**
 * Pick a proxy pool id from active pool ids using the configured strategy.
 * Empty targetProxyPoolIds means all active pools. Non-empty targets filter the
 * rotation subset; if every target is inactive/missing, returns null so callers
 * can fall back safely instead of silently using an unselected pool.
 *
 * @param {string[]} poolIds active proxy pool ids with a proxyUrl
 * @param {string} strategy rotation strategy from providerStrategies override
 * @param {string} providerId provider id for per-provider cursor isolation
 * @param {string[]} targetProxyPoolIds optional selected subset
 * @returns {string|null} chosen pool id, or null when pool/subset is empty
 */
export function pickProxyPoolId(poolIds, strategy, providerId = "", targetProxyPoolIds = [], options = {}) {
  if (!Array.isArray(targetProxyPoolIds)) {
    options = targetProxyPoolIds || {};
    targetProxyPoolIds = [];
  }
  let eligiblePoolIds = filterTargetProxyPoolIds(poolIds, targetProxyPoolIds);
  const strat = String(strategy || "").toLowerCase();
  const { scope = null, excludeIds = [] } = options || {};
  eligiblePoolIds = eligiblePoolIds.filter((id) => !excludeIds.includes(id));
  const fitnessApplied = strat === "smart" && !!scope;
  if (fitnessApplied) eligiblePoolIds = fitPoolIds(eligiblePoolIds, scope);
  if (eligiblePoolIds.length === 0 && !fitnessApplied) {
    eligiblePoolIds = filterTargetProxyPoolIds(poolIds, targetProxyPoolIds)
      .filter((id) => !excludeIds.includes(id));
  }
  if (eligiblePoolIds.length === 0) return null;

  if (strat === "fill-first") return eligiblePoolIds[0];

  if (strat === "round-robin" || strat === "smart") {
    const key = `${providerId}:${strat}:${eligiblePoolIds.join(",")}`;
    const idx = (_poolCursors.get(key) ?? 0) % eligiblePoolIds.length;
    _poolCursors.set(key, (idx + 1) % eligiblePoolIds.length);
    return eligiblePoolIds[idx];
  }

  if (strat === "random") {
    return eligiblePoolIds[Math.floor(Math.random() * eligiblePoolIds.length)];
  }

  return eligiblePoolIds[0];
}
