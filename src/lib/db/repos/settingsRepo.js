import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

const DEFAULT_MITM_ROUTER_BASE = "http://localhost:20128";
const DEFAULT_HEADROOM_URL = process.env.HEADROOM_URL || "http://localhost:8787";

const DEFAULT_SETTINGS = {
  cloudEnabled: false,
  tunnelEnabled: false,
  tunnelUrl: "",
  tunnelProvider: "cloudflare",
  tailscaleEnabled: false,
  tailscaleUrl: "",
  stickyRoundRobinLimit: 3,
  providerStrategies: {},
  comboStrategy: "fallback",
  comboStickyRoundRobinLimit: 1,
  comboStrategies: {},
  requireLogin: true,
  requireApiKey: process.env.REQUIRE_API_KEY === "true",
  allowRemoteNoApiKey: false,
  tunnelDashboardAccess: true,
  authMode: "password",
  oidcIssuerUrl: "",
  oidcClientId: "",
  oidcClientSecret: "",
  oidcScopes: "openid profile email",
  oidcLoginLabel: "Sign in with OIDC",
  enableObservability: true,
  observabilityMaxRecords: 1000,
  observabilityBatchSize: 20,
  observabilityFlushIntervalMs: 5000,
  observabilityMaxJsonSize: 5,
  outboundProxyEnabled: false,
  outboundProxyUrl: "",
  outboundNoProxy: "",
  mitmRouterBaseUrl: DEFAULT_MITM_ROUTER_BASE,
  dnsToolEnabled: {},
  rtkEnabled: true,
  headroomEnabled: false,
  headroomUrl: DEFAULT_HEADROOM_URL,
  headroomCompressUserMessages: false,
  headroomTimeoutMs: 3000,
  cavemanEnabled: false,
  cavemanLevel: "full",
  ponytailEnabled: false,
  ponytailLevel: "full",
  // User-authored system prompt, injected independently of the built-in savers.
  customPromptEnabled: false,
  customPrompt: "",
};

async function readRaw() {
  const db = await getAdapter();
  const row = db.get(`SELECT data FROM settings WHERE id = 1`);
  return row ? parseJson(row.data, {}) : {};
}

// Merge raw settings with defaults; backward-compat for missing keys
function mergeWithDefaults(raw) {
  const merged = { ...DEFAULT_SETTINGS, ...(raw || {}) };
  for (const [key, defVal] of Object.entries(DEFAULT_SETTINGS)) {
    if (merged[key] === undefined) {
      if (
        key === "outboundProxyEnabled" &&
        typeof merged.outboundProxyUrl === "string" &&
        merged.outboundProxyUrl.trim()
      ) {
        merged[key] = true;
      } else {
        merged[key] = defVal;
      }
    }
  }
  return merged;
}

// In-memory cache — eliminates sync DB read on every request.
// Invalidated on updateSettings() and expires after TTL.
let _settingsCache = null;
let _settingsCacheTs = 0;
let _settingsCacheRevision = null;
const _settingsTTL = 5_000; // 5s
const SETTINGS_REVISION_KEY = "settings_revision";

function readRevision(db) {
  const row = db.get(`SELECT value FROM _meta WHERE key = ?`, [SETTINGS_REVISION_KEY]);
  return Number(row?.value || 0);
}

export function bumpSettingsRevision(db) {
  const revision = readRevision(db) + 1;
  db.run(`INSERT INTO _meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [SETTINGS_REVISION_KEY, String(revision)]);
  return revision;
}

export function invalidateSettingsCache() {
  _settingsCache = null;
  _settingsCacheRevision = null;
}

export async function getSettings() {
  const now = Date.now();
  const db = await getAdapter();
  const revision = await readRevision(db);
  if (_settingsCache && revision === _settingsCacheRevision && now - _settingsCacheTs < _settingsTTL) {
    return _settingsCache;
  }
  const row = db.get(`SELECT data FROM settings WHERE id = 1`);
  const raw = row ? parseJson(row.data, {}) : {};
  _settingsCache = mergeWithDefaults(raw);
  _settingsCacheRevision = revision;
  _settingsCacheTs = now;
  return _settingsCache;
}

// Atomic read-merge-write inside transaction (prevents losing concurrent updates)
export async function updateSettings(updates) {
  const db = await getAdapter();
  let next;
  let revision;
  db.transaction(() => {
    const row = db.get(`SELECT data FROM settings WHERE id = 1`);
    const current = row ? parseJson(row.data, {}) : {};
    next = { ...current, ...updates };
    revision = bumpSettingsRevision(db);
    db.run(
      `INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
      [stringifyJson(next)]
    );
  });
  // Transaction committed; invalidate only after both writes succeeded.
  invalidateSettingsCache();
  return mergeWithDefaults(next);
}

export async function isCloudEnabled() {
  const settings = await getSettings();
  return settings.cloudEnabled === true;
}

export async function getCloudUrl() {
  const settings = await getSettings();
  return (
    settings.cloudUrl ||
    process.env.CLOUD_URL ||
    process.env.NEXT_PUBLIC_CLOUD_URL ||
    ""
  );
}

export async function exportSettings() {
  return await readRaw();
}
