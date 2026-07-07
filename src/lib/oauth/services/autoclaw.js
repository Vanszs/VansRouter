import crypto from "node:crypto";
import {
  createProviderConnection,
  updateProviderConnection,
  getProviderConnectionById,
} from "@/lib/db";
import { getAutoclawBalance } from "open-sse/services/usage/autoclaw.js";
import { refreshAutoclawToken } from "open-sse/services/tokenRefresh/autoclaw.js";

const BASE_URL = "https://autoglm-api.autoglm.ai";
const APP_ID = "100003";
const APP_KEY = "38d2391985e2369a5fb8227d8e6cd5e5";

function signHeaders(extra = {}) {
  const ts = String(Math.floor(Date.now() / 1000));
  const sign = crypto.createHash("md5").update(`${APP_ID}&${ts}&${APP_KEY}`).digest("hex");
  return {
    accept: "*/*",
    "content-type": "application/json",
    origin: "https://autoclaw.z.ai",
    referer: "https://autoclaw.z.ai/",
    "user-agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
    "x-auth-appid": APP_ID,
    "x-auth-timestamp": ts,
    "x-auth-sign": sign,
    "x-product": "autoclaw",
    "x-version": "1.10.0",
    "x-tm": "web",
    "x-channel": "official",
    "x-client-type": "web",
    "x-trace-id": crypto.randomUUID(),
    "x-lang": "zh-CN",
    ...extra,
  };
}

export class AutoclawService {
  async getUserProfile(accessToken, _proxyOptions = null) {
    if (!accessToken) {
      throw Object.assign(new Error("autoclaw: accessToken required"), { code: "INVALID_TOKEN" });
    }
    const token = accessToken.replace(/^Bearer\s+/i, "");
    const res = await fetch(`${BASE_URL}/userapi/v1/user-profile`, {
      method: "POST",
      headers: signHeaders({ "X-Authorization": `Bearer ${token}` }),
      body: "{}",
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const err = new Error(`autoclaw profile ${res.status} ${text}`);
      err.code = res.status === 401 || res.status === 403 ? "INVALID_TOKEN" : "PROFILE_FAILED";
      err.recoverable = res.status >= 500;
      throw err;
    }
    return res.json();
  }

  async validateAndSaveImport({ accessToken, refreshToken, deviceId }) {
    if (!accessToken || !refreshToken) {
      const err = new Error("accessToken and refreshToken are required");
      err.code = "INVALID_TOKEN";
      throw err;
    }

    const device = deviceId || crypto.randomUUID();

    // 1. Validate via user-profile (throws on bad token)
    let profile;
    try {
      profile = await this.getUserProfile(accessToken);
    } catch (e) {
      const err = new Error(`Invalid access_token: ${e.message}`);
      err.code = "INVALID_TOKEN";
      throw err;
    }

    // 2. Best-effort balance — don't block save if wallet unavailable
    let balance = null;
    try {
      const bal = await getAutoclawBalance(accessToken, { deviceId: device });
      balance = bal.balance;
    } catch {
      // non-fatal
    }

    // 3. Extract identity
    const data = profile?.data || profile || {};
    const userId = data.user_id || data.userId || profile?.user_id;
    const userName = data.user_name || data.userName || profile?.user_name;

    // 4. Persist via the shared connection API
    const conn = await createProviderConnection({
      provider: "autoclaw",
      authType: "access_token",
      name: userName || String(userId || "autoclaw-import"),
      email: String(userId || "unknown"),
      accessToken,
      refreshToken,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      testStatus: "active",
      lastRefreshAt: new Date().toISOString(),
      providerSpecificData: {
        deviceId: device,
        userName,
        balance,
        refreshExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        importedAt: new Date().toISOString(),
      },
    });

    return {
      id: conn.id,
      email: conn.email,
      name: conn.name,
      balance,
    };
  }

  async refreshConnection(connectionId, log) {
    const conn = await getProviderConnectionById(connectionId);
    if (!conn) {
      throw new Error("autoclaw refresh: connection not found");
    }
    if (conn.provider !== "autoclaw") {
      throw new Error("autoclaw refresh: connection is not an autoclaw connection");
    }
    return refreshAutoclawToken(conn, log, null, async (newTokens) => {
      await updateProviderConnection(connectionId, {
        accessToken: newTokens.accessToken,
        refreshToken: newTokens.refreshToken,
        expiresAt: newTokens.expiresAt,
        lastRefreshAt: new Date().toISOString(),
      });
    });
  }

  async getBalance(connectionId) {
    const conn = await getProviderConnectionById(connectionId);
    if (!conn) {
      throw new Error("autoclaw balance: connection not found");
    }
    if (conn.provider !== "autoclaw") {
      throw new Error("autoclaw balance: connection is not an autoclaw connection");
    }
    return getAutoclawBalance(conn.accessToken, conn.providerSpecificData);
  }
}

export const autoclawService = new AutoclawService();
export default autoclawService;
