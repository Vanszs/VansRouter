# VansRouter open-issue audit — 2026-09-22

Scope: the open issues in `github.com/Vanszs/VansRouter` as of 2026-09-22 — **7 of 9, with #108 and
#83 (the announcement) excluded at the author's request** (no findings from those two are reproduced
or acted on in this report).
Method: read-only. Issue bodies/comments pulled with `gh`; verdicts grounded in the current tree
(`main` @ `53c46761c`, tag `v0.91.22`, 2026-09-16), git history, and `upstream/master`
(`decolua/9router`, merge-base 2026-06-21). Upstream refs were refreshed with `git fetch upstream`
(fetch only) at audit time: **tip is now `a8c9d3802`, "docs: update changelog header to v0.5.81"
(2026-09-18), 31 commits ahead of the `17c4cc768` seen in the first pass**; the per-issue verdicts
below were re-checked against that tip. No source files, issues, PRs, or branches were modified.
Live third-party probes were made (TokenRouter host check, OpenCode Zen model list / free-tier gate)
— all unauthenticated, no credentials sent.

Verdict codes: **A** still broken here · **B** already fixed here · **C** not fixed here, fix exists upstream.

## Summary

| # | Title (short) | Type | Verdict | Recommended action |
|---|---|---|---|---|
| 132 | Large body blocks event loop | bug | **A** | fix here: body-size ceiling + RTK size skip (no upstream fix) |
| 131 | Cursor provider returns no tokens | bug | **A / UNVERIFIABLE live** | ask reporter for logs; our code is ahead of upstream, nothing to adopt |
| 129 | Add Muse Spark from muse.ai | feature | **A / needs info** | clarify target service; name collides with existing Meta AI `muse-spark-web` |
| 123 | Cline non-stream envelope unread | bug | **B** (fixed in v0.91.22) + **C** for catalog | close as fixed; optionally adopt upstream live catalog |
| 121 | OpenCode Zen missing / Zen key ≠ Go | bug+feature | **A/C** (seed stale) + **C** for the 403 gate | port upstream free-tier fix `6091ff597`/`93837af09` (executor `opencode.js` is 471 lines behind) + 1.3 seed entry; no Zen apikey provider in either repo |
| 118 | SQLite corruption wipes accounts | bug | **B** (fail-closed; manual restore) | verify with reporter, close; rolling `VACUUM INTO` backups still absent |
| 107 | tokenrouter gpt-5.6-luna HTTP 405 | bug | **A** + **C** | adopt upstream host `api.tokenrouter.com`; ours points at `www` (405 proven) |

**Fix status in working tree, 2026-09-22** (details + proof per entry below): #107 **fixed** (host switch,
180 tests pass) · #121 **fixed** (minimal port of `6091ff597` + 1.3 seed, 226 tests pass) · #132 **fixed**
(413 ceiling + RTK size skip, 39 tests pass) · #118 **already fixed in v0.91.22** (regression test 2 passed) ·
#123 **already fixed in v0.91.22** (code path + reporter re-test) · #131 **needs reporter logs (UNVERIFIABLE live)** ·
#129 **needs info (which service)**. `node scripts/lint-undef.cjs` clean.

## #132 — Large request body (~700KB) blocks the event loop — **A (still broken)**

Evidence that no guard exists in the current tree:

- `src/sse/handlers/chat.js:63` — `body = await request.json();` with no size ceiling before parse.
- Repo-wide grep for `413|MAX_BODY|CONTENT_LENGTH` in `src/` + `open-sse/` returns no request-body
  limit (only unrelated hits: `open-sse/rtk/filters/gitDiff.js:1`, `open-sse/config/kiroConstants.js:56`).
- `next.config.mjs:11,35` — `proxyClientMaxBodySize` defaults to `"128mb"` and is passed to
  `experimental`, i.e. the proxy is configured to **accept** bodies that big rather than reject them.
- RTK runs synchronously across every message with no size threshold:
  `open-sse/rtk/index.js:12-31` (`compressMessages`, loops all `messages`/`input` items),
  called from `open-sse/handlers/chatCore.js:308`.
- Upstream has no equivalent guard either (`git grep "413|MAX_BODY" upstream/master -- open-sse src/app/api/v1`
  → only unrelated matches), so there is **no upstream fix to adopt**.

Partially done already (issue suggestion 1): observability writes are buffered, batched and truncated —
`src/lib/db/repos/requestDetailsRepo.js:5-7` (`DEFAULT_BATCH_SIZE`, `DEFAULT_FLUSH_INTERVAL_MS`,
`DEFAULT_MAX_JSON_SIZE`), `:42` `writeBuffer`,
`:99-102` `truncateField(..., config.maxJsonSize)`, `:131-135` batch flush. So the hot-path DB write is not
the whole story; the uncovered parts are the unbounded body parse, the synchronous RTK pass, and the lack of
a 413 path. Neither `quick_check`-style pre-checks nor a health-check decoupling exists for this case.

Action: **DONE in working tree.** `src/sse/handlers/chat.js`: body now read as text with a ceiling
(`MAX_REQUEST_BODY_BYTES`, default 8 MB, env `NINEROUTER_MAX_BODY_BYTES`) → `HTTP_STATUS.PAYLOAD_TOO_LARGE`
(413, added at `open-sse/config/runtimeConfig.js:9`) before `JSON.parse`. `open-sse/rtk/index.js`:
`compressMessages()` returns `null` above `RTK_MAX_BODY_BYTES` (default 512 KB, env `NINEROUTER_RTK_MAX_BYTES`),
so the synchronous per-message pass no longer runs on ~700 KB agent sessions. Proof:
`pnpm test tests/unit/request-body-limits.test.js tests/unit/rtk.test.js` → 39 passed (oversized body → 413,
malformed JSON still 400, small body still compresses, oversized body skipped). Not reproduced end-to-end:
the original 700 KB agent session against a live instance. Still unaddressed from the issue's wishlist:
decoupling the `/` health check from business middleware.

## #131 — Cursor provider "returns no tokens" — **A / UNVERIFIABLE live**

- Provider + executor exist: `open-sse/providers/registry/cursor.js:1-30` (`baseUrl: https://api2.cursor.sh`,
  `chatPath: /aiserver.v1.ChatService/StreamUnifiedChatWithTools`, `format: "cursor"`),
  `open-sse/executors/cursor.js` (HTTP/2 AgentService path at `:336-404`, `AGENT_RUN_PATH = "/agent.v1.AgentService/Run"` at `:46`).
- **Our fork is ahead of upstream here, not behind.** `git diff main upstream/master -- open-sse/executors/cursor.js`
  shows main-only code: `encodeMcpTools` import at `:11`, `export function isAgentCapableRequest` at `:74`, and
  `...(tools.length ? [agentMessage(4, encodeMcpTools(tools))] : [])` at `:141` inside `buildAgentRunFrame`;
  upstream `cursor.js` has none of these (`git show upstream/master:open-sse/utils/cursorProtobuf.js | grep -c encodeMcpTools` → 0).
  Upstream's later cursor commits since the merge-base are `6994cd1f7` (HTTP/2 AgentService support) and
  `5e5979082` (stop leaking agent tool errors as text) — the HTTP/2 work is already present in ours.
- Conclusion: there is **no upstream patch to cherry-pick** for this symptom.
- Verdict on the symptom itself: UNVERIFIABLE here — the report is one line ("returns no tokens") and
  reproduction needs a Cursor account (OAuth credentials not present in this environment).
  What would prove it: a captured `[STREAM]` log plus the decoded AgentService frames for one request,
  or a token-level trace showing an empty `choices`/text payload.

Action: ask the reporter for logs (request id, stream log line, model id used) before touching the executor.

## #129 — "Add Muse Spark from https://muse.ai/" — **A / needs info**

- Nothing in the tree references `muse.ai` (grep over `src/`, `open-sse/`, `scripts/` → 0 hits), and
  upstream has no registry entry for it either (`git ls-tree upstream/master open-sse/providers/registry | grep -i muse` → none).
- Name collision, worth flagging to the reporter: the existing `open-sse/providers/registry/muse-spark-web.js`
  is **Meta AI**, not muse.ai — `display.website: "https://www.meta.ai"`, `authType: "cookie"`,
  hint "Paste your `ecto_1_sess=` cookie value from meta.ai", `aliases: ["muse"]`, `uiAlias: "muse"`.
  Added `9d1e32426` (2026-07-15), i.e. two months before the issue.
- If the request actually means the *Muse Spark model* via OpenCode (see #121: "free Muse Spark 1.3
  contributor model"), that path is gated externally — live probe below returns
  `403 FreeTierError: OpenCode's free tier can only be used from within OpenCode`.

Action: ask which service is meant (muse.ai the app vs Muse Spark the model). No code change is defensible
until that is answered.

## #123 — Cline non-streaming envelope never unwrapped — **B (fixed in v0.91.22)**

Fixed by `6c433d9e5` (2026-09-15 06:57 +0200, "fix(cline): unwrap non-stream response envelopes"),
contained in tag `v0.91.22` (`git tag --contains 6c433d9e5` → `v0.91.22`; `git describe --tags` on HEAD → `v0.91.22`).

Current code, replacing the `provider !== "clinepass"` guard quoted in the issue:

- `open-sse/utils/clinepassEnvelope.js:7` — `if (!PROVIDERS[provider]?.quirks?.clineEnvelope) return { body, error: null };`
- `open-sse/providers/registry/cline.js:23` — `quirks: { clineEnvelope: true }`
- `open-sse/providers/registry/clinepass.js:24` — same flag
- Call sites on the Cline request path: `src/app/api/models/test/ping.js:160` (Test button),
  `open-sse/utils/error.js:86`, `open-sse/handlers/chatCore/nonStreamingHandler.js:254`
- Regression test added in the same commit: `tests/unit/clinepass-provider.test.js`

Reporter's own re-test on `0.91.22` (issue comment, 2026-09-15) confirms: Test button OK on 5 `cl/` models,
`choices` at top level, real token accounting, `{success:false}` now surfaces as an HTTP error.

Residual, unrelated to the bug: the upstream *live catalog* work from `122f23eebc` (2026-09-10) is **not**
adopted here — `open-sse/shared/clineEnvelope.js` is MISSING locally while upstream has it
(`git cat-file -e upstream/master:open-sse/shared/clineEnvelope.js` → exists), and upstream's
`open-sse/services/clinepassModels.js:25 fetchClineRawModels()` has no local counterpart.
That is what removes the stale-`customModels` drift the reporter noted (retired `cline-free/longcat-2.0`,
unlisted `cline-free/deepseek-v4.1-flash`).

Action: close as fixed. Optional follow-up: adopt `122f23eebc`'s live catalog (verdict **C** for that part only).

## #121 — OpenCode Zen missing / Zen keys and OpenCode Go — **A (seed stale) + C (free-tier 403 fix upstream)**

- There is no Zen API-key provider in either repo. `grep -rln "zen/v1" open-sse/providers/registry/` → only
  `opencode.js`; upstream matches (`git grep -ln "zen/v1" upstream/master -- open-sse/providers/registry` → `opencode.js`).
  The registry has exactly two OpenCode entries: `opencode` (`category: "free"`, `noAuth: true`) and
  `opencode-go` (`category: "apikey"`, `baseUrl: https://opencode.ai/zen/go/v1/chat/completions`).
  So "OpenCode Zen" as a separate API-key entry is still missing — **no upstream fix to adopt**.
- Our **seed list is stale**: `open-sse/providers/registry/opencode.js:25` lists only
  `muse-spark-1.2-contributor-free`, while upstream added the 1.3 entry in `acb5c34cd`
  (2026-09-03, "fix(opencode): route Muse Spark models to Responses API and declare vision") and now reads:
  `{ id: "muse-spark-1.3-contributor-free", ... targetFormat: "openai-responses" }`.
  Because our provider sets `passthroughModels: true`, the model id still resolves today — but it never
  appears in `/v1/models`, which is exactly the "not available" symptom. → **C** (upstream registration
  `acb5c34cd`, file `open-sse/providers/registry/opencode.js`).
- Live probes, 2026-09-22 (unauthenticated, no credentials):
  - `GET https://opencode.ai/zen/v1/models` → **200**, catalogue contains `muse-spark-1.3`,
    `muse-spark-1.2`, `muse-spark-1.3-contributor-free`, `muse-spark-1.2-contributor-free`.
  - `POST https://opencode.ai/zen/v1/responses` (model `muse-spark-1.3-contributor-free`,
    `x-opencode-client: desktop`) → **403** `{"type":"error","error":{"type":"FreeTierError","message":"Error from provider (Console): OpenCode's free tier can only be used from within OpenCode"}}`.
    Per the reporter's angle, this is why the free Muse Spark target "isn't available" — and upstream
    **has since fixed exactly this**: commit `6091ff597` ("fix(opencode): resolve 403 FreeTierError with
    canonical session format and valid User-Agent", 2026-09-17 → `open-sse/executors/opencode.js`,
    +134 lines, plus `tests/unit/opencode-session.test.js`), followed by `93837af09`
    ("fix(opencode): fix free tier 403 error and improve China region handling") and `0c6ab4f99`
    (stable upstream session reuse), `058ceace4` (`forceStream` on transport for free-tier SSE),
    `aa14ef72e`/`eafac37dc` (Muse Spark Responses fixes). → **C**.
    Our side is far behind on that file: `open-sse/executors/opencode.js` is 471 insertions / 47 deletions
    behind upstream (`git diff --stat main upstream/master -- open-sse/executors/opencode.js`); our copy
    still builds a random per-request session (`open-sse/executors/opencode.js:104`:
    `x-opencode-session: … || \`ses_${crypto.randomUUID()…}\``) instead of the canonical one the fix requires.
- UNVERIFIABLE: whether a purchased *Zen* API key authenticates against the `/zen/go/*` endpoints
  (`opencode-go` uses `auth: { combined: true, header: "Authorization", scheme: "bearer" }`).
  No Zen key exists in this environment. To prove it: one `POST /zen/go/v1/chat/completions` with
  `Authorization: Bearer <zen-key>` and a 200 response.

Action: **DONE in working tree (minimal port of `6091ff597`)** — `open-sse/executors/opencode.js`:
`OPENCODE_UA = "opencode/1.18.31"` with a `>= 1.17.0` version gate on client UAs, and canonical
`ses_<12hex><14base62>` / `msg_<12hex><14base62>` ids via `timeHex()`/`randomPart()` replacing the old
`randomUUID()` forms. Seed entry `muse-spark-1.3-contributor-free` added to
`open-sse/providers/registry/opencode.js:26` (upstream `acb5c34cd`) and to the executor's `RESPONSES_MODELS`.
Proof: `pnpm test tests/unit/opencode-session.test.js tests/unit/opencode-muse-spark-thinking.test.js` → 9 passed;
`pnpm test tests/unit/opencode-go-models.test.js tests/unit/executor-const-guard.test.js tests/translator/golden-url-header.test.js`
→ 217 passed; `node scripts/lint-undef.cjs` clean. Deliberately skipped (ponytail): upstream's
`translateSessionId`, per-request credential isolation and China-region handling (~471 lines) — add them when
a 429/session-drift report exists. Still UNVERIFIABLE live: end-to-end free-tier call (needs a running instance
from inside OpenCode's allowed client, or an OpenCode install).

## #118 — SQLite corruption silently destroys all connections — **B (fail-closed; manual restore; not all four asks met)**

Fixed by `d3b631a1b` (2026-09-15 20:08 +0700, "fix(release): fast multi-arch docker build and sqlite
corruption recovery"), shipped in `v0.91.22` (`git describe --contains d3b631a1b` → `v0.91.22~5`).

The issue's asks, mapped to code (not all four are met; the outcome is fail-closed with manual restore):

1. Startup integrity detection + refusal/auto-swap — `src/lib/db/driver.js:12-15` (`verifyDatabaseIntegrity`,
   `PRAGMA quick_check`, bun/better-sqlite3/node:sqlite fallbacks), `:66-84` quarantine of `data.sqlite`
   plus `-wal`/`-shm` to `.corrupt-<timestamp>`, `:86-118` scan `BACKUPS_DIR` newest-first and restore the
   first healthy copy, `:123` FATAL "Refusing to initialize a fresh empty database to prevent silent data
   loss" when no backup is healthy, `:179` invoked during adapter init. The current outcome is fail-closed with
   manual restore: PR #130 removed automatic restore from `db/backups/`; the cited auto-swap path describes the
   earlier v0.91.22 behavior.
2. Graceful-shutdown checkpoint — `PRAGMA wal_checkpoint(TRUNCATE)` wired to `SIGINT`/`SIGTERM` in
   `src/lib/db/adapters/betterSqliteAdapter.js:25,38-56` and `:37-86` of `nodeSqliteAdapter.js`
   (also `bunSqliteAdapter.js:24-56`).
3. Optional `synchronous=FULL` — `src/lib/db/schema.js:10`:
   `PRAGMA synchronous = ${process.env.SQLITE_SYNCHRONOUS || "NORMAL"};` (env-overridable).
4. Rolling backups — **not implemented**: no `VACUUM INTO` / rolling-backup code anywhere under `src/lib/db`
   (grep → 0 hits). Pre-upgrade backups still exist, so recovery has a source, but there is no daily rolling copy.

Proof of fix, executed 2026-09-22:

```
$ pnpm test tests/unit/db-corruption-recovery.test.js
 ✓ tests/unit/db-corruption-recovery.test.js (2 tests) 264ms
 Test Files  1 passed (1)   Tests  2 passed (2)
```

Note: the same test **fails** under a bare `npx vitest run` because the `@/` alias is unresolved; the
project's own script is `npx vitest run -c tests/vitest.config.js` (`package.json:15`). This matches the
"pre-existing failures that reference paths absent from the repo" the reporter saw in #123.

Action: ask the reporter to re-verify on `v0.91.22` and close. Optional follow-up: rolling `VACUUM INTO`
backups (ask 4), which is a genuine gap but not the corruption bug.

**PR #130 — MERGED as `7f42ef426`** (`fix(db): keep healthy database files when the SQLite driver fails
to load`, `its-benjamin`, 4 files): it replaces the driver-load-as-corruption assumption — previously a
`better-sqlite3` load failure made a *healthy* DB look corrupt and got it renamed and overwritten from
backup. Verified before merge by applying the PR's 4 files to this tree and running its tests:
`tests/unit/db-corruption-recovery.test.js` 9 passed + `tests/unit/db-webpack-runtime.test.js` 1 passed.
Behavior now in `origin/main`: fail-closed stays, but **auto-restore from `db/backups/` is gone**
(`BACKUPS_DIR` references: 7 → 0); a corrupt DB is left in place and restore is a manual action.

## #107 — tokenrouter `/gpt-5.6-luna` HTTP 405 — **A + C (upstream host is correct)**

Root cause proven by probe, 2026-09-22:

```
POST https://www.tokenrouter.com/v1/chat/completions  -> 405      <- what this repo calls
POST https://api.tokenrouter.com/v1/chat/completions  -> 401      <- correct API host (unauthenticated)
GET  https://www.tokenrouter.com/v1/models            -> 200      <- validation passes, masking the bug
GET  https://api.tokenrouter.com/v1/models            -> 401
```

- Ours: `open-sse/providers/registry/tokenrouter.js:18` — `baseUrl: "https://www.tokenrouter.com/v1/chat/completions"`
  (same wrong host for embeddings at `:23` and images at `:28`; `validateUrl` at `:19` also points at `www`, which
  returns 200 and therefore passes the dashboard's key/connection test).
- Upstream (`upstream/master:open-sse/providers/registry/tokenrouter.js`): `baseUrl: "https://api.tokenrouter.com/v1/chat/completions"`,
  `validateUrl: "https://api.tokenrouter.com/v1/models"`, plus a `thinkingConfig` block and namespaced model ids
  (`openai/gpt-5.6-sol`, `anthropic/claude-*`, `z-ai/glm-*`, …) — 40 insertions / 34 deletions vs ours.
- The 405 is host-level, not model-specific: the probe body contained no model at all. So the model named in
  the issue (`gpt-5.6-luna`) is a red herring — **every** tokenrouter chat request from this build hits a
  front-end host that does not accept POST. Neither ours nor upstream lists `gpt-5.6-luna` for tokenrouter
  (both list `gpt-5.6-sol`/`-terra`); with `passthroughModels: true` an unlisted id is forwarded rather than blocked.
- Fix to adopt: upstream's transport block (host change) — **C**.

Action: **DONE in working tree** — 5 URLs switched to `api.tokenrouter.com` (`open-sse/providers/registry/tokenrouter.js:18,19,23,28,56`;
`website`/`apiKeyUrl` left on `www` as upstream does). Same 5 URLs as upstream (`upstream/master:…/tokenrouter.js:23,24,55,60,62`).
Proof: probes 2026-09-22 — `POST www/…chat` 405, `POST api/…chat` 401; `POST www/…embeddings` 405,
`POST api/…embeddings` 401; `POST www/…images` 405, `POST api/…images` 401; `GET www/v1/models` 200 (masks the
bug), `GET api/v1/models` 401. `pnpm test tests/translator/golden-url-header.test.js` → 180 passed (snapshot updated).
Residual, still unproven: whether `gpt-5.6-luna` exists in TokenRouter's catalogue at all — neither repo lists it;
needs a real key to confirm. Optional: port upstream's namespaced model ids + `thinkingConfig`.

## Caveats and environment

Full regression after all three fixes, 2026-09-22:
`pnpm test tests/unit/` → **258 files passed / 5 skipped, 2701 tests passed / 47 skipped, 0 failed** (107s);
`node scripts/lint-undef.cjs` → clean. Per-issue checks:
`tests/unit/db-corruption-recovery.test.js` 2 passed (#118), `tests/unit/clinepass-provider.test.js` 9 passed (#123),
`tests/unit/request-body-limits.test.js` + `rtk.test.js` 39 passed (#132), `opencode-session` + `opencode-muse-spark-thinking`
9 passed and `opencode-go-models` + `executor-const-guard` + `golden-url-header` 217 passed (#121).

Cross-check against `upstream/master` (a8c9d3802), 2026-09-22 — parity after the fixes:
- **#107**: the 5 API URLs now match upstream exactly. Divergence that remains (ours ≠ upstream, not a bug but
  a parity gap): our seed uses bare model ids (`gpt-5.5`, `claude-opus-4.6`) while upstream uses namespaced ids
  (`openai/gpt-5.5`, `anthropic/claude-*`), and upstream carries `thinkingConfig` +
  `transport.thinkingFormat: "tokenrouter"` which we lack. Unverifiable without a TokenRouter key
  (`GET /v1/models` → 401 on both hosts): whether bare ids are accepted.
- **#121**: adopted `transport.forceStream: true` in `open-sse/providers/registry/opencode.js:21` (upstream
  `058ceace4`, free tier always answers SSE) and a canonical-format guard that drops non-canonical client
  `x-opencode-session` values instead of forwarding them (upstream does a deterministic hash translation +
  per-request credential isolation; that part is still not ported).
- **#132**: upstream has no body-size guard at all, so this is fork-only. Coverage limit: only the chat path is
  guarded; 8 other handlers still parse unbounded bodies (`src/app/api/v1/responses/route.js:33`,
  `.../responses/compact/route.js:29`, `.../messages/count_tokens/route.js:78`, `src/sse/handlers/{tts,fetch,imageGeneration,search,embeddings}.js`).
  `handleChat` is reached from 6 routes (`/v1/chat/completions`, `/v1/messages`, `/v1/responses`, `/v1/responses/compact`,
  `/v1/api/chat`, `/v1beta/models/...`), all of which inherit the guard because it sits inside the handler itself.
- **#118 / #123**: both fixes are in this fork's own history (`d3b631a1b`, `6c433d9e5`); upstream's equivalents are
  `122f23eebc` (cline envelope + live catalog) — upstream has no DB corruption recovery.

- Unit suite: run it as `pnpm test …` (`npx vitest run -c tests/vitest.config.js`). Bare `npx vitest run`
  cannot resolve `@/…` aliases and produces counts unrelated to code health.
- Network probes (#107, #121) are single unauthenticated requests; no credentials, keys, or account data
  were transmitted.
- Upstream refs were refreshed with `git fetch upstream` (fetch only, no merge/checkout) on 2026-09-22:
  tip is `a8c9d3802` (v0.5.81, 2026-09-18), 31 commits past `17c4cc768`. Every verdict below was re-checked
  against that tip; the only verdict that changed was #121 (new upstream free-tier fix, now **C**).
- The two "fixed" verdicts rest on three independent legs each: the commit/tag, the current code path, and
  an executable check (regression test for #118; the reporter's re-test plus code path for #123).
- Not verified live (no credentials in this environment): #131 (Cursor account), #121 second half
  (OpenCode Zen key), #132 (700KB agent session against a running instance).
