import { ProxyAgent } from "undici";

const FIVE_SIM_API_BASE = "https://5sim.net/v1";
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_INITIAL_OTP_POLL_DELAY_MS = 5_000;
const DEFAULT_OTP_TIMEOUT_MS = 120_000;
const PRICE_CACHE_TTL_MS = 30_000;
const PRICE_CACHE_STALE_TTL_MS = 5 * 60_000;
const GUEST_RETRY_DELAYS_MS = [250, 750];
const PROFILE_RETRY_DELAYS_MS = [250, 750, 1500];
const MIN_CHECK_POLL_INTERVAL_MS = 5_000;
const FIVE_SIM_COOLDOWN_MS = 10 * 60_000;
const FETCH_PROXY_PROTOCOLS = new Set(["http:", "https:", "socks4:", "socks5:"]);
const priceCacheByFetch = new WeakMap();

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractOtpCode(payload) {
  const sms = Array.isArray(payload?.sms) ? payload.sms : [];
  for (const item of sms) {
    if (item?.code) return String(item.code).trim();
    const text = String(item?.text || "");
    const match = text.match(/\b(\d{4,8})\b/);
    if (match) return match[1];
  }
  return "";
}

function normalizeOrder(payload) {
  return {
    ...payload,
    code: extractOtpCode(payload),
  };
}

function buildQuery(params) {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    const clean = String(value || "").trim().toLowerCase();
    if (clean) searchParams.set(key, clean);
  });
  const query = searchParams.toString();
  return query ? `?${query}` : "";
}

function listAvailableOffers(prices, country, product) {
  const countryPrices = prices?.[country] || {};
  const productPrices = countryPrices?.[product] || {};
  return Object.entries(productPrices)
    .filter(([, meta]) => Number(meta?.count || 0) > 0)
    .map(([operator, meta]) => ({
      operator,
      cost: Number(meta?.cost ?? Number.POSITIVE_INFINITY),
      count: Number(meta?.count || 0),
    }))
    .sort((left, right) => {
      if (left.cost !== right.cost) return left.cost - right.cost;
      return right.count - left.count;
    });
}

function buildNoStockMessage(country, product, operator) {
  const scope = operator && operator !== "any" ? `${operator} operator` : "any operator";
  return `No available 5sim phone numbers for ${product} in ${country} using ${scope}`;
}

function createFiveSimCooldownError(path, message) {
  const error = new Error(message || "5sim temporarily banned this IP/API key; wait 10 minutes before retrying.");
  error.status = 444;
  error.path = path;
  error.code = "FIVE_SIM_COOLDOWN";
  error.cooldownMs = FIVE_SIM_COOLDOWN_MS;
  return error;
}

function isFiveSimCooldownError(error) {
  return error?.code === "FIVE_SIM_COOLDOWN" || Number(error?.status || 0) === 444;
}

function isTransientRequestError(error) {
  const status = Number(error?.status || 0);
  return !status || status === 408 || status === 425 || status === 429 || status >= 500;
}

function getCheckBackoffDelay(error, currentDelay) {
  const status = Number(error?.status || 0);
  if (status === 429) return Math.min(Math.max(currentDelay * 2, 10_000), 60_000);
  if (status === 503) return Math.min(Math.max(currentDelay * 2, 10_000), 30_000);
  if (status === 504) return Math.min(Math.max(Math.ceil(currentDelay * 1.5), 8_000), 20_000);
  return Math.min(Math.max(Math.ceil(currentDelay * 1.5), MIN_CHECK_POLL_INTERVAL_MS), 30_000);
}

function getPriceCache(fetchImpl) {
  let cache = priceCacheByFetch.get(fetchImpl);
  if (!cache) {
    cache = new Map();
    priceCacheByFetch.set(fetchImpl, cache);
  }
  return cache;
}

function normalizeProxyUrl(proxyUrl) {
  return String(proxyUrl || "").trim();
}

function createFetchDispatcher(proxyUrl) {
  const clean = normalizeProxyUrl(proxyUrl);
  if (!clean) return null;
  let parsed;
  try {
    parsed = new URL(clean);
  } catch {
    return null;
  }
  if (!FETCH_PROXY_PROTOCOLS.has(parsed.protocol)) return null;
  try {
    return new ProxyAgent(clean);
  } catch {
    return null;
  }
}

export class FiveSimClient {
  constructor({ token, fetchImpl = fetch, baseUrl = FIVE_SIM_API_BASE, waitImpl = wait, proxyUrl } = {}) {
    this.token = String(token || "").trim();
    this.fetchImpl = fetchImpl;
    this.baseUrl = String(baseUrl || FIVE_SIM_API_BASE).replace(/\/$/, "");
    this.wait = waitImpl;
    this.proxyUrl = normalizeProxyUrl(proxyUrl);
    this.fetchDispatcher = createFetchDispatcher(this.proxyUrl);
    this.priceCachePrefix = this.proxyUrl || "direct";
    this.priceCache = getPriceCache(fetchImpl);
  }

  async fetchJson(path, { headers = {}, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const init = {
        method: "GET",
        headers,
        signal: controller.signal,
      };
      if (this.fetchDispatcher) init.dispatcher = this.fetchDispatcher;
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, init);
      const text = await response.text?.() ?? "";
      let payload = null;
      try {
        payload = text ? JSON.parse(text) : await response.json();
      } catch {
        payload = { message: text };
      }
      if (!response.ok) {
        const msg = payload?.message || payload?.error || text || `5sim HTTP ${response.status}`;
        if (response.status === 444) {
          throw createFiveSimCooldownError(path, "5sim temporarily banned this IP/API key; wait 10 minutes before retrying.");
        }
        const error = new Error(`5sim HTTP ${response.status} for ${path}: ${msg}`);
        error.status = response.status;
        error.path = path;
        throw error;
      }
      return payload;
    } finally {
      clearTimeout(timer);
    }
  }

  async request(path, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    if (!this.token) {
      throw new Error("5sim token is required");
    }
    return this.fetchJson(path, {
      timeoutMs,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/json",
      },
    });
  }

  async guestRequest(path, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    return this.fetchJson(path, {
      timeoutMs,
      headers: {
        Accept: "application/json",
      },
    });
  }

  async getProfile() {
    let lastError = null;
    for (let attempt = 0; attempt <= PROFILE_RETRY_DELAYS_MS.length; attempt += 1) {
      try {
        return await this.request("/user/profile");
      } catch (error) {
        lastError = error;
        if (!isTransientRequestError(error) || attempt === PROFILE_RETRY_DELAYS_MS.length) break;
        await this.wait(PROFILE_RETRY_DELAYS_MS[attempt]);
      }
    }
    throw lastError;
  }

  async getPrices({ country, product } = {}) {
    const path = `/guest/prices${buildQuery({ country, product })}`;
    const cacheKey = `${this.priceCachePrefix}:${path}`;
    const now = Date.now();
    const cached = this.priceCache.get(cacheKey);
    if (cached?.payload && cached.expiresAt > now) return cached.payload;
    if (cached?.inFlight) return cached.inFlight;

    const inFlight = (async () => {
      let lastError = null;
      for (let attempt = 0; attempt <= GUEST_RETRY_DELAYS_MS.length; attempt += 1) {
        try {
          const payload = await this.guestRequest(path);
          this.priceCache.set(cacheKey, {
            payload,
            expiresAt: Date.now() + PRICE_CACHE_TTL_MS,
            staleUntil: Date.now() + PRICE_CACHE_STALE_TTL_MS,
            inFlight: null,
          });
          return payload;
        } catch (error) {
          lastError = error;
          if (!isTransientRequestError(error) || attempt === GUEST_RETRY_DELAYS_MS.length) break;
          await this.wait(GUEST_RETRY_DELAYS_MS[attempt]);
        }
      }

      if (cached?.payload && cached.staleUntil > Date.now()) return cached.payload;
      throw lastError;
    })();

    this.priceCache.set(cacheKey, { ...cached, inFlight });
    try {
      return await inFlight;
    } finally {
      const current = this.priceCache.get(cacheKey);
      if (current?.inFlight === inFlight) {
        if (current.payload) this.priceCache.set(cacheKey, { ...current, inFlight: null });
        else this.priceCache.delete(cacheKey);
      }
    }
  }

  async buyActivation({ country = "hongkong", operator = "any", product = "codebuddy" } = {}) {
    const normalizedCountry = String(country || "hongkong").trim().toLowerCase();
    const normalizedProduct = String(product || "codebuddy").trim().toLowerCase();
    const cleanCountry = encodeURIComponent(normalizedCountry);
    const cleanProduct = encodeURIComponent(normalizedProduct);
    const requestedOperator = String(operator || "any").trim().toLowerCase();
    const cleanOperator = encodeURIComponent(requestedOperator || "any");
    const path = `/user/buy/activation/${cleanCountry}/${cleanOperator}/${cleanProduct}`;
    const BUY_RETRY_DELAYS_MS = [500, 1500, 3000, 5000, 8000];
    let lastError = null;
    for (let attempt = 0; attempt <= BUY_RETRY_DELAYS_MS.length; attempt += 1) {
      try {
        return await this.request(path);
      } catch (error) {
        lastError = error;
        if (isFiveSimCooldownError(error)) throw error;
        if (!isTransientRequestError(error) || attempt === BUY_RETRY_DELAYS_MS.length) break;
        await this.wait(BUY_RETRY_DELAYS_MS[attempt]);
      }
    }
    throw lastError;
  }

  async getActivationQuote({ country = "hongkong", operator = "any", product = "codebuddy" } = {}) {
    const normalizedCountry = String(country || "hongkong").trim().toLowerCase();
    const normalizedProduct = String(product || "codebuddy").trim().toLowerCase();
    const requestedOperator = String(operator || "any").trim().toLowerCase();
    const [profile, prices] = await Promise.all([
      this.getProfile(),
      this.getPrices({ country: normalizedCountry, product: normalizedProduct }),
    ]);
    const offers = listAvailableOffers(prices, normalizedCountry, normalizedProduct);
    const candidates = requestedOperator && requestedOperator !== "any"
      ? offers.filter((offer) => offer.operator === requestedOperator)
      : offers;
    const selectedOffer = candidates[0] || null;
    const balance = Number(profile?.balance ?? 0);
    const unitCost = Number(selectedOffer?.cost ?? 0);
    const purchasableByBalance = unitCost > 0 ? Math.floor(balance / unitCost) : 0;
    const availableCount = Number(selectedOffer?.count || 0);
    return {
      country: normalizedCountry,
      product: normalizedProduct,
      operator: requestedOperator || "any",
      balance,
      selectedOffer,
      availableCount,
      unitCost: selectedOffer ? unitCost : null,
      purchasableByBalance: selectedOffer ? purchasableByBalance : 0,
      capacity: selectedOffer ? Math.min(availableCount, purchasableByBalance) : 0,
      noStockMessage: selectedOffer ? "" : buildNoStockMessage(normalizedCountry, normalizedProduct, requestedOperator || "any"),
    };
  }

  async checkOrder(orderId) {
    const id = encodeURIComponent(String(orderId || "").trim());
    if (!id) throw new Error("5sim order id is required");
    return normalizeOrder(await this.request(`/user/check/${id}`));
  }

  async finishOrder(orderId) {
    const id = encodeURIComponent(String(orderId || "").trim());
    if (!id) throw new Error("5sim order id is required");
    return this.request(`/user/finish/${id}`);
  }

  async cancelOrder(orderId) {
    const id = encodeURIComponent(String(orderId || "").trim());
    if (!id) throw new Error("5sim order id is required");
    return this.request(`/user/cancel/${id}`);
  }

  async waitForCode(orderId, {
    timeoutMs = DEFAULT_OTP_TIMEOUT_MS,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    initialDelayMs = DEFAULT_INITIAL_OTP_POLL_DELAY_MS,
  } = {}) {
    const startedAt = Date.now();
    const deadline = startedAt + timeoutMs;
    const minPollInterval = Math.max(MIN_CHECK_POLL_INTERVAL_MS, Number.parseInt(pollIntervalMs, 10) || DEFAULT_POLL_INTERVAL_MS);
    let nextDelayMs = minPollInterval;
    let lastOrder = null;
    let lastError = null;
    const firstDelay = Math.min(Math.max(0, Number.parseInt(initialDelayMs, 10) || 0), Math.max(0, deadline - Date.now()));
    if (firstDelay > 0) await this.wait(firstDelay);
    while (Date.now() < deadline) {
      try {
        lastOrder = await this.checkOrder(orderId);
        lastError = null;
        nextDelayMs = minPollInterval;
        if (lastOrder.code) return lastOrder;
      } catch (error) {
        if (isFiveSimCooldownError(error)) throw error;
        if (!isTransientRequestError(error)) throw error;
        lastError = error;
        nextDelayMs = getCheckBackoffDelay(error, nextDelayMs);
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      await this.wait(Math.min(nextDelayMs, remaining));
    }
    const suffix = lastError?.message ? `; last 5sim error: ${lastError.message}` : "";
    const error = new Error(`Timed out waiting for 5sim OTP code${suffix}`);
    error.order = lastOrder;
    error.lastError = lastError;
    throw error;
  }
}

export function createFiveSimClient(options) {
  return new FiveSimClient(options);
}
