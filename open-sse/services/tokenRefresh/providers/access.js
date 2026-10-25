import { PROVIDERS, PROVIDER_OAUTH } from "../../../config/providers.js";
import { dedupRefresh } from "../dedup.js";

export async function refreshAccessToken(provider, refreshToken, credentials, log) {
  const config = PROVIDERS[provider];

  if (!config || !config.refreshUrl) {
    log?.warn?.("TOKEN_REFRESH", `No refresh URL configured for provider: ${provider}`);
    return null;
  }

  if (!refreshToken) {
    log?.warn?.("TOKEN_REFRESH", `No refresh token available for provider: ${provider}`);
    return null;
  }

  return dedupRefresh(provider, refreshToken, async () => {
  try {
    // config values come from the registry; gitlab-style providers store the
    // OAuth client per credential in providerSpecificData instead
    const params = {
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    };
    const clientId = config.clientId ?? credentials?.providerSpecificData?.clientId;
    if (clientId !== undefined) params.client_id = clientId;
    const clientSecret = config.clientSecret ?? credentials?.providerSpecificData?.clientSecret;
    if (clientSecret !== undefined) params.client_secret = clientSecret;

    const response = await fetch(config.refreshUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams(params),
    });

    if (!response.ok) {
      const errorText = await response.text();
      log?.error?.("TOKEN_REFRESH", `Failed to refresh token for ${provider}`, {
        status: response.status,
        error: errorText,
      });
      return null;
    }

    const tokens = await response.json();

    log?.info?.("TOKEN_REFRESH", `Successfully refreshed token for ${provider}`, {
      hasNewAccessToken: !!tokens.access_token,
      hasNewRefreshToken: !!tokens.refresh_token,
      expiresIn: tokens.expires_in,
    });

    return {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token || refreshToken,
      expiresIn: tokens.expires_in,
    };
  } catch (error) {
    log?.error?.("TOKEN_REFRESH", `Error refreshing token for ${provider}`, {
      error: error.message,
    });
    return null;
  }
  }, log);
}
