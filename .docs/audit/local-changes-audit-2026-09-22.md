# Local changes audit — 2026-09-22

## Scope and method

- Audited range: `origin/main..HEAD`.
- `origin/main`: `7f42ef4267af32f1374c83538723e1aa6e4c1259`.
- `HEAD`: `e9d94fb739ddb68948c3371c04949edcd511fc7b`.
- Count: **42 commits** (`git rev-list --count origin/main..HEAD`).
- Aggregate range diff: **166 files, 12,571 insertions, 3,440 deletions** (`git diff --stat origin/main..HEAD`).
- Chronological commit list: `git log --reverse --format='%H%x09%s' origin/main..HEAD`.
- Per-commit file map: `git diff-tree --no-commit-id --name-status -r <sha>`.
- Verification: exact ACL lock, both repository lint scripts, full Vitest suite, targeted source inspection, `git diff --check`.
- No source edits, commits, pushes, GitHub calls, or deployment actions performed for this audit.

Verdicts:

- **AMAN** — local behavior has passing coverage or direct source evidence; no verified regression.
- **PERLU BOUNDARY** — local contract is covered, but live provider/client behavior or a custom integration boundary remains unverified.
- **MERUSAK** — verified regression caused by the commit/range.
- **TIDAK RELEVAN** — documentation/test-only change; no runtime behavior to approve.

## Commit verdicts

| # | Commit | Subject | Verdict | Evidence / boundary |
|---:|---|---|---|---|
| 1 | `f395abcf56` | fix(providers,chat,rtk): tokenrouter API host, opencode free-tier identity, request body ceiling | **PERLU BOUNDARY** | Local body/RTK/session tests pass; `src/sse/utils/boundedBody.js:16-24` still buffers the complete `request.text()` before measuring. TokenRouter/OpenCode live calls unavailable. |
| 2 | `72bb441077` | feat(providers): adopt upstream self-hosted embedding/stt/tts registry entries | **PERLU BOUNDARY** | Registry additions in `open-sse/providers/registry/selfhosted-embedding.js`, `selfhosted-stt.js`, `selfhosted-tts.js`; no range-specific failure identified in the full run, but no live self-hosted endpoint was exercised. |
| 3 | `2eaeba2d27` | fix(api): bound request bodies on every entry point | **PERLU BOUNDARY** | `src/sse/utils/boundedBody.js:16-36` and all listed handlers use the helper; `tests/unit/request-body-limits.test.js` passes in the full run. Raw-body memory protection before `request.text()` completion remains unverified/not implemented. |
| 4 | `2352409982` | perf(rtk): size requests without serializing the body | **AMAN** | `open-sse/rtk/index.js:17-22,102-117` uses an estimate/known byte count; no range-specific failure identified in the full run. |
| 5 | `636d144c2a` | fix(opencode): keep free-tier session and request ids stable | **PERLU BOUNDARY** | `tests/unit/opencode-session.test.js` passes; live OpenCode free-tier request unavailable. |
| 6 | `6105a97a35` | test(api,opencode): byte-accurate ceiling, wrapper 413, behaviour-only session cases | **TIDAK RELEVANT** | Test-only changes: `tests/unit/opencode-session.test.js`, `tests/unit/request-body-limits.test.js`; no runtime code. |
| 7 | `31f40fb351` | docs(audit): stop overstating what the fixes cover | **TIDAK RELEVANT** | Documentation-only changes: `.docs/audit/combo-image-audit-2026-09-22.md`, `.docs/audit/vansrouter-issue-audit-2026-09-22.md`. |
| 8 | `91816788c4` | feat(ui): surface vision capability in the combo editor | **AMAN** | UI changes in `src/app/(dashboard)/dashboard/combos/page.js` and `src/shared/components/ModelSelectModal.js`; no range-specific failure identified in the full run. |
| 9 | `757438f157` | fix(codex): route bare codex-auto-review to the Codex provider | **AMAN** | `open-sse/services/model.js`, `open-sse/providers/registry/codex.js`; `tests/unit/codex-auto-review-routing.test.js` passes in the full run. |
| 10 | `947ad5e599` | fix(rtk): compress Cursor tool results before translation | **AMAN** | `open-sse/handlers/chatCore.js:178-184,315-318`; `tests/unit/rtk-cursor-pretranslate.test.js` passes. |
| 11 | `5d05992e4e` | fix(kiro): preserve tool-name underscores and forward tool-result images | **AMAN** | Kiro translator changes covered by `tests/translator/kiro-tool-name-roundtrip.test.js`; no range-specific failure identified in the full run. |
| 12 | `c7bdf5b782` | fix(stream): report aborts in-band after a 200 response | **AMAN** | `open-sse/handlers/chatCore/streamingHandler.js`, `open-sse/utils/streamHandler.js`; `tests/unit/responses-abort-terminal.test.js` passes. |
| 13 | `5a267e7d00` | fix(translator): map Claude refusal stop reason to content_filter | **AMAN** | `open-sse/translator/concerns/finishReason.js`; `tests/unit/claude-refusal-stream.test.js` and finish-reason tests pass. |
| 14 | `bbe6a622a2` | fix(translator): drop replayed reasoning fields for groq, mistral and cerebras | **AMAN** | `open-sse/translator/concerns/paramSupport.js`; `tests/unit/param-support.test.js` passes. |
| 15 | `50239fb90e` | feat(models): add deepseek-v4.1-flash with effort levels and vision | **AMAN** | `open-sse/providers/capabilities.js`, DeepSeek registry/thinking config; `tests/unit/provider-thinking-config.test.js` passes. Live DeepSeek provider behavior not exercised. |
| 16 | `b9e95f5751` | perf(usage): bound the lastUsed scan and add the max thinking tier | **AMAN** | `src/lib/db/repos/usageRepo.js`, `open-sse/translator/concerns/thinking.js`; `tests/unit/thinking-budget-max-level.test.js` passes. |
| 17 | `dde5da4c8c` | fix(responses): report usage on response.completed | **AMAN** | `open-sse/translator/response/openai-responses.js`, `open-sse/utils/stream.js`; `tests/unit/openai-responses-usage-completed.test.js` passes. |
| 18 | `3b0a6f5156` | feat(usage): show deepseek credit balance as currency | **AMAN** | `open-sse/services/usage/deepseek.js` and dashboard quota components; `tests/unit/deepseek-usage.test.js` passes. |
| 19 | `56f83f1d42` | fix(mitm): strip unsupported gemini schema keywords on the antigravity passthrough | **PERLU BOUNDARY** | `src/mitm/scrubSchemaKeywords.cjs:85-100`, `src/mitm/server.js:169-176`, and `tests/unit/antigravity-mitm.test.js` pass. No live Antigravity credential/client exchange. |
| 20 | `886eb8a526` | fix(cursor): stop AgentService empty turns and silent tool hangs | **PERLU BOUNDARY** | `open-sse/executors/cursor.js`; `tests/unit/cursor-agent-proto.test.js` passes. Cursor credentials and live token/stream evidence unavailable. |
| 21 | `eb92115166` | fix(auth): do not cool down an account for a request-scoped 4xx | **AMAN** | `open-sse/services/accountFallback.js:62-75`; `tests/unit/account-fallback-4xx.test.js` and ACL lock pass. Account/provider live behavior not exercised. |
| 22 | `5720222cb8` | test(auth): prove re-validation clears stale connection health state | **TIDAK RELEVANT** | Test-only change: `tests/unit/connections-health-reset.test.js`; no runtime code. |
| 23 | `3ed19d7e29` | feat(providers): add the opencode-zen API-key provider | **PERLU BOUNDARY** | Registry/usage additions covered by `tests/unit/opencode-zen-models.test.js`, `opencode-zen-usage.test.js`, and usage dispatch tests. No Zen API key exists for an authenticated live request. |
| 24 | `f1f3d9b087` | fix(huggingface): move to the Inference Providers router and declare sttConfig | **PERLU BOUNDARY** | `open-sse/providers/registry/huggingface.js`, `open-sse/handlers/imageProviders/huggingface.js`; router migration and image tests pass. No HuggingFace credential/live media request. |
| 25 | `dfddcc70e6` | test(usage): lock the claude weekly limits parsing and the 24h dashboard cookie | **TIDAK RELEVANT** | Test-only change: `tests/unit/claude-fable-weekly-limit.test.js`. |
| 26 | `85541650ff` | feat(claude-code): strip the [1m] model marker and drive the auto-compact window | **AMAN** | `open-sse/utils/modelMarkers.js`, `src/sse/handlers/chat.js`, settings route; `tests/unit/model-context-marker.test.js` and Claude settings tests pass. |
| 27 | `91b53837f3` | fix(antigravity): stop sending requestType agent so Google stops 429ing | **PERLU BOUNDARY** | `open-sse/executors/antigravity.js`, `open-sse/translator/request/openai-to-gemini.js`; `tests/translator/bugs-antigravity.test.js` passes. No Google/Antigravity live request. |
| 28 | `fc732a421a` | fix(catalog): scope synced modalities per gateway and declare deepseek vision | **AMAN** | `open-sse/providers/catalogOverride.js`, `src/lib/modelCatalog/sync.js`; `tests/unit/capabilities.test.js` and `model-catalog-scope.test.js` pass. |
| 29 | `3561fb2a40` | feat(i18n): merge the missing Persian literals | **TIDAK RELEVANT** | Locale-only change: `public/i18n/literals/fa.json`; no runtime routing/provider behavior. |
| 30 | `7cec099324` | feat(combos): cursor and claude presets plus bulk edit actions | **AMAN** | `src/lib/comboPresets.js`, presets route, dashboard; `tests/unit/combo-presets.test.js` passes. |
| 31 | `df8157916f` | feat(analytics): add requests mode, provider and model breakdowns, all-time period | **AMAN** | Usage API/repository/dashboard changes; `tests/unit/usage-chart-periods.test.js` passes. |
| 32 | `73cf4b7906` | feat(models): aggregate combo capabilities into the model list | **AMAN** | `open-sse/services/combo.js:98-129`, `src/sse/services/allowedModels.js:389-423`; `tests/unit/combo-capabilities.test.js`, model catalog, and ACL lock pass. |
| 33 | `16045cbb8c` | feat(cli-tools): add pi, omp, crush, forge, smelt and codewhale with a generic card | **AMAN** | Generic settings routes/card plus `tests/unit/cli-tools-generic-settings.test.js`; no range-specific failure identified in the full run. |
| 34 | `059097c0c2` | feat(opencode): cloak decoy tools, normalise muse tool choice, route union alpha | **PERLU BOUNDARY** | `open-sse/executors/opencode.js`; `tests/unit/opencode-free-tool-choice.test.js` and Muse thinking tests pass. Live OpenCode upstream behavior unavailable. |
| 35 | `6f428a2809` | fix(commandcode): declare capabilities, keep images, retry transient streams | **PERLU BOUNDARY** | `open-sse/providers/capabilities.js:1589-1607`, Command Code executor/translators; commandcode executor, capability, image, and thinking tests pass. No Command Code credential/live stream. |
| 36 | `bc260d03c5` | fix(kiro): use a neutral placeholder for tool-result-only turns | **AMAN** | Kiro translator/canonicalization tests pass, including `tests/unit/kiro-conversation-canonicalization.test.js` and `tests/unit/openai-to-kiro.test.js`. |
| 37 | `a03219598a` | fix(qoder): treat code 110 as billing, surface first-frame errors, stop proxy replay | **PERLU BOUNDARY** | `open-sse/executors/qoder.js:245-300` and `sseToJsonHandler.js`; `tests/unit/qoder.test.js` passes. No Qoder credential/live SSE. |
| 38 | `1b7f374d70` | fix(models): keep the error detail length aligned with the provider probe | **AMAN** | `src/app/api/models/test/ping.js`; no range-specific failure identified in the full run and no range regression identified. |
| 39 | `3d5a814115` | feat(antigravity): track the weekly quota window alongside the per-model rows | **PERLU BOUNDARY** | `open-sse/services/usage/antigravity-weekly.js`, Google usage integration; `tests/unit/antigravity-weekly-quota.test.js` and usage-header/quota tests pass. No live Google quota response. |
| 40 | `0b5ac20935` | fix(capabilities): codebuddy-intl and opencode-go glm ids declare their own thinking shape | **AMAN** | `open-sse/providers/capabilities.js`, `thinkingLevels.js`; capability tests pass. |
| 41 | `f7a21664ba` | feat(qoder): escalate the declared context tier for long prompts | **PERLU BOUNDARY** | `open-sse/shared/qoder/contextTier.js`, `open-sse/executors/qoder.js:168-230`; `tests/unit/qoder-context-tier.test.js` passes. Live Qoder model-config/context behavior unavailable. |
| 42 | `e9d94fb739` | fix(opencode-go): resolve thinking-suffixed ids and keep responses-only models on /responses | **PERLU BOUNDARY** | `open-sse/config/providerModels.js`, `open-sse/executors/opencode-go.js`; `tests/unit/opencode-go-models.test.js` passes. No live OpenCode Go request. |

## Verified findings, ranked

### Blocker

None verified in this range.

### High

None verified in this range. The required ACL lock passed: **7 files, 134 tests**.

### Medium

1. **The body ceiling is not a streaming memory ceiling.** `src/sse/utils/boundedBody.js:16-24` calls `await request.text()` before `Buffer.byteLength(raw)`. This rejects before `JSON.parse` and before downstream work, but an oversized raw body is already fully buffered. The implementation therefore proves a parse/allocation guard, not protection against memory pressure from an attacker-controlled body. A true transport-level ceiling needs a `Content-Length` precheck plus bounded `ReadableStream` reading. No source change made in this audit.
2. **External-provider behavior remains unverified.** Cursor, Antigravity, OpenCode, Qoder, Command Code, TokenRouter, HuggingFace, and self-hosted provider commits have local tests, but no live credentials/endpoints were available. This is a verification boundary, not a proven regression.

### Low

1. **Line-ending/reviewability debt.** `open-sse/services/accountFallback.js`, `open-sse/rtk/index.js`, and `src/mitm/server.js` contain large CRLF/mixed-EOL rewrites relative to the range. `cli/hooks/trayRuntime.js` is dirty but byte-identical to `HEAD` (`cmp -s` exit 0). The range also has trailing whitespace from `git diff --check` at `open-sse/utils/streamHelpers.js:70,83-84`, `src/app/api/v1/api/chat/route.js:27`, `src/app/api/v1/responses/route.js:26`, and `src/mitm/server.js:99,102`. No functional failure was proven from the EOL churn.
2. **Antigravity signature-store item is absent, not fixed by this range.** No tracked `thoughtSignatureStore` file/path exists. The local Antigravity commits cover `requestType` and schema scrubbing/quota display; they do not establish signature persistence. Do not claim the upstream signature lifecycle as implemented.
3. **Command Code quota tracking is absent.** The provider/executor/capability changes exist, but no Command Code-specific quota tracker was found. Capability metadata and retry behavior do not prove quota accounting.

## Custom-surface checks

- VansAI branding preserved: `src/app/layout.js:20` retains `title: "VansAI - AI Infrastructure Management"`; `src/dashboardGuard.js:313` retains VansAI wording.
- Docker persistent volume preserved: `docker-compose.yml:15,51-52` retains `9router-data`.
- SearXNG fallback preserved: `open-sse/config/runtimeConfig.js:47` retains `http://127.0.0.1:8888/search`.
- MITM remains present; Antigravity scrubber updates `content-length` when the body changes (`src/mitm/server.js:169-176`).
- ACL path remains present: `src/sse/handlers/chat.js:137,151,263,271-272`, `src/sse/services/auth.js:454,475,489`, `src/sse/services/allowedModels.js:749`.
- Zed auth/catalog helper remains present and unchanged in the range: `open-sse/shared/zedAuth.js:59-98,254-319,356-412`.
- No `qoder-cn` registry was found. This audit does not claim Qoder China support.

## Tests and lint — raw results

### ACL regression lock

Command:

```text
npx vitest run -c tests/vitest.config.js tests/unit/post-merge-verification.test.js tests/unit/handler-acl-enforcement.test.js tests/unit/apikey-acl-security.test.js tests/unit/acl-provider-list.test.js tests/unit/models-acl-robustness.test.js tests/unit/acl-custom-prefix.test.js tests/unit/translator-custom-prefix.test.js
```

Result:

```text
Test Files  7 passed (7)
Tests  134 passed (134)
Duration 2.73s
```

### Required lint

Command:

```text
node scripts/lint-undef.cjs && node scripts/lint-reacthooks.cjs
```

Result:

```text
no-undef lint: clean
react-hooks lint: clean
```

### Full suite

Command:

```text
npx vitest run -c tests/vitest.config.js
```

Result:

```text
Test Files 1 failed | 299 passed | 13 skipped (313)
Tests 1 failed | 3485 passed | 82 skipped (3568)
Command failed with exit code 1.
```

Only failure:

```text
FAIL tests/unit/deploy-atomic.test.js > atomic deployment artifact > activates a complete release with one symlink replacement
AssertionError: expected '/var/lib/9router/releases/2026-09-22T…' to be null
at tests/unit/deploy-atomic.test.js:62:33
```

Scope proof for that failure:

```text
git diff --quiet origin/main..HEAD -- tests/unit/deploy-atomic.test.js scripts/deploy-atomic.cjs
exit 0
```

Thus the failing test files are unchanged across the audited range. Reported as a full-suite failure; not attributed to a local-ahead commit.

The full suite skipped 13 optional/live groups, including real Antigravity, real provider, cloud embeddings, RTK multi-provider/e2e, NVIDIA thinking, file-base64 survey, and smoke-provider groups.

### Diff hygiene

Command: `git diff --check origin/main..HEAD`

Result: exit `2`, trailing whitespace at:

```text
open-sse/utils/streamHelpers.js:70,83,84
src/app/api/v1/api/chat/route.js:27
src/app/api/v1/responses/route.js:26
src/mitm/server.js:99,102
```

## Could not verify externally

No live credentials or authorized end-to-end environments were available for Cursor, Antigravity, Qoder, OpenCode/OpenCode Go/Zen, Command Code, HuggingFace, TokenRouter, or self-hosted provider endpoints. No claims of successful upstream calls are made. Optional/live tests were skipped by the repository test configuration as shown above.

## Working-tree note

Pre-existing dirty/untracked items were not touched:

```text
 M cli/hooks/trayRuntime.js
?? .docs/audit/antigravity-regression-since-0.91.22-2026-09-22.md
?? .docs/audit/implement-pending-queue-2026-09-22.md
?? .docs/audit/upstream-83af3f18-triage-2026-09-22.md
?? .docs/audit/upstream-commits-after-73cb89143-2026-09-22.md
?? .docs/audit/upstream-sync-status-2026-09-22.md
?? .docs/audit/upstream-v0.5.81-triage-2026-09-22.md
?? tests/unit/scratch-optional-probe.test.js
```

This audit adds only `.docs/audit/local-changes-audit-2026-09-22.md`.

## Conclusion

No verified `MERUSAK` commit in `origin/main..HEAD`. Local ACL and lint gates pass. Full suite remains red on one deploy-atomic test outside the audited range. Main actionable verified issue: request-body handling measures only after full `request.text()` buffering; provider-specific end-to-end behavior remains a boundary, not evidence of failure.
