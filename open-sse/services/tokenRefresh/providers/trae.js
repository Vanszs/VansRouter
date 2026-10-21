import { PROVIDERS, PROVIDER_OAUTH } from "../../../config/providers.js";
import { dedupRefresh } from "../dedup.js";

export async function refreshTraeToken(refreshToken, credentials, log) {
  if (!refreshToken) return null;
  const oauth = PROVIDER_OAUTH.trae || {};
  const url = oauth.exchangeTokenUrl || oauth.tokenUrl;
  if (!url) {
    log?.warn?.("TOKEN_REFRESH", "No Trae exchangeTokenUrl configured");
    return null;
  }

  return dedupRefresh("trae", refreshToken, async () => {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "User-Agent": "Trae/1.0.0 antigravity-cockpit-tools",
        },
        body: JSON.stringify({
          ClientID: oauth.clientId || "ono9krqynydwx5",
          RefreshToken: refreshToken,
          ClientSecret: oauth.clientSecret || "-",
          UserID: "",
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        log?.error?.("TOKEN_REFRESH", "Failed to refresh Trae token", {
          status: response.status,
          error: errorText,
        });
        return null;
      }

      const payload = await response.json();
      const result = payload?.Result || payload?.result || payload;
      const accessToken = result?.AccessToken || result?.accessToken;
      if (!accessToken) {
        log?.error?.("TOKEN_REFRESH", "Trae refresh returned no AccessToken", { payload });
        return null;
      }

      const newRefresh = result?.RefreshToken || result?.refreshToken || refreshToken;
      const expiresAt = result?.ExpiresAt || result?.expiresAt;
      let expiresIn;
      if (typeof expiresAt === "number") {
        expiresIn = Math.max(1, expiresAt - Math.floor(Date.now() / 1000));
      } else if (typeof expiresAt === "string") {
        const ms = new Date(expiresAt).getTime() - Date.now();
        expiresIn = ms > 0 ? Math.floor(ms / 1000) : undefined;
      }

      log?.info?.("TOKEN_REFRESH", "Successfully refreshed Trae token", {
        hasNewAccessToken: !!accessToken,
        hasNewRefreshToken: newRefresh !== refreshToken,
        expiresIn,
      });

      return {
        accessToken,
        refreshToken: newRefresh,
        expiresIn,
      };
    } catch (error) {
      log?.error?.("TOKEN_REFRESH", `Error refreshing Trae token: ${error.message}`);
      return null;
    }
  }, log);
}
