import { readBoundedJson } from "../utils/boundedBody.js";
import {
  getProviderCredentials,
  markAccountUnavailable,
  clearAccountError,
  extractApiKey,
  isValidApiKey,
  isProviderAllowed,
  isComboAllowed,
  isKindAllowed,
  isTrustedInternalRequest,
} from "../services/auth.js";
import { errorResponse, unavailableResponse } from "open-sse/utils/error.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import * as log from "../utils/logger.js";
import { updateProviderCredentials, checkAndRefreshToken } from "../services/tokenRefresh.js";
import { handleComboChat, getComboModelsFromData, stripComboPrefix } from "open-sse/services/combo.js";
import { getSettings, getCombos } from "@/lib/localDb";
import { AI_PROVIDERS, resolveProviderId } from "@/shared/constants/providers.js";
import { isModelAllowed } from "../services/allowedModels.js";
import { handleSearchCore } from "open-sse/handlers/search/index.js";

/**
 * Handle web search request for the SSE/Next.js server.
 * Provider IS the model (no model field). Mirrors handleEmbeddings auth + fallback flow.
 *
 * @param {Request} request
 */
export async function handleSearch(request) {
  const { body, error } = await readBoundedJson(request);
  if (error) {
    log.warn("SEARCH", "Invalid JSON body");
    return error;
  }

  const url = new URL(request.url);
  // Accept either `provider` or `model` (UI sends `model` since provider IS the model for webSearch)
  const providerInput = body.provider || body.model;
  const query = body.query;

  log.request("POST", `${url.pathname} | ${providerInput}`);

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

  if (!providerInput || typeof providerInput !== "string") {
    log.warn("SEARCH", "Missing provider/model");
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing required field: provider (or model)");
  }

  if (!isKindAllowed(apiKeyInfo, "webSearch")) {
    log.warn("AUTH", "Web search kind not allowed for API key");
    return errorResponse(HTTP_STATUS.FORBIDDEN, "Web search requests are not allowed for this API key");
  }

  if (!query || typeof query !== "string" || !query.trim()) {
    log.warn("SEARCH", "Missing query");
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing required field: query");
  }

  // Combo expansion: providerInput may be a combo name → run fallback/round-robin across providers
  const combos = await getCombos();
  const comboModels = getComboModelsFromData(providerInput, combos);
  if (comboModels) {
    if (!isComboAllowed(apiKeyInfo, providerInput)) {
      return errorResponse(HTTP_STATUS.FORBIDDEN, `Combo "${providerInput}" is not allowed for this API key`);
    }
    const comboNameSearch = stripComboPrefix(providerInput);
    const comboStrategies = settings.comboStrategies || {};
    const comboStrategy = comboStrategies[comboNameSearch]?.fallbackStrategy || settings.comboStrategy || "fallback";
    const comboStickyLimit = settings.comboStickyRoundRobinLimit;
    log.info("SEARCH", `Combo "${comboNameSearch}" with ${comboModels.length} providers (strategy: ${comboStrategy}, sticky: ${comboStickyLimit})`);
    return handleComboChat({
      body,
      models: comboModels,
      handleSingleModel: (b, m) => handleSingleProviderSearch(b, m, request, apiKey, settings, apiKeyInfo),
      log,
      comboName: comboNameSearch,
      comboStrategy,
      comboStickyLimit,
      timeoutMs: comboStrategies[comboNameSearch]?.targetTimeoutMs ?? null,
      queueDepth: comboStrategies[comboNameSearch]?.queueDepth ?? null,
    });
  }

  return handleSingleProviderSearch(body, providerInput, request, apiKey, settings, apiKeyInfo);
}

async function handleSingleProviderSearch(body, providerInput, request, apiKey, settings, apiKeyInfo = null) {
  const query = body.query;
  const providerId = resolveProviderId(providerInput);
  const resolvedProvider = AI_PROVIDERS[providerId];

  if (!resolvedProvider) {
    log.warn("SEARCH", "Unknown provider", { provider: providerInput });
    return errorResponse(HTTP_STATUS.BAD_REQUEST, `Unknown provider: ${providerInput}`);
  }

  const providerConfig = resolvedProvider.searchConfig;
  const supportsSearch = !!providerConfig || !!resolvedProvider.searchViaChat;

  if (!supportsSearch) {
    log.warn("SEARCH", "Provider does not support web search", { provider: providerId });
    return errorResponse(HTTP_STATUS.BAD_REQUEST, `Provider ${providerId} does not support web search`);
  }

  if (!(await isProviderAllowed(apiKeyInfo, providerId))) {
    log.warn("AUTH", `Provider "${providerId}" not allowed for API key`, { provider: providerId });
    return errorResponse(HTTP_STATUS.FORBIDDEN, `Provider "${providerId}" is not allowed for this API key`);
  }

  const alias = AI_PROVIDERS[providerId]?.alias || providerId;
  const searchModelId = `${alias}/search`;
  if (!(await isModelAllowed(searchModelId, apiKeyInfo))) {
    log.warn("SEARCH", `Search model not in available models list`, { model: searchModelId });
    return errorResponse(HTTP_STATUS.NOT_FOUND, `Model "${searchModelId}" is not available. Only models listed in /v1/models can be used.`);
  }

  if (providerInput !== providerId) {
    log.info("ROUTING", `${providerInput} → ${providerId}`);
  } else {
    log.info("ROUTING", `Provider: ${providerId}`);
  }

  // Sanitized body forwarded to core
  const coreBody = {
    query: query.trim(),
    provider: providerId,
    max_results: body.max_results,
    search_type: body.search_type,
    country: body.country,
    language: body.language,
    time_range: body.time_range,
    offset: body.offset,
    domain_filter: body.domain_filter,
    content_options: body.content_options,
    provider_options: body.provider_options,
    exa_options: body.exa_options || body.exa || body
  };

  // No-auth providers (e.g. searxng) bypass credential lookup
  if (resolvedProvider.noAuth) {
    log.info("AUTH", `\x1b[32m${providerId} no-auth mode\x1b[0m`);
    const result = await handleSearchCore({
      body: coreBody,
      provider: resolvedProvider,
      providerConfig,
      credentials: null,
      log
    });
    if (result.success) return result.response;
    return result.response;
  }

  // Credential + fallback loop
  const excludeConnectionIds = new Set();
  let lastError = null;
  let lastStatus = null;

  // Credential fallback: some search providers reuse the API key of a related
  // chat provider (e.g. ollama-search reuses the `ollama` chat key, zai-search
  // reuses the `glm` chat key). When the search provider has no own connection,
  // fall back to the linked provider's credentials.
  const fallbackProviderId = resolvedProvider.credentialFallback;

  // Lock scope for this handler. Without it markAccountUnavailable would write
  // an account-wide `__all` lock, which on the credentialFallback path takes
  // the shared chat key (e.g. glm) offline for chat as well. Must be passed to
  // getProviderCredentials too, so the lock is read back under the same key.
  const searchLockKey = `websearch:${providerId}`;

  while (true) {
    // Provider that actually owns the connection in use — differs from
    // providerId once we fall back, and error locks must be attributed to it.
    let credentialProviderId = providerId;
    let credentials = await getProviderCredentials(providerId, excludeConnectionIds, searchLockKey);

    // Fall back to the related chat provider's credentials when this search
    // provider has none of its own (one key, chat + search).
    if (!credentials && fallbackProviderId) {
      credentials = await getProviderCredentials(fallbackProviderId, excludeConnectionIds, searchLockKey);
      if (credentials) {
        credentialProviderId = fallbackProviderId;
        log.info("AUTH", `\x1b[32m${providerId} reusing ${fallbackProviderId} credentials\x1b[0m`);
      }
    }

    if (!credentials || credentials.allRateLimited) {
      if (credentials?.allRateLimited) {
        const errorMsg = lastError || credentials.lastError || "Unavailable";
        const status = lastStatus || Number(credentials.lastErrorCode) || HTTP_STATUS.SERVICE_UNAVAILABLE;
        log.warn("SEARCH", `[${providerId}] ${errorMsg} (${credentials.retryAfterHuman})`);
        return unavailableResponse(status, `[${providerId}] ${errorMsg}`, credentials.retryAfter, credentials.retryAfterHuman);
      }
      if (excludeConnectionIds.size === 0) {
        log.error("AUTH", `No credentials for provider: ${providerId}`);
        return errorResponse(HTTP_STATUS.BAD_REQUEST, `No credentials for provider: ${providerId}`);
      }
      log.warn("SEARCH", "No more accounts available", { provider: providerId });
      return errorResponse(lastStatus || HTTP_STATUS.SERVICE_UNAVAILABLE, lastError || "All accounts unavailable");
    }

    log.info("AUTH", `\x1b[32mUsing ${providerId} account: ${credentials.connectionName}\x1b[0m`);

    const refreshedCredentials = await checkAndRefreshToken(providerId, credentials);

    const result = await handleSearchCore({
      body: coreBody,
      provider: resolvedProvider,
      providerConfig,
      credentials: refreshedCredentials,
      log,
      onCredentialsRefreshed: async (newCreds) => {
        await updateProviderCredentials(credentials.connectionId, {
          accessToken: newCreds.accessToken,
          refreshToken: newCreds.refreshToken,
          providerSpecificData: newCreds.providerSpecificData,
          testStatus: "active"
        });
      },
      onRequestSuccess: async () => {
        await clearAccountError(credentials.connectionId, credentials);
      }
    });

    if (result.success) return result.response;

    // Do NOT lock the account or trigger account fallback on 400/422 (client request validation errors)
    if (result.status === 400 || result.status === 422) {
      return result.response;
    }

    const { shouldFallback } = await markAccountUnavailable(
      credentials.connectionId,
      result.status,
      result.error,
      credentialProviderId,
      searchLockKey
    );

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
