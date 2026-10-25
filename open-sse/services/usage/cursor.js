import { proxyAwareFetch } from "../../utils/proxyFetch.js";
import { buildCursorHeaders } from "../../utils/cursorChecksum.js";
import { U, parseResetTime, toFiniteNumber } from "./shared.js";

const CURSOR_USAGE = U("cursor");

function centsToUsd(cents) {
  return Number((toFiniteNumber(cents, 0) / 100).toFixed(2));
}

function remainingFromPercentUsed(percentUsed) {
  return Math.max(0, 100 - Math.max(0, Math.min(100, toFiniteNumber(percentUsed, 0))));
}

function connectHeaders(accessToken, machineId) {
  return {
    ...buildCursorHeaders(accessToken, machineId, true),
    "content-type": "application/json",
    accept: "application/json",
  };
}

async function postConnectJson(url, accessToken, machineId, proxyOptions) {
  return proxyAwareFetch(url, {
    method: "POST",
    headers: connectHeaders(accessToken, machineId),
    body: "{}",
  }, proxyOptions);
}

async function getAuthUsage(url, token, proxyOptions) {
  return proxyAwareFetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${token.includes("::") ? token.split("::")[1] : token}`, Accept: "application/json" },
  }, proxyOptions);
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function addPlanQuotas(quotas, data) {
  const usage = data?.planUsage;
  if (!usage || typeof usage !== "object") return false;

  const limit = toFiniteNumber(usage.limit, 0);
  const used = toFiniteNumber(usage.includedSpend ?? usage.totalSpend, 0);
  const remaining = toFiniteNumber(usage.remaining, Math.max(0, limit - used));
  const resetAt = parseResetTime(data.billingCycleEnd);
  if (limit > 0) {
    const totalUsd = centsToUsd(limit);
    const usedUsd = centsToUsd(used);
    const remainingUsd = centsToUsd(remaining);
    quotas["Plan (USD)"] = {
      used: usedUsd,
      total: totalUsd,
      remainingPercentage: usage.totalPercentUsed != null
        ? remainingFromPercentUsed(usage.totalPercentUsed)
        : totalUsd > 0 ? remainingUsd / totalUsd * 100 : 0,
      resetAt,
    };
  } else if (usage.totalPercentUsed != null) {
    const percentUsed = toFiniteNumber(usage.totalPercentUsed, 0);
    quotas["Included usage"] = { used: percentUsed, total: 100, remainingPercentage: remainingFromPercentUsed(percentUsed), resetAt };
  }
  for (const [field, label] of [["autoPercentUsed", "Auto models (%)"], ["apiPercentUsed", "Named models (%)"]]) {
    if (usage[field] == null) continue;
    const percentUsed = toFiniteNumber(usage[field], 0);
    quotas[label] = { used: percentUsed, total: 100, remainingPercentage: remainingFromPercentUsed(percentUsed), resetAt };
  }
  return Object.keys(quotas).length > 0;
}

function addOnDemandQuota(quotas, data) {
  const spend = data?.spendLimitUsage;
  if (!spend || typeof spend !== "object") return;
  const resetAt = parseResetTime(data.billingCycleEnd);
  const individualLimit = toFiniteNumber(spend.individualLimit, 0);
  const pooledLimit = toFiniteNumber(spend.pooledLimit, 0);
  if (individualLimit > 0) {
    const used = centsToUsd(spend.individualUsed);
    const total = centsToUsd(individualLimit);
    const remaining = centsToUsd(spend.individualRemaining ?? Math.max(0, individualLimit - toFiniteNumber(spend.individualUsed, 0)));
    quotas["On-demand (USD)"] = { used, total, remainingPercentage: total > 0 ? remaining / total * 100 : 0, resetAt };
    return;
  }
  if (pooledLimit > 0) {
    const used = centsToUsd(spend.pooledUsed);
    const total = centsToUsd(pooledLimit);
    const remaining = centsToUsd(spend.pooledRemaining ?? Math.max(0, pooledLimit - toFiniteNumber(spend.pooledUsed, 0)));
    quotas["Team on-demand (USD)"] = { used, total, remainingPercentage: total > 0 ? remaining / total * 100 : 0, resetAt };
  }
}

function addRequestQuotas(quotas, data) {
  if (!data || typeof data !== "object") return false;
  const resetAt = parseResetTime(data.startOfMonth);
  let added = false;
  for (const [name, bucket] of Object.entries(data)) {
    if (!bucket || typeof bucket !== "object" || Array.isArray(bucket)) continue;
    const total = toFiniteNumber(bucket.maxRequestUsage, 0);
    if (total <= 0) continue;
    const used = toFiniteNumber(bucket.numRequests, 0);
    quotas[`${name} requests`] = { used, total, remainingPercentage: Math.max(0, (total - used) / total * 100), resetAt };
    added = true;
  }
  return added;
}

export async function getCursorUsage(accessToken, providerSpecificData = {}, proxyOptions = null) {
  if (typeof accessToken !== "string" || !accessToken.trim()) {
    return { message: "Cursor access token not available. Reconnect Cursor to view quota." };
  }
  const token = accessToken.trim();
  const machineId = providerSpecificData?.machineId || null;
  if (!CURSOR_USAGE.url) return { message: "Cursor usage endpoint is not configured." };
  try {
    const periodResponse = await postConnectJson(CURSOR_USAGE.url, token, machineId, proxyOptions);
    if (periodResponse.status === 401 || periodResponse.status === 403) {
      return { plan: "Cursor", message: "Cursor authentication failed. Reconnect the Cursor provider." };
    }

    const quotas = {};
    let periodData = null;
    if (periodResponse.ok) {
      periodData = await readJson(periodResponse);
      addPlanQuotas(quotas, periodData);
      addOnDemandQuota(quotas, periodData);
    }

    if (!periodResponse.ok && CURSOR_USAGE.authUsageUrl) {
      const response = await getAuthUsage(CURSOR_USAGE.authUsageUrl, token, proxyOptions);
      if (response.ok) addRequestQuotas(quotas, await readJson(response));
      else {
        const errorText = await periodResponse.text().catch(() => "");
        return { plan: "Cursor", message: `Cursor usage API error (${periodResponse.status})${errorText ? `: ${errorText.slice(0, 120)}` : ""}` };
      }
    }

    if (!Object.keys(quotas).length) {
      return { plan: "Cursor", message: periodData?.displayMessage || "Cursor connected. No quota data returned for this plan." };
    }

    let plan = "Cursor";
    if (CURSOR_USAGE.planInfoUrl) {
      const planResponse = await postConnectJson(CURSOR_USAGE.planInfoUrl, token, machineId, proxyOptions).catch(() => null);
      if (planResponse?.ok) {
        const planName = (await readJson(planResponse))?.planInfo?.planName;
        if (typeof planName === "string" && planName.trim()) plan = `Cursor ${planName.trim()}`;
      }
    }
    return { plan, quotas };
  } catch (error) {
    return { message: `Cursor error: ${error.message}` };
  }
}

export default getCursorUsage;
