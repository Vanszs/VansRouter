# Upstream commit inventory — `73cb89143..upstream/master` (2026-09-22)

Read-only commit-by-commit audit for VansRouter. No source file changed. This report complements (does not replace):

- `.docs/audit/upstream-83af3f18-triage-2026-09-22.md` — 49 rows, classified by *changelog bullet*
- `.docs/audit/upstream-v0.5.81-triage-2026-09-22.md` — 15 rows
- `.docs/audit/upstream-sync-status-2026-09-22.md` — consolidated status, 50 unique changes

The point of this pass: the earlier reports classified **changes**; this one inventories **commits**, so anything that
never made it into a changelog bullet shows up.

---

## 1. Range and method

```bash
git rev-list --count 73cb89143c29575e098e460b514b44c234c67739..upstream/master
# 69   (NOT 70)

git rev-list --no-merges --count 73cb89143c29575e098e460b514b44c234c67739..upstream/master   # 69
git rev-list --merges    --count 73cb89143c29575e098e460b514b44c234c67739..upstream/master   # 0
git rev-list --first-parent --count 73cb89143c29575e098e460b514b44c234c67739..upstream/master # 69
git merge-base --is-ancestor 73cb89143c29575e098e460b514b44c234c67739 upstream/master && echo YES  # YES

git log --reverse --format='%H|%h|%ci|%s' 73cb89143c29575e098e460b514b44c234c67739..upstream/master
git log --reverse --format='@@@%h' --name-only 73cb89143c29575e098e460b514b44c234c67739..upstream/master
git log --reverse --format='%h %d %s' 73cb89143c29575e098e460b514b44c234c67739..upstream/master | grep '(tag:'
```

| Field | Value |
|---|---|
| Start (exclusive) | `73cb89143c29575e098e460b514b44c234c67739` — `feat(xiaomi-mimo): merge MiMo Desktop support into xiaomi-mimo as dual auth`, 2026-09-10 23:42:41 +0700 |
| End (inclusive) | `21583c03e5c5d5276924efad82328ebe6e215854` — `# v0.5.85 (2026-09-22)`, 2026-09-22 15:43:30 +0700 = `upstream/master` = `upstream/HEAD` |
| **Total commits** | **69** (linear, zero merges, so linear == first-parent == no-merges) |
| Commits changed | 205 unique files |
| Tags inside range | `v0.5.79` = `8e15f0bdd` · `v0.5.81` = `a8c9d3802` · `v0.5.85` = `21583c03e` |
| Tag just below range | `v0.5.75` = `83af3f185` |
| `git describe upstream/master` | `v0.5.85` |

### Why 69 and not 70 (off-by-one at the lower bound)

`83af3f185` ("# v0.5.75 (2026-09-10)") is the **direct parent** of `73cb89143`:

```bash
git log --format='%h %s' -1 73cb89143~1        # 83af3f185 # v0.5.75 (2026-09-10)
git rev-list --count 73cb89143..83af3f185      # 0
git rev-list --count 83af3f185..73cb89143      # 1
git rev-list --count 83af3f185..upstream/master # 70   ← the earlier triage's range
```

So the earlier audit's **70** counted `73cb89143` (the Xiaomi MiMo commit, its row `S1`); the requested range here
starts *after* it, hence **69**. `73cb89143` is therefore **out of scope** for this report — it is the exclusive
lower bound, not a member.

### Local SHAs used for `DONE` verdicts (all verified)

```bash
git log --oneline -1 <sha>              # 10/10 resolved
git merge-base --is-ancestor <sha> main # 10/10 -> IN-main
```

| Local SHA | Subject |
|---|---|
| `757438f15` | fix(codex): route bare codex-auto-review to the Codex provider |
| `947ad5e59` | fix(rtk): compress Cursor tool results before translation |
| `5d05992e4` | fix(kiro): preserve tool-name underscores and forward tool-result images |
| `c7bdf5b78` | fix(stream): report aborts in-band after a 200 response |
| `5a267e7d0` | fix(translator): map Claude refusal stop reason to content_filter |
| `bbe6a622a` | fix(translator): drop replayed reasoning fields for groq, mistral and cerebras |
| `50239fb90` | feat(models): add deepseek-v4.1-flash with effort levels and vision |
| `b9e95f575` | perf(usage): bound the lastUsed scan and add the max thinking level |
| `dde5da4c8` | fix(responses): report usage on response.completed |
| `3b0a6f515` | feat(usage): show deepseek credit balance as currency |

### Method for the "menyentuh jalur custom?" column

Checked with `git log --oneline <range> -- <path>` over the eight custom-logic groups. Result — **only 3 files**
from that list are touched anywhere in the range:

```
src/app/api/v1/models/route.js   402745dc1, 5c217d34f
src/sse/services/auth.js         93837af09
```

Zero hits in the range for: `src/sse/handlers/chat.js`, `src/sse/services/allowedModels.js`,
`open-sse/providers/registry/zcode.js`, `open-sse/executors/zcode.js`, `src/app/layout.js`, `src/dashboardGuard.js`,
`open-sse/config/runtimeConfig.js` (searxng), `docker-compose.yml`, `src/app/api/providers/route.js`, `src/mitm/**`.
A `-S "searxng"` pass over the range also returned nothing. ACL-criticality of the two `models/route.js` commits is
proven by the local guard: `src/app/api/v1/models/route.js:1` imports `isKindAllowed` and line 76 calls it.

A stricter, wider signal is recorded in the *catatan* column where it matters — files the fork has **also** diverged
on (`git diff --quiet 73cb89143 main -- <file>`) are the real merge-conflict surface. That set is large (≈130 of the
205 changed files) and includes `open-sse/executors/{cursor,opencode,opencode-go,qoder,antigravity,zed,commandcode}.js`,
`open-sse/handlers/chatCore.js`, `open-sse/translator/**`, `src/shared/components/Sidebar.js`,
`src/shared/constants/providers.js`, `Dockerfile`, `README.md`.

---

## 2. Full inventory — 69 commits, no omissions

Columns: `SHA | tanggal | subjek | file utama (maks 3, +N sisa) | jalur custom? | verdikt | catatan`.
Verdicts restricted to `DONE <sha>` · `ALREADY-PRESENT` · `PENDING` · `SKIP` · `UNVERIFIED`.
`A#n` = row of the 49-row report; `UNTRIAGED` = no row matches this commit (see §3).

| # | SHA | Tanggal | Subjek | File utama | Custom? | Verdikt | Catatan |
|---|---|---|---|---|---|---|---|
| 1 | `17c4cc768` | 2026-09-11 | feat(claude-code): drive auto-compact window, add a 1M-context toggle | `.../cli-tools/components/ClaudeToolCard.js`, `src/app/api/cli-tools/claude-settings/route.js` | tidak | PENDING (A#25) | HYBRID; 2 file, halaman CLI-tools fork-custom |
| 2 | `5c399b640` | 2026-09-11 | feat(codebuddy-intl,ollama): add DeepSeek-V4.1-Flash | `open-sse/providers/capabilities.js`, `.../registry/codebuddy-intl.js`, `.../registry/ollama.js` +1 | tidak | DONE `50239fb90` | juga A#7. **PARSIAL** — override caps `codebuddy-intl` + pola `codebuddy-intl` di `thinkingLevels.js` belum ada (lihat §3b) |
| 3 | `930012136` | 2026-09-16 | fix(stream): report aborts after HTTP 200 in-band instead of closing silently | `.../chatCore/streamingHandler.js`, `.../utils/streamHandler.js`, `.../utils/streamHelpers.js` +1 | tidak | DONE `c7bdf5b78` | A#22; early-EOF lokal dipertahankan |
| 4 | `13b468b88` | 2026-09-16 | fix(commandcode): preserve images and reasoning_effort on /alpha/generate | `.../capabilities.js`, `.../registry/commandcode.js`, `.../services/usage/commandcode.js` +13 | tidak | UNVERIFIED (A#27) | alasan UNVERIFIED ("provider belum dipastikan") **terbantah**: `git ls-tree main open-sse/providers/registry/` → `commandcode.js` ADA. Naikkan ke PENDING (§3c) |
| 5 | `912ed295d` | 2026-09-17 | fix(deepseek,model-catalog): vision for V4.1-Flash ids, scope synced catalog to gateways | `.../capabilities.js`, `.../catalogOverride.js`, `src/lib/modelCatalog/sync.js` +2 | tidak | PENDING (A#24) | scoping menyentuh logika katalog bersama |
| 6 | `702b57c30` | 2026-09-17 | fix(opencode-go): route every responses-only model (incl. thinking variants) to /responses | `.../config/providerModels.js`, `.../executors/opencode-go.js` +2 | tidak | PENDING (A#20) | HYBRID; `opencode-go.js` fork-diverged |
| 7 | `2b65c49ff` | 2026-09-17 | fix(opencode): route Union Alpha through Messages API | `.../executors/opencode.js`, `.../capabilities.js`, `.../registry/opencode.js` +1 | tidak | PENDING (A#20) | `opencode.js` fork-diverged |
| 8 | `6091ff597` | 2026-09-17 | fix(opencode): resolve 403 FreeTierError with canonical session format and valid User-Agent | `.../executors/opencode.js`, `tests/unit/opencode-session.test.js` | tidak | ALREADY-PRESENT (A#18) | bukti: `executors/opencode.js:32 canonicalId()`, `:38 CANONICAL_SESSION`, `:162-180` header `x-opencode-session/request/client` |
| 9 | `0c6ab4f99` | 2026-09-17 | fix(opencode): reuse one stable upstream session per identity to stop 429s | `.../executors/opencode.js`, `tests/unit/opencode-session.test.js` | tidak | ALREADY-PRESENT (A#18) | bukti sama seperti #8 (`translateSessionId`, `storedSession` fallback) |
| 10 | `f4f06f290` | 2026-09-17 | fix(translator): keep tool-result images, restore Kiro tool names, preserve thinking display | `.../translator/formats/claude.js`, `.../request/claude-to-kiro.js`, `.../response/kiro-to-openai.js` +9 | tidak | DONE `5d05992e4` | A#21. **PARSIAL** — `hoistToolResultImages()` dan preservasi `thinking.display` (suplai `body` ke `buildHeaders`/`selectAnthropicBeta`) belum ada (§3b) |
| 11 | `82b1bca42` | 2026-09-17 | fix(kiro): use neutral placeholder for tool-result-only user turns | `.../concerns/kiroConversation.js`, `.../request/claude-to-kiro.js`, `.../request/openai-to-kiro.js` +2 | tidak | **PENDING** | **koreksi A#21** — `git grep "Tool results provided\|KIRO_TOOL_RESULTS_PLACEHOLDER\|kiroEmptyUserContent" main` → **0 hit**; lokal masih `\|\| "continue"` di `kiroConversation.js:181`, `claude-to-kiro.js:112`, `openai-to-kiro.js:131` |
| 12 | `c49efdf52` | 2026-09-17 | fix(kiro): preserve underscores in tool names and restore sanitized names in responses | `.../concerns/kiroConversation.js`, `.../response/kiro-to-claude.js`, 2 test | tidak | DONE `5d05992e4` | cocok 1:1 dengan diff lokal (`replace(/_+/g,"_")` dihapus, `_toolNameMap` ditambah) |
| 13 | `eafac37dc` | 2026-09-17 | fix(opencode): strip prior reasoning items on Muse Spark Responses models | `.../executors/opencode-go.js`, `.../executors/opencode.js` +2 | tidak | PENDING (A#19) | butuh laporan model spesifik |
| 14 | `aa14ef72e` | 2026-09-17 | fix(opencode): normalize Muse Free tool choice | `.../executors/opencode.js`, `.../registry/opencode.js`, `tests/unit/opencode-free-tool-choice.test.js` | tidak | PENDING (A#19) | idem |
| 15 | `20a43f5a2` | 2026-09-17 | fix(auth): don't cool down an account for a request-scoped 4xx | `.../services/accountFallback.js`, `tests/unit/account-fallback-4xx.test.js` | tidak | PENDING (A#31) | **risiko tinggi**: `accountFallback.js` fork-diverged |
| 16 | `367fc546d` | 2026-09-17 | feat(models): deepseek-v4.* accepts low..max effort; flag thinkingEffortSupported and vision | `.../capabilities.js`, `.../thinkingLevels.js` | tidak | DONE `50239fb90` | A#23; hanya 2 file, data |
| 17 | `725e2c118` | 2026-09-17 | feat(i18n): integrate Persian (fa) translation | `public/i18n/literals/fa.json` | tidak | PENDING (A#26) | `fa.json` ada di fork tapi **diverged** → gabung key, jangan timpa; branding VansAI |
| 18 | `ef1817522` | 2026-09-17 | fix(zed): harden OAuth lifecycle and live model support | `.../executors/zed.js`, `.../shared/zedAuth.js`, `src/shared/components/OAuthModal.js` +10 | tidak | PENDING (A#28) | 13 file; `OAuthModal.js` + `oauth/providers/zed.js` fork-diverged |
| 19 | `3ac100d52` | 2026-09-17 | fix(usage): improve DeepSeek credit balance display | `.../registry/opencode-go.js`, `.../services/usage/deepseek.js`, `.../ProviderLimits/QuotaTable.js` +2 | tidak | DONE `3b0a6f515` | A#32; `QuotaTable.js` lokal = implementasi lebih besar (normalisasi) |
| 20 | `f64229530` | 2026-09-17 | fix(antigravity): sanitize Hermes system identity | `open-sse/config/appConstants.js` | tidak | SKIP (A#29) | `appConstants.js` fork-diverged (punya `claudeCloaking`) |
| 21 | `52917a6d4` | 2026-09-17 | Add NEW badge to 9Remote menu | `src/shared/components/Sidebar.js` | tidak | UNTRIAGED → saran **SKIP** | §3a; churn badge, dibatalkan #28 lalu dipulihkan #37 |
| 22 | `93837af09` | 2026-09-18 | fix(opencode): fix free tier 403 error and improve China region handling | `.../executors/opencode.js`, `.../providers/[id]/page.js`, **`src/sse/services/auth.js`** +3 | **ya — `src/sse/services/auth.js`** (jalur ACL) | ALREADY-PRESENT (A#18) | inti ada (`canonicalId`, `forceStream`). **PARSIAL**: hunk `auth.js` `slice(0,100)`→`200` TIDAK diterapkan (`auth.js:323` masih 100); pesan `ping.js` juga belum |
| 23 | `4641c2b76` | 2026-09-18 | fix(zed): lower display priority in oauth list | `.../registry/zed.js` | tidak | PENDING (A#28) | 1 baris; YAGNI kecuali ada user Zed |
| 24 | `efc80ba2e` | 2026-09-18 | fix(codex): route bare codex-auto-review to the Codex provider (#4135) | `.../registry/codex.js`, `.../services/model.js`, `tests/unit/codex-auto-review-routing.test.js` | tidak | DONE `757438f15` | A#30; 2 hunk, load-bearing, ada test |
| 25 | `b3d6e089c` | 2026-09-18 | fix(antigravity): strip Claude Code billing header from system prompts | `open-sse/config/appConstants.js`, `tests/unit/antigravity-billing-header-rewrite.test.js` | tidak | SKIP (A#29) | integrasi Antigravity fork-modified |
| 26 | `092c84eac` | 2026-09-18 | fix(commandcode): retry on transient stream error and avoid fake stop chunks | `.../executors/commandcode.js`, `.../request/openai-to-commandcode.js`, `.../response/commandcode-to-openai.js` +1 | tidak | UNVERIFIED (A#27) | provider ADA (§3c) → layak naik ke PENDING |
| 27 | `bc3be0cb2` | 2026-09-18 | fix(antigravity): scope cached thought signatures to the model family | `.../executors/antigravity.js`, `.../services/thoughtSignatureStore.js`, 2 translator +1 | tidak | SKIP (A#29) | `antigravity.js` + `thoughtSignatureStore.js` fork-diverged |
| 28 | `d99bc8201` | 2026-09-18 | fix(sidebar): temporarily hide NEW badge from 9Remote menu | `src/shared/components/Sidebar.js` | tidak | UNTRIAGED → saran **SKIP** | §3a; membatalkan #21 |
| 29 | `058ceace4` | 2026-09-18 | fix(opencode): declare forceStream on transport for free-tier SSE aggregation | `.../registry/opencode.js`, `tests/unit/opencode-session.test.js` | tidak | ALREADY-PRESENT (A#18) | bukti: `registry/opencode.js:22 forceStream: true` |
| 30 | `8e15f0bdd` | 2026-09-18 | # v0.5.79 (2026-09-18) | `CHANGELOG.md`, `cli/package.json`, `.../providers/pricing.js` +3 | tidak | DONE `50239fb90` | bagian kode = `registry/deepseek.js +1` (ada lokal, `deepseek.js:51`). **PARSIAL**: entri `pricing.js` untuk `deepseek-v4.1-flash` belum ada; sisanya housekeeping rilis = SKIP |
| 31 | `23ae82d8e` | 2026-09-18 | # v0.5.81 (2026-09-18) | `cli/package.json`, `package.json` | tidak | UNTRIAGED → saran **SKIP** | bump versi saja; fork pakai versi sendiri (v0.91.22) |
| 32 | `a8c9d3802` | 2026-09-18 | docs: update changelog header to v0.5.81 | `CHANGELOG.md` | tidak | UNTRIAGED → saran **SKIP** | changelog upstream; tag `v0.5.81` menunjuk ke commit ini |
| 33 | `73e021b8a` | 2026-09-19 | fix(ollama): map free-plan monthly window and derive reset from signup date | `.../services/usage/misc.js`, `.../ProviderLimits/utils.js`, `tests/unit/ollama-usage.test.js` | tidak | UNTRIAGED → saran **PENDING** | §3a; lokal `getOllamaUsage` masih **stub pesan** (`misc.js:58`), upstream menambah baris kuota session/weekly/monthly nyata |
| 34 | `49185137b` | 2026-09-19 | feat(opencode-zen): add OpenCode Zen (PAYG) provider with free-tier fingerprint, alias ocz | `.../executors/opencode-zen.js`, `.../registry/opencode-zen.js`, `.../services/usage/opencode-zen.js` +7 | tidak | PENDING (A#35) | menutup separuh isu #121; bukti absen: `git ls-tree main open-sse/providers/registry/` → tidak ada `opencode-zen.js` |
| 35 | `822aa958d` | 2026-09-19 | fix(opencode): cloak Responses requests that already have tools | `.../utils/opencodeFingerprint.js`, `.../executors/opencode.js`, `.../handlers/chatCore.js` +5 | tidak | PENDING (A#19/#20) | bukti absen: `git grep -ln opencodeFingerprint main -- open-sse` → 0 (yang ada `claudeCloaking.js`, jalur berbeda) |
| 36 | `cf663f530` | 2026-09-19 | fix(huggingface): complete the Inference Providers router migration | `.../registry/huggingface.js`, `.../handlers/imageProviders/huggingface.js`, `tests/unit/huggingface-router-migration.test.js` +3 | tidak | PENDING (A#41) | bukti: lokal masih `api-inference.huggingface.co` (`registry/huggingface.js:33`) |
| 37 | `9f42e7ac1` | 2026-09-21 | fix(sidebar): restore NEW badge for 9Remote menu | `src/shared/components/Sidebar.js` | tidak | UNTRIAGED → saran **SKIP** | §3a; membatalkan #28 |
| 38 | `477b2aed0` | 2026-09-21 | fix(opencode-go): send reasoning_effort for glm-5.3-flash | `.../providers/capabilities.js` | tidak | UNTRIAGED → saran **PENDING** | §3a; lokal hanya punya entri global `capabilities.js:246` (`thinkingFormat:"zai"`), **tanpa** override provider `opencode-go` (`git grep '"opencode-go"' capabilities.js` → 0) |
| 39 | `5c217d34f` | 2026-09-21 | feat(capabilities): model capability metadata on /v1/models, combo aggregation, pattern fixes | `.../providers/capabilities.js`, **`src/app/api/v1/models/route.js`**, `.../combos/page.js` +4 | **ya — `src/app/api/v1/models/route.js`** (jalur ACL) | PENDING (A#36) | perluas, jangan tulis ulang: `models/route.js:76` memanggil `isKindAllowed` |
| 40 | `c933eefc2` | 2026-09-21 | fix(cursor): stop AgentService empty turns and silent tool hangs | `.../executors/cursor.js`, `.../utils/cursorProtobuf.js`, `.../handlers/chatCore.js` +6 | tidak | DONE `947ad5e59` | A#34 (bagian RTK). **PARSIAL** — bagian Cursor (`cursor.js` 269 baris, `cursorProtobuf.js` 221 baris) tetap **PENDING (A#33)**, lead utama isu #131 |
| 41 | `253199f16` | 2026-09-21 | feat(combos): Cursor/Claude Default presets + bulk select/delete/strategy | `.../combos/page.js`, `src/app/api/combos/presets/route.js`, `src/lib/comboPresets.js` +4 | tidak | PENDING (A#37) | endpoint API baru + 2 PNG; UI-only |
| 42 | `7c2b1fe3e` | 2026-09-21 | fix(translator): drop replayed reasoning fields for Groq/Mistral/Cerebras (#4220) | `.../concerns/paramSupport.js`, `tests/unit/param-support.test.js` | tidak | DONE `bbe6a622a` | cocok 1:1 |
| 43 | `2daf25ffb` | 2026-09-21 | fix(qoder): handle code 110 billing blocks and preserve SSE error status | `.../executors/qoder.js`, `.../chatCore/sseToJsonHandler.js`, `tests/unit/qoder-billing.test.js` | tidak | UNVERIFIED (A#46) | `qoder.js` **ADA** lokal; yang belum ada hanya `qoder-cn.js`. Layak naik ke PENDING (§3c) |
| 44 | `be3bc764b` | 2026-09-21 | fix(antigravity): separate weekly and short-window quotas and clean up redundant rows | `.../services/usage/antigravity-weekly.js`, `.../services/usage/google.js`, `.../ProviderLimits/utils.js` +2 | tidak | SKIP (A#45) | 3 file usage fork-diverged |
| 45 | `c7df895bb` | 2026-09-21 | build(docker): apply the apk mirror swap to the runner stage | `Dockerfile` | tidak | SKIP (A#48) | `Dockerfile` fork-diverged (54/38 vs upstream); fork pakai `deploy-atomic.cjs` |
| 46 | `f67d5a0c9` | 2026-09-21 | fix(docker): publish verified multi-platform images | `.github/workflows/docker-publish.yml`, `DOCKER.md`, `Dockerfile` | tidak | SKIP (A#48) | alur image upstream ≠ alur deploy fork |
| 47 | `402745dc1` | 2026-09-21 | feat(providers): add qoder-cn support for Qoder CN (qoder.com.cn) | `.../registry/qoder-cn.js`, `.../executors/qoder.js`, **`src/app/api/v1/models/route.js`** +27 | **ya — `src/app/api/v1/models/route.js`** (jalur ACL) | UNVERIFIED (A#39) | 30 file — commit terbesar di rentang ini. `registry/qoder-cn.js` **tidak ada** lokal |
| 48 | `da0046550` | 2026-09-21 | fix(responses): report usage on response.completed so clients can auto-compact | `.../translator/response/openai-responses.js`, `.../utils/stream.js`, `tests/unit/openai-responses-usage-completed.test.js` | tidak | DONE `dde5da4c8` | cocok 1:1 |
| 49 | `6886915f6` | 2026-09-22 | feat(capacity-adapter): default vision fallback to mimo-v2.6-flash-free | `.../services/capacityAdapter.js`, `.../providers/capabilities.js`, `.../registry/opencode-zen.js` +2 | tidak | UNTRIAGED → saran **SKIP** | §3a; `open-sse/services/capacityAdapter.js` **tidak ada** di `main` dan `git grep -rn capacityAdapter main` → 0 hit |
| 50 | `b7446f8dd` | 2026-09-22 | feat(providers): add System One (Jev) decision endpoint | `.../handlers/systemoneCore.js`, `src/sse/handlers/systemone.js`, `src/app/api/v1/systemone/route.js` +5 | tidak | SKIP (A#38) | menambah `src/shared/constants/providers.js` (fork-diverged) + `registry/opencode.js` |
| 51 | `41a1b8003` | 2026-09-22 | feat(providers): add MiMo V2.6 Flash Free to OpenCode Zen free tier | `.../registry/opencode-zen.js` | tidak | PENDING (A#35) | bergantung #34 (file tujuan belum ada) |
| 52 | `6431e3530` | 2026-09-22 | feat(dashboard): add System One to sidebar and media provider detail page | `.../registry/opencode-zen.js`, `.../registry/opencode.js`, `src/shared/components/Sidebar.js` +3 | tidak | SKIP (A#38) | bagian Sidebar = `VISIBLE_MEDIA_KINDS += "systemone"` |
| 53 | `f28e918e2` | 2026-09-22 | feat(dashboard): add question input for System One and hide inline test | `.../GenericExampleCard.js`, `.../providers/components/ModelsCard.js` | tidak | SKIP (A#38) | UI System One |
| 54 | `20014b310` | 2026-09-22 | fix(dashboard): probe System One models through /v1/systemone | `.../providers/components/ModelsCard.js`, `src/app/api/models/test/ping.js` | tidak | SKIP (A#38) | `ping.js` juga identik dengan sisa #22 |
| 55 | `f84c667d4` | 2026-09-22 | feat(providers): add OpenRouter System One lane and New badge | `.../registry/openrouter.js`, `src/shared/components/Sidebar.js`, `src/shared/constants/providers.js` | tidak | SKIP (A#38) | menyentuh 2 file fork-diverged tapi untuk fitur SKIP |
| 56 | `44fd69d22` | 2026-09-22 | style(dashboard): match 9remote NEW badge style on System One tags | `src/shared/components/Sidebar.js` | tidak | SKIP (A#38) | kosmetik murni |
| 57 | `6c9fe6f78` | 2026-09-22 | feat(cli-tools): add dynamic configuration for Pi, OMP, Crush, ForgeCode, Smelt and CodeWhale | 6× `src/app/api/cli-tools/*-settings/route.js`, `.../GenericCliToolCard.js`, `src/shared/constants/cliTools.js` +14 | tidak | PENDING (A#49) | 17 file, ~1809 baris; halaman CLI-tools fork-custom |
| 58 | `c73bb2cd6` | 2026-09-22 | docs(readme): add Indonesian video guide by Neptiver | `README.md` | tidak | UNTRIAGED → saran **SKIP** | `README.md` fork-diverged (rebrand); konten marketing upstream |
| 59 | `aa2bc53f3` | 2026-09-22 | docs(readme): add temporary swap instructions for low-memory production builds | `README.md` | tidak | UNTRIAGED → saran **SKIP** | docs; relevan hanya kalau fork ikut alur build upstream |
| 60 | `3279d3102` | 2026-09-22 | docs(cli): fix source README link | `cli/README.md` | tidak | UNTRIAGED → saran **SKIP** | docs-only |
| 61 | `0d50fe361` | 2026-09-22 | feat(analytics): add Requests mode and provider/model breakdown charts | `.../usage/components/ProviderBarChart.js`, `.../TopModelsChart.js`, `.../UsageChart.js` +2 | tidak | PENDING (A#40) | menyentuh `src/lib/db/repos/usageRepo.js` (juga dipakai #65) |
| 62 | `782c137b1` | 2026-09-22 | fix(qoder): prevent signed request replay and surface upstream errors | `.../executors/qoder.js`, 3 test qoder, `CHANGELOG.md` +2 | tidak | UNVERIFIED (A#46) | bergantung #43; provider qoder ADA lokal |
| 63 | `5798b3084` | 2026-09-22 | fix(antigravity): drop requestType "agent" to avoid false 429 RESOURCE_EXHAUSTED | `.../executors/antigravity.js`, `.../translator/request/openai-to-gemini.js` | tidak | SKIP (A#45) | 2 file, keduanya fork-diverged |
| 64 | `ce9ac43da` | 2026-09-22 | style(sidebar): match NEW badge style across 9Remote, Media Providers, and System One | `src/shared/components/Sidebar.js` | tidak | UNTRIAGED → saran **SKIP** | §3a; menutup siklus churn badge |
| 65 | `d1de32458` | 2026-09-22 | perf(usage): bound lastUsed overlay scan to 2-day window; reach max thinking tier | `.../translator/concerns/thinking.js`, `src/lib/db/repos/usageRepo.js`, `tests/unit/thinking-budget-max-level.test.js` | tidak | DONE `b9e95f575` | cocok 1:1; klaim perf belum diukur ulang |
| 66 | `b53260ca5` | 2026-09-22 | feat(usage): add All Time period option and refine overview cards | `.../usage/components/OverviewCards.js`, `.../usage/page.js`, `src/app/api/usage/chart/route.js` +2 | tidak | PENDING (A#40) | A#40 menyebut "All Time filter" secara eksplisit |
| 67 | `1a0271315` | 2026-09-22 | feat(combos): hide preset buttons and migrate legacy mimo vision adapter | `.../services/capacityAdapter.js`, `.../combos/page.js`, `src/lib/db/repos/settingsRepo.js` | tidak | PENDING (A#37) | setengah: bagian `capacityAdapter` tidak punya padanan lokal → SKIP untuk bagian itu |
| 68 | `0f488c702` | 2026-09-22 | fix(translator): map Claude "refusal" stop_reason to content_filter and surface its explanation | `.../concerns/finishReason.js`, `.../response/claude-to-openai.js`, `.../schema/finishReasons.js` +2 | tidak | DONE `5a267e7d0` | cocok 1:1 |
| 69 | `21583c03e` | 2026-09-22 | # v0.5.85 (2026-09-22) | `CHANGELOG.md`, `cli/package.json`, `package.json` | tidak | UNTRIAGED → saran **SKIP** | tag + bump versi + changelog upstream saja |

---

## 3. Untriaged commits

Method: for each of the 69 commits I matched its SHA against every `Sumber (SHA)` / `Citation` cell in the three
existing reports (`upstream-83af3f18-triage`, `upstream-v0.5.81-triage`, `upstream-sync-status`), then verified the
match by subject and file set. Commits with a SHA citation matched directly (the earlier reports cite upstream SHAs in
18 cells); the rest were matched by subject + `--stat` overlap.

**Result: the untriaged list is NOT empty — 13 of 69 commits.** They fall into four groups.

### 3a. Real gaps (3 commits — these carry behaviour nobody reviewed)

| SHA | Subjek | Bukti tidak tertriase | Saran verdikt |
|---|---|---|---|
| `73e021b8a` | fix(ollama): map free-plan monthly window and derive reset from signup date | Tidak ada baris A#1–A#49 maupun S1 yang menyebut Ollama usage/window/reset. Bukti lokal: `open-sse/services/usage/misc.js:46-62` — `getOllamaUsage` hanya mengembalikan `quotas: []` + pesan "resets every 5h & 7d"; upstream menambah `OLLAMA_LIMIT_WINDOWS` (session/weekly/monthly) + `nextMonthlyResetFromSignup()` | **PENDING** — display-only, risiko rendah, menaikkan akurasi kuota Ollama |
| `477b2aed0` | fix(opencode-go): send reasoning_effort for glm-5.3-flash | Row A#5 menyebut "OpenCode Go: model baru (glm-5.3 …)" sebagai pendaftaran model, bukan override format thinking. Bukti lokal: `capabilities.js:246` hanya entri global `glm-5.3-flash` dengan `thinkingFormat:"zai"`; `git grep '"opencode-go"' open-sse/providers/capabilities.js` → 0 hit → override provider belum ada | **PENDING** — data 6 baris; upstream rationale: backend OpenCode Go menolak objek `thinking` z.ai dengan 400 |
| `6886915f6` | feat(capacity-adapter): default vision fallback to mimo-v2.6-flash-free | Tidak ada baris yang menyebut capacity adapter / vision fallback. Bukti lokal: `open-sse/services/capacityAdapter.js` **tidak ada** di `main`; `git grep -rn capacityAdapter main` → 0 hit | **SKIP** — fork tidak punya capacity adapter; adopsi berarti menambah subsistem baru (YAGNI) |

### 3b. Commit yang tertriase tapi **tercakup sebagian** (6 commit — sub-perubahan tanpa baris)

Ini jenis gap yang paling mudah lolos: commit-nya ada di baris triage dengan status `DONE`, tetapi sebagian isinya
tidak ikut ter-port.

| SHA | Verdikt komit | Sub-perubahan belum ada | Bukti |
|---|---|---|---|
| `82b1bca42` | triase A#21 mengklaim `DONE 5d05992e4` | placeholder netral `KIRO_TOOL_RESULTS_PLACEHOLDER = "Tool results provided."` + `kiroEmptyUserContent()` | `git grep -n "Tool results provided\|KIRO_TOOL_RESULTS_PLACEHOLDER\|kiroEmptyUserContent" main` → **0 hit**; masih `\|\| "continue"` di `kiroConversation.js:181`, `claude-to-kiro.js:112`, `openai-to-kiro.js:131`. → **PENDING** |
| `f4f06f290` | `DONE 5d05992e4` | (i) `hoistToolResultImages()` — pindahkan gambar dari `tool_result` ke pesan user berikutnya untuk endpoint Anthropic-compatible; (ii) preservasi `thinking.display` (`selectAnthropicBeta(model, body)` + `wantsThinkingSummaries()` filter `redact-thinking-2026-02-12`, dan `applyFormat(..., display)`) | `git grep -n hoistToolResultImages main` → 0 hit; `git grep -n wantsThinkingSummaries main` → 0 hit; `thinkingUnified.js` lokal tidak punya `display`. Lokal masih memasang `redact-thinking-2026-02-12` tanpa syarat (`providers/shared.js:36`, `registry/claude.js:26`) |
| `5c399b640` | `DONE 50239fb90` | (i) override `PROVIDER_CAPABILITIES["codebuddy-intl"]["deepseek-v4.1-flash"]` (`thinkingFormat:"openai"` — gateway menolak bentuk vendor-native `deepseek`); (ii) pola `PATTERN_THINKING` `{provider:"codebuddy-intl", pattern:"deepseek-v4*"}` | `git grep -n codebuddy main -- open-sse/providers/capabilities.js` → hanya `"codebuddy-cn"` di baris 553; `git grep -n codebuddy-intl main -- open-sse/providers/thinkingLevels.js` → 0 hit |
| `8e15f0bdd` | `DONE 50239fb90` | `open-sse/providers/pricing.js` +2 (harga `deepseek-v4.1-flash`) | `git grep -n "deepseek-v4.1" main -- open-sse/providers/pricing.js` → 0 hit |
| `93837af09` | `ALREADY-PRESENT` | hunk `src/sse/services/auth.js` `slice(0,100)`→`slice(0,200)` dan perubahan batas pesan di `src/app/api/models/test/ping.js` | `git grep -n "slice(0, 200)" main -- src/sse/services/auth.js` → 0 hit; `auth.js:323` masih `slice(0, 100)` |
| `c933eefc2` | `DONE 947ad5e59` | inti Cursor: `cursor.js` (+269), `cursorProtobuf.js` (+221), `chatCore.js` (+24) | sudah tercatat sebagai A#33 PENDING — dicantumkan di sini agar pembaca tidak menyimpulkan komit sudah tuntas |

### 3c. UNVERIFIED yang alasannya sekarang terbantah (5 commit)

| SHA | Status triase | Alasan triase | Fakta yang saya ukur |
|---|---|---|---|
| `13b468b88` | UNVERIFIED (A#27) | "provider Command Code belum dipastikan ada di fork" | `open-sse/providers/registry/commandcode.js` **ADA** di `main` (`git ls-tree --name-only main open-sse/providers/registry/`) → naikkan ke PENDING |
| `092c84eac` | UNVERIFIED (A#27) | idem | idem → naikkan ke PENDING |
| `2daf25ffb` | UNVERIFIED (A#46) | "bergantung A#39 (Qoder CN)" | `registry/qoder.js` **ADA**; yang belum ada hanya `qoder-cn.js`. Billing/SSE-status berlaku untuk qoder intl → naikkan ke PENDING |
| `782c137b1` | UNVERIFIED (A#46) | idem | idem |
| `402745dc1` | UNVERIFIED (A#39) | provider qoder-cn belum jelas | **tetap UNVERIFIED di level komit**: commit ini yang *membuat* `qoder-cn`; `registry/qoder-cn.js` tidak ada lokal, jadi tidak ada yang bisa dibandingkan |

### 3d. Kelompok inert — tidak perlu baris triase (10 commit)

| SHA | Subjek | Alasan inert |
|---|---|---|
| `52917a6d4`, `d99bc8201`, `9f42e7ac1`, `ce9ac43da` | NEW badge 9Remote (tambah → sembunyikan → pulihkan → samakan gaya) | Siklus churn 4 commit yang **saling membatalkan**. Net diff rentang untuk `src/shared/components/Sidebar.js` hanya: badge NEW pada menu 9Remote + pada header/kategori Media Providers, dan `"systemone"` di `VISIBLE_MEDIA_KINDS`. Fork sudah mengganti nama menu jadi "Remote" (`Sidebar.js:316`) dan **tidak punya kode badge sama sekali** (`git grep -n "NEW" main -- src/shared/components/Sidebar.js` → 0 hit) → SKIP |
| `23ae82d8e`, `a8c9d3802`, `21583c03e` | # v0.5.81, docs changelog header, # v0.5.85 | Rilis/bump versi/changelog upstream; fork mengelola versinya sendiri (v0.91.22) → SKIP |
| `c73bb2cd6`, `aa2bc53f3`, `3279d3102` | docs README (video ID, swap low-memory, link CLI) | docs-only; `README.md` + `cli/README.md` fork-diverged (rebrand) → SKIP |

**Ringkas: 13 commit tanpa baris triase** = 3 bersubstansi (3a) + 10 inert (3d: 4 badge + 3 docs + 3 rilis).
Kelompok 3b dan 3c **bukan** untriaged — mereka sudah punya baris; yang saya temukan adalah cakupan atau alasan
yang keliru, dan itu masuk §4b sebagai usul koreksi status.

---

## 4. Counts + reconciliation

### 4a. Commits per verdikt

| Verdikt | Jumlah | SHA |
|---|---|---|
| `DONE <sha>` | **13** | `5c399b640`, `930012136`, `f4f06f290`, `c49efdf52`, `367fc546d`, `3ac100d52`, `efc80ba2e`, `8e15f0bdd`, `c933eefc2`, `7c2b1fe3e`, `da0046550`, `d1de32458`, `0f488c702` |
| `ALREADY-PRESENT` | **4** | `6091ff597`, `0c6ab4f99`, `93837af09`, `058ceace4` |
| `PENDING` | **21** | `17c4cc768`, `912ed295d`, `702b57c30`, `2b65c49ff`, `82b1bca42`, `eafac37dc`, `aa14ef72e`, `20a43f5a2`, `725e2c118`, `ef1817522`, `4641c2b76`, `49185137b`, `822aa958d`, `cf663f530`, `5c217d34f`, `253199f16`, `41a1b8003`, `6c9fe6f78`, `0d50fe361`, `b53260ca5`, `1a0271315` |
| `SKIP` | **13** | `f64229530`, `b3d6e089c`, `bc3be0cb2`, `be3bc764b`, `c7df895bb`, `f67d5a0c9`, `b7446f8dd`, `6431e3530`, `f28e918e2`, `20014b310`, `f84c667d4`, `44fd69d22`, `5798b3084` |
| `UNVERIFIED` | **5** | `13b468b88`, `092c84eac`, `2daf25ffb`, `402745dc1`, `782c137b1` |
| **Total tertriase** | **56** | |
| Untriaged (saran di §3) | **13** | 4 badge/`SKIP` · 3 docs/`SKIP` · 3 rilis/`SKIP` · `73e021b8a`/`PENDING` · `477b2aed0`/`PENDING` · `6886915f6`/`SKIP` |
| **Total** | **69** | 56 + 13 ✔ |

### 4b. Hubungan dengan angka "50 unique changes"

Bangun ulang dari commit, bukan dari changelog:

| Lapis | Angka | Penjelasan |
|---|---|---|
| Baris laporan 49-row + `S1` | 50 | 49 baris laporan lama + 1 baris unik laporan v0.5.81 |
| Baris yang **punya ≥1 commit di rentang ini** | **33** | `A#7` + `A#18`…`A#49` |
| Baris yang **tidak punya commit di rentang ini** | **17** | `A#1`…`A#17` — semuanya pekerjaan rilis **v0.5.75**, yang commit-nya seluruhnya berada di atau sebelum `83af3f185` |
| `S1` | 1 | `73cb89143` = batas bawah eksklusif rentang ini, jadi di luar cakupan |
| Commits memetakan ke 33 baris itu | **56** | beberapa baris menerima banyak commit (A#18 ← 4, A#19/#20 ← 5, A#29 ← 3, A#38 ← 6, A#45 ← 2, A#46 ← 2, A#48 ← 2, A#37 ← 2, A#35 ← 2, A#40 ← 2, A#28 ← 2, A#23 ← 3, A#21 ← 2, A#7 ← 1, A#33/#34 ← 1 komit bersama) |
| Commits tanpa baris | **13** | §3 |

**Kenapa 69 ≠ 50, jenisnya berbeda:**

1. **Rentang berbeda batas bawah.** Laporan lama = `83af3f18..upstream/master` (70 commit). Rentang ini =
   `73cb89143..upstream/master` (69). Selisihnya persis `73cb89143` (= `S1`), sehingga 17 baris pertama laporan lama
   (pekerjaan v0.5.75) **tidak punya satu commit pun** di sini — itu 17 dari 50 "changes" yang memang tidak akan
   pernah muncul di inventaris ini.
2. **Banyak commit per bullet changelog.** Bullet "OpenCode/Go 403+429" = 4 commit; "Antigravity trio" = 3;
   "System One" = 6; "Kiro" = 2; "DeepSeek models" = 3.
3. **Commit tanpa bullet changelog.** 13 commit (§3) tidak pernah masuk changelog upstream dengan kata kunci yang
   bisa dipetakan — terutama siklus churn NEW badge (4), docs/rilis (6), dan 3 perubahan teknis
   (`73e021b8a` Ollama window, `477b2aed0` glm-5.3-flash effort, `6886915f6` capacity-adapter).
4. **Merge commit = 0**, jadi tidak ada commit yang hilang/terhitung dua kali karena merge. Graf linear.

**Dampak pada tabel konsolidasi:** `upstream-sync-status-2026-09-22.md` tetap valid sebagai daftar *change*.
Yang perlu dikoreksi hanya sel STATUS berikut (semuanya karena bukti baru di laporan ini, bukan karena commit baru):

| Baris | Status sekarang | Usul | Bukti |
|---|---|---|---|
| A#21 | `DONE 5d05992e4` | tetap, **tambah catatan** bahwa `82b1bca42` (placeholder Kiro) belum di-port → keluarkan sebagai item PENDING terpisah | §3b |
| A#7 | `ALREADY-PRESENT` | tetap untuk id registry; **tambah item PENDING** untuk override caps `codebuddy-intl` + pola `thinkingLevels` | §3b |
| A#27 | `UNVERIFIED` | **PENDING** | `registry/commandcode.js` ada |
| A#46 | `UNVERIFIED` | **PENDING** | `registry/qoder.js` ada |
| A#32 | `DONE 3b0a6f515` | tetap; entri `pricing.js` untuk `deepseek-v4.1-flash` belum ada | `8e15f0bdd` di §3b |
| — | (tidak ada) | **item baru**: Ollama free-plan window, OpenCode Go `glm-5.3-flash` reasoning_effort | §3a |

---

## 5. High-signal — paling berharga / paling berisiko

Diurutkan menurun berdasarkan (nilai ÷ risiko).

| # | SHA | Kenapa |
|---|---|---|
| 1 | `c933eefc2` | **Lead terkuat untuk isu #131.** `cursor.js` +269 / `cursorProtobuf.js` +221 memperbaiki empty turn & silent tool hang. Setengah RTK-nya sudah kita ambil (`947ad5e59`); sisanya PENDING dan `cursor.js` lokal sudah divergen → medium risk, high value. |
| 2 | `cf663f530` | **Perbaikan yang jelas-belum-diambil.** `registry/huggingface.js:33` masih host lama (`api-inference.huggingface.co`) → jalur HF (termasuk STT) tidak berfungsi. 2 file kode, ada 2 test upstream untuk diport. Value tinggi, risk rendah. |
| 3 | `49185137b` (+`41a1b8003`) | **Menutup separuh isu #121** (OpenCode Zen tak muncul). 10 file, tapi terisolasi: 1 executor + 1 registry + 1 usage + 2 baris registrasi. `opencode-zen.js` dikonfirmasi tidak ada lokal. |
| 4 | `13b468b88` (& `092c84eac`) | **UNVERIFIED-nya salah.** Command Code ada di fork. `usage/commandcode.js` 134 baris + capabilities 54 baris adalah fitur penuh yang belum pernah ditinjau dengan benar. |
| 5 | `20a43f5a2` | **Rule yang benar di file yang paling berbahaya.** "jangan cooldown akun untuk 4xx request-scoped"; `accountFallback.js` divergen → port rule-nya, bukan patch. Satu request salah bisa melumpuhkan akun user. |
| 6 | `5c217d34f` | **Satu-satunya commit ACL-kritis yang masih PENDING.** Menambah `capabilities` ke tiap entri `/v1/models`, dan `models/route.js` adalah tempat `isKindAllowed` dipanggil (baris 76). Perluas, jangan tulis ulang. |
| 7 | `402745dc1` | **Commit terbesar (30 file)** dan menyentuh `models/route.js` + `usages.js` + seluruh OAuth qoder. Semua untuk provider yang belum ada di fork → jangan port tanpa keputusan produk; kalau di-port, ini yang paling mudah menabrak jalur ACL. |
| 8 | `be3bc764b`, `5798b3084`, `f64229530`, `b3d6e089c`, `bc3be0cb2` | **Trio Antigravity (5 commit) sengaja ditahan.** `5798b3084` memperbaiki false 429 yang membuat user kehilangan akses — nilai user tinggi, tapi `antigravity.js` + `thoughtSignatureStore.js` fork-diverged. Ini keputusan "risk appetite", bukan "cari tahu". |
| 9 | `73e021b8a` | **Gap yang tidak pernah masuk radar.** `getOllamaUsage` lokal masih stub pesan; upstream mengirim baris kuota nyata. Value menengah, risk rendah → kandidat cepat. |
| 10 | `82b1bca42` | **Paling murah, paling terlupakan.** 3 baris kode (`kiroEmptyUserContent`) memperbaiki model yang menjawab "Nothing in progress to continue" lalu kehilangan tugas. Kita sudah menyentuh ketiga file itu di `5d05992e4` — jadi biayanya nyaris nol. |
| 11 | `6886915f6` + `1a0271315` | **Penanda arsitektur:** `open-sse/services/capacityAdapter.js` tidak ada di fork, jadi "migrate legacy mimo vision adapter" upstream tidak punya padanan. Jangan port; cukup tahu bahwa fork dan upstream berbeda di lapisan ini. |

---

## 6. Verifikasi penutup

```bash
git status --short
```

Mengharapkan: hanya laporan ini yang **ditambahkan**; tidak ada file sumber berubah.

Untracked yang sudah ada sebelum pass ini (tetap untracked, tidak disentuh):
`.docs/audit/antigravity-regression-since-0.91.22-2026-09-22.md`,
`.docs/audit/upstream-83af3f18-triage-2026-09-22.md`,
`.docs/audit/upstream-sync-status-2026-09-22.md`,
`.docs/audit/upstream-v0.5.81-triage-2026-09-22.md`,
`tests/unit/scratch-optional-probe.test.js`.

Tracked-file changes: **nol** (tidak ada `M`/`D` di `git status`). HEAD tetap `56f83f1d4`.

### Batas dan ketidakpastian yang jujur

- **Tidak ada test yang dijalankan.** Laporan ini inventaris commit; verdict `DONE`/`ALREADY-PRESENT` dibuktikan
  lewat pembacaan kode dan `git grep`/`git ls-tree`, bukan lewat eksekusi. Klaim `DONE` berarti "kode padanannya ada
  di `main`", bukan "sudah lulus test".
- **8 sel A#60-an tidak diverifikasi ulang**: baris A#3/A#8–A#14/A#16 tidak punya commit di rentang ini, jadi saya
  tidak menguji ulang klaim `ALREADY-PRESENT`-nya (itu di luar cakupan laporan ini).
- **Klaim "belum ada" memakai batas `main` @ `56f83f1d4`.** Branch lain (`dev`, `pr-114`, `feature/upstream-adopt-*`)
  tidak diperiksa; kalau ada pekerjaan port di sana, verdikt `PENDING` bisa jadi sudah usang.
- **Perilaku live tidak diuji** (tidak ada kredensial): #4/#26 Command Code, #33 Cursor, #35 fingerprint OpenCode Zen,
  #41 HF router.
- Akibat poin 1–2, kolom verdikt untuk commit yang dipetakan ke baris triase **sengaja disamakan dengan STATUS di
  `upstream-sync-status-2026-09-22.md`** supaya dua dokumen bisa direkonsiliasi; koreksi yang saya temukan ditaruh di
  §3b/§3c sebagai usul perubahan status, bukan sebagai verdikt baru.
- `73cb89143` (`S1`, Xiaomi MiMo) **tidak diperiksa**: ia batas bawah eksklusif rentang ini. Perbandingan
  `xiaomi-mimo.js` upstream vs lokal masih terbuka.
