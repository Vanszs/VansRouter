# Implement pending queue — 2026-09-22

Kerja: implementasikan seluruh item PENDING triase upstream (26 baris perubahan + 2 commit untriaged), satu commit lokal per item, lalu audit hasil oleh subagen senior.

## Aturan subagen (wajib)

- Subagen IMPLEMENTASI memakai model `primary` (= bevan/ocg/deepseek-flash). Satu item = satu subagen = satu commit lokal.
- Commit lokal saja. DILARANG: push, PR, merge (main protected).
- Setelah semua item: SATU subagen audit dengan model `bevan/cx/gpt-5.6-luna`, read-only, fokus "apakah perubahan ini merusak logic kita?".
- Bukti wajib tiap item: `npx vitest run -c tests/vitest.config.js <test terkait>` + `node scripts/lint-undef.cjs`, output nyata ditunjukkan.
- Item yang menyentuh auth/ACL/model-list juga jalankan set pengunci: `post-merge-verification`, `handler-acl-enforcement`, `apikey-acl-security`, `acl-provider-list`, `models-acl-robustness`, `acl-custom-prefix`, `translator-custom-prefix`.
- Ponytail: diff minimum, pakai helper yang sudah ada, tanpa dependency/abstraksi baru. Item yang cuma "bagus di teori" → SKIP (YAGNI) + alasan, tanpa commit.
- STOP per item bila: perlu mengubah semantik ACL/custom logic, perlu dependency baru, atau test merah yang tidak bisa dijelaskan → tandai BLOCKED + alasan, lanjut item berikutnya.
- Jangan pernah melaporkan "semua hijau" tanpa output test.

## Queue (urut dampak user)

| # | Item | Target utama |
|---|---|---|
| 1 | A#33 Cursor empty-turn/hang | `open-sse/executors/cursor.js`, `open-sse/utils/cursorProtobuf.js` |
| 2 | A#31 auth: jangan cooldown untuk 4xx + hunk parsial `93837af09` (`auth.js:323` slice 100→200) | `src/sse/services/auth.js`, `open-sse/services/accountFallback*` |
| 3 | A#15 clear stale health state | file sama seperti #2 |
| 4 | A#45 Antigravity drop requestType `agent` (false 429) — `5798b3084` | `open-sse/executors/antigravity*` |
| 5 | A#29 Antigravity thought signature per model family — `bc3be0cb2` | translator/executor agy |
| 6 | A#2 Antigravity kuota mingguan + free-tier | executor + dashboard quota |
| 7 | A#35 provider `opencode-zen` | `registry/opencode-zen.js` + index (+executor/usage free tier) |
| 8 | A#41 HF Inference Providers router (+ hidupkan STT HF) | `registry/huggingface.js`, `handlers/imageProviders/huggingface.js` |
| 9 | A#36 capability metadata `/v1/models` + agregasi combo | `src/app/api/v1/models/route.js`, `providers/capabilities.js` |
| 10 | A#19+A#20+`822aa958d` OpenCode: cloak tools, Muse tool choice, responses-only routing, Union Alpha | executors/opencode.js, registry |
| 11 | A#17 Fable limit dari `limits[]` + cookie 24 jam | dashboard usage, `src/dashboardGuard.js` |
| 12 | A#25 Claude Code 1M toggle + auto-compact window | CLI-tools pages + marker strip |
| 13 | A#24 catalog scope ke gateway + vision caps | catalog service, capabilities |
| 14 | A#5 OpenCode Go models (WAJIB ikut `supportedFormats` lokal) | `registry/opencode-go.js` |
| 15 | A#26 locale fa (gabung key, branding VansAI tetap) | `public/i18n/**` |
| 16 | A#37 combo preset + bulk ops | `dashboard/combos/page.js` |
| 17 | A#40 Analytics Requests mode | dashboard usage |
| 18 | A#49 CLI-tools dinamis + logo | dashboard cli-tools |
| 19 | A#28 Zed OAuth hardening — `ef1817522`, `4641c2b76` | `lib/oauth/providers.js`, `registry/zed.js` |
| 20 | A#27 Command Code (provider ADA): caps + translator + prefetch + retry/no-fake-stop — `13b468b88`, `092c84eac` | capabilities, translator, prefetch, thinkingLevels, registry |
| 21 | A#46 Qoder (provider ADA): billing code 110 + first-frame error→status + strictProxy anti-replay — `2daf25ffb`, `782c137b1` | `executors/qoder.js`, `sseToJsonHandler.js` |
| 22 | A#21 sisa parsial: placeholder netral Kiro — `82b1bca42` | `kiroConversation.js:181`, `claude-to-kiro.js:112`, `openai-to-kiro.js:131` |
| 23 | A#7 sisa parsial: caps `codebuddy-intl` + pola `thinkingLevels` — `5c399b60` | capabilities, thinkingLevels, registry |
| 24 | A#18 verifikasi sisa (hunk 100→200 sudah masuk item 2) | `src/sse/services/auth.js` |
| 25 | A#6 CLI-tools grup picker + search | `ModelSelectModal.js` |
| 26 | `73e021b8a` ollama free-plan monthly window (`usage/misc.js:58` stub) | `open-sse/services/usage/misc.js` |
| 27 | `477b2aed0` glm-5.3-flash `reasoning_effort` (caps provider-scoped) | capabilities, thinkingLevels |
| 28 | Qoder context tier auto-escalation (pure function, ADOPT-able) | `open-sse/shared/qoder/contextTier.js` + wiring |

## Audit akhir (subagen luna)

Rubrik thermonuclear, read-only, tanpa commit. Tulis `.docs/audit/local-changes-audit-2026-09-22.md`:
- verdict per commit: aman / merusak / perlu boundary, dengan file:line;
- temuan berurut severity (blocker/high/medium/low) + apa yang harus diubah;
- khusus: apakah ada yang menabrak custom logic kita — ACL per API key (`src/sse/handlers/chat.js`, `src/app/api/v1/models/route.js`, `src/sse/services/auth.js`, `allowedModels.js`), ZCode, branding VansAI, searxng fallback, volume `9router-data`, guard multi-koneksi provider custom, `src/mitm`;
- daftar test yang membuktikan tiap verdict, plus daftar yang tidak bisa dibuktikan tanpa kredensial.
Temuan blocker/high dari subagen WAJIB diverifikasi ulang oleh saya (baca file:line) sebelum ditindak; tandai mana yang terverifikasi vs masih klaim.

## Larangan & stop rule global

- DILARANG ubah CHANGELOG/versi/tag, deploy/pm2, push/PR, komentar issue, tulis DB produksi.
- `src/mitm` hanya bila item memang membutuhkannya.
- Di akhir: laporkan DONE (dengan SHA) / SKIP (alasan) / BLOCKED (alasan) per item — tanpa membulatkan angka.
