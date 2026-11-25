import { PUBLIC_PROXY_ANONYMITY_LEVELS, PUBLIC_PROXY_SOURCES } from "@/shared/constants/publicProxySources.js";

/**
 * Fetch + normalize public free-proxy list feeds into proxy pool entries.
 *
 * Security posture: every upstream URL is built from a fixed host plus a
 * whitelisted path/query — no user-supplied URL ever reaches the fetch
 * layer, so the import path cannot be turned into an SSRF relay.
 */

const FREEPROXYDB_SEARCH_URL = "https://freeproxydb.com/api/proxy/search";
const VPSLAB_BASE_URL = "https://raw.githubusercontent.com/VPSLabCloud/VPSLab-Free-Proxy-List/main";

const FETCH_TIMEOUT_MS = 20000;
const VPSLAB_IP_PORT_PATTERN = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3}):(\d{1,5})$/;

// VPSLab ships one file per protocol/SSL/anonymity cut. ssl+transparent has
// no dedicated file — it falls back to the plain SSL list (documented in the
// route response so the UI can show an honest summary).
const VPSLAB_HTTP_FILES = {
  any: { any: "http_all.txt", elite: "http_elite.txt", anonymous: "http_anonymous.txt", transparent: "http_transparent.txt" },
  ssl: { any: "http_ssl.txt", elite: "http_ssl_elite.txt", anonymous: "http_ssl_anonymous.txt", transparent: "http_ssl.txt" },
};

// Client-side ranking of the fetched valid rows.
//
// Why client-side: measured against the live API, the search endpoint has no
// server-side validity filter (an is_valid=1 param is silently ignored) and
// `order_by=speed asc` fills the whole page with unmeasured invalid rows
// (0 valid out of 50), while `order_by=last_checked desc` yields the most
// currently-valid rows (11 out of 100, all with measured speeds). So we always
// fetch the freshest page_size=100 and rank the valid remainder ourselves:
//   - "success": lifetime check_success_count (reliability history)
//   - "latency": measured speed ascending; 0 means "not measured" and is
//     demoted below every measured proxy
//   - "recent": keep the upstream last_checked order
const FREEPROXYDB_FETCH_PAGE_SIZE = 100;
const FREEPROXYDB_RANKERS = {
  success: (a, b) => Number(b.check_success_count || 0) - Number(a.check_success_count || 0),
  latency: (a, b) => {
    const sa = Number(a.speed) > 0 ? Number(a.speed) : Number.POSITIVE_INFINITY;
    const sb = Number(b.speed) > 0 ? Number(b.speed) : Number.POSITIVE_INFINITY;
    return sa - sb;
  },
  recent: null,
};

function isValidIp(octets) {
  return octets.every((part) => Number(part) >= 0 && Number(part) <= 255);
}

/**
 * Canonical proxy URL key for dedupe. Mirrors the batch-import parser
 * (parseProxyLine → URL.toString()): special schemes (http/https) get a
 * trailing "/", socks5 does not. Idempotent.
 */
export function normalizeProxyUrlKey(value) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) return "";
  try {
    return new URL(trimmed).toString();
  } catch {
    return trimmed;
  }
}

export function resolveVpsLabFile({ protocol, anonymity, httpsOnly } = {}) {
  if (protocol === "socks5") return "socks5_all.txt";
  const sslKey = httpsOnly === true ? "ssl" : "any";
  const anonymityKey = PUBLIC_PROXY_ANONYMITY_LEVELS.includes(anonymity) ? anonymity : "any";
  return VPSLAB_HTTP_FILES[sslKey][anonymityKey];
}

function buildVpsLabUrl(options) {
  return `${VPSLAB_BASE_URL}/${resolveVpsLabFile(options)}`;
}

function parseVpsLabText(text, { protocol, count }) {
  const scheme = protocol === "socks5" ? "socks5" : "http";
  const seen = new Set();
  const entries = [];
  for (const rawLine of text.split(/\r\n|\n|\r/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = VPSLAB_IP_PORT_PATTERN.exec(line);
    if (!match) continue;
    if (!isValidIp([match[1], match[2], match[3], match[4]])) continue;
    const proxyUrl = normalizeProxyUrlKey(`${scheme}://${line}`);
    if (seen.has(proxyUrl)) continue;
    seen.add(proxyUrl);
    entries.push({ name: `VPSLab ${line}`, proxyUrl, type: "http" });
    if (entries.length >= count) break;
  }
  return entries;
}

function buildFreeProxyDbUrl({ count, protocol, country, anonymity, httpsOnly, maxSpeed } = {}) {
  const params = new URLSearchParams();
  params.set("protocol", protocol || "http");
  if (country) params.set("country", country);
  if (anonymity) params.set("anonymity", anonymity);
  if (httpsOnly === true) params.set("https", "1");
  if (maxSpeed) params.set("speed", `0,${maxSpeed}`);
  // Always pull the freshest full page: this ordering carries the highest
  // density of currently-valid rows (see FREEPROXYDB_RANKERS note above), and
  // the requested ordering is applied client-side afterwards.
  params.set("page_size", String(Math.max(count, FREEPROXYDB_FETCH_PAGE_SIZE)));
  params.set("order_by", "last_checked");
  params.set("order_dir", "desc");
  return `${FREEPROXYDB_SEARCH_URL}?${params.toString()}`;
}

function parseFreeProxyDbPayload(payload, { count, orderBy } = {}) {
  const rows = Array.isArray(payload?.data?.data) ? payload.data.data : [];
  let filtered = [];
  const seen = new Set();
  for (const row of rows) {
    // The search endpoint returns invalid entries too — only currently
    // verified proxies may land in the pool.
    if (row?.is_valid !== 1) continue;
    const connectString = typeof row.connect_string === "string" ? row.connect_string.trim() : "";
    if (!connectString) continue;
    const scheme = connectString.split("://")[0];
    if (scheme !== "http" && scheme !== "socks5") continue;
    const proxyUrl = normalizeProxyUrlKey(connectString);
    if (!proxyUrl || seen.has(proxyUrl)) continue;
    seen.add(proxyUrl);
    filtered.push(row);
  }

  const ranker = FREEPROXYDB_RANKERS[orderBy] || null;
  if (ranker) filtered.sort(ranker);

  return filtered.slice(0, count).map((row) => {
    const connectString = row.connect_string.trim();
    const proxyUrl = normalizeProxyUrlKey(connectString);
    const hostLabel = row.port ? `${row.ip}:${row.port}` : `${row.ip}`;
    const bits = ["FreeProxyDB"];
    if (typeof row.country === "string" && row.country) bits.push(row.country);
    if (PUBLIC_PROXY_ANONYMITY_LEVELS.includes(row.anonymity)) bits.push(row.anonymity);
    if (Number(row.speed) > 0) bits.push(`${Number(row.speed).toFixed(1)}s`);
    bits.push(hostLabel);
    return { name: bits.join(" "), proxyUrl, type: "http" };
  });
}

async function fetchUpstream(url, { sourceLabel, timeoutMs = FETCH_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json, text/plain, */*" },
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      const detail = body ? `: ${body.slice(0, 200)}` : "";
      const hint = response.status === 429
        ? ` ${sourceLabel} public rate limit reached — retry in a minute or lower the count.`
        : "";
      const error = new Error(`${sourceLabel} returned HTTP ${response.status}${detail}.${hint}`);
      error.status = response.status;
      throw error;
    }
    return response;
  } catch (err) {
    if (err?.name === "AbortError") {
      const error = new Error(`${sourceLabel} request timed out after ${timeoutMs}ms.`);
      error.status = 504;
      throw error;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export function getPublicProxySource(sourceId) {
  const source = PUBLIC_PROXY_SOURCES[sourceId];
  if (!source) {
    throw new Error(`Unknown proxy source: ${sourceId}`);
  }
  return source;
}

export async function fetchPublicProxyEntries(sourceId, options = {}) {
  if (sourceId === "vpslab") {
    const source = getPublicProxySource(sourceId);
    const response = await fetchUpstream(buildVpsLabUrl(options), { sourceLabel: source.label });
    const text = await response.text();
    return parseVpsLabText(text, options);
  }

  if (sourceId === "freeproxydb") {
    const source = getPublicProxySource(sourceId);
    const response = await fetchUpstream(buildFreeProxyDbUrl(options), { sourceLabel: source.label });
    const payload = await response.json().catch(() => {
      const error = new Error("FreeProxyDB returned a non-JSON payload.");
      error.status = 502;
      throw error;
    });
    return parseFreeProxyDbPayload(payload, options);
  }

  throw new Error(`Unknown public proxy source: ${sourceId}`);
}
