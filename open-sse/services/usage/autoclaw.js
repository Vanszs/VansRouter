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

export async function getAutoclawBalance(accessToken, _providerSpecificData = {}, _proxyOptions = null) {
  if (!accessToken) {
    throw new Error("autoclaw: accessToken required for wallet lookup");
  }
  const token = accessToken.replace(/^Bearer\s+/i, "");

  const res = await fetch(`${BASE_URL}/agent-assetmgr/api/v2/wallets?biz_app_id=autoclaw`, {
    method: "GET",
    headers: signHeaders({ authorization: `Bearer ${token}` }),
  });

  const contentType = res.headers.get("content-type") || "";
  if (!res.ok || !contentType.includes("application/json")) {
    const text = await res.text().catch(() => "");
    const hint = text.startsWith("<") || contentType.includes("text/html")
      ? "token revoked or upstream returned HTML"
      : `${res.status} ${text.slice(0, 200)}`;
    throw Object.assign(new Error(`autoclaw wallet: ${hint}`), {
      recoverable: res.status >= 500,
    });
  }

  const json = await res.json();
  const data = json.data || json;
  const balance = Number(data.total_balance ?? 0);

  return {
    provider: "autoclaw",
    plan: "AutoClaw Points",
    quotas: {
      points: {
        used: 0,
        total: balance,
        remaining: balance,
        resetAt: null,
        unlimited: false,
      },
    },
    balance,
    currency: "points",
  };
}
