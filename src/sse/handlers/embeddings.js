import { readBoundedJson } from "../utils/boundedBody.js";
import {
  getProviderCredentials,
  markAccountUnavailable,
  clearAccountError,
  extractApiKey,
  isValidApiKey,
  isProviderAllowed,
  isKindAllowed,
  isTrustedInternalRequest,
} from "../services/auth.js";
import {
  isProviderFullyBlocked,
  getProviderShortestCooldownMs,
  isProviderInCooldown,
  recordProviderFailure,
} from "open-sse/services/accountFallback.js";
import { getProxyHash } from "@/lib/network/connectionProxy";
import { getSettings } from "@/lib/localDb";
import { getModelInfo } from "../services/model.js";
import { isModelAllowed } from "../services/allowedModels.js";
import { handleEmbeddingsCore } from "open-sse/handlers/embeddingsCore.js";
import { errorResponse, unavailableResponse } from "open-sse/utils/error.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import * as log from "../utils/logger.js";
import { updateProviderCredentials, checkAndRefreshToken } from "../services/tokenRefresh.js";
import { saveRequestUsage } from "@/lib/usageDb.js";

function exactEmbeddingUsage(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || raw.estimated === true) return null;
  const promptTokens = raw.prompt_tokens ?? raw.input_tokens;
  const completionTokens = raw.completion_tokens ?? raw.output_tokens ?? 0;
  const totalTokens = raw.total_tokens;
  if (!Number.isSafeInteger(promptTokens) || promptTokens <= 0 || completionTokens !== 0 || totalTokens !== promptTokens) return null;
  return { prompt_tokens: promptTokens, completion_tokens: 0, total_tokens: totalTokens };
}

/**
 * Handle embeddings request for the SSE/Next.js server.
 * Follows the same auth + fallback pattern as handleChat.
 *
 * @param {Request} request
 */
export async function handleEmbeddings(request) {
  const { body, error } = await readBoundedJson(request);
  if (error) {
    log.warn("EMBEDDINGS", "Invalid JSON body");
    return error;
  }

  const url = new URL(request.url);
  const modelStr = body.model;

  log.request("POST", `${url.pathname} | ${modelStr}`);

  // Log API key (masked)
  const apiKey = extractApiKey(request);
  if (apiKey) {
    log.debug("AUTH", `API Key: ${log.maskKey(apiKey)}`);
  } else {
    log.debug("AUTH", "No API key provided (local mode)");
  }

  // Enforce API key if enabled in settings
  const settings = await getSettings();
  let apiKeyInfo = null;
  // Trusted internal (dashboard/CLI) requests act as the local owner — bypass ACL.
  const trustedInternal = await isTrustedInternalRequest(request);
  if (!trustedInternal && settings.requireApiKey) {
    if (!apiKey) {
      log.warn("AUTH", "Missing API key (requireApiKey=true)");
      return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Missing API key");
    }
    apiKeyInfo = await isValidApiKey(apiKey);
    if (!apiKeyInfo) {
      log.warn("AUTH", "Invalid API key (requireApiKey=true)");
      return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Invalid API key");
    }
  }

  if (!modelStr) {
    log.warn("EMBEDDINGS", "Missing model");
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing model");
  }

  if (!isKindAllowed(apiKeyInfo, "embedding")) {
    log.warn("AUTH", "Embedding kind not allowed for API key");
    return errorResponse(HTTP_STATUS.FORBIDDEN, "Embedding requests are not allowed for this API key");
  }

  if (!body.input) {
    log.warn("EMBEDDINGS", "Missing input");
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing required field: input");
  }

  const modelInfo = await getModelInfo(modelStr);
  if (!modelInfo.provider) {
    log.warn("EMBEDDINGS", "Invalid model format", { model: modelStr });
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid model format");
  }

  const { provider, model } = modelInfo;

  if (!(await isProviderAllowed(apiKeyInfo, provider))) {
    log.warn("AUTH", `Provider "${provider}" not allowed for API key`, { provider });
    return errorResponse(HTTP_STATUS.FORBIDDEN, `Provider "${provider}" is not allowed for this API key`);
  }

  // Normalize model name: handle double-prefix (e.g. "nvidia/nvidia/nv-embedqa-e5-v5" → also try "nvidia/nv-embedqa-e5-v5")
  const resolvedModelStr = `${provider}/${model}`;
  const candidates = [resolvedModelStr];
  if (model.startsWith(`${provider}/`)) {
    // User sent "provider/provider/model" — the listed form is "provider/model"
    candidates.push(`${provider}/${model.slice(provider.length + 1)}`);
  }
  if (modelStr !== resolvedModelStr && !candidates.includes(modelStr)) {
    candidates.push(modelStr);
  }
  let isAllowed = false;
  for (const c of candidates) {
    if (await isModelAllowed(c, apiKeyInfo)) { isAllowed = true; break; }
  }
  if (!isAllowed) {
    log.warn("EMBEDDINGS", `Model not in available models list`, { model: resolvedModelStr, candidates });
    return errorResponse(HTTP_STATUS.NOT_FOUND, `Model "${candidates[candidates.length - 1]}" is not available. Only models listed in /v1/models can be used.`);
  }

  if (modelStr !== `${provider}/${model}`) {
    log.info("ROUTING", `${modelStr} → ${provider}/${model}`);
  } else {
    log.info("ROUTING", `Provider: ${provider}, Model: ${model}`);
  }

  // Circuit-breaker toggle (mirrors handleChat). When disabled, skip the
  // provider-level short-circuit so embeddings honor the same toggle as chat.
  const circuitBreakerEnabled = settings.circuitBreakerEnabled !== false && settings.circuitBreakerEnabled !== 0;
  if (circuitBreakerEnabled && isProviderFullyBlocked(provider)) {
    const cooldownMs = getProviderShortestCooldownMs(provider);
    const retryAfterSec = Math.ceil(cooldownMs / 1000) || 30;
    const retryAfterTimestamp = new Date(Date.now() + cooldownMs).toISOString();
    log.warn("GATE", `${provider} circuit breaker OPEN — short-circuiting embeddings before credential lookup`);
    return unavailableResponse(
      HTTP_STATUS.SERVICE_UNAVAILABLE,
      `[${provider}/${model}] Provider temporarily unavailable (circuit breaker open)`,
      retryAfterTimestamp,
      `${retryAfterSec}s`
    );
  }

  // Credential + fallback loop (mirrors handleChat)
  const excludeConnectionIds = new Set();
  let lastError = null;
  let lastStatus = null;

  while (true) {
    const credentials = await getProviderCredentials(provider, excludeConnectionIds, model);

    // All accounts unavailable
    if (!credentials || credentials.allRateLimited) {
      if (credentials?.allRateLimited) {
        const errorMsg = lastError || credentials.lastError || "Unavailable";
        const status = lastStatus || Number(credentials.lastErrorCode) || HTTP_STATUS.SERVICE_UNAVAILABLE;
        log.warn("EMBEDDINGS", `[${provider}/${model}] ${errorMsg} (${credentials.retryAfterHuman})`);
        return unavailableResponse(status, `[${provider}/${model}] ${errorMsg}`, credentials.retryAfter, credentials.retryAfterHuman);
      }
      if (excludeConnectionIds.size === 0) {
        log.error("AUTH", `No credentials for provider: ${provider}`);
        return errorResponse(HTTP_STATUS.BAD_REQUEST, `No credentials for provider: ${provider}`);
      }
      log.warn("EMBEDDINGS", "No more accounts available", { provider });
      return errorResponse(lastStatus || HTTP_STATUS.SERVICE_UNAVAILABLE, lastError || "All accounts unavailable");
    }

    log.info("AUTH", `\x1b[32mUsing ${provider} account: ${credentials.connectionName}\x1b[0m`);

    const refreshedCredentials = await checkAndRefreshToken(provider, credentials);

    if (circuitBreakerEnabled) {
      const proxyHash = getProxyHash(credentials.providerSpecificData || {});
      if (isProviderInCooldown(provider, proxyHash)) {
        log.warn("AUTH", `${provider} proxy bucket ${proxyHash} circuit breaker OPEN — skipping account ${credentials.connectionName}`);
        excludeConnectionIds.add(credentials.connectionId);
        lastError = "Provider temporarily unavailable (circuit breaker open)";
        lastStatus = HTTP_STATUS.SERVICE_UNAVAILABLE;
        continue;
      }
    }

    const result = await handleEmbeddingsCore({
      body: { ...body, model: `${provider}/${model}` },
      modelInfo: { provider, model },
      credentials: refreshedCredentials,
      log,
      onCredentialsRefreshed: async (newCreds) => {
        await updateProviderCredentials(credentials.connectionId, {
          ...newCreds,
          existingProviderSpecificData: credentials.providerSpecificData,
          testStatus: "active"
        });
      },
      onRequestSuccess: async () => {
        await clearAccountError(credentials.connectionId, credentials, model);
      }
    });

    if (result.success) {
      const usage = exactEmbeddingUsage(result.usage);
      if (usage) {
        saveRequestUsage({
          provider,
          model,
          connectionId: credentials.connectionId,
          apiKey,
          endpoint: url.pathname,
          tokens: usage,
          status: "success",
        }).catch(() => {});
      }
      return result.response;
    }

    const { shouldFallback } = await markAccountUnavailable(credentials.connectionId, result.status, result.error, provider, model, null, { disableLock: !circuitBreakerEnabled });

    if (circuitBreakerEnabled) {
      recordProviderFailure(provider, result.status, result.error, log, credentials.connectionId, getProxyHash(credentials.providerSpecificData || {}));
    }

    if (shouldFallback) {
      log.warn("AUTH", `Account ${credentials.connectionName} unavailable (${result.status}), trying fallback`);
      excludeConnectionIds.add(credentials.connectionId);
      lastError = result.error;
      lastStatus = result.status;
      continue;
    }

    return result.response;
  }
}
