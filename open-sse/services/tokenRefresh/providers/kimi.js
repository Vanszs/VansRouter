import { PROVIDERS, PROVIDER_OAUTH } from "../../../config/providers.js";
import { OAUTH_ENDPOINTS, GITHUB_COPILOT, buildKimiHeaders } from "../../../config/appConstants.js";
import { dedupRefresh } from "../dedup.js";

export async function refreshKimiToken(refreshToken, credentials, log) {
  const config = PROVIDERS.kimi;
  if (!config?.refreshUrl || !config?.clientId) {
    log?.warn?.("TOKEN_REFRESH", "No Kimi refresh URL/clientId configured");
    return null;
  }
  if (!refreshToken) return null;

  return dedupRefresh("kimi", refreshToken, async () => {
    try {
      const headers = {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        ...buildKimiHeaders(credentials?.providerSpecificData?.deviceId),
      };
      const response = await fetch(config.refreshUrl, {
        method: "POST",
        headers,
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
          client_id: config.clientId,
        }),
      });
      if (!response.ok) {
        const errorText = await response.text();
        log?.error?.("TOKEN_REFRESH", `Failed to refresh token for kimi`, {
          status: response.status,
          error: errorText,
        });
        return null;
      }
      const tokens = await response.json();
      return {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || refreshToken,
        expiresIn: tokens.expires_in,
      };
    } catch (error) {
      log?.error?.("TOKEN_REFRESH", `Error refreshing token for kimi`, { error: error.message });
      return null;
    }
  }, log);
}
