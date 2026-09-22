# Upstream sync — consolidated status (2026-09-22)

Single source of truth for the upstream triage. Supersedes the **status columns** of:

- `.docs/audit/upstream-83af3f18-triage-2026-09-22.md` — 49 triage rows (kept as evidence)
- `.docs/audit/upstream-v0.5.81-triage-2026-09-22.md` — 15 rows (kept as evidence)

Nothing in those two files is edited; they remain the audit trail for citations.

## Range and sources

- Reference start: `83af3f1853b295eda428f3d3d8f5ff96ca25bfab` ("# v0.5.75", 2026-09-10) → upstream tip at audit time
  (`21583c03e`, "# v0.5.85", 2026-09-22). Tags in range: v0.5.75, v0.5.79, v0.5.81, v0.5.85.
- Duplicate accounting between the two reports: **14 of the 15 rows in the v0.5.81 report map onto rows of the
  49-row report** (Claude Code 1M → A#25, DeepSeek models → A#23, fa i18n → A#26, OpenCode → A#18,
  OpenCode extras → A#19/#20, Kiro → A#21, stream abort → A#22, Command Code → A#27, Zed → A#28,
  Antigravity → A#29, Codex → A#30, auth → A#31, DeepSeek usage → A#32, catalog → A#24).
  The one row unique to the older report is **Xiaomi MiMo** (`73cb89143`), listed below as **S1**.
- **Unique changes under review: 50** (49 + S1).

Row prefixes: `A#n` = row n of the 49-row report; `S1` = the single row unique to the v0.5.81 report.

## Status table

Column values for **STATUS** are restricted to `DONE <sha>` · `ALREADY-PRESENT` · `PENDING` · `SKIP` · `UNVERIFIED`.

| # | Rilis | Perubahan | Keputusan awal | STATUS | Dampak user | Catatan |
|---|---|---|---|---|---|---|
| A#1 | v0.5.75 | Video OpenRouter + Vertex Veo via adapter layer | HYBRID | SKIP | Sedang | Hanya user video; adapter layer besar, ditahan |
| A#2 | v0.5.75 | Antigravity weekly quota tracking | SKIP | SKIP | **Tinggi** | Kuota salah tampil = user pikir rusak; ditahan karena integrasi fork-modified |
| A#3 | v0.5.75 | Codex image models (GPT Image 2.5/Flare/Sunburst) | ADOPT | ALREADY-PRESENT | Rendah | 11 entri `kind:"image"` sudah setara; `image-generation.test.js` lulus |
| A#4 | v0.5.75 | Qoder usage/attachments | UNVERIFIED | UNVERIFIED | Tidak ada | Provider Qoder belum dipastikan ada di fork ini |
| A#5 | v0.5.75 | OpenCode Go: model baru | NEEDS-BOUNDARY | PENDING | Sedang | Hanya boleh ditambah dengan `supportedFormats` lokal |
| A#6 | v0.5.75 | CLI tools: grup picker + search | HYBRID | PENDING | Sedang | UX browsing model; UI customised |
| A#7 | v0.5.75 | CodeBuddy-CN: swap ke `deepseek-v4.1-flash` | ADOPT | ALREADY-PRESENT | Rendah | Registry sudah memuat id itu |
| A#8 | v0.5.75 | Claude tool-type defaulting scoped ke `requireClaudeToolType` | SKIP | ALREADY-PRESENT | Tidak ada | `concerns/toolCall.js:269` sudah menerapkan aturan sama |
| A#9 | v0.5.75 | Claude `cache_control` cap 4 marker + bare-object wrap | ADOPT | ALREADY-PRESENT | Rendah | Ada + ditest (`upstream-claude-deepseek-fixes.test.js:66-80`); commit upstream pre-base |
| A#10 | v0.5.75 | Cline/ClinePass envelope + catalog | SKIP | ALREADY-PRESENT | Rendah | Envelope sudah fixed (`6c433d9e5`); katalog live = opsional |
| A#11 | v0.5.75 | Kiro: jangan kirim top-level `systemPrompt` | ADOPT | ALREADY-PRESENT | Sedang | `claude-to-kiro.js:450-452`, `executors/kiro.js:102` |
| A#12 | v0.5.75 | Codex: strip Unicode schema + `Version` header | ADOPT | ALREADY-PRESENT | Rendah | Identik; fork malah punya guard array tambahan |
| A#13 | v0.5.75 | DeepSeek: pertahankan Anthropic tool types | SKIP | ALREADY-PRESENT | Rendah | Ada test khusus (`upstream-claude-deepseek-fixes`) |
| A#14 | v0.5.75 | Qoder: drop Responses usage plumbing | SKIP | SKIP | Tidak ada | Justru revert yang merusak akuntansi bersama |
| A#15 | v0.5.75 | Providers: clear stale health state saat re-validate | HYBRID | PENDING | **Tinggi** | Health basi bikin koneksi sehat tampak rusak |
| A#16 | v0.5.75 | Vertex/Video SSRF guard | ADOPT | ALREADY-PRESENT | Tidak ada | Lokal **lebih ketat** (per-segmen); port upstream = regresi |
| A#17 | v0.5.75 | Fable weekly limit dari `limits[]` + cookie 24h | HYBRID | PENDING | Sedang | Baris kuota salah + "kenapa logout terus" |
| A#18 | v0.5.79 | OpenCode/Go: 403 FreeTier + 429 (session/UA/forceStream) | SKIP | ALREADY-PRESENT | Sedang | Sudah diadopsi lebih dulu (canonical id, UA gate, forceStream) |
| A#19 | v0.5.79 | OpenCode: Muse tool choice + reasoning items | HYBRID | PENDING | Sedang | Perlu laporan model spesifik |
| A#20 | v0.5.79 | OpenCode Go: responses-only routing + Union Alpha | HYBRID | PENDING | Sedang | Sama: per model |
| A#21 | v0.5.79 | Kiro: underscore tool name + restore nama + images | ADOPT | **DONE** `5d05992e4` | Sedang | Test baru: `kiro-tool-name-roundtrip` (9) |
| A#22 | v0.5.79 | Stream: abort in-band setelah HTTP 200 | ADOPT | **DONE** `c7bdf5b78` | Sedang | `pipeWithDisconnect` saja; early-EOF lokal utuh |
| A#23 | v0.5.79 | DeepSeek-V4.1-Flash + effort + vision | ADOPT | **DONE** `50239fb90` | Sedang | Hanya entri per-provider (pola glob bersama tidak diubah) |
| A#24 | v0.5.79 | Catalog: scope ke gateway + vision caps | HYBRID | PENDING | Sedang | Bagian caps sebagian sudah; scoping menyentuh logika bersama |
| A#25 | v0.5.79 | Claude Code: toggle 1M + auto-compact window | HYBRID | PENDING | Sedang | Power-user Claude Code |
| A#26 | v0.5.79 | i18n Persian (fa) | NEEDS-BOUNDARY | PENDING | Rendah | Gabung key saja; branding VansAI |
| A#27 | v0.5.79 | Command Code: images/effort, retry, stop chunks | UNVERIFIED | UNVERIFIED | Tidak ada | Provider belum dipastikan ada |
| A#28 | v0.5.79 | Zed: OAuth lifecycle + live models | HYBRID | PENDING | Rendah | Hanya kalau ada user Zed |
| A#29 | v0.5.79 | Antigravity: signatures/headers/Hermes | SKIP | SKIP | **Tinggi** | Sama seperti A#2: dampak user besar, risiko kode besar |
| A#30 | v0.5.79 | Codex: route bare `codex-auto-review` | ADOPT | **DONE** `757438f15` | Sedang | Rule + entri registry; 2 hunk terbukti load-bearing |
| A#31 | v0.5.79 | Auth: jangan cooldown akun untuk 4xx request-scoped | HYBRID | PENDING | **Tinggi** | Satu request salah bisa melumpuhkan akun user |
| A#32 | v0.5.79 | Usage: saldo DeepSeek sebagai kredit | ADOPT | **DONE** `3b0a6f515` | Rendah | Display; JSX tanpa test (tanpa jsdom) |
| A#33 | v0.5.81 delta | Cursor: stop AgentService empty turns (`OUT 0`) + hang | HYBRID | PENDING | **Tinggi** | Lead utama issue #131 |
| A#34 | v0.5.81 delta | RTK: kompres Cursor `tool_result` sebelum translasi | ADOPT | **DONE** `947ad5e59` | Sedang | Test ada tapi tidak diskriminatif pra/pasca |
| A#35 | v0.5.85 | Provider `opencode-zen` | HYBRID | PENDING | **Tinggi** | Menutup separuh issue #121 (Zen tak ada di daftar) |
| A#36 | v0.5.85 | Capability metadata di `/v1/models` + agregasi combo | HYBRID | PENDING | Sedang | Menyambung kerja combo-vision; `/v1/models` = jalur ACL |
| A#37 | v0.5.85 | Combo: preset + bulk select/delete/strategy | HYBRID | PENDING | Rendah | Kenyamanan dashboard |
| A#38 | v0.5.85 | System One `/v1/systemone` | SKIP | SKIP | Tidak ada | Endpoint niche, permukaan baru |
| A#39 | v0.5.85 | Qoder CN provider | UNVERIFIED | UNVERIFIED | Tidak ada | Sama seperti A#4 |
| A#40 | v0.5.85 | Analytics: Requests mode + breakdown | HYBRID | PENDING | Rendah | Insight dashboard |
| A#41 | v0.5.85 | HF Inference Providers router | ADOPT | PENDING | **Tinggi** | STT HF sekarang mati (400) tanpa pesan jelas |
| A#42 | v0.5.85 | Responses: `usage` di `response.completed` | ADOPT | **DONE** `dde5da4c8` | Sedang | Auto-compact klien; akuntansi lokal tidak ditimpa |
| A#43 | v0.5.85 | Translator: `refusal` → `content_filter` | ADOPT | **DONE** `5a267e7d0` | Sedang | Guard synthetic-whitespace lokal dipertahankan |
| A#44 | v0.5.85 | Translator: strip reasoning Groq/Mistral/Cerebras | ADOPT | **DONE** `bbe6a622a` | Sedang | Aturan Kimchi/Xiaomi/VolcEngine tidak disentuh |
| A#45 | v0.5.85 | Antigravity: drop requestType agent + kuota 5-jam | SKIP | SKIP | **Tinggi** | False 429 bikin user kehilangan akses |
| A#46 | v0.5.85 | Qoder: replay/billing/SSE status | UNVERIFIED | UNVERIFIED | Tidak ada | Bergantung A#39 |
| A#47 | v0.5.85 | Usage: bound `lastUsed` 2 hari + tier `max` | HYBRID | **DONE** `b9e95f575` | Rendah | Assertion upstream utk wire OpenAI tidak mungkin (fork clamp `max→xhigh`) |
| A#48 | v0.5.85 | Docker: publish multi-platform | SKIP | SKIP | Rendah | Fork pakai `deploy-atomic.cjs`, bukan alur image upstream |
| A#49 | v0.5.85 | CLI Tools: konfigurasi dinamis + logo | HYBRID | PENDING | Rendah | Polish dashboard |
| S1 | v0.5.81 | Xiaomi MiMo: dual auth + Desktop + Preview | UNVERIFIED | UNVERIFIED | Tidak ada | Nama/shape entry berbeda dari `xiaomi-tokenplan.js` kita |

## Reconciliation

Counted from the table above (row IDs, not estimates):

- **DONE (10)**: A#21, A#22, A#23, A#30, A#32, A#34, A#42, A#43, A#44, A#47.
  Each SHA was verified before this file was written: `git log --oneline -1 <sha>` for
  `5d05992e4`, `c7bdf5b78`, `50239fb90`, `757438f15`, `3b0a6f515`, `947ad5e59`, `dde5da4c8`, `5a267e7d0`,
  `bbe6a622a`, `b9e95f575`.
- **ALREADY-PRESENT (10)**: A#3, A#7, A#8, A#9, A#10, A#11, A#12, A#13, A#16, A#18.
- **PENDING (18)**: A#5, A#6, A#15, A#17, A#19, A#20, A#24, A#25, A#26, A#28, A#31, A#33, A#35, A#36, A#37, A#40, A#41, A#49.
- **SKIP (7)**: A#1, A#2, A#14, A#29, A#38, A#45, A#48.
- **UNVERIFIED (5)**: A#4, A#27, A#39, A#46, S1.

Sum: 10 + 10 + 18 + 7 + 5 = **50** = the 49 rows of the first report + S1 (the single row unique to the second
report). No row is counted twice; the 14 duplicated rows are listed under "Range and sources" instead of appearing
twice in the table.

## Work queue (ordered by user impact)

| # | Item | Target files | Tests that must pass | Expected diff | Custom-logic risk |
|---|---|---|---|---|---|
| A#33 | Cursor empty-turn/hang | `open-sse/executors/cursor.js`, `open-sse/utils/cursorProtobuf.js` | `tests/unit/cursor-*.test.js` + a ported empty-turn test | medium (fork diverged: MCP tool encoding) | Medium |
| A#31 | Auth 4xx cooldown rule | `src/sse/services/auth.js`, `open-sse/services/accountFallback*` | `tests/unit/handler-acl-enforcement.test.js`, `apikey-acl-security.test.js` | small rule, high care | **High** (ACL/fallback custom) |
| A#15 | Clear stale health state | same auth/fallback files | same ACL lock tests | small | **High** |
| A#35 | `opencode-zen` provider | `open-sse/providers/registry/opencode-zen.js` + registry index; executor/usage for free tier | `tests/translator/golden-url-header.test.js`, ported `opencode-zen-models` | 1 new file + 2 lines (PAYG) | Low–Medium (must pass local `isProviderAllowed`) |
| A#41 | HF router | `registry/huggingface.js`, `handlers/imageProviders/huggingface.js` | ported `huggingface-router-migration` | 2 files | Medium (media-provider schema) |
| A#2/A#29/A#45 | Antigravity trio | `open-sse/executors/antigravity*`, translator, dashboard quota rows | antigravity unit + quota tests | medium | **High** (fork-modified integration) |
| A#36 | Capability metadata + combo aggregation | `src/app/api/v1/models/route.js`, `providers/capabilities.js` | models/ACL lock tests | medium | Medium–High (ACL path) |
| A#19/A#20/A#24/A#25/A#17/A#37/A#40/A#49/A#5/A#26/A#28 | polish & boundary items | see per-row notes in the two evidence reports | per item | small each | mixed |

## Non-code leftovers

- **Local commits not pushed**: `main` is protected (`enforce_admins: true`, required check
  `Validate (Ubuntu / Node 22)`), so direct push is rejected. Landing requires a PR or temporarily lifting
  protection — the user's call.
- **`pm2 save` not run** after today's local atomic deploy (health already verified: `/` → 200,
  `/api/version` buildId `OVpIOTyT5upl_HkHGRr5Z`, symlink `/var/lib/9router/current` → release
  `2026-09-22T10-58-08-236Z-2373888`).
- **Untracked report files**: this file, `upstream-83af3f18-triage-2026-09-22.md`,
  `upstream-v0.5.81-triage-2026-09-22.md` (none committed yet).
- **Line-ending churn** makes several diffs unreadable. Numbers reported by the implementation subagents
  (not re-measured in this pass — a later pass should re-measure before quoting them):
  `open-sse/utils/streamHelpers.js` raw `159/134` vs content-only `25/-` · `QuotaTable.js` raw `278/278`
  vs content-only `12/5` · `tests/unit/responses-abort-terminal.test.js` raw `118/72`. Cause: blobs stored CRLF
  while `.gitattributes` sets `text eol=crlf`, so git normalises one side. Review with
  `git diff --ignore-cr-at-eol -- <path>`.
- **Two test gaps**: (a) the ported Cursor pre-translate test proves non-Cursor providers still compress on the
  post-translate path, but does not discriminate pre vs post for Cursor itself; (b) `QuotaTable.js` JSX has no
  test — the repo has no jsdom/testing-library, so only the normalisation path is covered.
- **Known environment failure**: `tests/unit/deploy-atomic.test.js:62` fails on this machine because it asserts
  the live `/var/lib/9router/current` symlink is absent. Pre-existing, reproduced in a pristine worktree at HEAD.

## UNVERIFIED — what would prove each

| Item | What would prove it |
|---|---|
| A#4, A#39, A#46 (Qoder) | `ls open-sse/providers/registry \| grep -i qoder` + executor check |
| A#27 (Command Code) | `grep -ri commandcode open-sse/providers/registry src` |
| S1 (Xiaomi MiMo) | per-file comparison of upstream `xiaomi-mimo` vs our `xiaomi-tokenplan.js` |
| A#35 free-tier fingerprint | a live free-tier request from an allowed client |
| A#33 Cursor behaviour | Cursor credentials + captured `[STREAM]` log (same blocker as issue #131) |
| Churn numbers above | re-run both `git diff --stat` and `--ignore-cr-at-eol --stat` per file |
