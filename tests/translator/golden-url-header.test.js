// P0 GOLDEN: lock buildUrl + buildHeaders cho mọi provider trên code CŨ.
// Sinh snapshot lần đầu (baseline) → sau refactor chạy lại phải khớp y hệt.
// Mock proxyFetch + uuid-heavy executors KHÔNG cần ở đây vì chỉ gọi buildUrl/buildHeaders (pure).
import { describe, it, expect } from "vitest";
import { hostname } from "node:os";
import { createRequire } from "node:module";
import { PROVIDERS } from "../../open-sse/config/providers.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";

const require = createRequire(import.meta.url);
const APP_VERSION = require("../../package.json").version;

// Credentials mẫu cố định (deterministic) — KHÔNG dùng Date.now/random.
const API_KEY_CRED = { apiKey: "sk-test-APIKEY", providerSpecificData: {} };
const OAUTH_CRED = { accessToken: "tok-test-ACCESS", providerSpecificData: {} };
const SPECIAL_CRED = {
  apiKey: "sk-test-APIKEY",
  accessToken: "tok-test-ACCESS",
  providerSpecificData: { accountId: "ACC123", region: "sgp", baseUrl: "https://custom.example.com/v1", orgId: "ORG9" },
};

// Provider cần executor riêng (buildUrl/buildHeaders không nằm ở DefaultExecutor) → bỏ qua ở golden này.
// Chúng được lock riêng ở 11-provider edge tests / unit test chuyên biệt.
const SPECIALIZED = new Set([
  "antigravity", "azure", "gemini-cli", "github", "iflow", "qoder", "kiro",
  "codex", "cursor", "vertex", "vertex-partner", "qwen", "opencode",
  "opencode-go", "grok-web", "perplexity-web", "ollama-local", "commandcode",
  "xiaomi-tokenplan", "mimo-free", "opencode-zen",
]);

// Sanitize header: khử token + field thời gian động (kimi X-Msh-Device-Id) để snapshot ổn định.
function sanitize(headers) {
  const out = {};
  const dynamicValues = [process.version, hostname()].filter(Boolean);
  for (const [k, v] of Object.entries(headers)) {
    out[k] = typeof v === "string"
      ? v.replace(/Bearer .+/, "Bearer <TOK>")
          .replace(/sk-test-APIKEY|tok-test-ACCESS/g, "<CRED>")
          .replace(/kimi-\d{10,}/g, "kimi-<TS>")
          // Version headers (X-Msh-Version et al) track package.json, so a release
          // bump would otherwise churn every snapshot. Only the app's own version is
          // masked: upstream CLI versions (claude-cli/2.1.280, grok-shell/1.0.44, ...)
          // are pinned constants this golden set exists to guard, so a blanket
          // \d+\.\d+\.\d+ strip would let a real regression through.
          .replace(/^\d+\.\d+\.\d+$/, "<VER>")
          .replace(new RegExp(`VansRouter/${escapeRegExp(APP_VERSION)}`, "g"), "VansRouter/<VER>")
          .replace(new RegExp(dynamicValues.map(escapeRegExp).join("|"), "g"), "<ENV>")
          // Per-request session ids (MiniMax X-Mavis-Session-Id) are random per
          // call, so they can never be part of a stable snapshot.
          .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<UUID>")
      : v;
    // The MiniMax timezone offset is the host's offset, not a constant: it
    // differs per machine, so it cannot be pinned in a snapshot either.
    if (k === "X-Mavis-Timezone-Offset") out[k] = "<TZ>";
  }
  return out;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const providerIds = Object.keys(PROVIDERS).filter((p) => !SPECIALIZED.has(p)).sort();

describe("GOLDEN buildUrl (default executor providers)", () => {
  for (const pid of providerIds) {
    it(`${pid} → url (stream + non-stream)`, () => {
      const ex = new DefaultExecutor(pid);
      const cred = PROVIDERS[pid].noAuth ? {} : SPECIAL_CRED;
      const model = "test-model";
      const snap = {
        stream: safe(() => ex.buildUrl(model, true, 0, cred)),
        nonStream: safe(() => ex.buildUrl(model, false, 0, cred)),
      };
      expect(snap).toMatchSnapshot();
    });
  }
});

describe("GOLDEN buildHeaders (default executor providers)", () => {
  for (const pid of providerIds) {
    it(`${pid} → headers (apiKey / oauth)`, () => {
      const ex = new DefaultExecutor(pid);
      const snap = {
        apiKey: safe(() => sanitize(ex.buildHeaders(PROVIDERS[pid].noAuth ? {} : API_KEY_CRED, true))),
        oauth: safe(() => sanitize(ex.buildHeaders(PROVIDERS[pid].noAuth ? {} : OAUTH_CRED, true))),
        nonStream: safe(() => sanitize(ex.buildHeaders(PROVIDERS[pid].noAuth ? {} : API_KEY_CRED, false))),
      };
      expect(snap).toMatchSnapshot();
    });
  }
});

function safe(fn) {
  try { return fn(); } catch (e) { return `THROW: ${e.message}`; }
}
