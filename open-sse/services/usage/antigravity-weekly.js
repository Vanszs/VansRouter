/**
 * Antigravity weekly quota — best-effort retrieval from retrieveUserQuotaSummary.
 * Failure never breaks existing per-model quota display.
 */

import { U, parseResetTime, fetchWithTimeout } from "./shared.js";
import { ANTIGRAVITY_IDE_USER_AGENT, ANTIGRAVITY_IDE_VERSION } from "../../providers/shared.js";

// Endpoints come from the registry usage block
const WEEKLY_CONFIG = {
  ...U("antigravity"),
  userAgent: ANTIGRAVITY_IDE_USER_AGENT,
};

// Cache: TTL + in-flight dedup per account/project (same idiom as usage/claude.js)
const WEEKLY_CACHE_TTL_MS = 180_000;
const weeklyCache = new Map();

function pruneWeeklyCache() {
  const now = Date.now();
  for (const [key, entry] of weeklyCache) {
    if (!entry.promise && entry.expiresAt <= now) weeklyCache.delete(key);
  }
}

// Exported for tests only
export function _clearWeeklyCache() {
  weeklyCache.clear();
}

// Group name → stable quota key
const GROUP_MATCHERS = [
  { pattern: /gemini/i, key: "gemini_weekly", displayName: "Gemini (Weekly)" },
  { pattern: /claude|gpt/i, key: "claude_gpt_weekly", displayName: "Claude & GPT (Weekly)" },
];

/**
 * Parse a retrieveUserQuotaSummary response into normalized weekly quotas.
 * Pure function — safe to unit-test without network.
 */
export function parseWeeklyQuotaSummary(data) {
  if (!data || typeof data !== "object") return {};

  // Groups may live at data.groups or data.quotaSummary.groups
  const groups = Array.isArray(data.groups)
    ? data.groups
    : Array.isArray(data.quotaSummary?.groups)
      ? data.quotaSummary.groups
      : null;

  if (!groups) return {};

  const result = {};

  for (const group of groups) {
    if (!group || typeof group !== "object") continue;
    const displayName = group.displayName || "";

    const buckets = Array.isArray(group.buckets) ? group.buckets : [];
    for (const bucket of buckets) {
      if (!bucket || typeof bucket !== "object") continue;

      // Identify the weekly bucket by bucketId + displayName
      const bucketText = `${bucket.bucketId || ""} ${bucket.displayName || ""}`.toLowerCase();
      if (!bucketText.includes("weekly")) continue;

      // Skip disabled buckets
      if (bucket.disabled === true) continue;

      const remainingFraction = Number(bucket.remainingFraction);
      if (!Number.isFinite(remainingFraction)) continue;

      // Match group to a known family
      for (const matcher of GROUP_MATCHERS) {
        if (matcher.pattern.test(displayName)) {
          const total = 1000;
          const remaining = Math.round(total * remainingFraction);
          const used = Math.max(0, total - remaining);

          result[matcher.key] = {
            used,
            total,
            resetAt: parseResetTime(bucket.resetTime),
            remainingPercentage: remainingFraction * 100,
            unlimited: false,
            displayName: matcher.displayName,
          };
          break; // first matching bucket per family wins
        }
      }
    }
  }

  return result;
}

/**
 * Fetch weekly quota summary — cached, deduped, never throws.
 */
export async function fetchAntigravityWeeklyQuota(accessToken, projectId, proxyOptions = null) {
  const url = WEEKLY_CONFIG.quotaSummaryApiUrl;
  if (!accessToken || !url) return {};

  const key = `${accessToken}::${projectId || ""}`;
  pruneWeeklyCache();

  // Serve in-flight or cached
  const hit = weeklyCache.get(key);
  if (hit?.promise) return hit.promise;
  if (hit?.expiresAt > Date.now()) return hit.result;

  const promise = (async () => {
    try {
      const response = await fetchWithTimeout(url, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "User-Agent": WEEKLY_CONFIG.userAgent,
          "Content-Type": "application/json",
          "X-Client-Name": "antigravity",
          "X-Client-Version": ANTIGRAVITY_IDE_VERSION,
        },
        body: JSON.stringify({
          ...(projectId ? { project: projectId } : {}),
        }),
      }, 10000, proxyOptions);

      if (!response.ok) return {};

      return parseWeeklyQuotaSummary(await response.json());
    } catch {
      return {};
    }
  })();

  weeklyCache.set(key, { promise });

  const result = await promise;
  if (weeklyCache.get(key)?.promise === promise) {
    if (result && Object.keys(result).length > 0) {
      weeklyCache.set(key, { result, expiresAt: Date.now() + WEEKLY_CACHE_TTL_MS });
    } else {
      weeklyCache.delete(key);
    }
  }
  return result;
}
