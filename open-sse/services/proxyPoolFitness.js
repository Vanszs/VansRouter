// Durable proxy-pool fitness registry.
// Scope format: `provider::model` (for example `freebuff::openai/gpt-5`).
// The map is a read-through cache; SQLite is the source of truth.

import {
  getProxyPoolById,
  listProxyPoolFitness,
  upsertProxyPoolFitness,
  deleteProxyPoolFitness,
  deleteExpiredProxyPoolFitness,
  clearProxyPoolFitness,
  updateProxyPool,
} from "@/models";

// One process-wide state object. `cache` is the read-through view, `loadedAt`
// bounds the SQLite read rate, and `lastWriteAt` tells a load that its rows are
// older than a mark/clear that landed while it was reading.
const FITNESS_STATE_KEY = "__9routerPoolFitnessState__";
const state = (globalThis[FITNESS_STATE_KEY] ??= {
  cache: new Map(),
  loadedAt: new Map(),
  lastWriteAt: new Map(),
  legacyChecked: new Set(),
});
const { cache: fitness, loadedAt, lastWriteAt, legacyChecked } = state;
let loadWarningLogged = false;

export const POOL_UNFIT_MS = 5 * 60 * 1000;
export const FITNESS_LOAD_TTL_MS = 15 * 1000;

function setPoolFitness(poolId, entries) {
  if (entries.length) fitness.set(poolId, new Map(entries.map((entry) => [entry.scope, { until: entry.until, reason: entry.reason || "" }])));
  else fitness.delete(poolId);
}

function touchPool(poolId, now = Date.now()) {
  loadedAt.set(poolId, now);
  lastWriteAt.set(poolId, now);
}

function updateCachedFitness(poolId, scope, until, reason = "") {
  const byScope = fitness.get(poolId) || new Map();
  byScope.set(scope, { until, reason });
  fitness.set(poolId, byScope);
}

async function migrateLegacyFitness(poolId) {
  if (legacyChecked.has(poolId)) return false;
  const pool = await getProxyPoolById(poolId);
  const legacy = Object.entries(pool?.fitness || {}).filter(([, entry]) => Number.isFinite(entry?.until));
  if (legacy.length) {
    await Promise.all(legacy.map(([scope, entry]) => upsertProxyPoolFitness(poolId, scope, entry.until, entry.reason || "")));
    // One-way migration. Leaving the JSON field behind means the next clear-all
    // (empty table) re-inserts every legacy block from the pool row.
    await updateProxyPool(poolId, { fitness: {} });
  }
  legacyChecked.add(poolId);
  return legacy.length > 0;
}

export async function loadPoolFitness(poolId) {
  if (!poolId) return;
  const startedAt = Date.now();
  if ((loadedAt.get(poolId) || 0) > startedAt - FITNESS_LOAD_TTL_MS) return;
  try {
    let entries = await listProxyPoolFitness(poolId);
    if (!entries.length && await migrateLegacyFitness(poolId)) {
      entries = await listProxyPoolFitness(poolId);
    }
    // A mark/clear landed while the rows were being read: keep its cache value.
    if ((lastWriteAt.get(poolId) || 0) > startedAt) return;
    const active = entries.filter((entry) => entry.until > startedAt);
    setPoolFitness(poolId, active);
    loadedAt.set(poolId, Date.now());
    loadWarningLogged = false;
    const expired = entries.filter((entry) => entry.until <= startedAt);
    if (expired.length) await Promise.all(expired.map((entry) => deleteProxyPoolFitness(poolId, entry.scope)));
  } catch (error) {
    // Fitness is fail-open when persistence is unavailable. Warn once so a
    // broken DB is not invisible without spamming every smart request.
    if (!loadWarningLogged) {
      loadWarningLogged = true;
      console.warn("[proxy-fitness] load failed; using the in-process cache:", error?.message || error);
    }
  }
}

export async function markPoolUnfit(poolId, scope, until = Date.now() + POOL_UNFIT_MS, reason = "") {
  if (!poolId || !scope || !Number.isFinite(until)) return false;
  try {
    await upsertProxyPoolFitness(poolId, scope, until, reason);
    updateCachedFitness(poolId, scope, until, reason);
    touchPool(poolId);
    return true;
  } catch {
    return false;
  }
}

export async function clearPoolUnfit(poolId, scope) {
  if (!poolId || !scope) return false;
  try {
    await deleteProxyPoolFitness(poolId, scope);
    const byScope = fitness.get(poolId);
    if (byScope) {
      byScope.delete(scope);
      if (byScope.size === 0) fitness.delete(poolId);
    }
    touchPool(poolId);
    return true;
  } catch {
    return false;
  }
}

function providerWildcardScope(scope) {
  const sep = String(scope || "").indexOf("::");
  if (sep < 0) return null;
  return `${scope.slice(0, sep)}::*`;
}

// Cache-only read: expired entries are dropped here, and the durable rows are
// pruned by the next load/snapshot so the hot path never writes.
export function isPoolFit(poolId, scope, now = Date.now()) {
  if (!poolId) return true;
  const byScope = fitness.get(poolId);
  if (!byScope) return true;
  for (const key of [scope, providerWildcardScope(scope)]) {
    if (!key) continue;
    const entry = byScope.get(key);
    if (!entry) continue;
    if (entry.until <= now) {
      byScope.delete(key);
      if (byScope.size === 0) fitness.delete(poolId);
      continue;
    }
    return false;
  }
  return true;
}

export function fitPoolIds(poolIds, scope, now = Date.now()) {
  return (poolIds || []).filter((id) => isPoolFit(id, scope, now));
}

// Earliest expiry among the active benches for the given pools/scope. Used to
// tell the client how long to wait when every configured pool is benched.
export function earliestPoolUnfitUntil(poolIds, scope, now = Date.now()) {
  const provider = typeof scope === "string" ? scope.split("::")[0] : null;
  let earliest = null;
  for (const poolId of poolIds || []) {
    const entries = fitness.get(poolId);
    if (!entries) continue;
    for (const [entryScope, entry] of entries) {
      if (entryScope !== scope && !(provider && entryScope === `${provider}::*`)) continue;
      if (!Number.isFinite(entry.until) || entry.until <= now) continue;
      if (earliest == null || entry.until < earliest) earliest = entry.until;
    }
  }
  return earliest;
}

export async function clearAllPoolUnfit(provider = null) {
  try {
    await clearProxyPoolFitness(provider);
    if (!provider) fitness.clear();
    else {
      const prefix = `${provider}::`;
      for (const [poolId, byScope] of fitness) {
        for (const scope of [...byScope.keys()]) if (scope.startsWith(prefix)) byScope.delete(scope);
        if (!byScope.size) fitness.delete(poolId);
      }
    }
    // Pool caches may now disagree with SQLite; force the next use to reload.
    // Keep lastWriteAt: a mark that races this clear must still guard a load.
    loadedAt.clear();
    return true;
  } catch {
    return false;
  }
}

export async function resetPoolFitness() {
  try {
    await clearProxyPoolFitness();
    fitness.clear();
    loadedAt.clear();
    lastWriteAt.clear();
    legacyChecked.clear();
    return true;
  } catch {
    return false;
  }
}

// Read-and-prune: the dashboard read also drops expired rows so the table does
// not accumulate blocks nobody will ever look at again.
export async function poolFitnessSnapshot() {
  const entries = await listProxyPoolFitness();
  const startedAt = Date.now();
  const out = {};
  const byPool = new Map();
  for (const entry of entries) {
    if (entry.until <= startedAt) continue;
    const info = { until: entry.until, reason: entry.reason || "" };
    (out[entry.poolId] ||= {})[entry.scope] = info;
    if (!byPool.has(entry.poolId)) byPool.set(entry.poolId, new Map());
    byPool.get(entry.poolId).set(entry.scope, info);
  }
  for (const poolId of [...fitness.keys()]) {
    if (byPool.has(poolId)) continue;
    if ((lastWriteAt.get(poolId) || 0) > startedAt) continue;
    fitness.delete(poolId);
    loadedAt.delete(poolId);
  }
  for (const [poolId, byScope] of byPool) {
    if ((lastWriteAt.get(poolId) || 0) > startedAt) continue;
    fitness.set(poolId, byScope);
    loadedAt.set(poolId, Date.now());
  }
  if (entries.some((entry) => entry.until <= startedAt)) await deleteExpiredProxyPoolFitness(startedAt);
  return out;
}
