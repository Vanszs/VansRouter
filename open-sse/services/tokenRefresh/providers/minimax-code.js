import { dedupRefresh } from "../dedup.js";

const MINIMAX_CODE_SITES = {
  "minimax-code": "https://account.minimax.cn/oauth2/token",
  "minimax-code-global": "https://account.minimax.io/oauth2/token",
};

export async function refreshMiniMaxCodeToken(provider, refreshToken, log) {
  const tokenUrl = MINIMAX_CODE_SITES[provider];
  if (!tokenUrl || !refreshToken) return null;
  return dedupRefresh(provider, refreshToken, async () => {
    try {
      const response = await fetch(tokenUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
          client_id: "mcode-public",
          scope: "agent.default",
          audience: "agent-backend",
        }).toString(),
        signal: AbortSignal.timeout(30000),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || (data && typeof data.error === "string" && data.error)) {
        const code = data?.error || `HTTP ${response.status}`;
        if (response.status === 400 && data?.error === "invalid_grant") {
          log?.warn?.("TOKEN_REFRESH", `MiniMax refresh token spent/rejected (${provider}) — sign-in gone`);
          return { error: "invalid_grant" };
        }
        log?.error?.("TOKEN_REFRESH", `MiniMax token refresh failed (${provider})`, { status: response.status, error: code });
        return null;
      }
      if (!data?.access_token) {
        log?.error?.("TOKEN_REFRESH", `MiniMax refresh returned no access_token (${provider})`);
        return null;
      }
      return {
        accessToken: data.access_token,
        // MiniMax rotates the refresh token on every refresh; keep the old one
        // only if the answer oddly omits it.
        refreshToken: data.refresh_token || refreshToken,
        expiresIn: data.expires_in,
      };
    } catch (error) {
      log?.error?.("TOKEN_REFRESH", `Error refreshing MiniMax token (${provider}): ${error.message}`);
      return null;
    }
  }, log);
}
