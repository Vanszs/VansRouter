import {
  extractApiKey, isValidApiKey,
  getProviderCredentials, markAccountUnavailable, clearAccountError,
  isProviderAllowed, isKindAllowed, isTrustedInternalRequest,
} from "../services/auth.js";
import { isModelAllowed } from "../services/allowedModels.js";
import { getSettings, getCustomModels } from "@/lib/localDb";
import { getModelInfo } from "../services/model.js";
import { handleSttCore } from "open-sse/handlers/sttCore.js";
import { errorResponse, unavailableResponse } from "open-sse/utils/error.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import { AI_PROVIDERS } from "@/shared/constants/providers";
import * as log from "../utils/logger.js";
import { checkAndRefreshToken } from "../services/tokenRefresh.js";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy.js";

// Providers requiring credentials for STT
const CREDENTIALED_PROVIDERS = new Set(
  Object.entries(AI_PROVIDERS)
    .filter(([, p]) => p.serviceKinds?.includes("stt") && !p.noAuth && p.sttConfig?.authType !== "none")
    .map(([id]) => id)
);

// Custom-model transport marker: models registered through
// /api/models/custom may pin a specialized STT transport (e.g.
// "gemini-live"). The engine dispatches on the marker itself, so the app
// layer only resolves it — same getModelInfo-style provider+model pairing,
// restricted to type "stt" records.
async function resolveCustomModelTransport(provider, model) {
  try {
    const customModels = await getCustomModels();
    const hit = customModels.find((c) => c && c.type === "stt"
      && c.providerAlias === provider && c.id === model
      && typeof c.transport === "string" && c.transport.trim());
    return hit ? hit.transport.trim() : null;
  } catch {
    return null; // DB unreadable → built-in registry marker still applies
  }
}

export async function handleStt(request) {
  let formData;
  try {
    formData = await request.formData();
  } catch {
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid multipart form data");
  }

  const modelStr = formData.get("model");
  log.request("POST", `/v1/audio/transcriptions | ${modelStr}`);

  const settings = await getSettings();
  let apiKeyInfo = null;
  const trustedInternal = await isTrustedInternalRequest(request);
  if (!trustedInternal && settings.requireApiKey) {
    const apiKey = extractApiKey(request);
    if (!apiKey) return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Missing API key");
    apiKeyInfo = await isValidApiKey(apiKey);
    if (!apiKeyInfo) return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Invalid API key");
  }

  if (!modelStr) return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing model");

  // ACL: check if STT kind is allowed for this API key
  if (!isKindAllowed(apiKeyInfo, "stt")) {
    log.warn("AUTH", "STT kind not allowed for API key");
    return errorResponse(HTTP_STATUS.FORBIDDEN, "STT requests are not allowed for this API key");
  }

  if (!formData.get("file")) return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing required field: file");

  const modelInfo = await getModelInfo(modelStr);
  if (!modelInfo.provider) return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid model format");

  const { provider, model } = modelInfo;
  if (provider === "codex" && model !== "transcribe") return errorResponse(400, "Use model cx/transcribe for Codex STT");

  // ACL: check if provider is allowed for this API key
  if (!(await isProviderAllowed(apiKeyInfo, provider))) {
    log.warn("AUTH", `Provider "${provider}" not allowed for API key`, { provider });
    return errorResponse(HTTP_STATUS.FORBIDDEN, `Provider "${provider}" is not allowed for this API key`);
  }

  // ACL: check if model is in available models list
  const resolvedModelStr = `${provider}/${model}`;
  const isAllowed = (modelStr === resolvedModelStr)
    ? await isModelAllowed(resolvedModelStr, apiKeyInfo)
    : (await isModelAllowed(modelStr, apiKeyInfo) || await isModelAllowed(resolvedModelStr, apiKeyInfo));
  if (!isAllowed) {
    log.warn("STT", `Model not in available models list`, { model: resolvedModelStr });
    return errorResponse(HTTP_STATUS.NOT_FOUND, `Model "${resolvedModelStr}" is not available.`);
  }

  log.info("ROUTING", `Provider: ${provider}, Model: ${model}`);

  const modelTransport = await resolveCustomModelTransport(provider, model);

  // noAuth providers
  if (!CREDENTIALED_PROVIDERS.has(provider)) {
    const result = await handleSttCore({ provider, model, formData, sttConfig: AI_PROVIDERS[provider]?.sttConfig, transport: modelTransport });
    if (result.success) return result.response;
    return errorResponse(result.status || HTTP_STATUS.BAD_GATEWAY, result.error || "STT failed");
  }

  // Credentialed — fallback loop
  const excludeConnectionIds = new Set();
  let lastError = null;
  let lastStatus = null;

  while (true) {
    let credentials = await getProviderCredentials(provider, excludeConnectionIds, model);

    if (!credentials || credentials.allRateLimited) {
      if (credentials?.allRateLimited) {
        const msg = lastError || credentials.lastError || "Unavailable";
        const status = lastStatus || Number(credentials.lastErrorCode) || HTTP_STATUS.SERVICE_UNAVAILABLE;
        return unavailableResponse(status, `[${provider}/${model}] ${msg}`, credentials.retryAfter, credentials.retryAfterHuman);
      }
      if (excludeConnectionIds.size === 0) return errorResponse(HTTP_STATUS.BAD_REQUEST, `No credentials for provider: ${provider}`);
      return errorResponse(lastStatus || HTTP_STATUS.SERVICE_UNAVAILABLE, lastError || "All accounts unavailable");
    }

    log.info("AUTH", `\x1b[32mUsing ${provider} account: ${credentials.connectionName}\x1b[0m`);

    let result;
    try {
      const isCodex = provider === "codex";
      if (isCodex) credentials = await checkAndRefreshToken(provider, credentials);
      const proxyOptions = isCodex
        ? await resolveConnectionProxyConfig(credentials._connection?.providerSpecificData || credentials.providerSpecificData)
        : undefined;
      const args = { provider, model, formData, credentials, sttConfig: AI_PROVIDERS[provider]?.sttConfig, transport: modelTransport, signal: request.signal, proxyOptions };
      result = await handleSttCore(args);
      if (isCodex && result.status === 401 && credentials.refreshToken && !request.signal.aborted) {
        const previous = credentials.accessToken;
        credentials = await checkAndRefreshToken(provider, credentials, { force: true });
        if (credentials.accessToken !== previous) result = await handleSttCore({ ...args, credentials });
      }
      if (result.success) {
        if (isCodex) await clearAccountError(credentials.connectionId, credentials, model);
        return result.response;
      }
    } catch {
      return errorResponse(HTTP_STATUS.BAD_GATEWAY, "STT credential or transport failure");
    }

    if (request.signal.aborted) return errorResponse(504, "Transcription cancelled");
    // Bad audio / unsupported parameters are client errors, not broken accounts.
    if (provider === "codex" && [400, 413, 504].includes(result.status)) {
      return result.response || errorResponse(result.status, result.error);
    }

    const { shouldFallback } = await markAccountUnavailable(credentials.connectionId, result.status, result.error, provider, model);
    if (shouldFallback) {
      excludeConnectionIds.add(credentials.connectionId);
      lastError = result.error;
      lastStatus = result.status;
      continue;
    }
    return result.response || errorResponse(result.status, result.error);
  }
}
