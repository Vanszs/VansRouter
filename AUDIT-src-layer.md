# VansRouter — Next.js Application Layer Audit (`src/`)

**Date:** 2026-09-14  
**Scope:** Full audit of `src/` directory — routes, pages, SSE, DB, OAuth, MITM, Auth, Shared, Store

---

## 1. API Routes (`src/app/api/`)

### 1.1 Auth Routes
| Endpoint | Methods | Purpose |
|---|---|---|
| `/api/auth/login` | POST | Dashboard login (password or OIDC) |
| `/api/auth/logout` | POST | Clear auth cookie |
| `/api/auth/check` | GET | Verify JWT / requireLogin status |
| `/api/auth/status` | GET | Auth status (public path) |
| `/api/auth/reset-password` | POST | Reset password (LOCAL_ONLY) |
| `/api/auth/oidc/start` | GET | Begin OIDC flow |
| `/api/auth/oidc/callback` | GET | OIDC callback handler |
| `/api/auth/oidc/test` | POST | Test OIDC config |

### 1.2 LLM Proxy Routes (OpenAI-compatible, `/api/v1/`)
| Endpoint | Methods | Purpose |
|---|---|---|
| `/api/v1/chat/completions` | POST, OPTIONS | Chat completions proxy |
| `/api/v1/messages` | POST | Anthropic Messages API proxy |
| `/api/v1/messages/count_tokens` | POST | Anthropic token counting |
| `/api/v1/responses` | POST | OpenAI Responses API |
| `/api/v1/responses/compact` | POST | Compact responses |
| `/api/v1/embeddings` | POST | Embeddings proxy |
| `/api/v1/audio/speech` | POST | TTS proxy |
| `/api/v1/audio/transcriptions` | POST | STT proxy |
| `/api/v1/audio/voices` | GET | List TTS voices |
| `/api/v1/images/generations` | POST | Image generation proxy |
| `/api/v1/videos/generations` | POST | Video generation |
| `/api/v1/videos/edits` | POST | Video edits |
| `/api/v1/videos/extensions` | POST | Video extensions |
| `/api/v1/videos/[id]` | GET | Get video status |
| `/api/v1/models` | GET | List available models |
| `/api/v1/models/info` | GET | Model info |
| `/api/v1/models/[kind]` | GET | Models by kind (tts/embedding/etc) |
| `/api/v1/search` | POST | Web search proxy |
| `/api/v1/web/fetch` | POST | Web fetch/extraction proxy |
| `/api/v1/api/chat` | POST | Legacy chat endpoint |
| `/api/v1` | GET | Alias → models list |
| `/api/v1beta/models` | GET | Gemini-format models list |
| `/api/v1beta/models/[...path]` | GET/POST | Gemini-format proxy |

### 1.3 Provider Management Routes
| Endpoint | Methods | Purpose |
|---|---|---|
| `/api/providers` | GET, POST | List/create providers |
| `/api/providers/bulk` | POST | Bulk import providers |
| `/api/providers/client` | GET | Client-side provider data |
| `/api/providers/validate` | POST | Validate provider config |
| `/api/providers/suggested-models` | GET | Suggested model list |
| `/api/providers/circuit-breakers` | GET | Circuit breaker status |
| `/api/providers/circuit-breakers/[name]/reset` | POST | Reset circuit breaker |
| `/api/providers/test-batch` | POST | Batch test providers |
| `/api/providers/kilo/free-models` | GET | Kilo free model list |
| `/api/providers/[id]` | GET, PATCH, DELETE | CRUD single provider |
| `/api/providers/[id]/models` | GET | Provider-specific models |
| `/api/providers/[id]/test` | POST | Test provider connection |
| `/api/providers/[id]/test-models` | POST | Test provider models |
| `/api/providers/[id]/gcp-projects` | GET | GCP project list |

### 1.4 Model Management Routes
| Endpoint | Methods | Purpose |
|---|---|---|
| `/api/models` | GET | List all models |
| `/api/models/alias` | GET, POST, DELETE | Model alias CRUD |
| `/api/models/availability` | GET | Model availability status |
| `/api/models/catalog-sync` | POST | Sync model catalog |
| `/api/models/custom` | GET, POST, DELETE | Custom model CRUD |
| `/api/models/disabled` | GET, POST, DELETE | Disabled models CRUD |
| `/api/models/test` | POST | Test model |

### 1.5 OAuth Routes
| Endpoint | Methods | Purpose |
|---|---|---|
| `/api/oauth/[provider]/[action]` | GET, POST | Generic OAuth flow (start/callback) |
| `/api/oauth/codex/bulk-import` | POST | Bulk import Codex tokens |
| `/api/oauth/codex/import-token` | POST | Import single Codex token |
| `/api/oauth/cursor/auto-import` | POST | Auto-import Cursor creds (LOCAL_ONLY) |
| `/api/oauth/cursor/import` | POST | Import Cursor creds |
| `/api/oauth/gitlab/pat` | POST | Import GitLab PAT |
| `/api/oauth/grok-cli/bulk-import` | POST | Bulk import Grok CLI tokens |
| `/api/oauth/iflow/cookie` | POST | Import iFlow cookie |
| `/api/oauth/kiro/api-key` | POST | Import Kiro API key |
| `/api/oauth/kiro/auto-import` | POST | Auto-import Kiro creds (LOCAL_ONLY) |
| `/api/oauth/kiro/import` | POST | Import Kiro creds |
| `/api/oauth/kiro/import-cli-proxy` | POST | Import Kiro via CLI proxy |
| `/api/oauth/kiro/social-authorize` | POST | Kiro social OAuth start |
| `/api/oauth/kiro/social-exchange` | POST | Kiro social OAuth exchange |

### 1.6 Admin/Settings Routes
| Endpoint | Methods | Purpose |
|---|---|---|
| `/api/settings` | GET, PATCH | Get/update settings |
| `/api/settings/database` | POST | Database operations (ALWAYS_PROTECTED) |
| `/api/settings/proxy-test` | POST | Test outbound proxy |
| `/api/settings/require-login` | GET | Check requireLogin (public) |
| `/api/keys` | GET, POST | API key CRUD |
| `/api/keys/[id]` | PATCH, DELETE | Update/delete API key |
| `/api/shutdown` | POST | Shutdown (dev only, ALWAYS_PROTECTED) |
| `/api/init` | GET | App initialization (public) |
| `/api/health` | GET | Health check (public, CORS open) |
| `/api/version` | GET | App version |
| `/api/version/shutdown` | POST | Version shutdown (ALWAYS_PROTECTED) |
| `/api/version/update` | POST | App update (ALWAYS_PROTECTED) |
| `/api/locale` | GET, POST | Locale settings (public) |
| `/api/tags` | GET, POST, DELETE | Tags CRUD |
| `/api/pricing` | GET, POST | Pricing data |

### 1.7 Proxy Pools Routes
| Endpoint | Methods | Purpose |
|---|---|---|
| `/api/proxy-pools` | GET, POST | Proxy pool CRUD |
| `/api/proxy-pools/fitness` | GET | Fitness status |
| `/api/proxy-pools/fitness/clear-all` | POST | Clear all fitness |
| `/api/proxy-pools/cloudflare-deploy` | POST | Deploy to Cloudflare |
| `/api/proxy-pools/deno-deploy` | POST | Deploy to Deno |
| `/api/proxy-pools/vercel-deploy` | POST | Deploy to Vercel |
| `/api/proxy-pools/[id]` | GET, PATCH, DELETE | Single pool CRUD |
| `/api/proxy-pools/[id]/fitness/clear` | POST | Clear pool fitness |
| `/api/proxy-pools/[id]/test` | POST | Test proxy pool |

### 1.8 CLI Tools Routes
| Endpoint | Methods | Purpose |
|---|---|---|
| `/api/cli-tools/all-statuses` | GET | All tool statuses |
| `/api/cli-tools/antigravity-mitm` | GET, POST | MITM config (LOCAL_ONLY) |
| `/api/cli-tools/antigravity-mitm/alias` | GET, POST | MITM aliases |
| `/api/cli-tools/claude-settings` | GET, POST | Claude CLI settings |
| `/api/cli-tools/cline-settings` | GET, POST | Cline settings |
| `/api/cli-tools/codex-settings` | GET, POST | Codex settings |
| `/api/cli-tools/copilot-settings` | GET, POST | Copilot settings |
| `/api/cli-tools/cowork-settings` | GET, POST | Cowork settings (LOCAL_ONLY) |
| `/api/cli-tools/cowork-mcp-registry` | GET, POST | Cowork MCP registry |
| `/api/cli-tools/cowork-mcp-tools` | GET | Cowork MCP tools |
| `/api/cli-tools/deepseek-tui-settings` | GET, POST | DeepSeek TUI settings |
| `/api/cli-tools/devin-settings` | GET, POST | Devin settings |
| `/api/cli-tools/droid-settings` | GET, POST | Droid settings |
| `/api/cli-tools/grok-build-settings` | GET, POST | Grok Build settings |
| `/api/cli-tools/hermes-settings` | GET, POST | Hermes settings |
| `/api/cli-tools/jcode-settings` | GET, POST | JCode settings |
| `/api/cli-tools/kilo-settings` | GET, POST | Kilo settings |
| `/api/cli-tools/openclaw-settings` | GET, POST | OpenClaw settings |
| `/api/cli-tools/opencode-settings` | GET, POST | OpenCode settings |

### 1.9 Usage/Observability Routes
| Endpoint | Methods | Purpose |
|---|---|---|
| `/api/usage/stats` | GET | Usage statistics |
| `/api/usage/chart` | GET | Usage chart data |
| `/api/usage/history` | GET | Usage history |
| `/api/usage/logs` | GET | Usage logs |
| `/api/usage/providers` | GET | Per-provider usage |
| `/api/usage/request-details` | GET | Request details list |
| `/api/usage/request-details/[id]` | GET | Single request detail |
| `/api/usage/request-logs` | GET | Request logs |
| `/api/usage/stream` | GET | SSE usage stream |
| `/api/usage/[connectionId]` | GET | Per-connection usage |
| `/api/usage/[connectionId]/codex-reset-credits` | POST | Reset Codex credits |

### 1.10 Other Routes
| Endpoint | Methods | Purpose |
|---|---|---|
| `/api/combos` | GET, POST | Combo CRUD |
| `/api/combos/[id]` | PATCH, DELETE | Single combo CRUD |
| `/api/provider-nodes` | GET, POST | Provider nodes |
| `/api/provider-nodes/validate` | POST | Validate node |
| `/api/provider-nodes/[id]` | PATCH, DELETE | Single node CRUD |
| `/api/tunnel/enable` | POST | Enable tunnel (LOCAL_ONLY) |
| `/api/tunnel/disable` | POST | Disable tunnel (LOCAL_ONLY) |
| `/api/tunnel/status` | GET | Tunnel status |
| `/api/tunnel/tailscale-*` | Various | Tailscale operations (LOCAL_ONLY) |
| `/api/translator/*` | Various | Request translator |
| `/api/headroom/*` | Various | Headroom (token compression) |
| `/api/pxpipe/*` | Various | Pxpipe proxy |
| `/api/mcp/[plugin]/message` | POST | MCP plugin message |
| `/api/mcp/[plugin]/sse` | GET | MCP plugin SSE stream |
| `/api/media-providers/tts/*/voices` | GET | TTS voice lists |

### Auth Gaps & Security Concerns

1. **`/api/auth/check` uses a different JWT secret path** than `dashboardSession.js`. `check/route.js` calls `process.env.JWT_SECRET` directly and throws if missing, while `dashboardSession.js` generates and persists a secret to disk. If `JWT_SECRET` env var is not set, `check` fails but `login` succeeds — **inconsistent JWT verification**. This is a real bug: tokens minted by `dashboardSession.js` (file-based secret) won't verify in `check/route.js` (env-only secret).

2. **Default password `123456`** — hardcoded in `dashboardSession.js`. While common for local tools, if exposed via tunnel without changing password, this is a critical risk.

3. **`/api/keys` has no auth guard in the route handler itself** — it relies entirely on the `dashboardGuard.js` middleware. If the middleware is misconfigured or bypassed, all API keys are exposed. The route handler should have defense-in-depth auth checks.

4. **`/api/health` and `/api/init` are fully public** with no rate limiting. Health is fine; init could be probed.

5. **CORS on v1 routes is `Access-Control-Allow-Origin: *`** — intentional for API proxy use, but means any website can make credentialed requests to the proxy if the user's browser has access.

6. **Settings PATCH strips `password` and `mitmSudoEncrypted`** from body (CWE-915 protection) — good. But the OIDC client secret is writable via settings PATCH without re-auth verification.

7. **`/api/shutdown` has dual protection** (production block + secret check) — good.

---

## 2. Dashboard Pages (`src/app/(dashboard)/`)

### All Pages
| Path | Purpose |
|---|---|
| `/dashboard` | Main dashboard overview |
| `/dashboard/basic-chat` | Built-in chat interface |
| `/dashboard/cli-tools` | CLI tools index (Codex, Claude, Hermes, etc.) |
| `/dashboard/cli-tools/[toolId]` | Individual CLI tool detail |
| `/dashboard/combos` | Model combos (fallback chains) |
| `/dashboard/console-log` | Live console log viewer |
| `/dashboard/endpoint` | Endpoint configuration |
| `/dashboard/media-providers/[kind]` | Media providers by kind (TTS, STT, etc.) |
| `/dashboard/media-providers/[kind]/[id]` | Media provider detail with example cards |
| `/dashboard/media-providers/combo/[id]` | Combo media provider |
| `/dashboard/media-providers/web` | Web search/fetch providers |
| `/dashboard/mitm` | MITM proxy management |
| `/dashboard/profile` | User profile / password change |
| `/dashboard/providers` | Provider connections list |
| `/dashboard/providers/new` | Add new provider |
| `/dashboard/providers/[id]` | Provider detail (connections, models, circuit breakers) |
| `/dashboard/proxy-fitness` | Proxy pool fitness dashboard |
| `/dashboard/proxy-pools` | Proxy pools management |
| `/dashboard/pxpipe` | Pxpipe management |
| `/dashboard/quota` | Provider quota/limits view |
| `/dashboard/skills` | Skills management |
| `/dashboard/token-saver` | Token compression (Headroom) settings |
| `/dashboard/translator` | Request translator |
| `/dashboard/usage` | Usage analytics (charts, tables, request details) |

### Other Pages (outside dashboard layout)
| Path | Purpose |
|---|---|
| `/login` | Login page |
| `/masuk` | Alternate login page (Indonesian "masuk" = "login") |
| `/landing` | Landing/marketing page |
| `/callback` | OAuth callback handler |
| `/dashboard/settings/pricing` | Pricing settings (outside dashboard group layout) |

### What Works Well
- Comprehensive CLI tool support (15+ tools with individual config cards)
- Rich usage analytics with charts, tables, per-request detail views
- Media provider pages cover TTS/STT/embedding/image/video/search/fetch
- Provider detail page has circuit breaker badges, model availability, connection management

### Missing/Could Improve
- **No dedicated settings page** in the dashboard layout — settings CRUD goes through API but has no unified settings UI page
- **No audit log page** — settings changes, OAuth events, login attempts are not surfaced in UI
- **No user management page** — single-user model, but no way to manage API key permissions through the UI beyond creation
- **`/dashboard/settings/pricing`** is outside the dashboard group layout — will lack sidebar/header

---

## 3. SSE Handlers (`src/sse/`)

### Handlers
| File | Endpoint | Purpose |
|---|---|---|
| `handlers/chat.js` (583 lines) | `/v1/chat/completions`, `/v1/messages`, `/v1/responses` | Main chat proxy with account rotation, circuit breakers, combo routing |
| `handlers/embeddings.js` (239 lines) | `/v1/embeddings` | Embeddings with auth + account fallback |
| `handlers/tts.js` (143 lines) | `/v1/audio/speech` | TTS with provider credential routing |
| `handlers/stt.js` (116 lines) | `/v1/audio/transcriptions` | STT with multipart form handling |
| `handlers/imageGeneration.js` (170 lines) | `/v1/images/generations` | Image generation with retry rotation |
| `handlers/videoGeneration.js` (223 lines) | `/v1/videos/*` | Video generation (xAI-only currently) |
| `handlers/search.js` (274 lines) | `/v1/search` | Web search proxy |
| `handlers/fetch.js` (248 lines) | `/v1/web/fetch` | Web fetch with SSRF guard |

### Services
| File | Purpose |
|---|---|
| `services/auth.js` (492 lines) | Credential selection, API key validation, ACL enforcement, per-provider mutex |
| `services/tokenRefresh.js` (327 lines) | Token refresh for all OAuth providers (Claude, Google, Qwen, Codex, Kiro, etc.) |
| `services/model.js` (108 lines) | Model parsing, alias resolution, combo detection |
| `services/allowedModels.js` (751 lines) | Model availability, live model resolution for Kiro/Copilot/Cursor/etc. |
| `services/internalTrust.js` (62 lines) | CLI/dashboard trust token validation (constant-time comparison) |
| `services/antigravityQuota.js` | Antigravity quota cache/tracking |
| `services/kimchiQuotaReactivation.js` | Kimchi daily quota reactivation |

### Request Flow (chat.js example)
1. Parse request body
2. Extract API key → validate if `requireApiKey` is on
3. Check `isTrustedInternalRequest` → bypass ACLs for local dashboard
4. Resolve model (alias → provider:model, combo detection)
5. Check model allowed per API key ACLs
6. Acquire per-provider mutex → select credential (round-robin/priority)
7. Check circuit breaker → skip provider if in cooldown
8. Refresh OAuth token if near expiry
9. Delegate to `handleChatCore` (open-sse library)
10. Record usage on success/failure
11. On 429/401/5xx: mark account unavailable, retry with next account

### What Works Well
- **Per-provider mutex** prevents race conditions in credential selection
- **Circuit breaker pattern** with cooldown and automatic retry
- **SSRF guard** on fetch handler (`assertPublicUrl`)
- **Constant-time token comparison** in internalTrust.js
- **Combo/fallback chains** with multiple strategy options
- **Account semaphore** for concurrency limiting per account

### Gaps & Concerns
- `videoGeneration.js` lacks `isTrustedInternalRequest` check — doesn't bypass ACLs for dashboard
- `fetch.js` imports `isTrustedInternalRequest` but the function is not imported (line 10 shows it's not in the destructured import) — **potential bug**: fetch handler may not properly bypass ACLs for internal requests
- Error responses in handlers sometimes leak provider details (`provider`, `connectionId`) which could aid enumeration
- No per-endpoint rate limiting on the proxy routes — relies entirely on upstream provider limits

---

## 4. Database Layer (`src/lib/db/`)

### Schema (`schema.js`, SCHEMA_VERSION = 8)
| Table | Purpose | Key Columns |
|---|---|---|
| `_meta` | Key-value metadata | key, value |
| `settings` | App settings (singleton) | id=1, data (JSON) |
| `providerConnections` | OAuth/API key connections | id, provider, authType, data (JSON), priority |
| `providerNodes` | Custom provider nodes | id, type, name, data (JSON) |
| `proxyPools` | HTTP proxy pools | id, isActive, testStatus, data (JSON) |
| `proxyPoolFitness` | Proxy health scoring | poolId, scope, until, reason |
| `apiKeys` | API keys for proxy access | id, key (UNIQUE), name, machineId, isActive |
| `combos` | Model fallback chains | id, name (UNIQUE), kind, models (JSON) |
| `kv` | Generic key-value store | scope, key, value |
| `usageHistory` | Request usage logs | id (AUTOINCREMENT), timestamp, provider, model, tokens |
| `usageDaily` | Daily aggregated usage | dateKey, data (JSON) |
| `requestDetails` | Full request/response capture | id, timestamp, data (JSON) |
| `cachedProviderModels` | Cached model lists | providerId, modelId, kind, data (JSON) |

### Adapters (4 drivers)
| Adapter | Purpose |
|---|---|
| `betterSqliteAdapter.js` | Primary — better-sqlite3 (sync, fast, WAL with periodic checkpoint) |
| `bunSqliteAdapter.js` | Bun runtime support |
| `nodeSqliteAdapter.js` | Node.js built-in sqlite |
| `sqljsAdapter.js` | sql.js (WASM fallback) |

### Repos (13 repos)
`aliasRepo`, `apiKeysRepo`, `cachedModelsRepo`, `combosRepo`, `connectionsRepo`, `disabledModelsRepo`, `nodesRepo`, `pricingRepo`, `proxyPoolFitnessRepo`, `proxyPoolsRepo`, `requestDetailsRepo`, `settingsRepo`, `usageRepo`

### Migrations (6 files)
001-initial → 002-fix-empty-allowed-lists → 003-add-allowed-lists-columns → 004-add-request-details-apikey → 007-add-combo-context-length → 008-add-proxy-pool-fitness

**Note:** Migrations 005 and 006 are missing (likely skipped or handled by schema sync).

### What Works Well
- **Declarative schema** with additive auto-sync (`syncSchemaFromTables`) — new columns/tables added automatically
- **WAL mode** with periodic checkpoint (60s) keeps database performant
- **Graceful shutdown** flushes WAL on SIGINT/SIGTERM
- **4 adapter options** for different runtimes (better-sqlite3, Bun, Node, WASM)
- **JSON column pattern** (`data TEXT NOT NULL`) with `parseJson`/`stringifyJson` helpers — flexible schema evolution
- **Backup before schema migration** when version bumps

### Gaps
- **No connection pooling** — single adapter instance, fine for SQLite but limits concurrency
- **Sensitive data in `providerConnections.data`** — OAuth tokens stored in JSON text column. Encryption at rest depends on OS-level disk encryption; no application-level encryption
- **`usageHistory` has no auto-cleanup** — grows unbounded. Only `observabilityMaxRecords` in settings but enforcement unclear
- **`apiKeys` table lacks `allowedProviders/allowedCombos/allowedKinds` columns in schema** — migration 003 adds them but schema.js doesn't show them (they may be in the truncated portion)
- **No foreign key constraints** between tables (e.g., proxyPoolFitness.poolId → proxyPools.id) despite `PRAGMA foreign_keys = ON`

---

## 5. OAuth (`src/lib/oauth/`)

### Providers (from `constants/oauth.js` + `providers.js`)
| Provider | Flow Type | Token Refresh |
|---|---|---|
| Claude (Anthropic) | Authorization Code + PKCE | ✅ `refreshClaudeOAuthToken` |
| Codex (OpenAI) | Authorization Code + PKCE | ✅ `refreshCodexToken` |
| Gemini (Google) | Standard OAuth2 | ✅ `refreshGoogleToken` |
| Qwen (Alibaba) | Device Code + PKCE | ✅ `refreshQwenToken` |
| Qoder | Device Token + PKCE | ❌ Refresh returns 403 — requires re-login |
| iFlow | Authorization Code | ✅ `refreshIflowToken` |
| GitHub | Standard OAuth2 | ✅ `refreshGitHubToken` |
| Copilot | Via GitHub token | ✅ `refreshCopilotToken` |
| Cursor | Custom import | Unclear |
| xAI (Grok) | OIDC Discovery | ✅ `refreshAccessToken` |
| Kiro (AWS) | Social + API key | ✅ `refreshKiroToken` |
| Antigravity | Google OAuth2 | ✅ via provider module |
| Kimchi | Custom | ✅ via provider module |
| Freebuff | Custom | ✅ via provider module |
| Kimi | From registry | Unclear |
| Kilocode | From registry | Unclear |
| Cline/Clinepass | From registry | Unclear |
| GitLab | PAT import | N/A (static token) |
| CodeBuddy/Intl | From registry | Unclear |
| ZAI | From registry | Unclear |
| Grok CLI | Token import | Unclear |

### Structure
- `providers.js` (1667 lines) — Monolith with all provider configurations and OAuth flow implementations
- `constants/oauth.js` — Static configs imported from `open-sse/providers/` registry
- `constants/xai.js` — xAI-specific OIDC constants
- `providers/` — Individual provider modules (kiro, antigravity, kimchi, freebuff)
- `services/` — CLI-oriented OAuth services (codex, cursor, kiro, oauth, qoder, xai)
- `utils/` — PKCE, local server, UI spinner

### What Works Well
- **PKCE** used for all browser-based OAuth flows
- **Token refresh** is centralized in `tokenRefresh.js` with per-provider dispatch
- **XAI OAuth endpoint validation** checks exact domain matching (`*.x.ai`)
- **Registry-driven config** — most provider configs come from `open-sse/providers/registry`
- **Bulk import** support for Codex and Grok CLI tokens

### Gaps & Security
- **`providers.js` is 1667 lines** — should be split per provider
- **Qoder refresh is documented as broken** (upstream 403) — users must manually re-login
- **No token rotation** — if a refresh token leaks, it's valid until the provider revokes it
- **Cursor/Kiro auto-import reads local files** (LOCAL_ONLY protected, which is good)
- **OAuth state not bound to user session** — no CSRF binding beyond random state parameter
- **Missing: rate limiting on OAuth callback endpoints** — could be used for token enumeration
- **Client secrets for Google OAuth are embedded** in `open-sse/providers/shared.js` — standard for desktop apps but worth noting

---

## 6. MITM Proxy (`src/mitm/`)

### Architecture
The MITM proxy runs as a separate Node.js child process on port 443, intercepting HTTPS traffic from IDE tools and rerouting through VansRouter.

### Components
| File | Purpose |
|---|---|
| `server.js` (433 lines) | HTTPS server with SNI callback, request interception, model mapping |
| `manager.js` (883 lines) | Process lifecycle, DNS management, cert installation, elevated ops |
| `config.js` (138 lines) | Target hosts, URL patterns, model synonyms |
| `cert/generate.js` | Root CA generation + per-domain leaf cert |
| `cert/rootCA.js` (173 lines) | Root CA lifecycle with node-forge, auto-regeneration on expiry |
| `cert/install.js` (272 lines) | Cross-platform cert trust store installation |
| `dns/dnsConfig.js` (266 lines) | `/etc/hosts` / Windows hosts file manipulation |
| `handlers/antigravity.js` | Antigravity (Gemini) interception → OpenAI format |
| `handlers/copilot.js` | Copilot interception → mapped endpoint |
| `handlers/kiro.js` (538 lines) | Kiro (AWS) interception with EventStream (CRC32) |
| `handlers/cursor.js` | Cursor — **stub only** (returns 501) |
| `handlers/base.js` | Base handler: fetchRouter(), pipeSSE() |
| `winElevated.js` | Windows UAC elevation for admin ops |
| `dbReader.js` | Read MITM aliases from database |

### Target Hosts Intercepted
- `daily-cloudcode-pa.googleapis.com` / `cloudcode-pa.googleapis.com` (Antigravity/Gemini)
- `api.individual.githubcopilot.com` (Copilot)
- `q.us-east-1.amazonaws.com` / `codewhisperer.us-east-1.amazonaws.com` (Kiro)
- `runtime.us-east-1.kiro.dev` (Kiro)
- `api2.cursor.sh` (Cursor — stub)

### Host Rewrite
`cloudcode-pa.googleapis.com` → `daily-cloudcode-pa.googleapis.com` (to avoid 429 rate limits)

### What Works Well
- **Dynamic SNI-based cert generation** (one root CA → per-domain leaf certs)
- **Root CA auto-regeneration** when within 30 days of expiry
- **Atomic hosts file writes** on Windows (NTFS rename trick with rollback)
- **Cross-platform cert installation** (Windows/macOS/Linux with Debian/Arch/Fedora/openSUSE)
- **Model synonym mapping** with regex fallback patterns
- **Kiro handler** implements full AWS EventStream binary protocol (CRC32 framing)

### Gaps & Security
- **Cursor handler is a stub** — returns 501 "coming soon"
- **Root CA private key stored on disk** (`MITM_DIR/rootCA.key`) — if compromised, attacker can MITM any site the user visits
- **DNS modification requires sudo/admin** — elevated ops could be abused if VansRouter process is compromised
- **No cert pinning bypass detection** — if target apps update cert pins, MITM silently fails
- **`execSync` used for lsof and other system commands** — potential for command injection if inputs aren't sanitized (review needed for `manager.js`)
- **`clearDumpDir()` on startup** — debug dump files from previous sessions are deleted, no rotation policy
- **Manager restart logic** has max 5 restarts with exponential backoff — good, but failure recovery could be surfaced better in UI

---

## 7. Auth (`src/lib/auth/`)

### Components
| File | Purpose |
|---|---|
| `dashboardSession.js` (82 lines) | JWT token creation/verification, bcrypt password, cookie management |
| `routeAuth.js` (21 lines) | Dashboard auth check (CLI token OR JWT OR requireLogin=false) |
| `loginLimiter.js` (63 lines) | Progressive lockout (5 fails → 30s → 2m → 10m → 30m) |
| `oidc.js` (234 lines) | Full OIDC provider support with PKCE, discovery, token exchange |
| `trustedPeer.js` (3 lines) | Peer token validation (`x-9r-peer-token`) |

### Auth Flow
1. **Password login**: POST `/api/auth/login` → check IP lock → verify password → set JWT cookie (24h, httpOnly, sameSite=lax)
2. **OIDC login**: GET `/api/auth/oidc/start` → redirect to IdP → callback → verify ID token → set JWT cookie
3. **CLI token**: `x-9r-cli-token` header with machine-bound HMAC → bypass login
4. **API key**: `Authorization: Bearer sk-...` header → HMAC-validated (machineId + keyId + CRC8)
5. **No-auth mode**: `requireLogin=false` → all dashboard routes accessible

### Security Analysis

**Strengths:**
- JWT with HS256 + auto-generated 32-byte secret persisted to disk
- bcrypt for password hashing
- Progressive lockout with per-IP tracking (in-memory, resets on restart)
- httpOnly + sameSite=lax cookies
- Secure cookie flag when behind HTTPS proxy
- CLI token uses constant-time comparison (in `internalTrust.js`)
- Protected settings have mass-assignment guard (CWE-915)
- LOCAL_ONLY paths restricted to loopback addresses

**Concerns:**
1. **JWT secret inconsistency** (see Section 1 — `/api/auth/check` uses env-only, `dashboardSession.js` uses file-based)
2. **Default password "123456"** — should force password change on first login
3. **Lockout is in-memory** — restarting the server resets all lockouts
4. **No CSRF token** for state-changing POST endpoints beyond sameSite=lax
5. **JWT has no refresh mechanism** — 24h fixed expiry, no sliding window
6. **API key format `sk-{machineId}-{keyId}-{crc8}`** embeds machineId — leaked key reveals machine identity
7. **`requireLogin=false` disables all dashboard auth** — one setting exposes everything
8. **Trusted peer token** is a single shared secret from env var — no rotation mechanism
9. **No 2FA/MFA support**

---

## 8. Shared Components/Constants (`src/shared/`)

### Components (40+ files)
| Component | Purpose |
|---|---|
| `DashboardLayout.js` | Main layout with sidebar, header |
| `Sidebar.js` | Navigation sidebar |
| `Header.js` / `HeaderMenu.js` / `HeaderLanguage.js` | Top header with search, menu, language |
| `Modal.js` / `Drawer.js` | Generic modal and drawer components |
| `Button.js` / `Input.js` / `Select.js` / `Toggle.js` | Form elements |
| `Card.js` / `Badge.js` / `Tooltip.js` | Display components |
| `OAuthModal.js` / `CursorAuthModal.js` / `GitLabAuthModal.js` / `KiroAuthModal.js` / `KiroSocialOAuthModal.js` / `IFlowCookieModal.js` | Provider-specific auth modals |
| `ComboFormModal.js` / `PricingModal.js` / `ManualConfigModal.js` / `McpMarketplaceModal.js` | Feature modals |
| `ProviderIcon.js` / `ProviderInfoCard.js` | Provider display |
| `UsageStats.js` / `RequestLogger.js` | Analytics components |
| `ThemeProvider.js` / `ThemeToggle.js` | Dark/light theme |
| `LanguageSwitcher.js` | i18n language selection |
| `Pagination.js` / `SegmentedControl.js` / `Loading.js` | UI utilities |
| `Avatar.js` / `CapacityBadges.js` | Status indicators |

### Constants
| File | Purpose |
|---|---|
| `config.js` | App-level config (theme defaults, etc.) |
| `providers.js` (179 lines) | Provider definitions from registry |
| `providersDisplay.js` | Provider UI display metadata |
| `models.js` | Model catalogs and metadata |
| `cliTools.js` | CLI tool definitions |
| `suggestedModels.js` | Suggested model presets |
| `skills.js` | Skills definitions |
| `locales.js` | Supported locales |
| `mitmToolHosts.cjs` | MITM target hosts (CJS for MITM subprocess) |
| `coworkPlugins.js` | Cowork MCP plugin registry |
| `ttsProviders.js` | TTS provider configs |

### Hooks
| Hook | Purpose |
|---|---|
| `useCircuitBreakers.js` | Circuit breaker state |
| `useCopyToClipboard.js` | Clipboard utility |
| `useModelCaps.js` | Model capability detection |
| `useTheme.js` | Theme management |

### Utils
| Utility | Purpose |
|---|---|
| `api.js` | API fetch wrapper |
| `apiKey.js` (132 lines) | API key generation with HMAC-CRC |
| `ssrfGuard.js` (109 lines) | SSRF protection (blocked private IPs, DNS resolution) |
| `machineId.js` | Consistent machine identification |
| `cn.js` | className utility (tailwind merge) |
| `runtime.js` | Runtime detection |
| `connectionStatus.js` | Connection health |
| `providerAuth.js` / `providerIcon.js` / `providerCustomModels.js` / `providerModelsFetcher.js` | Provider utilities |
| `bulkAdd.js` | Bulk provider import |
| `clineAuth.js` | Cline auth helper |
| `aclProviderList.js` | ACL provider filtering |

### Services
| Service | Purpose |
|---|---|
| `bootstrap.js` | App initialization on server start |
| `initializeApp.js` | Full init sequence (DB, tunnels, DNS, etc.) |
| `quotaAutoPing.js` | Automatic quota checking |

### What Works Well
- Well-organized component library with consistent patterns
- SSRF guard is comprehensive (IPv4/IPv6, DNS rebinding, private ranges)
- API key system uses HMAC-CRC for tamper detection
- i18n support with language switcher

### Concerns
- `mitmToolHosts.cjs` uses CommonJS (required by MITM subprocess) while rest is ESM — minor inconsistency
- Some auth modals embed provider-specific logic that could be generalized

---

## 9. Store (`src/store/`)

### Stores (3 files, all Zustand)
| Store | Purpose | Persistence |
|---|---|---|
| `themeStore.js` (54 lines) | Theme state (dark/light/system) | `zustand/persist` (localStorage) |
| `notificationStore.js` (45 lines) | Toast notification queue | In-memory only |
| `headerSearchStore.js` (19 lines) | Global header search input state | In-memory only |

### What Works Well
- Lightweight Zustand stores — minimal boilerplate
- Theme store uses persist middleware for cross-session theme memory
- Notification store has auto-dismiss with configurable duration
- Header search uses register/unregister pattern for page-specific placeholders

### Potential Improvements
- **No provider/connection state store** — all provider data is fetched fresh from API each time. A client-side cache store could reduce API calls
- **No auth state store** — auth status is checked per-navigation; a store could avoid redundant `/api/auth/check` calls
- **No error boundary store** — errors in `error.js` and `global-error.js` aren't tracked centrally

---

## Summary of Top Findings

### Critical
1. **JWT secret mismatch** between `dashboardSession.js` (file-based) and `auth/check/route.js` (env-only) — tokens may fail verification
2. **Default password "123456"** with no forced change
3. **Root CA private key on disk** without application-level protection

### High
4. **`requireLogin=false` bypasses all dashboard auth** — single toggle exposes entire admin interface
5. **OAuth tokens stored as plaintext JSON** in SQLite
6. **CORS `*` on all v1 proxy endpoints** — any origin can use the proxy
7. **No rate limiting on proxy endpoints** — relies on upstream limits only

### Medium
8. **In-memory lockout resets on restart** — attacker can force restart to bypass
9. **No CSRF protection** beyond sameSite=lax cookies
10. **No 2FA/MFA support**
11. **Cursor MITM handler is a stub** (501)
12. **Missing migrations 005-006** in sequence
13. **`/api/keys` route has no defense-in-depth auth** (relies solely on middleware)
14. **Video handler missing `isTrustedInternalRequest` check**

### Low
15. **API key leaks machineId** in key format
16. **Notification store has no persistence** — toasts lost on navigation
17. **No audit log** for admin actions
18. **`providers.js` is 1667-line monolith** — should be split
