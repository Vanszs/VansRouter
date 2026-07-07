import { createProviderConnection } from "../../../models/index.js";
import { KiroService } from "./kiro.js";

function formatSocialProvider(provider) {
  return provider.charAt(0).toUpperCase() + provider.slice(1);
}

function buildExpiresAt(expiresIn) {
  const ttlSeconds = Number.isFinite(Number(expiresIn)) ? Number(expiresIn) : 3600;
  return new Date(Date.now() + ttlSeconds * 1000).toISOString();
}

export async function saveKiroOAuthConnection({
  accessToken,
  refreshToken,
  expiresIn,
  profileArn,
  authMethod,
  providerLabel,
  idcData = null,
}) {
  const kiroService = new KiroService();
  const email = kiroService.extractEmailFromJWT(accessToken);

  const providerSpecificData = {
    profileArn,
    authMethod,
    provider: providerLabel,
  };

  if (idcData) {
    providerSpecificData.clientId = idcData.clientId;
    providerSpecificData.clientSecret = idcData.clientSecret;
    providerSpecificData.region = idcData.region || "us-east-1";
  }

  const connection = await createProviderConnection({
    provider: "kiro",
    authType: "oauth",
    accessToken,
    refreshToken,
    expiresAt: buildExpiresAt(expiresIn),
    email: email || null,
    providerSpecificData,
    testStatus: "active",
  });

  return {
    id: connection.id,
    provider: connection.provider,
    email: connection.email,
  };
}

export async function exchangeAndSaveKiroSocialConnection({
  code,
  codeVerifier,
  provider = "google",
}) {
  if (!code || !codeVerifier) {
    throw new Error("Missing required social exchange fields");
  }
  if (!["google", "github"].includes(provider)) {
    throw new Error("Invalid provider");
  }

  const kiroService = new KiroService();
  const tokenData = await kiroService.exchangeSocialCode(code, codeVerifier);

  const connection = await saveKiroOAuthConnection({
    accessToken: tokenData.accessToken,
    refreshToken: tokenData.refreshToken,
    expiresIn: tokenData.expiresIn,
    profileArn: tokenData.profileArn,
    authMethod: provider,
    providerLabel: formatSocialProvider(provider),
  });

  return {
    connection,
    tokenData,
  };
}

export async function validateAndSaveKiroImportedToken(refreshToken, idcOptions = null) {
  const kiroService = new KiroService();
  const isIdc = !!(idcOptions?.clientId && idcOptions?.clientSecret);

  const providerSpecificData = isIdc
    ? { clientId: idcOptions.clientId, clientSecret: idcOptions.clientSecret, region: idcOptions.region || "us-east-1", authMethod: "idc" }
    : {};

  const tokenData = isIdc
    ? await kiroService.refreshToken(refreshToken, providerSpecificData)
    : await kiroService.validateImportToken(refreshToken);

  const connection = await saveKiroOAuthConnection({
    accessToken: tokenData.accessToken,
    refreshToken: tokenData.refreshToken || refreshToken,
    expiresIn: tokenData.expiresIn,
    profileArn: idcOptions?.profileArn || tokenData.profileArn,
    authMethod: isIdc ? "idc" : "imported",
    providerLabel: isIdc ? "Enterprise" : "Imported",
    idcData: isIdc ? providerSpecificData : null,
  });

  return {
    connection,
    tokenData,
  };
}
