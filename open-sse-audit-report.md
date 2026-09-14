# VansRouter open-sse Engine Layer — Comprehensive Audit Report

**Date:** 2026-09-14  
**Scope:** `open-sse/` directory (excluding `node_modules/`)  
**Total files:** 250+ JS files across 12 subdirectories

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Executors](#2-executors)
3. [Translators](#3-translators)
4. [Services](#4-services)
5. [RTK / Token Savers](#5-rtk--token-savers)
6. [Config](#6-config)
7. [Utils](#7-utils)
8. [Handlers](#8-handlers)
9. [Providers Registry](#9-providers-registry)
10. [Cross-Cutting Issues](#10-cross-cutting-issues)
11. [Recommendations Summary](#11-recommendations-summary)

---

## 1. Architecture Overview

The open-sse engine is a well-structured, modular request pipeline:

```
Request → Handler (chatCore/ttsCore/sttCore/etc.)
  → Format Detection (services/provider.js)
  → Request Translation (translator/index.js)
  → RTK Compression (rtk/index.js)
  → Executor Selection (executors/index.js)
  → Upstream Fetch (executor.execute())
  → Response Translation (translator/response/*)
  → Stream Handling (utils/streamHandler.js)
  → Client Response
```

**What works well:**
- Clean separation of concerns between executors, translators, and handlers
- Registry-driven provider configuration — single source of truth
- Fail-open design throughout (RTK, pxpipe, system inject all swallow errors)
- Hub-and-spoke translation pattern (source → OpenAI → target) with direct routes for lossless paths

---

## 2. Executors

**Files:** `executors/*.js` (28 specialized executors + default + base)

### 2.1 Registry & Dispatch (`executors/index.js`, 105 lines)

- **28 specialized executors** registered by provider ID, with aliases (`cu` → cursor, `gcli`/`gb` → grok-cli, `mmf` → mimo-free, `zc` → zcode)
- **DefaultExecutor cache** (`Map`) for unknown providers — falls back gracefully
- **Singleton pattern** — all executors instantiated at module load (no lazy init)

**✅ Works well:** Clean dispatch, alias support, unbounded fallback to DefaultExecutor

**⚠️ Issue — Memory leak in defaultCache:** `defaultCache` is a `Map` that grows unboundedly. Every unique unknown provider string creates a new `DefaultExecutor` that's never evicted. If a client sends random provider strings, this grows forever.

### 2.2 BaseExecutor (`executors/base.js`, 192 lines)

- Provides `buildUrl()`, `buildHeaders()`, `execute()`, retry logic
- Supports `openai-compatible-*` and `anthropic-compatible-*` dynamic providers
- Retry config from `runtimeConfig.js` (status-code-aware retry counts)
- Connect timeout via `FETCH_CONNECT_TIMEOUT_MS` (60s default, env-overridable)

**✅ Works well:** Solid retry with exponential backoff, clean auth header building, `proxyAwareFetch` integration

**⚠️ Issue — L31-38:** The `openai-compatible-*` and `anthropic-compatible-*` URL building lives in both `BaseExecutor.buildUrl()` AND `DefaultExecutor.buildUrl()`, duplicating logic.

**⚠️ Issue — L80:** `transformRequest()` is a no-op in base — some executors may silently skip transformation if they forget to override.

### 2.3 DefaultExecutor (`executors/default.js`, 456 lines)

The largest executor — config-driven via the registry. Handles ~100+ providers that don't need specialized executors.

- **Auth:** `AUTH_DESCRIPTORS` derived from registry `transport.auth` — supports bearer, x-api-key, split apiKey/oauth
- **Header hooks:** Provider-specific quirks (`kimiHeaders`, `kimchiHeaders`, `clineHeaders`, `kilocodeOrg`, `claudeOverlay`)
- **OAuth refresh:** Config-driven from registry `oauth.refresh`
- **`reasoningContentInjector`:** Injects reasoning_content for providers that support it

**✅ Works well:** Config-driven design minimizes per-provider code. The `HEADER_HOOKS` pattern is clean and extensible.

**⚠️ Code smell — L30-31:** `applyAuth()` with `combined: true` sets `"Bearer undefined"` when both `apiKey` and `accessToken` are missing (comment acknowledges "legacy behavior, incl. noAuth → Bearer undefined"). This is a bug that sends invalid auth headers silently.

### 2.4 Specialized Executors

| Executor | Lines | Provider | Key Features | Issues |
|----------|-------|----------|-------------|--------|
| **cursor.js** | 1115 | Cursor IDE | Protobuf encoding, HTTP/2, gzip, ConnectRPC, Agent path | Largest executor. Complex protobuf encoding. `isCloudEnv()` check (L23-27) uses loose detection. |
| **kiro.js** | 555 | AWS Kiro | Event stream→SSE transform, repair buffer, short-final detection | Heavy regex for Chinese/English future-action detection (L20-31). Repair logic is sophisticated but complex. |
| **github.js** | 345 | GitHub Copilot | Token refresh, message sanitization, Copilot headers | `sanitizeMessagesForChatCompletions` (L45-100) injects system prompts for JSON mode — hacky workaround. |
| **vertex.js** | 176 | Vertex AI | SA JSON auth, ADC support, project ID resolution | `resolveProjectId()` (L35-49) sends a dummy request to discover project ID — clever but fragile if Google changes error format. |
| **codex.js** | 491 | Codex | Responses API translation, OAuth, streaming envelope | Inline Responses API translation instead of using translator layer. |
| **antigravity.js** | 491 | Antigravity (Google) | Session management, prompt rewriting, transient retry | `AG_PROMPT_TRIGGERS` (L25) hardcodes "Hermes Agent" and "Nous Research" for competitive prompt detection. `ANTIGRAVITY_REQUEST_BLACKLIST` (L46-53) manually lists rejected fields. |
| **grok-cli.js** | 302 | Grok CLI | Session turn tracking, quota frame | Per-session turn counter with `sessionTurnStore` — in-memory, lost on restart. |
| **grok-web.js** | 343 | Grok Web | Cookie auth, statsig ID gen, model mapping | `generateStatsigId()` (L35-39) generates fake error messages as IDs — fragile anti-detection. |
| **freebuff.js** | 675 | Freebuff/Codebuff | Session claiming, agent run registration, system marker injection | Complex session lifecycle (claim → run → chat). `FREEBUFF_SYSTEM_MARKER` (L48) injection for gate bypass. |
| **mimo-free.js** | 166 | Xiaomi MiMo | JWT bootstrap, device fingerprint, system marker | `MIMO_SYSTEM_MARKER` (L24) injection. In-memory JWT cache not shared across workers. |
| **qoder.js** | 527 | Qoder | COSY signing (RSA+AES+MD5), WAF bypass encoding | Complex crypto. Model config fetched live from `/model/list`. |
| **azure.js** | 57 | Azure OpenAI | Deployment URL building | Falls back to `process.env` for config — good. Clean and minimal. |
| **gemini-cli.js** | 99 | Gemini CLI | CLI user-agent, reasoning field stripping | Stores `_currentModel` as instance var (L27) — NOT thread-safe if executor is shared. |
| **ollama-local.js** | — | Local Ollama | Local inference | |
| **opencode.js** / **opencode-go.js** | — | OpenCode | | |
| **perplexity-web.js** | — | Perplexity Web | | |
| **commandcode.js** | — | CommandCode | | |
| **xiaomi-tokenplan.js** | — | Xiaomi TokenPlan | | |
| **zcode.js** | — | ZCode | | |
| **codebuddy-cn.js** / **codebuddy-intl.js** | — | CodeBuddy | | |
| **agentrouter.js** | — | AgentRouter | | |
| **muse-spark-web.js** | — | MuseSpark Web | | |
| **devin-cli.js** | — | Devin CLI | | |
| **iflow.js** | — | iFlow | | |

**🐛 Bug — gemini-cli.js L27:** `this._currentModel = model` in `transformRequest()` is NOT thread-safe. The executor is a singleton shared across concurrent requests. If two requests hit simultaneously, one overwrites the other's model in `buildHeaders()`.

**🐛 Bug — grok-web.js MODEL_MAP:** Has 14 hardcoded model mappings. New Grok models require code changes rather than config changes.

---

## 3. Translators

**Files:** `translator/` (40+ files)

### 3.1 Translation Pipeline (`translator/index.js`, 269 lines)

- **Hub-and-spoke:** source → OpenAI → target (with direct route shortcuts)
- **Registration:** via `register(from, to, requestFn, responseFn)` in `translator/registry.js` (21 lines — clean)
- **Pre-processing:** `ensureToolCallIds`, `fixMissingToolResponses`, `stripContentTypes`, `normalizeThinkingConfig`
- **Post-processing:** `applyThinking()`, `captureSessionId()`, `normalizeClaudePassthrough`, `anchorClaudeCache`, `claudeCloaking`

**✅ Works well:** Direct routes for lossless translation (e.g., `claude:kiro` avoids double-hop). Clean registration pattern.

### 3.2 Formats (`translator/formats.js`, 36 lines)

13 format identifiers: `openai`, `openai-responses`, `openai-response`, `claude`, `gemini`, `gemini-cli`, `vertex`, `codex`, `antigravity`, `kiro`, `cursor`, `ollama`, `commandcode`

**⚠️ Gap — `openai-response` vs `openai-responses`:** Two similar-sounding format IDs. `openai-response` appears to be a typo/legacy that could cause confusion.

### 3.3 Request Translators (12 files)

| File | Direction | Lines |
|------|-----------|-------|
| `openai-to-claude.js` | OpenAI → Claude | — |
| `openai-to-gemini.js` | OpenAI → Gemini | — |
| `openai-to-kiro.js` | OpenAI → Kiro | — |
| `openai-to-cursor.js` | OpenAI → Cursor | — |
| `openai-to-commandcode.js` | OpenAI → CommandCode | — |
| `openai-to-ollama.js` | OpenAI → Ollama | — |
| `openai-to-vertex.js` | OpenAI → Vertex | — |
| `claude-to-openai.js` | Claude → OpenAI | — |
| `claude-to-kiro.js` | Claude → Kiro (direct) | — |
| `gemini-to-openai.js` | Gemini → OpenAI | — |
| `antigravity-to-openai.js` | Antigravity → OpenAI | — |
| `openai-responses.js` | Responses API ↔ OpenAI | — |

**⚠️ Coverage gap — No direct request translators for:**
- `openai → codex` (codex executor does inline translation)
- `claude → gemini` (must double-hop through OpenAI)
- `gemini → claude`
- `kiro → openai` (only `openai → kiro` exists for requests)

### 3.4 Response Translators (11 files)

| File | Direction | Key Notes |
|------|-----------|-----------|
| `claude-to-openai.js` | 221 lines | Handles thinking blocks, cache tokens, tool calls. `wrapThinkTags` only for native Claude models (L32). |
| `gemini-to-openai.js` | 180 lines | Handles function calls, images, reasoning. `emitFunctionCall` restores cloaked tool names. |
| `kiro-to-openai.js` | 160 lines | Parses Kiro SSE events. Handles `assistantResponseEvent`, `codeEvent`, etc. |
| `kiro-to-claude.js` | — | Direct Kiro→Claude path. |
| `cursor-to-openai.js` | 30 lines | **Pure passthrough** — CursorExecutor already emits OpenAI format. |
| `commandcode-to-openai.js` | — | CommandCode→OpenAI. |
| `ollama-to-openai.js` | — | Ollama→OpenAI. |
| `openai-responses.js` | — | Responses API. |
| `openai-to-claude.js` | — | OpenAI→Claude (for native Claude clients). |
| `openai-to-antigravity.js` | — | OpenAI→Antigravity. |

**⚠️ Coverage gap:** No `gemini-to-claude` response translator. Gemini responses must go through OpenAI pivot first, losing some information.

### 3.5 Concerns (`translator/concerns/`, 13 files)

Excellent decomposition into cross-cutting concerns:
- **chunk.js** — chunk builder
- **finishReason.js** — finish reason normalization
- **image.js** — data URI encoding
- **json.js** — safe JSON parsing
- **kiroConversation.js** — Kiro conversation handling
- **message.js** — message normalization, text collapsing
- **modality.js** — strip unsupported modalities
- **paramSupport.js** — strip unsupported params per provider
- **prefetch.js** — prefetch remote images
- **reasoning.js** — reasoning_content delta
- **thinking.js** / **thinkingUnified.js** — thinking block handling
- **toolCall.js** — tool call ID generation, missing response fixing
- **usage.js** — usage token normalization

**✅ Works well:** Very clean separation. Each concern is focused and testable.

### 3.6 Schema (`translator/schema/`, 5 files)

- `blocks.js` — content type constants (OPENAI_BLOCK, CLAUDE_BLOCK)
- `defaults.js` — default values
- `finishReasons.js` — finish reason mappings
- `roles.js` — role constants (ROLE.SYSTEM, ROLE.USER, etc.)
- `index.js` — barrel export

**✅ Works well:** Constants are centralized and well-organized.

---

## 4. Services

**Files:** `services/*.js` (20 files)

### 4.1 Account Fallback (`services/accountFallback.js`, 539 lines)

- **Config-driven error rules** — matches `ERROR_RULES` top-to-bottom
- **Exponential backoff** for rate limits (2s base, 5min max, 15 levels)
- **Account filtering** — `filterAvailableAccounts()` with circuit breaker integration
- **Provider resilience profiles** — per-provider failure thresholds

**✅ Works well:** Sophisticated and well-thought-out. The config-driven error classification is excellent.

### 4.2 Account Semaphore (`services/accountSemaphore.js`, 246 lines)

- **Per-account concurrency limiter** — FIFO queue with timeout
- `SemaphoreCapacityError` for queue overflow
- Default: 1 concurrent request per account, 20 max queue, 30s timeout

**✅ Works well:** Clean implementation. `buildAccountSemaphoreKey()` includes proxy hash for pool-aware locking.

**⚠️ Issue — No cleanup of idle gates:** Gates are stored in a `Map` but never pruned when an account is removed. Over time this can leak memory.

### 4.3 Token Refresh (`services/tokenRefresh.js`, 269 lines + `tokenRefresh/providers.js`)

- **13 provider-specific refresh functions** (Claude, Google, Qwen, Codex, Kiro, iFlow, GitHub, Copilot, CodeBuddy, Xai, Kimi, Cline)
- **Vertex SA JSON** — JWT assertion via `jose` library
- **Token caching** — `vertexTokenCache` with 5-minute buffer

**✅ Works well:** Comprehensive OAuth support. `isUnrecoverableRefreshError()` correctly identifies terminal errors.

**⚠️ Issue — `vertexTokenCache`:** In-memory `Map`, not shared across workers/processes. Each worker mints its own tokens.

### 4.4 OAuth Credential Manager (`services/oauthCredentialManager.js`, 156 lines)

- **Proactive refresh** — `shouldRefreshCredentials()` checks before request
- **Refresh locks** — per-credential dedup via `refreshLocks` Map
- Codex-specific 8-day max refresh age from registry

**✅ Works well:** Lock deduplication prevents thundering-herd token refreshes.

### 4.5 Other Services

| Service | Lines | Purpose | Notes |
|---------|-------|---------|-------|
| **provider.js** | 169 | Format detection, transport resolution | `detectFormat()` inspects body structure — comprehensive (checks 15+ indicators) |
| **model.js** | 142 | Model parsing, alias resolution | `ALIAS_TO_PROVIDER_ID` built from registry — single source |
| **combo.js** | 689 | Model combo/fallback chains | Complex but well-documented. `flattenToolHistory()` for panel models. |
| **proxyPoolFitness.js** | 165 | Proxy pool health tracking | SQLite-backed with in-memory cache. 5-min unfit window. |
| **cloudCodeThinking.js** | — | Cloud Code thinking config | Selective strip for Claude/GPT/tab_ models |
| **cursorModels.js** | — | Dynamic Cursor model list | |
| **copilotModels.js** | — | Dynamic Copilot model list | |
| **kiroModels.js** | — | Dynamic Kiro model list | |
| **grokCliModels.js** | — | Dynamic Grok CLI model list | |
| **qoderModels.js** | — | Dynamic Qoder model list + config | |
| **clinepassModels.js** | — | Clinepass model list | |
| **projectId.js** | — | GCP project ID management | |
| **antigravityHeaderScrub.js** | — | Strip proxy/fingerprint headers | |

### 4.6 Usage Tracking (`services/usage/`, 13 files)

Provider-specific usage parsing for: Claude, CodeBuddy, Codex, DeepSeek, Freebuff, GitHub, GLM, Google, Grok CLI, Kimi, Kiro, MiniMax, Zed, plus shared utilities.

**⚠️ Gap — Missing usage trackers for:** Many providers listed in the registry (e.g., Anthropic via API, OpenAI, Mistral, Cohere, etc.) don't have dedicated usage files. They likely use the generic shared handler, but this should be verified.

---

## 5. RTK / Token Savers

**Files:** `rtk/` (19 files)

RTK is a **token reduction toolkit** that compresses verbose tool output before sending to LLM providers. It's a port from a Rust implementation.

### 5.1 Core (`rtk/index.js`, 160 lines)

- Compresses `tool_result` / `tool` message content in-place
- Supports 4 shapes: OpenAI tool, Claude string, Claude array, OpenAI Responses
- Kiro format support via `compressKiroFormat()`
- **Auto-detect filters** via `rtk/autodetect.js`

**✅ Works well:** Shape-aware compression. Fail-open (`try/catch` wraps everything). Preserves error traces (`is_error === true` → skip).

### 5.2 Filters (`rtk/filters/`, 12 files)

Detection-order: git-log → git-diff → git-status → build-output → grep → find → tree → ls → search-list → read-numbered → dedup-log → smart-truncate

| Filter | Purpose | Cap |
|--------|---------|-----|
| gitLog | Truncate git log output | 200 lines |
| gitDiff | Keep diff hunks, trim context | 100 lines/hunk, 3 context lines |
| gitStatus | Truncate file lists | 10 files, 10 untracked |
| buildOutput | Compress build/npm/yarn output | — |
| grep | Limit matches per file | 10/file |
| find | Limit files per directory | 10/dir, 20 dirs |
| ls | Compact ls output | Top 5 extensions |
| tree | Truncate tree output | 200 lines |
| searchList | Cursor-style search results | 10/dir, 20 dirs |
| readNumbered | Numbered-line file reads | — |
| dedupLog | Deduplicate log lines | 2000 lines |
| smartTruncate | Head+tail truncation | 120 head + 60 tail |

**✅ Works well:** Comprehensive filter library. Constants are configurable (`rtk/constants.js`). Detection is robust with multiple regex patterns.

### 5.3 System Injectors

| File | Purpose |
|------|---------|
| **caveman.js** | Injects "caveman-style" (concise) instructions |
| **ponytail.js** | Injects "lazy senior dev" instructions |
| **systemInject.js** | Format-aware system prompt injection (dispatches by format) |
| **terminationPrompt.js** | Anti-loop termination contract + tool protocol hint |
| **formatInjectors.js** | Per-format injection implementations |

**✅ Works well:** Format-aware injection covers all 6+ formats. Idempotent (checks for existing prompt before injecting).

### 5.4 Compression Services

| File | Lines | Purpose |
|------|-------|---------|
| **pxpipe.js** | 104 | Renders bulky Claude context as dense PNGs via pxpipe-proxy |
| **headroom.js** | 358 | External compression service (RTK-as-a-service via HTTP API) |

**✅ Works well:** Both are fail-open with timeout races. `pxpipe.js` correctly handles the token-vs-bytes distinction (base64 PNGs are bigger in bytes but cheaper in tokens).

**⚠️ Issue — headroom.js L8:** `DEFAULT_TIMEOUT_MS = 3000` is quite aggressive for an HTTP call. May cause false "timeout" results under load.

---

## 6. Config

**Files:** `config/` (16 files)

### 6.1 Runtime Config (`config/runtimeConfig.js`, 125 lines)

| Constant | Default | Env Override | Notes |
|----------|---------|-------------|-------|
| `STREAM_STALL_TIMEOUT_MS` | 360s | ✅ | Very generous for reasoning models |
| `STREAM_FIRST_CHUNK_TIMEOUT_MS` | 200s | ✅ | Generous TTFT |
| `FETCH_CONNECT_TIMEOUT_MS` | 60s | ✅ | |
| `GEMINI_NATIVE_TTS_FETCH_TIMEOUT_MS` | 45s | ✅ | |
| `DEFAULT_COMBO_TARGET_TIMEOUT_MS` | 30s | ✅ | |
| `DEFAULT_MAX_TOKENS` | 64000 | ❌ | **Should be env-configurable** |
| `DEFAULT_MIN_TOKENS` | 32000 | ❌ | **Should be env-configurable** |
| `CACHE_TTL.userInfo` | 300s | ❌ | **Should be env-configurable** |
| `CACHE_TTL.modelAlias` | 3600s | ❌ | **Should be env-configurable** |
| `MEMORY_CONFIG.sessionTtlMs` | 2h | ❌ | **Should be env-configurable** |
| `RETRY_CONFIG.maxAttempts` | 2 | ❌ | |
| `RETRY_CONFIG.delayMs` | 2000 | ❌ | |
| `SEARXNG_URL` | `http://127.0.0.1:8888/search` | ✅ | |
| `TOKEN_SAVER_HEADER` | `x-9router-token-saver` | ❌ | Hardcoded header name |

**⚠️ Hardcoded values that should be configurable:**
- `DEFAULT_MAX_TOKENS` / `DEFAULT_MIN_TOKENS` (L68-69)
- `MEMORY_CONFIG` session/cleanup TTLs (L28-32)
- `CACHE_TTL` values (L21-24)
- `TOKEN_SAVER_HEADER` (L71)

### 6.2 Error Config (`config/errorConfig.js`, 88 lines)

- Error type mapping (HTTP status → OpenAI error type/code)
- Backoff config: 2s base, 5min max, 15 levels
- Transient cooldown: 30s
- Max rate limit cooldown: 30min

**✅ Works well:** Well-organized, comprehensive error mapping.

### 6.3 Other Config Files

| File | Purpose | Issues |
|------|---------|--------|
| **appConstants.js** (210 lines) | Gemini CLI, GitHub Copilot, Antigravity constants | Derives from registry — good. |
| **awsRegion.js** | Kiro AWS region validation | |
| **codexInstructions.js** | Codex system instructions | |
| **defaultThinkingSignature.js** | Default thinking signatures per format | |
| **googleTtsLanguages.js** | Google TTS language list | |
| **grokCli.js** | Grok CLI model config, reasoning effort | |
| **kiroConstants.js** | Kiro-specific constants | |
| **mediaConfig.js** | Media (image/video/audio) config | |
| **ollamaModels.js** | Ollama model list | |
| **providerModels.js** (111 lines) | Provider model registry helpers | |
| **providerProfiles.js** | Per-provider resilience profiles | |
| **providers.js** (23 lines) | Barrel re-export from registry | |
| **ttsModels.js** | TTS model config | |

---

## 7. Utils

**Files:** `utils/` (34 files)

### 7.1 Circuit Breaker (`utils/circuitBreaker.js`, 260 lines)

**States:** CLOSED → DEGRADED → OPEN → HALF_OPEN → CLOSED

- **4-state machine** with degradation threshold
- **Exponential backoff** on OPEN state (up to 16x multiplier)
- **Failure window** — optional sliding window (0 = cumulative)
- **Per-kind thresholds** — different limits for transient vs rate-limit vs quota
- **Provider-failure error codes:** 408, 500, 502, 503, 504, 520, 524 (429 excluded — correct!)
- **Local stream lifecycle errors** excluded from failure count

**✅ Works well:** Sophisticated implementation. The DEGRADED state is a nice touch for early warning. The decision to exclude 429 from circuit breaker is explicitly documented and correct (L22-27).

**⚠️ Issue — In-memory only:** Comment on L3 explicitly acknowledges "no DB persistence." Circuit breaker state resets on process restart.

**⚠️ Issue — No metrics/observability:** No hooks for monitoring circuit breaker state changes externally.

### 7.2 Error Handling (`utils/error.js`, 184 lines)

- `buildErrorBody()` — OpenAI-compatible error response
- `errorResponse()` — non-streaming error Response
- `writeStreamError()` — SSE streaming error
- `parseUpstreamError()` — extracts message from provider error responses, supports executor-specific `parseError()` override
- `formatProviderError()` — formats with retry-after info

**✅ Works well:** Comprehensive error handling with both streaming and non-streaming paths. The executor `parseError()` override is extensible.

### 7.3 429 Classification (`utils/classify429.js`, 331 lines)

- Distinguishes **rate_limit** (60s cooldown), **quota_exhausted** (1h cooldown), **daily_quota** (until midnight)
- Heuristic regex patterns for each kind
- Provider-specific patterns (OpenAI, Google, Groq, OpenRouter, etc.)

**✅ Works well:** Very thorough heuristic classification. Well-documented with provider examples.

### 7.4 Stream Handling (`utils/streamHandler.js`, 240 lines)

- `createStreamController()` — abort + disconnect detection
- `pipeWithDisconnect()` — pipe with client disconnect awareness
- Stall timeout detection (`STREAM_STALL_TIMEOUT_MS`)

**✅ Works well:** Clean disconnect handling.

### 7.5 Other Notable Utils

| File | Lines | Purpose | Notes |
|------|-------|---------|-------|
| **proxyFetch.js** | 295 | Proxy-aware fetch with DNS cache | Patches `globalThis.fetch`. DNS cache eviction via `MEMORY_CONFIG.dnsCacheTtlMs`. `MITM_BYPASS_HOSTS` hardcoded (L10-17). |
| **claudeCloaking.js** | — | Tool name obfuscation for Antigravity | Cloaks/decloaks tool names to bypass Google's restrictions |
| **claudeHeaderCache.js** | — | Cached Claude headers | |
| **claudeSignature.js** | — | Claude response signature validation | |
| **clientDetector.js** | — | Detects Cline, Cursor, Codex, etc. | |
| **clinepassEnvelope.js** | — | Clinepass request envelope unwrap | |
| **cookie.js** | — | Cookie parsing/cleaning | |
| **cooldownRetry.js** | 121 | Wait-and-retry when all accounts rate-limited | 30s max wait, 1 retry max. Clean abort on disconnect. |
| **cursorProtobuf.js** | — | Cursor protobuf encode/decode | |
| **cursorChecksum.js** | — | Cursor checksum generation | |
| **cursorAgentProtobuf.js** | — | Cursor agent protobuf handling | |
| **debugLog.js** | — | Debug logging | |
| **errorLog.js** | — | Error logging | |
| **kimchiUserAgent.js** | — | Kimchi user agent generation | |
| **kimiToolParser.js** | — | Kimi tool call normalization | |
| **kiroSessionReplay.js** | — | Kiro session replay | |
| **loopGuard.js** | 223 | Detect repeating tool call patterns | Thresholds: 3x single repeat, 2x sequence repeat, 3x text repeat |
| **ollamaTransform.js** | — | Ollama response transformation | |
| **reasoningContentInjector.js** | — | Inject reasoning_content into responses | |
| **requestLogger.js** | — | Request logging | |
| **responsesStreamHelpers.js** | — | Responses API stream helpers | |
| **sessionManager.js** | — | Session ID management | |
| **sse.js** | — | SSE chunk formatting | |
| **sseConstants.js** | — | SSE constants ([DONE], headers) | |
| **stream.js** | — | SSE transform stream creation | |
| **streamHelpers.js** | — | SSE line parsing | |
| **toolDeduper.js** | — | Deduplicate tool definitions | |
| **usageTracking.js** | — | Usage token counting/estimation | |
| **bypassHandler.js** | — | Direct passthrough handler | |

**⚠️ Issue — proxyFetch.js L10-17:** `MITM_BYPASS_HOSTS` is hardcoded. Adding new providers that need MITM bypass requires code changes.

---

## 8. Handlers

**Files:** `handlers/` (36 files)

### 8.1 Chat Core (`handlers/chatCore.js`, 671 lines)

The **main entry point** for chat completions. Orchestrates:

1. Format detection + transport resolution
2. RTK compression (caveman, ponytail, pxpipe, headroom, RTK)
3. Token saver configuration from headers
4. Loop guard detection + termination prompt injection
5. Tool deduplication + tool protocol prompt
6. Request translation
7. Credential refresh
8. Executor selection + dispatch
9. Response handling (streaming/non-streaming/coerced)

**✅ Works well:** Well-organized orchestration. Clean delegation to sub-handlers.

**⚠️ Issue — L39:** `MAX_POOL_RETRIES = 2` is hardcoded at module level. Should be configurable.

**⚠️ Issue — L40:** `TOOL_PROTOCOL_PROMPT_PROVIDERS = new Set(["kimchi", "nvidia"])` — hardcoded provider set for tool protocol injection. Should be registry-driven.

### 8.2 Chat Sub-Handlers (`handlers/chatCore/`, 5 files)

| File | Lines | Purpose |
|------|-------|---------|
| **streamingHandler.js** | 217 | SSE streaming pipeline with early EOF detection |
| **nonStreamingHandler.js** | 402 | JSON response handling with format conversion |
| **sseToJsonHandler.js** | — | Force SSE→JSON conversion |
| **coercedSseHandler.js** | — | Coerced SSE for providers that need it |
| **requestDetail.js** | — | Request detail logging + usage stats |

### 8.3 TTS (`handlers/ttsCore.js`, 69 lines + `ttsProviders/`, 11 files)

- Clean adapter pattern via `getTtsAdapter()`
- 11 TTS providers: OpenAI, EdgeTTS, ElevenLabs, Gemini, Google TTS, MiniMax, Xiaomi MiMo, OpenRouter, local device, + generic formats
- Supports JSON and binary response formats

**✅ Works well:** Clean adapter pattern. Good provider coverage.

### 8.4 STT (`handlers/sttCore.js`, 193 lines)

- OpenAI-compatible multipart/form-data
- Deepgram binary POST
- Generic multipart providers
- Auth header support: bearer, token, x-api-key, key

**✅ Works well:** Handles multiple upload formats. `resolveAudioContentType()` covers common formats.

### 8.5 Embeddings (`handlers/embeddingsCore.js`, 127 lines + `embeddingProviders/`, 5 files)

- Adapter pattern: OpenAI, OpenAI-compatible, Gemini
- Input validation (string or array)

**✅ Works well:** Clean. Input validation is thorough.

### 8.6 Image Generation (`handlers/imageGenerationCore.js`, 230 lines + `imageProviders/`, 13 files)

13 image providers: OpenAI, Gemini, Antigravity, Black Forest Labs, Cloudflare AI, Codex, ComfyUI, Fal AI, HuggingFace, Nanobanana, RunwayML, SD WebUI, Stability AI

**✅ Works well:** Comprehensive provider coverage. Clean adapter pattern.

### 8.7 Video (`handlers/videoCore.js`, 166 lines)

- Async job submission (no auto-retry for POST — correct for billable operations)
- Auth retry on 401/403 after token refresh
- Secret sanitization in error messages

**✅ Works well:** Correctly avoids retrying billable job submissions.

### 8.8 Search (`handlers/search/`, 7 files)

Web search integration: Exa, XQuik, SearXNG, ChatSearch, with normalizers and request helpers.

### 8.9 Responses API (`handlers/responsesHandler.js`)

OpenAI Responses API handler.

---

## 9. Providers Registry

**Files:** `providers/registry/` (100+ files)

The registry is the **single source of truth** for provider configuration. Each provider has a registry file defining:
- Transport (base URL, headers, auth)
- Models (IDs, capabilities, pricing)
- OAuth config (token URLs, refresh)
- Media config (TTS, STT, image, video)

**✅ Works well:** Excellent pattern. New providers only need a registry file + (optionally) a specialized executor.

---

## 10. Cross-Cutting Issues

### 🐛 Bugs

1. **gemini-cli.js L27 — Thread-safety:** `this._currentModel = model` on a singleton executor. Concurrent requests will corrupt each other's model name in headers.

2. **default.js L30-31 — "Bearer undefined":** `applyAuth()` with `combined: true` sends `"Bearer undefined"` when both apiKey and accessToken are missing.

3. **executors/index.js L66 — Unbounded defaultCache:** No size limit or eviction on the `defaultCache` Map.

### ⚠️ Code Smells

1. **Duplicated URL building:** `openai-compatible-*` URL building logic exists in both `BaseExecutor.buildUrl()` (L31-43) and `DefaultExecutor.buildUrl()`.

2. **Hardcoded provider sets:** `TOOL_PROTOCOL_PROMPT_PROVIDERS`, `MITM_BYPASS_HOSTS`, `AG_PROMPT_TRIGGERS` — should be registry-driven.

3. **In-memory state:** Circuit breakers, session turn counters, JWT caches, account semaphore gates — all lost on restart. Acceptable for single-process but problematic for multi-worker deployments.

4. **codex.js inline translation:** The Codex executor does its own Responses API translation instead of using the translator layer. This duplicates logic and makes it harder to maintain.

5. **No test files in open-sse/:** Zero test files visible. All testing appears to be external.

### 🔄 Architectural Observations

1. **Format proliferation:** 13 format IDs for what is essentially 5 distinct wire formats (OpenAI, Claude, Gemini, Kiro, Cursor). `vertex`, `gemini-cli`, `antigravity` are all Gemini variants. `codex` is an OpenAI variant. This increases translation matrix complexity.

2. **Executor vs DefaultExecutor boundary:** Some providers that use DefaultExecutor (e.g., kimchi, kimi) have quirks handled via `HEADER_HOOKS`. If quirks grow, they should graduate to specialized executors.

3. **RTK is excellent:** The token reduction toolkit is a standout feature. Well-ported from Rust, comprehensive filter library, fail-open design. The auto-detect logic is particularly clever.

---

## 11. Recommendations Summary

### Critical (Bugs)
| # | Issue | Location | Fix |
|---|-------|----------|-----|
| 1 | Thread-unsafe `_currentModel` | `executors/gemini-cli.js:27` | Pass model through method params instead of instance state |
| 2 | `"Bearer undefined"` auth header | `executors/default.js:30-31` | Guard with `if (token)` before setting header |
| 3 | Unbounded defaultCache | `executors/index.js:66` | Add LRU eviction or max size |

### High Priority (Missing)
| # | Issue | Fix |
|---|-------|-----|
| 4 | No tests in open-sse/ | Add unit tests for translators, circuit breaker, RTK |
| 5 | Missing env overrides for MAX_TOKENS, CACHE_TTL, MEMORY_CONFIG | Use `envMs()` pattern already in file |
| 6 | Direct translation gaps (claude→gemini, kiro→openai request) | Add direct routes where double-hop causes data loss |

### Medium Priority (Improvements)
| # | Issue | Fix |
|---|-------|-----|
| 7 | Hardcoded provider sets | Move to registry config |
| 8 | In-memory state across workers | Consider Redis/SQLite for circuit breakers & semaphores |
| 9 | `MITM_BYPASS_HOSTS` hardcoded | Move to config/env |
| 10 | `headroom.js` 3s timeout | Increase to 5-10s or make configurable |
| 11 | Codex inline translation | Migrate to translator layer |
| 12 | `openai-response` vs `openai-responses` format confusion | Clarify or remove the singular form |

### Low Priority (Polish)
| # | Issue | Fix |
|---|-------|-----|
| 13 | Semaphore gate cleanup | Add idle gate pruning timer |
| 14 | grok-web MODEL_MAP hardcoded | Move to registry |
| 15 | Circuit breaker observability | Add state-change event hooks |

---

*End of Audit Report*
