import { PROVIDERS, PROVIDER_OAUTH } from "../../../config/providers.js";
import { OAUTH_ENDPOINTS, GITHUB_COPILOT, buildKimiHeaders } from "../../../config/appConstants.js";
import { dedupRefresh } from "../dedup.js";

export async function refreshGitHubToken(refreshToken, log) {
  if (!refreshToken) return null;
  return dedupRefresh("github", refreshToken, async () => {
  const params = {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: PROVIDERS.github.clientId,
  };
  if (PROVIDERS.github.clientSecret) {
    params.client_secret = PROVIDERS.github.clientSecret;
  }

  const response = await fetch(OAUTH_ENDPOINTS.github.token, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams(params),
  });

  if (!response.ok) {
    const errorText = await response.text();
    log?.error?.("TOKEN_REFRESH", "Failed to refresh GitHub token", {
      status: response.status,
      error: errorText,
    });
    return null;
  }

  const tokens = await response.json();

  log?.info?.("TOKEN_REFRESH", "Successfully refreshed GitHub token", {
    hasNewAccessToken: !!tokens.access_token,
    hasNewRefreshToken: !!tokens.refresh_token,
    expiresIn: tokens.expires_in,
  });

  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token || refreshToken,
    expiresIn: tokens.expires_in,
  };
  }, log);
}
