import { dedupRefresh } from "../dedup.js";

export async function refreshNousToken(refreshToken, log) {
  if (!refreshToken) return null;
  return dedupRefresh("nous", refreshToken, async () => {
    try {
      const tokenResponse = await fetch("https://portal.nousresearch.com/api/oauth/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
          "x-nous-refresh-token": refreshToken,
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
          client_id: "hermes-cli",
        }),
        signal: AbortSignal.timeout(30000),
      });

      if (!tokenResponse.ok) {
        const error = await tokenResponse.text().catch(() => "");
        log?.error?.("TOKEN_REFRESH", "Failed to refresh Nous token", {
          status: tokenResponse.status,
          error,
        });
        return null;
      }

      const tokenData = await tokenResponse.json();
      if (!tokenData?.access_token) {
        log?.error?.("TOKEN_REFRESH", "Nous token refresh returned no access_token");
        return null;
      }

      let agentKey = null;
      let agentKeyId = null;
      let agentKeyExpiresAt = null;
      try {
        const agentKeyResponse = await fetch("https://portal.nousresearch.com/api/oauth/agent-key", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            Authorization: `Bearer ${tokenData.access_token}`,
          },
          body: JSON.stringify({
            min_ttl_seconds: 7200,
          }),
          signal: AbortSignal.timeout(15000),
        });

        if (agentKeyResponse.ok) {
          const agentKeyData = await agentKeyResponse.json();
          agentKey = agentKeyData.api_key || null;
          agentKeyId = agentKeyData.key_id || null;
          agentKeyExpiresAt = agentKeyData.expires_at || null;
          log?.info?.("TOKEN_REFRESH", "Nous agent key minted successfully");
        } else {
          const error = await agentKeyResponse.text().catch(() => "");
          log?.warn?.("TOKEN_REFRESH", "Failed to mint Nous agent key, falling back to access_token", { error });
        }
      } catch (mintErr) {
        log?.warn?.("TOKEN_REFRESH", `Nous agent key mint error: ${mintErr?.message || mintErr}`);
      }

      return {
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token || refreshToken,
        expiresIn: tokenData.expires_in,
        apiKey: agentKey || tokenData.access_token,
        agentKey,
        providerSpecificData: {
          ...(agentKeyId ? { agentKeyId } : {}),
          ...(agentKeyExpiresAt ? { agentKeyExpiresAt } : {}),
        },
      };
    } catch (error) {
      log?.error?.("TOKEN_REFRESH", `Error refreshing Nous token: ${error.message}`);
      return null;
    }
  }, log);
}
