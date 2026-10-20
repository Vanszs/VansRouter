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
import { handleSystemoneCore } from "open-sse/handlers/systemoneCore.js";
import { errorResponse, unavailableResponse } from "open-sse/utils/error.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import * as log from "../utils/logger.js";
import { checkAndRefreshToken, updateProviderCredentials } from "../services/tokenRefresh.js";
import { saveRequestUsage } from "@/lib/usageDb.js";

/**
 * Handle System One (Jev) decision requests for the Next.js server.
 * Follows the auth + account-fallback pattern of handleEmbeddings / handleChat.
 *
 * @param {Request} request
 */
export async function handleSystemone(request) {
  const { body, error } = await readBoundedJson(request);
  if (error) {
    log.warn("SYSTEMONE", "Invalid JSON body");
    return error;
  }

  const url = new URL(request.url);
  const modelStr = body?.model;

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
    log.warn("SYSTEMONE", "Missing model");
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing model");
  }

  if (!isKindAllowed(apiKeyInfo, "systemone")) {
    log.warn("AUTH", "System One kind not allowed for API key");
    return errorResponse(HTTP_STATUS.FORBIDDEN, "System One requests are not allowed for this API key");
  }

  if (body.state === undefined || body.state === null) {
    log.warn("SYSTEMONE", "Missing state");
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing required field: state");
  }
  if (!body.questions || typeof body.questions !== "object" || Array.isArray(body.questions)) {
    log.warn("SYSTEMONE", "Missing questions");
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing required field: questions");
  }

  const modelInfo = await getModelInfo(modelStr);
  if (!modelInfo.provider) {
    log.warn("SYSTEMONE", "Invalid model format", { model: modelStr });
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid model format");
  }

  const { provider, model } = modelInfo;

  if (!(await isProviderAllowed(apiKeyInfo, provider))) {
    log.warn("AUTH", `Provider "${provider}" not allowed for API key`, { provider });
    return errorResponse(HTTP_STATUS.FORBIDDEN, `Provider "${provider}" is not allowed for this API key`);
  }

  const resolvedModelStr = `${provider}/${model}`;
  const candidates = [resolvedModelStr];
  if (model.startsWith(`${provider}/`)) {
    candidates.push(`${provider}/${model.slice(provider.length + 1)}`);
  }
  if (modelStr !== resolvedModelStr && !candidates.includes(modelStr)) {
    candidates.push(modelStr);
  }
  let isAllowed = false;
  for (const c of candidates) {
    if (await isModelAllowed(c, apiKeyInfo)) {
      isAllowed = true;
      break;
    }
  }
  if (!isAllowed) {
    log.warn("SYSTEMONE", `Model not in available models list`, { model: resolvedModelStr, candidates });
    return errorResponse(
      HTTP_STATUS.NOT_FOUND,
      `Model "${candidates[candidates.length - 1]}" is not available. Only models listed in /v1/models can be used.`
    );
  }

  if (modelStr !== `${provider}/${model}`) {
    log.info("ROUTING", `${modelStr} → ${provider}/${model}`);
  } else {
    log.info("ROUTING", `Provider: ${provider}, Model: ${model}`);
  }

  const circuitBreakerEnabled = settings.circuitBreakerEnabled !== false && settings.circuitBreakerEnabled !== 0;
  if (circuitBreakerEnabled && isProviderFullyBlocked(provider)) {
    const cooldownMs = getProviderShortestCooldownMs(provider);
    const retryAfterSec = Math.ceil(cooldownMs / 1000) || 30;
    const retryAfterTimestamp = new Date(Date.now() + cooldownMs).toISOString();
    log.warn("GATE", `${provider} circuit breaker OPEN — short-circuiting systemone before credential lookup`);
    return unavailableResponse(
      HTTP_STATUS.SERVICE_UNAVAILABLE,
      `[${provider}/${model}] Provider temporarily unavailable (circuit breaker open)`,
      retryAfterTimestamp,
      `${retryAfterSec}s`
    );
  }

  const excludeConnectionIds = new Set();
  let lastError = null;
  let lastStatus = null;

  while (true) {
    const credentials = await getProviderCredentials(provider, excludeConnectionIds, model);

    if (!credentials || credentials.allRateLimited) {
      if (credentials?.allRateLimited) {
        const errorMsg = lastError || credentials.lastError || "Unavailable";
        const status = lastStatus || Number(credentials.lastErrorCode) || HTTP_STATUS.SERVICE_UNAVAILABLE;
        log.warn("SYSTEMONE", `[${provider}/${model}] ${errorMsg} (${credentials.retryAfterHuman})`);
        return unavailableResponse(
          status,
          `[${provider}/${model}] ${errorMsg}`,
          credentials.retryAfter,
          credentials.retryAfterHuman
        );
      }
      if (excludeConnectionIds.size === 0) {
        log.error("AUTH", `No credentials for provider: ${provider}`);
        return errorResponse(HTTP_STATUS.BAD_REQUEST, `No credentials for provider: ${provider}`);
      }
      log.warn("SYSTEMONE", "No more accounts available", { provider });
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

    const result = await handleSystemoneCore({
      body,
      modelInfo: { provider, model },
      credentials: refreshedCredentials,
      log,
      onCredentialsRefreshed: async (newCreds) => {
        await updateProviderCredentials(credentials.connectionId, {
          ...newCreds,
          existingProviderSpecificData: credentials.providerSpecificData,
          testStatus: "active",
        });
      },
      onRequestSuccess: async () => {
        await clearAccountError(credentials.connectionId, credentials, model);
      },
    });

    if (result.success) {
      if (result.usage) {
        saveRequestUsage({
          provider,
          model,
          connectionId: credentials.connectionId,
          apiKey,
          endpoint: url.pathname,
          tokens: {
            ...result.usage,
            total_tokens:
              (result.usage.prompt_tokens ?? result.usage.input_tokens ?? 0) +
              (result.usage.completion_tokens ?? result.usage.output_tokens ?? 0),
          },
          status: "success",
        }).catch(() => {});
      }
      return result.response;
    }

    const { shouldFallback } = await markAccountUnavailable(
      credentials.connectionId,
      result.status,
      result.error,
      provider,
      model,
      null,
      { disableLock: !circuitBreakerEnabled }
    );

    if (circuitBreakerEnabled) {
      recordProviderFailure(
        provider,
        result.status,
        result.error,
        log,
        credentials.connectionId,
        getProxyHash(credentials.providerSpecificData || {})
      );
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
