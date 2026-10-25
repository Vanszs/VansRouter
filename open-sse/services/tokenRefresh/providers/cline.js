import { PROVIDERS, PROVIDER_OAUTH } from "../../../config/providers.js";
import { dedupRefresh } from "../dedup.js";

export async function refreshClineToken(refreshToken, log) {
  if (!refreshToken) return null;

  return dedupRefresh("cline", refreshToken, async () => {
    try {
      const response = await fetch(PROVIDERS.cline?.refreshUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          refreshToken,
          grantType: "refresh_token",
          clientType: "extension",
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        log?.error?.("TOKEN_REFRESH", "Failed to refresh Cline token", {
          status: response.status,
          error: errorText,
        });
        return null;
      }

      const body = await response.json();
      const tokens = body?.data || body;
      if (!tokens?.accessToken) return null;

      const expiresIn = tokens.expiresAt
        ? Math.max(1, Math.floor((new Date(tokens.expiresAt).getTime() - Date.now()) / 1000))
        : (tokens.expiresIn || tokens.expires_in || 3600);

      return {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken || refreshToken,
        expiresIn,
      };
    } catch (error) {
      log?.error?.("TOKEN_REFRESH", `Error refreshing Cline token: ${error.message}`);
      return null;
    }
  }, log);
}
