import {
  extractApiKey, isValidApiKey,
  getProviderCredentials, markAccountUnavailable,
  isProviderAllowed, isComboAllowed, isKindAllowed,
  isTrustedInternalRequest,
} from "../services/auth.js";

import { getSettings } from "@/lib/localDb";
import { getModelInfo, getComboModels } from "../services/model.js";
import { isModelAllowed } from "../services/allowedModels.js";
import { handleTtsCore } from "open-sse/handlers/ttsCore.js";
import { errorResponse, unavailableResponse } from "open-sse/utils/error.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import { AI_PROVIDERS } from "@/shared/constants/providers";
import { handleComboChat, stripComboPrefix } from "open-sse/services/combo.js";
import * as log from "../utils/logger.js";

// Derived from providers.js: any TTS provider not noAuth requires stored credentials
const CREDENTIALED_PROVIDERS = new Set(
  Object.entries(AI_PROVIDERS).reduce((acc, [id, p]) => {
    if (p.serviceKinds?.includes("tts") && !p.noAuth && p.ttsConfig?.authType !== "none") acc.push(id);
    return acc;
  }, [])
);

export async function handleTts(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid JSON body");
  }

  const url = new URL(request.url);
  const modelStr = body.model;
  const responseFormat = url.searchParams.get("response_format") || "mp3"; // mp3 (default) | json
  const language = body.language || ""; // Optional language hint (currently used by Gemini)
  log.request("POST", `${url.pathname} | ${modelStr} | format=${responseFormat}${language ? ` | lang=${language}` : ""}`);

  const settings = await getSettings();
  let apiKeyInfo = null;
  // Trusted internal (dashboard/CLI) requests act as the local owner — bypass ACL.
  const trustedInternal = await isTrustedInternalRequest(request);
  if (!trustedInternal && settings.requireApiKey) {
    const apiKey = extractApiKey(request);
    if (!apiKey) return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Missing API key");
    apiKeyInfo = await isValidApiKey(apiKey);
    if (!apiKeyInfo) return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Invalid API key");
  }

  if (!modelStr) return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing model");
  if (!isKindAllowed(apiKeyInfo, "tts")) return errorResponse(HTTP_STATUS.FORBIDDEN, "TTS requests are not allowed for this API key");
  if (!body.input) return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing required field: input");

  // Combo expansion: model may be a combo name → run fallback/round-robin across models
  const comboModels = await getComboModels(modelStr);
  if (comboModels) {
    if (!isComboAllowed(apiKeyInfo, modelStr)) {
      return errorResponse(HTTP_STATUS.FORBIDDEN, `Combo "${modelStr}" is not allowed for this API key`);
    }
    const comboNameTts = stripComboPrefix(modelStr);
    const comboStrategies = settings.comboStrategies || {};
    const comboStrategy = comboStrategies[comboNameTts]?.fallbackStrategy || settings.comboStrategy || "fallback";
    const comboStickyLimit = settings.comboStickyRoundRobinLimit;
    log.info("TTS", `Combo "${comboNameTts}" with ${comboModels.length} models (strategy: ${comboStrategy}, sticky: ${comboStickyLimit})`);
    return handleComboChat({

      body,
      models: comboModels,
      handleSingleModel: (b, m) => handleSingleModelTts(b, m, responseFormat, language, apiKeyInfo),
      log,
      comboName: comboNameTts,
      comboStrategy,
      comboStickyLimit,
    });
  }

  return handleSingleModelTts(body, modelStr, responseFormat, language, apiKeyInfo);
}

async function handleSingleModelTts(body, modelStr, responseFormat, language, apiKeyInfo = null) {
  const modelInfo = await getModelInfo(modelStr);
  if (!modelInfo.provider) return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid model format");

  const { provider, model } = modelInfo;

  if (!isProviderAllowed(apiKeyInfo, provider)) {
    return errorResponse(HTTP_STATUS.FORBIDDEN, `Provider "${provider}" is not allowed for this API key`);
  }

  const resolvedModelStr = `${provider}/${model}`;
  const isAllowed = (modelStr === resolvedModelStr)
    ? await isModelAllowed(resolvedModelStr, apiKeyInfo)
    : (await isModelAllowed(modelStr, apiKeyInfo) || await isModelAllowed(resolvedModelStr, apiKeyInfo));
  if (!isAllowed) {
    return errorResponse(HTTP_STATUS.NOT_FOUND, `Model "${resolvedModelStr}" is not available. Only models listed in /v1/models can be used.`);
  }

  log.info("ROUTING", `Provider: ${provider}, Voice: ${model}`);

  // noAuth providers — no credential needed
  if (!CREDENTIALED_PROVIDERS.has(provider)) {
    const result = await handleTtsCore({ provider, model, input: body.input, responseFormat, language });
    if (result.success) return result.response;
    return errorResponse(result.status || HTTP_STATUS.BAD_GATEWAY, result.error || "TTS failed");
  }

  // Credentialed providers — fallback loop (same pattern as embeddings)
  const excludeConnectionIds = new Set();
  let lastError = null;
  let lastStatus = null;

  while (true) {
    const credentials = await getProviderCredentials(provider, excludeConnectionIds, model);

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

    const result = await handleTtsCore({ provider, model, input: body.input, credentials, responseFormat, language });

    if (result.success) return result.response;

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
