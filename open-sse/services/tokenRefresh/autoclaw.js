import crypto from "node:crypto";

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

export async function refreshAutoclawToken(credentials, _log, _proxyOptions, onRotated) {
  if (!credentials?.refreshToken) {
    throw new Error("autoclaw refresh: missing refreshToken");
  }
  const deviceId = credentials.providerSpecificData?.deviceId;
  if (!deviceId) {
    throw new Error("autoclaw refresh: missing deviceId in providerSpecificData");
  }

  const refreshToken = credentials.refreshToken.replace(/^Bearer\s+/i, "");

  const res = await fetch(`${BASE_URL}/userapi/v1/refresh`, {
    method: "POST",
    headers: signHeaders(),
    body: JSON.stringify({
      source_id: "web",
      device_id: deviceId,
      refresh_token: refreshToken,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw Object.assign(new Error(`autoclaw refresh failed: ${res.status} ${text}`), {
      recoverable: res.status >= 500,
    });
  }

  const json = await res.json();
  if (json.code !== 0 && json.code !== undefined) {
    throw new Error(`autoclaw refresh: code ${json.code} ${json.message || ""}`);
  }
  const data = json.data || json;
  const accessToken = data.access_token || data.accessToken;
  const newRefreshToken = data.refresh_token || data.refreshToken;

  if (!accessToken || !newRefreshToken) {
    throw new Error("autoclaw refresh: missing tokens in response");
  }

  const newTokens = {
    accessToken,
    refreshToken: newRefreshToken,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  };

  if (typeof onRotated === "function") {
    await onRotated(newTokens);
  }
  return newTokens;
}

export { signHeaders as _autoclawSignHeaders };
