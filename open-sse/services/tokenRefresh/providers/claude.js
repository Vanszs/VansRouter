import { PROVIDERS, PROVIDER_OAUTH } from "../../../config/providers.js";
import { OAUTH_ENDPOINTS, GITHUB_COPILOT, buildKimiHeaders } from "../../../config/appConstants.js";
import { dedupRefresh } from "../dedup.js";

export async function refreshClaudeOAuthToken(refreshToken, log) {
  if (!refreshToken) return null;
  return dedupRefresh("claude", refreshToken, async () => {
  try {
    const response = await fetch(OAUTH_ENDPOINTS.anthropic.token, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: PROVIDERS.claude.clientId,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      log?.error?.("TOKEN_REFRESH", "Failed to refresh Claude OAuth token", { status: response.status, error: errorText });
      return null;
    }

    const tokens = await response.json();
    log?.info?.("TOKEN_REFRESH", "Successfully refreshed Claude OAuth token", { hasNewAccessToken: !!tokens.access_token, expiresIn: tokens.expires_in });
    return { accessToken: tokens.access_token, refreshToken: tokens.refresh_token || refreshToken, expiresIn: tokens.expires_in };
  } catch (error) {
    log?.error?.("TOKEN_REFRESH", `Network error refreshing Claude token: ${error.message}`);
    return null;
  }
  }, log);
}
