/**
 * Public free-proxy list sources for one-click proxy pool import.
 *
 * Shared between the import API route (server) and the dashboard modal
 * (client) so capability gating never drifts between the two.
 *
 * Runtime constraint: undici's ProxyAgent (open-sse/utils/proxyFetch.js)
 * dispatches http/https and socks5/socks schemes only — socks4 and the
 * Xray share-link families (vmess/vless/trojan/ss/ssr/mtproto) cannot be
 * routed by a pool entry, so sources never offer them.
 */
export const PUBLIC_PROXY_SOURCES = {
  freeproxydb: {
    id: "freeproxydb",
    label: "FreeProxyDB",
    protocols: ["http", "socks5"],
    supportsCountry: true,
    supportsAnonymity: true,
    supportsHttpsOnly: true,
    supportsMaxSpeed: true,
    // Ranking is applied client-side on the fetched valid rows: "success" by
    // lifetime check_success_count, "latency" by measured speed (0 = not
    // measured, sorted last), "recent" by upstream last_checked order.
    supportsOrderBy: true,
    orderByOptions: [
      { value: "success", label: "Best success rate" },
      { value: "latency", label: "Fastest first (latency)" },
      { value: "recent", label: "Recently checked" },
    ],
    minCount: 1,
    // /api/proxy/search caps page_size at 100
    maxCount: 100,
    defaultCount: 50,
    note: "Public API — rate limited (~3 requests/minute, 10/hour per IP).",
  },
  vpslab: {
    id: "vpslab",
    label: "VPSLab",
    protocols: ["http", "socks5"],
    supportsCountry: false,
    // Anonymity/SSL cuts only exist for the HTTP lists; socks5 ships as a
    // single socks5_all.txt file.
    supportsAnonymity: true,
    supportsHttpsOnly: true,
    anonymityProtocols: ["http"],
    supportsMaxSpeed: false,
    supportsOrderBy: false,
    minCount: 1,
    maxCount: 500,
    defaultCount: 100,
    note: "Plain ip:port lists served from GitHub raw (5-minute cache). No country or speed metadata.",
  },
};


export const PUBLIC_PROXY_ANONYMITY_LEVELS = ["elite", "anonymous", "transparent"];
