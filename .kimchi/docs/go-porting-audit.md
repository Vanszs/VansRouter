# 9router Backend Go Porting Audit

**Project:** VansRoute / 9router  
**Repository:** `/media/DiskE/Code/9router-new`  
**Branch:** `go-port`  
**Audit date:** 2026-06-29  
**Output:** `.kimchi/docs/go-porting-audit.md`

---

## 1. Executive Summary

VansRoute is a Next.js 16 + Node 20 universal AI gateway built around a single OpenAI-compatible `/v1` surface. The backend that needs porting to Go consists of:

- ~120+ API route handlers under `src/app/api/`
- An SSE engine (`open-sse/`) with provider executors, format translators, resilience primitives, token savers, and OAuth/token refresh
- Auth/ACL, API-key management, dashboard session logic
- SQLite persistence layer with multiple adapters and schema migrations
- Usage/observability tracking and request-detail logging
- A Node CLI (`cli/`) that bootstraps the standalone server

**Core porting thesis:** The Go backend should expose the same `/v1/*` and dashboard API contracts, reuse the existing provider registry/translator logic by porting it faithfully, and keep the Next.js frontend as a thin client. The hardest parts are the provider-specific request/response translators, OAuth flows, SSE streaming semantics, and the deeply-stateful resilience layer (circuit breaker + account semaphore + account fallback).

**Estimated overall complexity:** High. The codebase is ~2114 backend-related nodes per the extracted knowledge graph, with heavy provider-by-provider edge cases. A pragmatic port should be phased, starting with the `/v1/chat/completions` hot path, then embeddings/tts/image, then dashboard CRUD, then the CLI.

---

## 2. Backend Feature Inventory

| Feature | Primary Files | LoC/Scale | Go Porting Complexity | Notes |
|---------|---------------|-----------|----------------------|-------|
| **HTTP API routes** | `src/app/api/**/*.js` (~120 files) | Large | Medium | Mostly CRUD wrappers over DB + SSE handlers. Straightforward Gin/Echo/hmux equivalents. |
| **Chat completions** | `src/app/api/v1/chat/completions/route.js`, `src/sse/handlers/chat.js`, `open-sse/handlers/chatCore.js`, `open-sse/handlers/chatCore/*.js` | Very Large | **High** | Retry loop, ACL, combo handling, translation, streaming/non-streaming, usage tracking. |
| **Format translation** | `open-sse/translator/**/*.js` (~35 files) | Large | **High** | Bidirectional OpenAI↔Claude↔Gemini↔Kiro↔Cursor↔Ollama↔CommandCode. Must preserve quirks. |
| **Provider executors** | `open-sse/executors/*.js` (~22 files) | Medium | **High** | Per-provider HTTP dispatch, auth headers, retries, token refresh, custom bodies. |
| **Provider registry/models** | `open-sse/providers/registry/*.js` (~115 files), `open-sse/providers/index.js`, `open-sse/config/providerModels.js`, `src/shared/constants/models.js`, `src/shared/constants/providers.js` | Very Large | Medium | Declarative config; can be code-generated or loaded as JSON/YAML in Go. |
| **Resilience (circuit breaker)** | `open-sse/utils/circuitBreaker.js`, `src/shared/utils/circuitBreaker.js` | Small | Medium | In-memory state machine; easy in Go, but tests must prove identical semantics. |
| **Resilience (account semaphore)** | `open-sse/services/accountSemaphore.js` | Small | Medium | In-memory FIFO concurrency gate per `provider:account:proxy`. |
| **Resilience (account fallback)** | `open-sse/services/accountFallback.js`, `open-sse/utils/classify429.js`, `open-sse/utils/cooldownRetry.js` | Medium | **High** | 429 classification, exponential backoff, per-model locks, quota detection (Kimchi/daily). |
| **Combo strategies** | `open-sse/services/combo.js` | Medium | **High** | Fallback, round-robin, capacity auto-switch, fusion (parallel panel + judge). |
| **Token savers** | `open-sse/rtk/**/*.js` (~22 files) | Medium | **High** | RTK compression, Caveman/Ponytail prompts, loop guard, tool deduper. |
| **Auth / ACL** | `src/sse/services/auth.js`, `src/lib/auth/*.js`, `src/sse/services/internalTrust.js` | Medium | Medium | API-key validation, allowedProviders/Combos/Kinds, internal-trust bypass. |
| **OAuth** | `src/lib/oauth/**/*.js` (~25 files), `open-sse/services/tokenRefresh*.js`, `open-sse/services/oauthCredentialManager.js` | Large | **High** | PKCE, per-provider token exchange/refresh, GitHub Copilot token, Vertex SA-JWT. |
| **Database layer** | `src/lib/db/**/*.js` (~25 files) | Large | Medium | SQLite via better-sqlite3/node:sqlite/sql.js. Go can use `database/sql` + `modernc.org/sqlite` or `mattn/go-sqlite3`. |
| **Models / aliases / pricing** | `src/lib/db/repos/{alias,pricing,combos,nodes,proxyPools,disabledModels,apiKeys}Repo.js`, `src/lib/disabledModelsDb.js`, `src/lib/providerNormalization.js` | Medium | Low-Medium | Mostly CRUD over SQLite. |
| **Usage / observability** | `src/lib/db/repos/usageRepo.js`, `src/lib/usageDb.js`, `src/lib/requestDetailsDb.js`, `open-sse/utils/requestLogger.js`, `open-sse/utils/usageTracking.js` | Large | Medium | Pending-request counters, EventEmitter stats, daily rollups, cost calculation, request-detail persistence. |
| **Embeddings** | `src/app/api/v1/embeddings/route.js`, `src/sse/handlers/embeddings.js`, `open-sse/handlers/embeddingsCore.js`, `open-sse/handlers/embeddingProviders/*.js` | Medium | Medium | Auth + fallback loop + provider adapters. |
| **TTS** | `src/app/api/v1/audio/speech/route.js`, `src/sse/handlers/tts.js`, `open-sse/handlers/ttsCore.js`, `open-sse/handlers/ttsProviders/*.js` | Medium | Medium | Binary audio responses, multiple provider adapters. |
| **STT** | `src/app/api/v1/audio/transcriptions/route.js`, `src/sse/handlers/stt.js`, `open-sse/handlers/sttCore.js` | Small | Medium | Multipart form parsing. |
| **Image generation** | `src/app/api/v1/images/generations/route.js`, `src/sse/handlers/imageGeneration.js`, `open-sse/handlers/imageGenerationCore.js`, `open-sse/handlers/imageProviders/*.js` | Medium | **High** | Binary image responses, async polling, SSE passthrough (Codex), many adapters. |
| **Models list** | `src/app/api/v1/models/route.js`, `src/sse/services/allowedModels.js`, `src/sse/services/model.js`, `open-sse/services/model.js` | Medium | **High** | Builds allowed model list from connections, combos, aliases, custom models, fetchers, disabled models. |
| **Search / fetch** | `src/app/api/v1/search/route.js`, `src/app/api/v1/web/fetch/route.js`, `src/sse/handlers/search.js`, `open-sse/handlers/search/*.js`, `open-sse/handlers/fetch/*.js` | Small | Medium | Web search/fetch via chat provider or dedicated endpoints. |
| **Tunnel / proxy** | `src/lib/tunnel/**/*.js`, `src/lib/network/*.js`, `src/lib/proxy.js`, `src/mitm/*.js` | Medium | Medium-High | Cloudflare/Tailscale tunnel management, outbound proxy, MITM alias cache. |
| **MCP bridge** | `src/lib/mcp/*.js`, `src/app/api/mcp/**/*.js` | Small | Medium | stdio↔SSE bridge for MCP plugins. |
| **Headroom compression** | `open-sse/rtk/headroom.js`, `src/lib/headroom/*.js` | Small | Medium | Optional external proxy compression service. |
| **CLI bootstrap** | `cli/cli.js`, `cli/src/cli/**/*.js`, `server.js`, `custom-server.js` | Medium | Medium | Spawns standalone Node server. If backend becomes Go, CLI becomes a Go wrapper or is replaced by `go run`. |
| **Dashboard session** | `src/lib/auth/dashboardSession.js`, `src/lib/auth/loginLimiter.js`, `src/app/api/auth/**/*.js` | Small | Low | JWT cookie session, password login, OIDC. |

---

## 3. File-by-File Porting List

### 3.1 Server bootstrap & routing

| File | What it does | Go equivalent / notes |
|------|--------------|----------------------|
| `server.js` | Sets `PORT=3003` and requires Next standalone server. | Replaced by Go `main` with `http.Server`; keep env defaults. |
| `custom-server.js` | Patches `http.createServer` to derive real client IP and strip spoofed `X-Forwarded-For`. | Port to Go middleware (read `RemoteAddr`, trust loopback XFF). |
| `next.config.mjs` | Next.js config, standalone output. | Not needed for Go backend; keep for Next.js frontend only. |
| `src/app/api/v1/route.js`, `src/app/api/v1/*` | OpenAI-compatible API surface. | Map to Go router handlers. |

### 3.2 Chat hot path (highest priority)

| File | Role | Complexity |
|------|------|------------|
| `src/app/api/v1/chat/completions/route.js` | Route entry, CORS, calls `handleChat`. | Low |
| `src/sse/handlers/chat.js` | Auth, model resolution, combo expansion, circuit-breaker gate, credential selection loop, account semaphore, cooldown retry, calls `handleChatCore`. | **High** |
| `open-sse/handlers/chatCore.js` | Format detection, translation, token savers, executor dispatch, token refresh, non-streaming/streaming/coerced response handling. | **High** |
| `open-sse/handlers/chatCore/streamingHandler.js` | SSE transform stream selection, early-EOF peek, disconnect-aware pipe, usage tracking. | **High** |
| `open-sse/handlers/chatCore/nonStreamingHandler.js` | JSON response translation (Claude/Gemini/Ollama → OpenAI), Kimi tool parser, usage tracking. | **High** |
| `open-sse/handlers/chatCore/sseToJsonHandler.js` | Parse provider SSE into OpenAI non-stream response. | Medium |
| `open-sse/handlers/chatCore/coercedSseHandler.js` | NVIDIA Kimi `stream=false` upstream → SSE downstream. | Medium |
| `open-sse/handlers/chatCore/requestDetail.js` | Build request-detail rows and usage stats. | Low |

### 3.3 Translator layer

| File | Role | Complexity |
|------|------|------------|
| `open-sse/translator/index.js` | Registry + `translateRequest`/`translateResponse` orchestration. | **High** |
| `open-sse/translator/formats.js`, `open-sse/translator/schema/*.js` | Format constants and schema helpers. | Medium |
| `open-sse/translator/request/*.js` (12 files) | Source→OpenAI→Target request transformers. | **High** (must be ported one-by-one). |
| `open-sse/translator/response/*.js` (11 files) | Target→OpenAI→Source response transformers. | **High**. |
| `open-sse/translator/concerns/*.js` (14 files) | Shared concerns: tool calls, thinking, reasoning, modalities, image prefetch, JSON schema, finish reasons, usage. | **High**. |
| `open-sse/translator/formats/{claude,gemini,openai,responsesApi,maxTokens}.js` | Format-specific helpers. | **High**. |

### 3.4 Provider execution layer

| File | Role | Complexity |
|------|------|------------|
| `open-sse/executors/index.js` | Executor registry (`getExecutor`). | Low |
| `open-sse/executors/base.js` | Base executor: retry loop, connect timeout, abort signal merging, `proxyAwareFetch`. | **High** |
| `open-sse/executors/default.js` | Default executor: header/auth quirks, URL building, OAuth refresh grants, transient-body retry. | **High** |
| `open-sse/executors/{antigravity,azure,gemini-cli,github,iflow,qoder,kiro,codex,cursor,vertex,qwen,opencode,opencode-go,grok-web,perplexity-web,ollama-local,commandcode,xiaomi-tokenplan,mimo-free,zcode,codebuddy-cn}.js` | Provider-specific transforms/auth. | **High** (each has unique logic). |
| `open-sse/utils/proxyFetch.js` | Outbound proxy support + no-proxy handling. | Medium |
| `open-sse/services/provider.js` | Format detection, transport resolution, thinking normalization. | Medium |

### 3.5 Provider registry / models / capabilities

**Status (Phase 1, Step 2):** The provider registry is now JSON-backed. Run `node scripts/export-registry.js` to regenerate `backend/data/providers.json` from the Node.js registry. The Go backend should load this file at runtime rather than importing JavaScript modules.

**Status (Phase 1, Step 3):** Go module initialized at `backend/go.mod` (`github.com/9router/9router/backend`, Go 1.22) and the agreed dependency stack is locked. A minimal registry loader lives in `backend/internal/providers/registry.go`:

- `LoadRegistry(path)` reads `backend/data/providers.json`, unmarshals it into a `Registry` struct, and validates that `generatedAt`, `nodeVersion`, `providers`, `PROVIDERS`, `PROVIDER_MODELS`, `PROVIDER_OAUTH`, and `PROVIDER_MEDIA` are present and non-empty.
- Provider structs are intentionally small: scalar fields that are immediately useful (`id`, `alias`, `category`, `authType`, `hasOAuth`, `priority`, etc.) are typed, while nested blobs (`display`, `transport`, `models`, `oauth`, configs) are `json.RawMessage` so future code can decode them on demand without updating the loader.
- Tests in `backend/internal/providers/registry_test.go` load the real exported registry and assert success, a provider count >= 100, populated top-level maps, and error behavior for missing/empty paths.
- Locked module stack: `github.com/go-chi/chi/v5`, `modernc.org/sqlite`, `github.com/golang-jwt/jwt/v5`, `github.com/coreos/go-oidc/v3/oidc`, `golang.org/x/crypto/bcrypt`, `github.com/google/uuid`, `golang.org/x/sync/singleflight`, `github.com/caarlos0/env/v11`, `github.com/stretchr/testify`. Optional CLI deps `github.com/pterm/pterm` and `github.com/pkg/browser` are omitted for now to keep the module graph lean.

| File | Role | Complexity |
|------|------|------------|
| `open-sse/providers/registry/*.js` (~115 files) | Per-provider transport + models + OAuth/media configs. | Medium (data-heavy; code-generate or load as config). |
| `open-sse/providers/index.js` | Builds `PROVIDERS`, `PROVIDER_MODELS`, `PROVIDER_OAUTH`, `PROVIDER_MEDIA` from registry. | Medium |
| `scripts/export-registry.js` | Exports the registry to `backend/data/providers.json`. | Done |
| `backend/data/providers.json` | Static JSON snapshot consumed by the Go backend. | Done |
| `open-sse/providers/capabilities.js`, `open-sse/providers/models/*.js`, `open-sse/providers/pricing.js`, `open-sse/providers/schema.js`, `open-sse/providers/shared.js` | Capabilities, model normalization, pricing. | Medium |
| `open-sse/config/providerModels.js` | Model metadata: target format, strip lists, upstream IDs. | Medium |
| `open-sse/config/providers.js`, `open-sse/config/runtimeConfig.js`, `open-sse/config/appConstants.js`, `open-sse/config/errorConfig.js` | Provider wiring and runtime constants. | Medium |
| `src/shared/constants/models.js`, `src/shared/constants/providers.js` | UI-facing provider/model constants + ACL list. | Medium |

### 3.6 Resilience services

| File | Role | Complexity |
|------|------|------------|
| `open-sse/utils/circuitBreaker.js` | Per-proxy circuit breaker state machine. | Medium |
| `open-sse/services/accountSemaphore.js` | Per-account concurrency gate. | Medium |
| `open-sse/services/accountFallback.js` | Failure tracking, per-model locks, cooldowns, quota detection, Kimchi exhaustion. | **High** |
| `open-sse/utils/classify429.js` | Semantic 429 classification (rate limit / quota / daily). | Medium |
| `open-sse/utils/cooldownRetry.js` | Bounded wait when all accounts rate-limited. | Low |
| `open-sse/services/combo.js` | Fallback, round-robin, capacity, fusion. | **High** |

### 3.7 Token savers & request hygiene

| File | Role | Complexity |
|------|------|------------|
| `open-sse/rtk/index.js` | RTK message compression dispatcher. | Medium |
| `open-sse/rtk/filters/*.js` (12 files) | Per-tool-type compressors (`git_diff`, `ls`, `grep`, `tree`, etc.). | Medium |
| `open-sse/rtk/caveman.js`, `open-sse/rtk/ponytail.js`, `open-sse/rtk/terminationPrompt.js`, `open-sse/rtk/systemInject.js` | Prompt injection. | Low-Medium |
| `open-sse/rtk/headroom.js` | Optional external Headroom compression. | Medium |
| `open-sse/utils/loopGuard.js` | Detect repeated tool-call loops and inject hints. | Medium |
| `open-sse/utils/toolDeduper.js` | Dedupe equivalent built-in vs MCP tools. | Low |
| `open-sse/utils/kimiToolParser.js` | Parse leaked `functions.NAME:ID {JSON}` markup. | Medium |
| `open-sse/utils/clientDetector.js`, `open-sse/utils/sessionManager.js` | Detect client tool, capture session IDs. | Low |

### 3.8 Auth / ACL / session

| File | Role | Complexity |
|------|------|------------|
| `src/sse/services/auth.js` | API-key extraction/validation, provider/combo/kind ACL, credential selection with mutex. | **High** |
| `src/sse/services/internalTrust.js` | Trust dashboard/CLI requests by origin/signature. | Medium |
| `src/sse/services/allowedModels.js` | Build allowed model list from DB + registry. | **High** |
| `src/sse/services/model.js` | Model parsing + provider-node resolution. | Medium |
| `src/lib/auth/dashboardSession.js`, `src/lib/auth/loginLimiter.js` | JWT session and login rate limit. | Low |
| `src/app/api/auth/**/*.js` (~9 files) | Login/logout/OIDC/status/reset-password. | Low |
| `src/app/api/init/route.js` | First-run setup. | Low |

### 3.9 OAuth services

| File | Role | Complexity |
|------|------|------------|
| `src/lib/oauth/services/oauth.js` | Generic PKCE authorization-code flow. | Medium |
| `src/lib/oauth/services/{codex,cursor,kiro,qoder,xai}.js` | Provider-specific OAuth/token exchange. | **High** |
| `src/lib/oauth/providerHelpers.js`, `src/lib/oauth/providers.js`, `src/lib/oauth/constants/*.js` | Provider OAuth metadata. | Medium |
| `src/lib/oauth/utils/{pkce,server,ui}.js` | PKCE, local callback server, browser open. | Low-Medium |
| `open-sse/services/tokenRefresh.js` | Per-provider refresh handlers (Claude, Google, Qwen, Codex, Iflow, GitHub, Copilot, Kiro, Vertex SA-JWT). | **High** |
| `open-sse/services/tokenRefresh/providers.js` | Lower-level refresh implementations. | **High** |
| `open-sse/services/oauthCredentialManager.js` | Decide when/which token to refresh. | Medium |
| `src/lib/oauth/kiroExternalIdp.js` | Kiro external IDP flow. | Medium |

### 3.10 Database layer

**Status (Phase 1, Step 4):** SQLite schema and repositories ported to Go under `backend/internal/db/`:

- Migrations are embedded in the binary via `//go:embed migrations/*.sql` in `backend/internal/db/migrations.go`. Two migrations mirror the JS schema: `001_initial.sql` and `002_fix_empty_allowed_lists.sql`.
- `backend/internal/db/db.go` opens `modernc.org/sqlite` with WAL, foreign keys, and busy timeout. It supports the same data directory layout as the JS backend.
- Repositories live in `backend/internal/db/repos/`: `keys.go`, `accounts.go`, `usage.go`, and `repos.go` composition. A generic TTL cache in `backend/internal/db/repos/cache.go` backs read-heavy lookups.
- Tests cover migrations, DB open/close, key/account/usage CRUD, and TTL cache behavior. `cd backend && go test ./internal/db/...` passes for `internal/db` and `internal/db/repos`.

| File | Role | Complexity |
|------|------|------------|
| `src/lib/db/driver.js` | Adapter selection: bun:sqlite → better-sqlite3 → node:sqlite → sql.js. | Medium |
| `src/lib/db/schema.js` | Declarative SQLite schema (11 tables). | Low |
| `src/lib/db/migrate.js`, `src/lib/db/migrations/*.js` | Migrations. | Low |
| `src/lib/db/adapters/{betterSqlite,bunSqlite,nodeSqlite,sqljs}Adapter.js` | Adapter implementations. | Medium (Go can collapse to one `database/sql` driver). |
| `src/lib/db/repos/settingsRepo.js` | Settings CRUD + 5s TTL cache. | Low |
| `src/lib/db/repos/connectionsRepo.js` | Provider connection CRUD + 2s TTL cache + priority reorder. | Medium |
| `src/lib/db/repos/apiKeysRepo.js` | API-key CRUD + permission lists. | Low |
| `src/lib/db/repos/combosRepo.js`, `aliasRepo.js`, `pricingRepo.js`, `disabledModelsRepo.js`, `nodesRepo.js`, `proxyPoolsRepo.js` | CRUD. | Low |
| `src/lib/db/repos/usageRepo.js` | Usage history, daily rollups, stats, pending-request counters, EventEmitter. | **High** |
| `src/lib/db/repos/requestDetailsRepo.js` | Request-detail persistence. | Low |
| `src/lib/localDb.js` | Barrel export of DB functions (used widely). | Low |
| `src/lib/db/paths.js`, `src/lib/dataDir.js` | Data directory resolution. | Low |

**Status (Phase 1, Step 6):** Chi router skeleton, slog middleware, and graceful shutdown wired up under `backend/cmd/server/main.go` and supporting packages:

- `backend/internal/log/log.go` provides `New(level string) (*slog.Logger, error)`, returning a JSON `slog.Logger` with levels mapped from "debug", "info", "warn", and "error".
- `backend/internal/log/middleware.go` adds request-logging middleware (method, path, status, duration) and panic-recovery middleware that logs panics and returns HTTP 500.
- `backend/internal/api/routes.go` builds a `chi.Mux`, wires middleware, and registers placeholder handlers for `GET /health`, `GET /shutdown`, `GET /version`, `GET /api/v1/models`, plus an empty `/v1` sub-router.
- `backend/cmd/server/main.go` loads config, initializes the logger, opens/migrates SQLite via `db.Open(cfg.DBPath())`, loads `backend/data/providers.json`, builds the chi router, and starts an `http.Server` with graceful shutdown on `SIGINT`/`SIGTERM` using a 10-second bounded `Shutdown` context.
- `backend/cmd/server/main_test.go` starts the server on an ephemeral port, asserts `GET /health` returns 200 and `{"status":"ok"}`, and verifies the configured SQLite file is created.
- Verification: `cd backend && go build ./cmd/server` compiles and `cd backend && go test ./cmd/server/... -run TestServerStart` passes.

**Status (Phase 1, Step 5):** Runtime environment config and resilience primitives ported to Go:

- `backend/internal/config/config.go` defines a `Config` struct parsed with `github.com/caarlos0/env/v11` tags and fills defaults matching the JS backend (`PORT`, `DATA_DIR`, `DATABASE_FILE`, `JWT_SECRET`, `LOG_LEVEL`, etc.).
- `backend/internal/config/paths.go` resolves the data directory, defaulting to `~/.vansroute` (or `DATA_DIR` override), matching `src/lib/dataDir.js` and `src/lib/db/paths.js`.
- `backend/internal/resilience/profiles.go` provides provider-specific circuit-breaker profiles (`DefaultProfile()` and `ProfileForProvider`).
- `backend/internal/resilience/breaker.go` ports the JS circuit breaker (CLOSED/DEGRADED/OPEN/HALF_OPEN) with cumulative-count and sliding-window `failureWindowMs` modes.
- `backend/internal/resilience/semaphore.go` implements a per-account concurrency gate with immediate release on completion.
- Tests pass: `cd backend && go test ./internal/config/... ./internal/resilience/...` (29 tests) and `... -run TestProfiles`.

### 3.11 Usage / observability / request logging

| File | Role | Complexity |
|------|------|------------|
| `src/lib/usageDb.js` | Thin wrappers over `usageRepo` and `requestDetailsRepo`. | Low |
| `src/lib/requestDetailsDb.js` | Request-detail helpers. | Low |
| `open-sse/utils/requestLogger.js` | Per-request raw/openai/target/response logging. | Low |
| `open-sse/utils/usageTracking.js` | Token extraction/addBuffer/filter. | Low |
| `src/app/api/usage/**/*.js` (~11 files) | Dashboard usage endpoints. | Low |
| `src/app/api/translator/**/*.js` | Console-log stream endpoints. | Low |

### 3.12 Media handlers (embeddings / tts / stt / image)

| File | Role | Complexity |
|------|------|------------|
| `src/app/api/v1/embeddings/route.js`, `src/sse/handlers/embeddings.js`, `open-sse/handlers/embeddingsCore.js`, `open-sse/handlers/embeddingProviders/{openai,gemini,openaiCompatNode,_base}.js` | Embeddings orchestration + adapters. | Medium |
| `src/app/api/v1/audio/speech/route.js`, `src/sse/handlers/tts.js`, `open-sse/handlers/ttsCore.js`, `open-sse/handlers/ttsProviders/*.js` (10 files) | TTS orchestration + adapters. | Medium |
| `src/app/api/v1/audio/transcriptions/route.js`, `src/sse/handlers/stt.js`, `open-sse/handlers/sttCore.js` | STT orchestration. | Medium |
| `src/app/api/v1/images/generations/route.js`, `src/sse/handlers/imageGeneration.js`, `open-sse/handlers/imageGenerationCore.js`, `open-sse/handlers/imageProviders/*.js` (16 files) | Image generation orchestration + adapters. | **High** |
| `src/app/api/v1/audio/voices/route.js`, `src/app/api/media-providers/tts/**/*.js` | Voice list endpoints. | Low |

### 3.13 Search / fetch / responses / messages

| File | Role | Complexity |
|------|------|------------|
| `src/app/api/v1/search/route.js`, `src/sse/handlers/search.js`, `open-sse/handlers/search/*.js` | Web search via providers. | Medium |
| `src/app/api/v1/web/fetch/route.js`, `open-sse/handlers/fetch/*.js` | Web fetch via providers. | Medium |
| `src/app/api/v1/responses/route.js`, `src/app/api/v1/responses/compact/route.js`, `open-sse/handlers/responsesHandler.js`, `open-sse/translator/request/openai-responses.js`, `open-sse/translator/response/openai-responses.js` | OpenAI Responses API passthrough. | **High** |
| `src/app/api/v1/messages/route.js`, `src/app/api/v1/messages/count_tokens/route.js` | Anthropic Messages API passthrough. | Medium |
| `src/app/api/v1beta/models/**/*.js` | Beta models proxy. | Low |

### 3.14 Dashboard / admin API

| File | Role | Complexity |
|------|------|------------|
| `src/app/api/providers/**/*.js` (~10 files) | Provider CRUD, test, validation, model lists, batch tests. | Medium |
| `src/app/api/keys/**/*.js` (~3 files) | API-key CRUD. | Low |
| `src/app/api/combos/**/*.js` (~2 files) | Combo CRUD. | Low |
| `src/app/api/settings/**/*.js` (~4 files) | Settings, proxy test, database export/import. | Low-Medium |
| `src/app/api/oauth/**/*.js` (~15 files) | OAuth endpoints for Cursor/Codex/Kiro/etc. | **High** |
| `src/app/api/cli-tools/**/*.js` (~18 files) | CLI tool config generation (Claude, Codex, Cursor, etc.). | Low |
| `src/app/api/proxy-pools/**/*.js` (~5 files) | Proxy pool CRUD + deploy helpers. | Medium |
| `src/app/api/provider-nodes/**/*.js` (~3 files) | Custom OpenAI/Anthropic node CRUD. | Low |
| `src/app/api/tags/route.js`, `src/app/api/pricing/route.js`, `src/app/api/health/route.js`, `src/app/api/version/**/*.js`, `src/app/api/shutdown/route.js` | Misc admin endpoints. | Low |
| `src/app/api/tunnel/**/*.js` (~8 files) | Cloudflare/Tailscale tunnel enable/disable/status. | Medium |
| `src/app/api/mcp/**/*.js` (~2 files) | MCP plugin SSE/message bridge. | Medium |
| `src/app/api/headroom/**/*.js` (~3 files) | Headroom compression service control. | Low |

### 3.15 Tunnel / proxy / network

| File | Role | Complexity |
|------|------|------------|
| `src/lib/network/connectionProxy.js`, `src/lib/network/initOutboundProxy.js`, `src/lib/network/outboundProxy.js`, `src/lib/network/proxyTest.js` | Proxy hash, outbound proxy init, test. | Medium |
| `src/lib/tunnel/cloudflare/*.js`, `src/lib/tunnel/tailscale/*.js`, `src/lib/tunnel/index.js` | Tunnel lifecycle. | Medium |
| `src/proxy.js` | Proxy setup entry. | Low |
| `src/mitm/*.js` | MITM alias cache / router. | Medium |
| `src/lib/mitmAliasCache.js` | MITM alias cache. | Low |

### 3.16 CLI bootstrap

| File | Role | Complexity |
|------|------|------------|
| `cli/cli.js` | Main CLI: port/host parsing, update check, process kill, server spawn, TUI menu, tray. | **High** (if keeping Node CLI around Go binary, complexity drops to wrapper). |
| `cli/src/cli/terminalUI.js`, `cli/src/cli/menus/*.js`, `cli/src/cli/utils/*.js` | TUI menus and helpers. | Medium |
| `cli/src/cli/tray/*.js` | System tray (macOS/Linux/Windows). | Medium |
| `cli/hooks/*.js`, `cli/scripts/*.js` | Postinstall/runtime dependency management. | Medium |
| `cli/package.json` | CLI manifest. | Low |

### 3.17 Tests to preserve / rewrite

| Path | Count | Notes |
|------|-------|-------|
| `tests/unit/*.test.js` (~25 files) | 214 tests | Vitest. Priority: circuit breaker, account semaphore, proxy-aware resilience, Kimchi CLI-derived, Kimchi quota, translator tests. |
| `tests/translator/*.test.js` (~10 files) | Format translation correctness. | Critical to port first. |

---

## 3.18 Phase 1 Ponytail Review

Reviewed the Phase 1 Go packages (`internal/providers`, `internal/db`, `internal/config`, `internal/resilience/profiles.go`) against their JS counterparts. No behavior was changed; findings were recorded as `ponytail:` comments in the source for later simplification.

Notable flags:

- `internal/providers/registry.go`: provider overrides table and deep modeling of display/transport blobs are speculative; keep `json.RawMessage` passthrough until consumers exist.
- `internal/db/repos/*.go`: account/key/usage structs over-model JSON data; consider `map[string]any` passthrough until the dashboard consumes concrete fields.
- `internal/db/repos/cache.go`: generic TTL cache is reusable but only backs two repos; a per-repo map would be less abstraction.
- `internal/config/config.go`: `env/v11` dependency adds binary size and a failure surface; manual `os.Getenv` with defaults is ~30 lines and zero deps.
- `internal/resilience/profiles.go`: provider-specific tuning table is speculative; start with `DefaultProfile` everywhere and add overrides after real outage data.

Net: packages are lean for a first port; deferrals are tracked via `ponytail:` comments rather than speculative abstractions.

### 3.19 Phase 2 — Step 1: Auth, ACL, internal trust

- Created `backend/internal/auth` package with:
  - `apikey.go` — `ExtractAPIKey`, API-key middleware, context attachment
  - `acl.go` — `IsProviderAllowed`, `IsComboAllowed`, `IsKindAllowed` with alias resolution and custom-compatible-provider prefix fix
  - `internal.go` — `IsTrustedInternalRequest` (fail-closed, constant-time)
  - `machine.go` — `GetConsistentMachineId` with on-disk raw machine ID + CLI secret persistence
  - Full unit-test coverage for extraction, ACL, custom prefix, internal-trust exploit resistance, and machine-id stability
- Wired `auth.APIKeyMiddleware` into `/v1/*` and `/api/v1/models` routes in `backend/internal/api/routes.go`.
- Updated `backend/cmd/server/main.go` to create repos, load registry, and set `auth.DataDirSource`.
- Verification: `cd backend && go test ./internal/auth/...` passes (48 tests); `go test ./...` passes (87 tests in 9 packages).

### 3.24 Phase 2 — Step 6: Ponytail review of auth/ACL/models ports

Scanned `src/sse/services/{auth,internalTrust,allowedModels}.js`, `src/lib/auth/{dashboardSession,loginLimiter,oidc}.js` against the Go ports in `backend/internal/{auth,models}` and `backend/internal/api/middleware`.

Findings (format: location → what → replacement, applied or deferred):

Applied:
- `backend/internal/auth/acl.go` L65-72 → custom `contains()` helper duplicated `slices.Contains` (stdlib since Go 1.21). **stdlib:** removed the helper, replaced 3 call sites with `slices.Contains`.

Deferred (recorded as `// ponytail:` comments — not refactored now because the work would touch tests, callers, and the Source interface for cosmetic gain):
- `backend/internal/models/models.go` L62-69 (Source interface) → five tiny methods called sequentially from `load()`. **yagni/shrink:** collapse to `Snapshot(ctx) SnapshotData` so the build is one DB roundtrip. Test fake would change shape (acceptable; countingSource re-implements the same methods).
- `backend/internal/models/models.go` L350-388 (`connectedEntries`/`freeEntries`) → ~100 lines each, one caller apiece, share 95% body. **yagni/shrink:** merge into one `walkEntries(provider, *Connection)` helper. Defers naturally to when Phase 3 adds live fetches.
- `backend/internal/api/middleware/cors.go` L24-28 → `Vary: Origin` set even when origin is "*". **shrink:** skip the header when AllowOrigin == "*". One if-statement. Marked, not fixed — only matters once the dashboard hardens its origin.

Out-of-scope (correctness/security, not complexity):
- `backend/internal/auth/internal.go` — no per-process memoization of the computed CLI token (JS memoizes in `_cachedCliToken`). Existing test still passes because the implementation is correct, just slightly slower on warm calls. Defer to Phase 3 along with the rest of the per-request budget work.

Verification: `cd backend && go test ./...` → 151 PASS in 12 packages (no regressions after the slices.Contains swap). Grep `grep -r "ponytail:" backend/internal/{auth,models,api/middleware}` → 9 comments.

### 3.23 Phase 2 — Step 5: GET /v1/models

- Added `backend/internal/models/sql_source.go` — `SQLSource` implements `Source` over SQLite (combos table + providerConnections `data` JSON + three `kv` scopes: `modelAliases`, `customModels`, `disabledModels`). Mirrors JS conventions in `src/lib/db/repos/{aliasRepo,disabledModelsRepo}.js`.
- Added `backend/internal/api/v1/models.go` — `ModelsHandler` produces the OpenAI list response (`object=list`, `data=[...]`). Supports `?kind=llm,embedding` filter; `parseKindFilter` helper. Error path returns OpenAI-shaped JSON.
- Updated `backend/internal/api/routes.go` — builds a SQL-backed `models.Builder` from `repos.DB`, mounts `/v1/models` under `auth.APIKeyMiddleware`, and keeps `/api/v1/models` for the dashboard path.
- Tests (`backend/internal/api/v1/models_test.go`, 6 cases): OpenAI list shape, kind filter, disabled model omission, dedup, empty registry, parseKindFilter edge cases.
- Verification: `cd backend && go test ./internal/api/v1/... -run TestModelsEndpoint` → 6 PASS; `go test ./...` → 151 PASS in 12 packages; `go build ./...` → clean.

### 3.22 Phase 2 — Step 4: Auth, CORS, real-IP, logging middleware

- Added `backend/internal/api/middleware/{realip,cors,logger}.go` and `middleware_test.go`. Mirrors the request-handling bits Next.js used to provide implicitly (recovery, access logs) and fills the gaps JS handled per-response (`Access-Control-Allow-Origin: *` in `corsHeadersFrom`).
- `RealIP` reads `X-Forwarded-For` (first hop) then `X-Real-IP` and rewrites `r.RemoteAddr` so downstream handlers/loggers see the resolved IP. Helper `ClientIP(r)` is exported.
- `CORS` adds permissive ACAO/ACAM/ACAH/Vary headers, answers `OPTIONS` preflight with 204. Matches the proxy-pattern default of `*`.
- `RequestLogger` emits one structured slog line per request with method/path/query/status/bytes/ip/ua/duration. `statusRecorder` captures the response code and bytes for the log entry.
- `Recovery` turns panics into a 500 JSON body and logs `panic_recovered` with the stack from `log.Stack()`. Added `Stack()` to `backend/internal/log/log.go`.
- Updated `backend/internal/api/routes.go` to chain `RealIP → Recovery → RequestLogger → CORS` on the root router and keep `auth.APIKeyMiddleware` on the `/v1/*` and `/api/v1/models` mounts.
- Tests (`backend/internal/api/middleware/middleware_test.go`, 12 cases): XFF/XRI/fallback resolution, CORS preflight, custom origin, log shape, status capture for 4xx, recovery no-op + panic path, full chain order, ClientIP helper.
- Verification: `cd backend && go test ./internal/api/middleware/...` → 12 PASS; `go test ./...` → 144 PASS in 11 packages; `go build ./...` → clean.

### 3.21 Phase 2 — Step 3: Allowed-models resolution

- Added `backend/internal/models/models.go` — `Builder` with `BuildModelsList(ctx, kindFilter)` and `IsModelAllowed(ctx, modelStr, apiKeyPresent)`. Mirrors `src/sse/services/allowedModels.js` for combo entries, connected-provider entries (with `enabledModels` override + alias prefix stripping), free/noAuth providers, custom models, model aliases, disabled filter, and sub-kind (tts/embedding/webSearch/webFetch) pseudo-models.
- Introduced `Source` interface so tests use a `fakeSource` and routes can plug in a SQLite-backed implementation later.
- 30s TTL cache on the allow-list with `InvalidateCache()`. `ponytail:` comments defer the live `modelsFetcher` and compatible-provider HTTP fetches to Phase 3 (registry alone covers the static-models path needed for the first `/v1/models` live cut).
- `inferKindFromUnknownModelId` ports the JS regex fallback (embed/tts/image).
- Tests (`backend/internal/models/models_test.go`, 14 cases): combo emission, kind filtering, registry providers, dedup, disabled filter, allow-list cache + invalidation, strip-prefix helper, kind inference.
- Verification: `cd backend && go test ./internal/models/...` → 14 passed; `go test ./...` → 132 passed in 10 packages.

### 3.20 Phase 2 — Step 2: Dashboard session, login limiter, OIDC stub

- Added `backend/internal/auth/session.go` — JWT HS256 issue/verify via `golang-jwt/jwt/v5`, bcrypt hash/compare via `x/crypto/bcrypt`, cookie helpers (`session` cookie, httpOnly, sameSite=lax, path=/), `JWT_SECRET` env with stable dev fallback. Mirrors `src/lib/auth/dashboardSession.js`.
- Added `backend/internal/auth/login_limiter.go` — in-memory progressive lockout keyed by `ip|username`, 1-hour sliding window, escalating lock steps (30s → 2m → 10m → 30m), package-level `now` var for test injection. Mirrors `src/lib/auth/loginLimiter.js`. `ponytail:` note records that the func-var clock hook is cheaper than a clock interface and matches the JS module-level `now()`.
- Added `backend/internal/auth/oidc.go` — thin OIDC config loader (deferred verification; real provider wiring lands in Phase 3).
- Tests: `session_test.go` (13 `TestSession*` cases), `login_limiter_test.go` (10 cases including isolation and retry-after). Fixed one test assertion (`TestLoginLimiterAutoResetAfterWindow` originally expected `remaining=4` after 2 failures; corrected to `3`).
- Verification: `cd backend && go test ./internal/auth/... -run TestSession -v` → 21 passed; `go test ./...` → 118 passed in 9 packages.

## 4. API Contracts to Preserve

The Go backend must expose at least these surfaces to remain a drop-in replacement for CLI tools:

### 4.1 OpenAI-compatible surface (`/v1`)

- `POST /v1/chat/completions`
- `POST /v1/embeddings`
- `POST /v1/images/generations`
- `POST /v1/audio/speech`
- `POST /v1/audio/transcriptions`
- `GET  /v1/models`
- `POST /v1/messages` (Anthropic-compatible)
- `POST /v1/responses` (OpenAI Responses API)
- `POST /v1/search`
- `POST /v1/web/fetch`

Request/response shapes must match OpenAI / Anthropic / Responses API specs as already normalized by the translators.

### 4.2 Dashboard / admin surface

- Auth: `/api/auth/*`, `/api/init`, `/api/settings/require-login`
- Provider connections: `/api/providers/*`, `/api/provider-nodes/*`
- API keys: `/api/keys/*`
- Combos: `/api/combos/*`
- Settings: `/api/settings/*`
- Usage: `/api/usage/*`
- OAuth: `/api/oauth/*`
- CLI tool configs: `/api/cli-tools/*`
- Proxy pools: `/api/proxy-pools/*`
- Tunnel: `/api/tunnel/*`
- Misc: `/api/health`, `/api/version`, `/api/shutdown`

### 4.3 Internal / cross-cutting contracts

- **Settings object shape** (`DEFAULT_SETTINGS` in `src/lib/db/repos/settingsRepo.js`): ~50 keys including `requireApiKey`, `comboStrategy`, `rtkEnabled`, `headroomEnabled`, etc.
- **Connection object shape** (`rowToConn`/`connToRow` in `src/lib/db/repos/connectionsRepo.js`): id, provider, authType, accessToken, refreshToken, expiresAt, providerSpecificData, modelLock_*, etc.
- **API-key shape** (`rowToKey` in `src/lib/db/repos/apiKeysRepo.js`): allowedProviders, allowedCombos, allowedKinds (null = all, [] = none).
- **Credential selection contract**: `getProviderCredentials(provider, excludeConnectionIds, model)` must respect priority, round-robin/fill-first, model locks, proxy pool.
- **Result envelope from executors/core**: `{ success, response, status?, error?, errorCode?, resetsAtMs? }`.
- **Streaming contract**: SSE lines (`data: {...}\n\n`) with `[DONE]` terminator; must support disconnect propagation.
- **Usage stats contract**: `saveRequestUsage({timestamp, provider, model, connectionId, apiKey, endpoint, tokens, cost, status})`.

---

## 5. External Dependencies / Integrations

### 5.1 OAuth providers (authorization-code + refresh)

- Claude (Anthropic OAuth)
- Codex (OpenAI OAuth)
- Cursor
- GitHub Copilot (GitHub OAuth + Copilot token exchange)
- Gemini CLI (Google OAuth)
- Kiro
- Qwen
- Iflow
- X.AI
- CodeBuddy-CN
- Vertex / Vertex Partner (Google service-account JWT)
- Antigravity (Google OAuth)

### 5.2 API providers (40+)

OpenAI, Anthropic, Gemini, Kimchi, OpenRouter, NVIDIA, SiliconFlow, Z.AI, Together, Fireworks, Groq, Cohere, Mistral, Perplexity, Azure, HuggingFace, DeepSeek, xAI, and many more. See `open-sse/providers/registry/`.

### 5.3 External services

- **Cloudflare tunnel** (`cloudflared`) for public dashboard exposure.
- **Tailscale** tunnel support.
- **Headroom** optional compression proxy (`HEADROOM_URL`).
- **MITM router** (`mitmRouterBaseUrl`, default `http://localhost:20128`) for CLI tool alias injection.
- **npm registry** for CLI update checks.

### 5.4 Node-specific libraries that need Go equivalents

| Node library | Purpose | Go replacement |
|--------------|---------|----------------|
| `better-sqlite3` / `node:sqlite` / `sql.js` | SQLite | `modernc.org/sqlite` or `mattn/go-sqlite3` |
| `undici` | HTTP fetch with proxy | `net/http` + `golang.org/x/net/proxy` or custom transport |
| `jose` | JWT sign/verify, OIDC | `golang-jwt/jwt/v5`, `coreos/go-oidc/v3` |
| `bcryptjs` | Password hashing | `golang.org/x/crypto/bcrypt` |
| `node-forge` | PKI / cert generation for MITM | `crypto/tls`, `golang.org/x/crypto` |
| `node-machine-id` | Machine fingerprint for API keys | OS-specific calls or drop/replace |
| `open` | Browser open for OAuth | `github.com/pkg/browser` or shell out |
| `ora` / `chalk` | CLI spinner/color | `pterm` / `fatih/color` |
| `confbox` | Config serialization | standard library |
| `marked`, `dompurify` | Markdown/sanitization | Keep in frontend or use `gomarkdown` + `bluemonday` |

---

## 6. Suggested Go Module / Package Structure

```
backend/
├── cmd/
│   └── vansroute/              # main.go (HTTP server + CLI flags)
│   └── vansroute-cli/          # optional Go CLI wrapper
├── internal/
│   ├── api/
│   │   ├── v1/                 # /v1/chat/completions, embeddings, etc.
│   │   ├── admin/              # providers, keys, combos, settings, usage
│   │   ├── oauth/              # OAuth callback/start endpoints
│   │   ├── middleware/         # auth, CORS, real-IP, logging
│   │   └── router.go           # route registration
│   ├── sse/
│   │   ├── chat.go             # handleChat equivalent
│   │   ├── embeddings.go
│   │   ├── tts.go
│   │   ├── stt.go
│   │   └── image.go
│   ├── engine/
│   │   ├── chatcore.go         # handleChatCore equivalent
│   │   ├── streaming.go
│   │   ├── nonstreaming.go
│   │   └── responses.go
│   ├── translator/
│   │   ├── registry.go
│   │   ├── request/            # source→target translators
│   │   ├── response/           # target→source translators
│   │   ├── concerns/           # toolCall, thinking, modality, etc.
│   │   └── formats/            # claude, gemini, openai, responsesApi
│   ├── providers/
│   │   ├── registry/           # generated/config provider entries
│   │   ├── executor.go         # BaseExecutor / DefaultExecutor
│   │   ├── executors/          # per-provider executors
│   │   ├── models.go
│   │   └── capabilities.go
│   ├── resilience/
│   │   ├── circuitbreaker.go
│   │   ├── accountsemaphore.go
│   │   ├── accountfallback.go
│   │   └── combo.go
│   ├── tokensaver/
│   │   ├── rtk.go
│   │   ├── caveman.go
│   │   ├── ponytail.go
│   │   └── filters/
│   ├── auth/
│   │   ├── apikey.go
│   │   ├── acl.go
│   │   ├── session.go
│   │   └── internaltrust.go
│   ├── oauth/
│   │   ├── pkce.go
│   │   ├── service.go
│   │   └── providers/          # codex, cursor, kiro, etc.
│   ├── refresh/
│   │   ├── tokenrefresh.go
│   │   └── providers.go
│   ├── db/
│   │   ├── sqlite.go           # database/sql setup
│   │   ├── schema.go
│   │   ├── migrations/
│   │   └── repos/              # settings, connections, apikeys, usage, etc.
│   ├── usage/
│   │   ├── tracker.go
│   │   ├── stats.go
│   │   └── requestdetail.go
│   ├── network/
│   │   ├── proxy.go
│   │   └── tunnel/
│   ├── models/
│   │   └── allowed.go          # allowedModels equivalent
│   ├── config/
│   │   ├── defaults.go
│   │   └── runtime.go
│   └── log/
│       └── logger.go
├── pkg/
│   └── models/                 # shared DTO types (provider registry shape)
├── migrations/
├── web/                        # optional embedded Next.js build (if serving from Go)
└── go.mod
```

---

## 7. Risks and Open Questions

### 7.1 High-risk items

1. **Translator correctness.** The translators encode hundreds of provider-specific edge cases. A direct port is error-prone; missing one quirk breaks a specific CLI tool or model. Recommendation: port with the existing 200+ translator tests running side-by-side.
2. **Streaming lifecycle.** Node's `ReadableStream`/AbortController semantics differ from Go's `io.Reader`/context cancellation. The early-EOF peek, disconnect-aware pipe, and stall timeout need careful implementation.
3. **OAuth flows.** Many providers use browser-based login with local callback server and refresh-token rotation. The Go port must reproduce the exact token exchange payloads and Copilot token exchange.
4. **State concurrency.** Circuit breaker, account semaphore, combo rotation state, and pending-request counters live in module-level Maps. Go's goroutine-safe equivalents need locks/channels.
5. **SQLite driver parity.** The project relies on synchronous SQLite (better-sqlite3) for TPS. Go's `database/sql` is pooled/connection-based; settings/connections caches must be preserved to avoid regressing throughput.
6. **Provider registry size.** 115 registry files + model tables. Decide early: generate Go structs from JS registry, or load JSON/YAML at runtime.
7. **MITM / tunnel integration.** These spawn external processes and manage PID files. Cross-platform Go process management is doable but requires platform-specific handling.

### 7.2 Open questions

- Will the Next.js frontend remain and talk to a separate Go backend, or will Go also serve the built frontend?
- Should the Node CLI be replaced by a Go CLI, or kept as a wrapper that downloads/updates the Go binary?
- Which SQLite driver is acceptable? `mattn/go-sqlite3` requires CGO; `modernc.org/sqlite` is pure Go but slower for some workloads.
- Do we keep the existing DB schema exactly, or normalize it during the port?
- How is deployment packaged? Static binary + embedded migrations? Docker?
- Is there a requirement to keep running Node-only tests during transition, or do we rewrite tests in Go immediately?

---

## 8. Phased Migration Order (Suggested)

### Phase 0 — Foundation (1–2 weeks)
- Set up Go module, HTTP router, config loading, SQLite schema + migrations, logger.
- Port `src/lib/db/repos/{settings,connections,apiKeys,combos,alias,pricing,disabledModels,nodes,proxyPools}` to Go repositories.
- Port `src/lib/db/schema.js` and migrations one-to-one.
- Validate by reading/writing same data shape as Node.

### Phase 1 — `/v1/models` + auth (1 week)
- Port `src/sse/services/auth.js`, `internalTrust.js`, and ACL helpers.
- Port `src/sse/services/allowedModels.js` + `src/sse/services/model.js`.
- Implement `GET /v1/models` to return identical output to Node build.
- This unlocks CLI tools listing models before any completions work.

### Phase 2 — Chat hot path (2–3 weeks)
- Port provider registry loading and `PROVIDERS`/`PROVIDER_MODELS` data model.
- Port `open-sse/executors/base.js` + `default.js` + a small set of providers (openai, anthropic, kimchi).
- Port the translator request/response pairs needed for those providers.
- Port `open-sse/handlers/chatCore.js` and `src/sse/handlers/chat.js`.
- Port circuit breaker, account semaphore, account fallback, combo fallback.
- Implement `POST /v1/chat/completions` streaming + non-streaming.
- Run existing translator/chat tests against Go backend.

### Phase 3 — Resilience + token savers (1–2 weeks)
- Port RTK, Caveman, Ponytail, loop guard, tool deduper, Kimi native tool parser.
- Port combo round-robin, capacity, fusion.
- Add usage tracking and request-detail persistence.
- Harden retry/cooldown behavior against existing unit tests.

### Phase 4 — Media endpoints (1–2 weeks)
- Port embeddings, TTS, STT, image generation handlers + adapters.
- Add binary response handling and multipart form parsing for STT.

### Phase 5 — OAuth + dashboard admin (2–3 weeks)
- Port OAuth start/callback endpoints and token refresh providers.
- Port dashboard CRUD endpoints (`/api/providers`, `/api/keys`, `/api/combos`, etc.).
- Port tunnel/proxy endpoints.

### Phase 6 — CLI + packaging (1–2 weeks)
- Replace `cli/cli.js` with a Go CLI, or wrap the Go binary in a thin Node/updater shell.
- Embed migrations and static frontend assets if serving from Go.
- Build Docker image, static binaries for win/mac/linux.

### Phase 7 — Full test parity + deprecation
- Port or rewrite the 214 Vitest tests in Go.
- Run side-by-side comparison against Node backend.
- Deprecate Node backend routes once parity is proven.

---

## 9. Quick Reference: Files Most Touched in a Request

For a typical `POST /v1/chat/completions` request, the call tree is:

```
src/app/api/v1/chat/completions/route.js
  → src/sse/handlers/chat.js
    → src/sse/services/auth.js
    → src/sse/services/model.js
    → src/sse/services/allowedModels.js
    → src/lib/db/repos/{settings,connections,combos}Repo.js
    → open-sse/services/combo.js
    → open-sse/services/accountFallback.js
    → open-sse/services/accountSemaphore.js
    → open-sse/utils/circuitBreaker.js
    → src/sse/services/tokenRefresh.js
    → open-sse/handlers/chatCore.js
      → open-sse/translator/index.js
      → open-sse/rtk/index.js
      → open-sse/executors/index.js
      → open-sse/executors/{base,default,<provider>}.js
      → open-sse/handlers/chatCore/{streaming,nonStreaming}Handler.js
      → open-sse/utils/stream.js
    → src/lib/db/repos/usageRepo.js
    → src/lib/requestDetailsDb.js
```

These are the files to prioritize in any Go porting sprint.

---

## 10. Phase 3 Ponytail-Review Findings (Resilience Primitives)

Files reviewed:
- `backend/internal/resilience/{breaker,semaphore,fallback,combo,cooldown,profiles}.go`
- JS originals: `open-sse/utils/{circuitBreaker,classify429,cooldownRetry}.js`, `open-sse/services/{accountSemaphore,accountFallback,combo}.js`, `open-sse/providers/capabilities.js`

### Applied wins (committed)

| Location | Tag | What | Replacement | Lines saved |
|---|---|---|---|---|
| `breaker.go:171` | stdlib | Hand-rolled loop scanning breaker keys for a state value | `slices.IndexFunc` | -3 |
| `breaker.go:198` | stdlib | Inline `parseRetryAfter` body re-implementation | Extract `parseRetryAfter` helper from JS port | -5 |
| `fallback.go:236` | stdlib | Manual insertion sort loop over `[]kv` entries | `slices.SortFunc` with `time.Time.Compare` | -7 |
| `fallback.go:354` | stdlib | Hand-rolled `pow2` helper using a for-loop | `math.Pow(2, n)` | -6 |

**Net: -21 lines.**

### Deferred speculative refactors (`// ponytail:` comments)

| File | Comment |
|---|---|
| `breaker.go:17` | DEGRADED state adds a transition the JS breaker does not expose; remove if no caller acts on it. |
| `breaker.go:345` | Sliding-window failure counting is more complex than cumulative and is not required by the JS legacy path (`failureWindowMs=0`); defer until bursts prove it is needed. |
| `fallback.go:43` | `errorRules` mixes text and status matching in one table; consider a single `[]func(status int, text string) (cooldownMs int, backoff bool)` once the rule set stabilizes. |
| `fallback.go:72` | `profileCache` is an optimization around a cheap pure function; remove once `ProfileForProvider` call cost is measured and found negligible. |
| `fallback.go:87` | `ProviderRegistry` caches both instances and profiles; consider computing profiles on demand and only memoizing instances. |
| `profiles.go:13` | `SuccessThreshold` is always 1; remove the field once the breaker hard-codes single-probe close. |
| `profiles.go:18` | Sliding-window failure counting is more complex than cumulative; defer until rate-limit bursts actually require it. |
| `profiles.go:26` | JS breaker only allows one probe; consider removing once callers settle on single-probe behavior. |
| `profiles.go:49` | Provider-specific tuning table is speculative; start with `DefaultProfile` for all providers and add overrides only after real outage data. |

### Out-of-scope (forbidden refactors)
- `package-level var now = time.Now` ownership — `fallback.go` owns it, `cooldown.go` reuses. Convention locked by Step 5.
- `CapabilitiesFunc` indirection — required for pluggable capability lookup (currently stubbed with `allCaps`; real provider integration in Phase 4).
- Constant types `int64` for duration arithmetic — locked for `time.Duration` math consistency.

### Verification
- `go test ./... -count=1` → 404 PASS in 12 packages (was 389 before Step 6/7).
- `grep -rq "ponytail:" backend/internal/resilience` → 9 deferral comments recorded.

---

## 11. Phase 4 Step 1 — Base/Default Executor

Files created:
- `backend/internal/providers/executors/types.go`
- `backend/internal/providers/executors/proxy.go`
- `backend/internal/providers/executors/base.go`
- `backend/internal/providers/executors/default.go`
- `backend/internal/providers/executors/executor.go`
- `backend/internal/providers/executors/executor_test.go`

### Ported behavior
- URL building with runtime transport override, openai-compatible/anthropic-compatible defaults, gemini format, `{accountId}` placeholder, URL suffix.
- Header construction with Bearer/x-api-key auth, anthropic-version, Accept: text/event-stream.
- Retry/fallback loop using `http.Client{Transport: ProxyTransport()}` with `http.ProxyFromEnvironment`.
- Context cancellation propagation via `context.WithTimeout(parent, timeout)` and standard `http.NewRequestWithContext`.
- Account-count retry cap (>=5 → 1, >=3 → 2).

### Tests added (7)
- `TestExecutorDefault_SimpleOK`
- `TestExecutorDefault_PropagatesCancel`
- `TestExecutorDefault_Retry429ThenFallback`
- `TestExecutorDefault_ConnectTimeout`
- `TestExecutorDefault_AuthBearer`
- `TestExecutorDefault_AnthropicCompatibleXApiKey`
- `TestExecutorDefault_RuntimeTransportOverride`

### Deferred (`// ponytail:` comments)
- OAuth refresh helpers
- Provider-specific header hooks (kimi, cline, claudeOverlay, etc.)
- Transient body error retries (`_peekTransientBodyError`)
- json_schema fallback, client_metadata drop, nvidia max_tokens clamp

### Verification
- `go test ./internal/providers/... -run TestExecutor -v` → 7 PASS.
- `go test ./... -count=1` → 411 PASS in 13 packages (was 404 before Step 1).

---

## 12. Phase 4 Step 2 — Special Provider Executors

Files created:
- `backend/internal/providers/executors/special_executors_test.go`

Files already present (ported in this step, no implementation changes unless tests revealed bugs):
- `backend/internal/providers/executors/azure.go`
- `backend/internal/providers/executors/ollama.go`
- `backend/internal/providers/executors/github.go`
- `backend/internal/providers/executors/vertex.go`
- `backend/internal/providers/executors/codex.go`
- `backend/internal/providers/executors/registry.go`

### Ported behavior
- **Azure**: deployment-scoped `BuildURL` with `azureEndpoint`, `apiVersion`, and `deployment` from `providerSpecificData`; `api-key` header auth.
- **Ollama local**: `BuildURL` resolves `ollamaHost`/`baseUrl`/`OLLAMA_HOST` to `/api/chat`.
- **GitHub Models**: fixed `https://models.inference.ai.azure.com/chat/completions` endpoint with `Authorization: Bearer <token>`.
- **Vertex**: Gemini URL builder with `projectId`, `location`, and `streamGenerateContent?alt=sse`; partner URL builder with `global/endpoints/openapi/chat/completions`.
- **Vertex partner**: `Execute` validates that `projectId` or `VERTEX_PROJECT_ID` is present.
- **Codex**: `/v1/responses` endpoint with `Authorization`, `originator: codex_cli_rs`, and `session_id: default` headers.
- **Registry**: `Register`/`Get` factory map with built-in fallbacks for `cu`, `mmf`, `zc`, and default executor.

### Tests added (11)
- `TestSpecialExecutors_Registry_Azure`
- `TestSpecialExecutors_Registry_DefaultFallback`
- `TestSpecialExecutors_AzureURL`
- `TestSpecialExecutors_AzureApiKeyHeader`
- `TestSpecialExecutors_OllamaLocalHost`
- `TestSpecialExecutors_GithubEndpointAndBearer`
- `TestSpecialExecutors_VertexGeminiURL`
- `TestSpecialExecutors_VertexPartnerURL`
- `TestSpecialExecutors_VertexPartnerRequiresProjectID`
- `TestSpecialExecutors_CodexResponsesEndpoint`
- `TestSpecialExecutors_CodexHeaders`

### Deferred (`// ponytail:` comments)
- Vertex SA JSON token minting and ADC refresh (`vertex.go:77`).
- Vertex auto-resolve `projectId` from raw API key on first 404 (`vertex.go:31`).
- Remaining provider executors: cursor, grok-web, perplexity-web, kiro, qoder, opencode, opencode-go, antigravity, iflow, qwen, gemini-cli, commandcode, xiaomi-tokenplan, mimo-free, zcode, codebuddy-cn, proxy, etc.
- Base/Default header hooks (kimi, cline, claudeOverlay, etc.) (`base.go:138`).
- Transient body error retries (`default.go:22`).
- json_schema fallback, client_metadata drop, nvidia max_tokens clamp (`default.go:29`).
- Full Codex request transform, image prefetch, and SSE overload peeking (`codex.go:58`).

### Verification
- `cd /media/DiskE/Code/9router-new/backend && go test ./internal/providers/... -run TestSpecialExecutors -v` → 11 PASS.
- `cd /media/DiskE/Code/9router-new/backend && go test ./... -count=1` → 422 PASS in 13 packages (was 411 before Step 2).

---

## 13. Phase 4 Step 3 — Translator Registry + Schema/Concerns/Formats Scaffolding

Files created:
- `backend/internal/translator/registry.go`
- `backend/internal/translator/formats.go`
- `backend/internal/translator/translator.go`
- `backend/internal/translator/registry_test.go`
- `backend/internal/translator/schema/roles.go`
- `backend/internal/translator/schema/blocks.go`
- `backend/internal/translator/schema/finishReasons.go`
- `backend/internal/translator/schema/defaults.go`
- `backend/internal/translator/concerns/chunk.go`
- `backend/internal/translator/concerns/finishReason.go`
- `backend/internal/translator/concerns/image.go`
- `backend/internal/translator/concerns/json.go`
- `backend/internal/translator/concerns/message.go`
- `backend/internal/translator/concerns/modality.go`
- `backend/internal/translator/concerns/paramSupport.go`
- `backend/internal/translator/concerns/prefetch.go`
- `backend/internal/translator/concerns/reasoning.go`
- `backend/internal/translator/concerns/thinking.go`
- `backend/internal/translator/concerns/thinkingUnified.go`
- `backend/internal/translator/concerns/toolCall.go`
- `backend/internal/translator/concerns/usage.go`
- `backend/internal/translator/formats/claude.go`
- `backend/internal/translator/formats/gemini.go`
- `backend/internal/translator/formats/maxTokens.go`
- `backend/internal/translator/formats/openai.go`
- `backend/internal/translator/formats/responsesApi.go`

### Ported behavior
- **Registry**: `Register(from, to, req, res)`, `GetRequestTranslator(key)`, `GetResponseTranslator(key)` with per-map mutexes.
- **Formats**: `Format` type and constants for OpenAI, Claude, Gemini, Vertex, Kiro, Cursor, Ollama, CommandCode, Antigravity, OpenAIResponses.
- **Schema**: ported role constants, block/type constants, finish-reason maps, and defaults (`MODEL_FALLBACK`, `DEFAULT_IMAGE_MIME`) from `open-sse/translator/schema/`.
- **Concerns**: stub helpers for tool-call IDs, message handling, thinking capture, usage merging, image normalization, JSON schema parsing, modality filtering, param support, prefetch, reasoning, and chunk handling. Full behavior deferred.
- **Formats helpers**: stub helpers for OpenAI filter, Claude request prep, Gemini constants, responses API constants, and max-tokens lookup.
- **Translator core**: `TranslateRequest`, `TranslateResponse`, `NeedsTranslation`, `InitState`, and `State` struct skeleton that future request/response translators will consume.

### Tests added (1)
- `TestRegistry`: registers request and response translators and verifies lookup and missing-key behavior.

### Deferred (`// ponytail:` comments)
- Full request/response translator pairs (claude-to-openai, openai-to-claude, gemini-to-openai, openai-to-gemini, vertex, kiro, cursor, ollama, commandcode, antigravity, openai-responses).
- Full concern implementations (tool-call fixing, thinking normalization, reasoning capture, usage aggregation, image prefetch, modality/param filtering).
- Format-specific request prep and response filtering.

### Verification
- `cd /media/DiskE/Code/9router-new/backend && go test ./internal/translator/... -run TestRegistry -v` → 1 PASS.
- `cd /media/DiskE/Code/9router-new/backend && go test ./... -count=1` → 423 PASS in 17 packages (was 422 before Step 3).

---

## 14. Phase 4 Step 4 — Request/Response Translator Pairs (Claude ↔ OpenAI)

Files created:
- `backend/internal/translator/translator_test.go` (side-by-side tests)

Files modified:
- `backend/internal/translator/concerns/chunk.go` (BuildChunk helper)
- `backend/internal/translator/concerns/usage.go` (ToOpenAIUsage, IntNumber export)
- `backend/internal/translator/concerns/finishReason.go` (ToOpenAIFinish, FromOpenAIFinish)
- `backend/internal/translator/concerns/reasoning.go` (ExtractReasoningText)
- `backend/internal/translator/concerns/image.go` (EncodeDataUri, ParseDataUri)
- `backend/internal/translator/concerns/message.go` (CollapseTextParts, ExtractTextContent)
- `backend/internal/translator/concerns/json.go` (SafeParseJSON, MarshalJSON)
- `backend/internal/translator/concerns/toolCall.go` (EnsureToolCallIds, FixMissingToolResponses)
- `backend/internal/translator/formats/maxTokens.go` (AdjustMaxTokens)
- `backend/internal/translator/translator.go` (State fields, InitState)
- `backend/internal/translator/schema/blocks.go` (Claude block types, function/file blocks)
- `backend/internal/translator/registry_test.go` (use test-only keys to avoid shadowing real translators)

Files created (request):
- `backend/internal/translator/request/claude_to_openai.go`
- `backend/internal/translator/request/openai_to_claude.go`

Files created (response):
- `backend/internal/translator/response/claude_to_openai.go`
- `backend/internal/translator/response/openai_to_claude.go`

### Ported behavior
- **Claude → OpenAI request**: system text stripping (Anthropic billing header), message conversion with role remapping, content-block-to-part conversion (text/image/tool_use/tool_result), tools normalization to OpenAI `function` shape, tool_choice conversion, reasoning_effort passthrough.
- **OpenAI → Claude request**: system message extraction, tool_use block packaging with prefix, image base64 → Claude source conversion, response_format → JSON-schema system-prompt injection, cache_control stamping on last assistant block, tool_choice sanitization (only pass through types Claude accepts).
- **Claude → OpenAI response**: SSE event stream → OpenAI chunk stream. `message_start` emits role chunk; `content_block_start` (text/thinking/tool_use/server_tool_use) emits delta/tool_calls; `content_block_delta` emits text_delta/thinking_delta/input_json_delta; `message_delta` resolves stop_reason and attaches usage; `message_stop` ensures final finish-reason chunk.
- **OpenAI → Claude response**: OpenAI chunk → Claude SSE events. First chunk emits `message_start`; reasoning content opens `thinking` block; text opens `text` block; tool calls open `tool_use` blocks; finish_reason flushes buffered args (with sanitization) and emits `message_delta` + `message_stop`.

### Tests added (5)
- `TestClaudeToOpenAIRequest`
- `TestOpenAIToClaudeRequest`
- `TestClaudeToOpenAIResponse`
- `TestOpenAIToClaudeResponse`
- `TestRoundTripClaudeOpenAIClaude`

TestRegistry was also updated to use isolated keys (`test-from:test-to`) so it does not shadow real translator registrations.

### Deferred (`// ponytail:` comments)
- Remaining translator pairs (gemini ↔ openai, vertex, kiro, cursor, ollama, commandcode, antigravity, openai-responses).
- Full concern implementations: thinking normalization, reasoning capture, usage aggregation, image prefetch, modality/param filtering.
- Tool-name prefix stripping for non-Anthropic OAuth transports and full `openai-to-claude` for Antigravity variant.
- Cross-format translation pivot (source → openai → target) — current `TranslateRequest` only resolves direct routes registered in the registry.

### Verification
- `cd /media/DiskE/Code/9router-new/backend && go test ./internal/translator/... -v` → 6 PASS.
- `cd /media/DiskE/Code/9router-new/backend && go test ./... -count=1` → 428 PASS in 19 packages (was 423 before Step 4).

---

## 15. Phase 4 Step 5 — Provider Format Detection + Transport Resolution

Files created:
- `backend/internal/providers/format.go`
- `backend/internal/providers/format_test.go`

### Ported behavior
- **Compatibility prefixes**: `IsOpenAICompatible`, `IsAnthropicCompatible`, `GetOpenAICompatibleType` (`chat` vs `responses`).
- **`DetectFormat(body)`**: mirrors `open-sse/services/provider.js#detectFormat` with the same priority order — openai-responses (`body.input` without `body.messages`) → antigravity (`body.request.contents` + `userAgent`) → gemini (`body.contents`) → openai (OpenAI-specific fields like `response_format`, `logprobs`, `n`, `presence_penalty`, `frequency_penalty`, `logit_bias`, `user`, `stream_options`, `top_logprobs`) → claude (`body.system` / `anthropic_version`, Claude content blocks with `source.type=base64`, `tool_use`, `tool_result`) → openai (default).
- **`GetTargetFormat(provider, registry)`**: derives format from openai-compatible / anthropic-compatible prefixes, or reads the `format` field from the registry's `PROVIDERS` map.
- **`ResolveTransport(provider, sourceFormat, registry)`**: picks the transport entry from `provider.transports[]` whose `format` matches the client source format; returns nil for no match.
- **Thinking helpers**: `IsLastMessageFromUser`, `HasThinkingConfig`, `NormalizeThinkingConfig` (strips `body.thinking` when last message is not from the user).

### Tests added (21 total in format_test.go)
- `TestProviderResolution` with subtests: IsOpenAICompatible, IsAnthropicCompatible, GetOpenAICompatibleType, DetectFormat_OpenAIResponses, DetectFormat_Antigravity, DetectFormat_Gemini, DetectFormat_OpenAI_Indicators (stream_options, response_format, logprobs, top_logprobs, n, presence_penalty, frequency_penalty, logit_bias, user), DetectFormat_Claude (system field, anthropic_version, image source.base64, tool_use, tool_result), DetectFormat_OpenAI_ImageURL, DetectFormat_Default, DetectFormat_NilBody.
- `TestGetTargetFormat`: openai-compatible, anthropic-compatible, named providers, unknown fallback.
- `TestResolveTransport`: match by format, first match, no-match fallback, no-transports-array, unknown provider, single transport.
- `TestThinkingConfigHelpers`: HasThinkingConfig variants, IsLastMessageFromUser, NormalizeThinkingConfig strip/keep behavior.

### Deferred (`// ponytail:` comments)
- Antigravity and Gemini full request/response translator pairs (Step 6+).
- Streaming-aware transport selection with fallback chains.
- `providerSpecificData` merging into transport config.

### Verification
- `cd /media/DiskE/Code/9router-new/backend && go test ./internal/providers/... -run TestProviderResolution -v` → 21 PASS.
- `cd /media/DiskE/Code/9router-new/backend && go test ./... -count=1` → 469 PASS in 19 packages (was 428 before Step 5; added 41 new assertions across format_test.go).

---

*End of audit.*
