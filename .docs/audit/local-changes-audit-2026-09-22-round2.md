# Local changes audit — round 2

## 1. Scope and method

- Repository: `/home/bevan/code/9router`.
- Base: `origin/main` (`7f42ef4267af32f1374c83538723e1aa6e4c1259`).
- HEAD: `fee6712fcf1fb9fad023f8b345e66c2956c055c6`.
- `git merge-base --is-ancestor origin/main HEAD`: `OK`.
- Ahead count: `58` commits, not 61. `git log --oneline origin/main..HEAD | wc -l`: `58`.
- Range size: `195 files changed, 15634 insertions, 4128 deletions`.
- Working tree: four paths reported dirty; `cli/hooks/trayRuntime.js` is byte-identical to HEAD (`cmp` exit 0) and excluded.
- Uncommitted semantic diff: `errorConfig.js`, `chatCore.js`, `accountFallback.js`; line-ending noise dominates the ordinary diff.
- Commands used: `git status --short --branch`; `git log --oneline origin/main..HEAD`; `git diff --stat origin/main..HEAD`; `git diff -w`; `git show`; `grep`; `cmp`; `curl`; `npx vitest run -c tests/vitest.config.js`.
- Review method: commit subjects/stats first; runtime-risk files read against base; focused source tracing; focused tests; full-suite test.
- No source, existing report, `.env`, Git index, remote, or deployment state was modified.

## 2. Verdict table

| Commit group | Verdict | Evidence |
|---|---|---|
| `f395abcf5`, `2eaeba2d2`, `84da7c8e8`, `235240998` request-body ceilings | AMAN | `tests/unit/request-body-limits.test.js`: 11/11; byte and chunked-body paths exercised. |
| `636d144c2`, `6105a97a3`, `a750c7028`, `059097c0c`, `e9d94fb73`, `b77e2a310` OpenCode identity/routing | AMAN | OpenCode session 10/10, fingerprint 13/13, restore 3/3, model-routing 30/30, tool-choice 14/14. |
| `72bb44107`, `f1f3d9b08`, `3ed19d7e2` provider registry additions | PERLU BOUNDARY | Static registry/capability tests pass; live provider contracts and credentials were not exercised. |
| `50239fb90`, `0b5ac2093`, `fc732a421`, `73cf4b790`, `91816788c` model/capability catalog | AMAN | Capability 9/9, provider-thinking 5/5, combo-capability 20/20; H3 confirms scoped overrides. |
| `c7bdf5b78`, `dde5da4c8`, `bbe6a622a`, `5a267e7d0`, `ac852d932` translator/stream semantics | AMAN | Claude refusal 3/3, finish-reason tests included, abort terminal 4/4, focused suite green. |
| `5d05992e4`, `bc260d03c`, `6f428a280`, `886eb8a52`, `947ad5e59` tool/stream protocol paths | PERLU BOUNDARY | Kiro round-trip 9/9, Cursor protocol 42/42, CommandCode tests pass; live upstream wire behavior unavailable. |
| `eb9211516`, `5720222cb`, `a03219598` auth/account fallback | AMAN | Account 4xx 6/6, health reset 5/5, 429 classification 7/7; no live accounts used. |
| `56f83f1d4`, `91b53837f`, `32c64eb7f`, `c07e78977`, `3d5a81411` Antigravity/MITM | PERLU BOUNDARY | MITM 12/12, weekly quota 22/22, signature family 9/9; Google/IDE live handshake not tested. |
| `d11fde969`, `3b0a6f515`, `b9e95f575`, `dfddcc70e`, `0c018c883` usage/quota/dashboard | AMAN | Ollama usage 11/11, weekly quota 22/22, chart periods 4/4; database tests use temporary DBs. |
| `8e7add7f6`, `3561fb2a4` Persian/i18n | AMAN | H4 source enumeration and locale smoke check; all prior supported locale outputs preserved. |
| `7cec09932`, `d97b8dd6e`, `df8157916` combo/analytics UI | AMAN | Combo capability and chart-period tests pass; browser interaction not run. |
| `16045cbb8` CLI tools and related settings routes | PERLU BOUNDARY | Generic settings tests 256 assertions were included in full suite; desktop installers/live CLI not exercised. |
| `85541650f`, `1b7f374d7`, `f7a21664b`, `b9e95f575` model markers/context/error sizing | AMAN | Relevant model and provider tests pass; upstream quota/large-context behavior remains unverified. |
| `c24b43afe`, `31f40fb35`, `8c4125743` docs/whitespace audit material | TIDAK RELEVANT | Documentation/formatting only; no runtime path. |
| `fee6712fc`, `7898fd78e`, `63d574141` cleanup/test consolidation | TIDAK RELEVANT | Dead-code/test organization changes; no runtime behavior except reviewed imports/exports. |

## 3. Findings ranked by severity

### Blocker

- **None proven in the committed range.** The full suite is not green, but the one failure is `tests/unit/deploy-atomic.test.js:62`, where a live `/var/lib/9router/current` symlink makes the test expect `null` and receive the production release path. Causality was not isolated to this range; do not call the branch fully green.

### High

- **Uncommitted content-filter flag is semantically dead.** `open-sse/utils/error.js:109-116` emits `policyError`; `open-sse/utils/errorLog.js:107-110` checks `error.isPolicyError`. H1 reproduction classified the result as `PROVIDER`, not `POLICY`. The current change therefore does not alter the classifier.
- **Dirty tree is not represented by HEAD.** `open-sse/config/errorConfig.js:61-65`, `open-sse/handlers/chatCore.js:632-633`, and `open-sse/services/accountFallback.js:40` differ from HEAD. A rebuild from HEAD cannot contain these rules; a production rebuild must follow a commit of the intended change.

### Medium

- **No direct live-provider proof.** Registry, translator, MITM, quota, and protocol changes have unit evidence but no authenticated provider/IDE end-to-end evidence. This is a boundary limitation, not a proven regression.
- **Full-suite deployment test is red in this environment.** `tests/unit/deploy-atomic.test.js:62` fails because `readCurrentTarget()` sees `/var/lib/9router/releases/2026-09-22T16-46-33-184Z-2786222`; 302 files pass, 1 fails, 13 skip.
- **Range diff has a pre-existing hygiene signal in touched UI.** `git diff --check origin/main..HEAD` reports trailing whitespace at `src/shared/components/LanguageSwitcher.js:109`; this is not runtime-critical and the commit group is otherwise behaviorally verified.

### Low

- `open-sse/providers/capabilities.js` is 1633 lines and `open-sse/executors/cursor.js` 1300 lines after the range. Neither crossed from below 1000 due to a single audited commit, but these are maintainability ceilings for future changes.
- `LOCALE_NAMES` remains in ignored build artifacts (`.next`/`.next-cli-build`) only; source references are absent. Artifacts should be regenerated/cleaned by the normal build process, not hand-edited.

## 4. H1–H4 answers

### H1 — TERVERIFIKASI: defect confirmed

- `createErrorResult()` parameter is named `policyError` and returned as `policyError` at `open-sse/utils/error.js:109-116`.
- `classifyError()` only reads `error.isPolicyError` at `open-sse/utils/errorLog.js:107-110`.
- Source grep found no call site of `classifyError()` outside its definition; circuit-breaker accepts an injected classifier but does not import this function (`open-sse/utils/circuitBreaker.js:76,169,224`).
- Source grep found no read of `.policyError`; it only finds the writer at `open-sse/utils/error.js:115`.
- Reproduction: `createErrorResult(..., true)` produced `{policyError:true,isPolicyError:undefined}` and `classifyError(...)` returned `PROVIDER`.
- Conclusion: content-filter metadata currently has no observable effect beyond adding an unread field to the returned object.

### H2 — TERVERIFIKASI with boundary qualification: repository drift confirmed; live dirty inclusion not provable from build ID

- `/api/version` at `http://127.0.0.1:3003/api/version` returned `buildId: "7Zjewkc2tR9kx_tWTSRFD"`.
- Worktree hashes differ from HEAD for all three named files; `git diff -w HEAD` shows semantic changes above.
- The active release is `/var/lib/9router/releases/2026-09-22T16-46-33-184Z-2786222`; standalone release has no `open-sse/` source tree, so direct source-file comparison is impossible.
- Search of deployed chunks found no content-filter marker. Therefore the claim that production contains the dirty rules is **not proven** by `/api/version`; the verified fact is repo/worktree drift plus a live build identity.
- Fix: commit the intended dirty changes, run the standard build/deploy flow, verify `/api/version` and a smoke request. A commit alone does not rebuild production; a rebuild without a commit leaves source provenance unclear.

### H3 — TERVERIFIKASI: cleanup claim confirmed

- `getCapabilitiesForModel()` checks provider-specific exact entries first at `open-sse/providers/capabilities.js:1609-1616`, then canonical exact at `1618-1622`, then patterns at `1624-1629`; provider entries are merged only with defaults, not with another provider/model entry.
- The model-level entry at `open-sse/providers/capabilities.js:286-292` supplies DeepSeek-native format, 1M context, and 384K output.
- `codebuddy-cn` at `686-693` supplies OpenAI format, `thinkingCanDisable:false`, 1M context, 128K output.
- `codebuddy-intl` at `707-714` supplies OpenAI format, `thinkingCanDisable:true`, 1M context, 128K output.
- `deepseek` at `756-763` supplies native format plus `thinkingEffortSupported:true` and 128K output.
- `ollama` at `767-773` is a different model key (`deepseek-v4.1-flash:cloud`) and supplies 384K output.
- These are distinct provider scopes, model keys, formats, and/or capability deltas; none is a duplicate removable by provider-independent deduplication.

### H4 — TERVERIFIKASI: supported-locale behavior preserved; intentional `fa` addition confirmed

- `git show 8e7add7f6^:src/i18n/config.js` enumerates 33 previously supported locale values; only `zh` is an alias to `zh-CN`.
- Current `src/i18n/config.js:1,5-14` preserves all 33 identity outputs and `zh -> zh-CN`; direct smoke output reported `mismatches:[]`, `zh:"zh-CN"`, `invalid:"en"`.
- `fa` is intentionally new at `src/i18n/config.js:1`; current normalization returns `fa`. This is a requested feature change, not a regression against prior supported locales.
- `LOCALE_NAMES` was private and had no source references. `src/shared/components/LanguageSwitcher.js:18-55` owns the display map and now includes `fa` at line 45.

## 5. Test evidence

- `npx vitest run -c tests/vitest.config.js tests/unit/account-fallback-4xx.test.js tests/unit/request-body-limits.test.js tests/unit/capabilities.test.js tests/unit/provider-thinking-config.test.js tests/unit/claude-refusal-stream.test.js tests/unit/responses-abort-terminal.test.js tests/translator/kiro-tool-name-roundtrip.test.js tests/unit/opencode-go-models.test.js tests/unit/opencode-free-tool-choice.test.js tests/unit/opencode-muse-spark-thinking.test.js tests/unit/antigravity-mitm.test.js tests/unit/model-catalog-scope.test.js tests/unit/combo-capabilities.test.js tests/unit/usage-chart-periods.test.js` — **14 files passed, 141 tests passed**.
- `npx vitest run -c tests/vitest.config.js tests/unit/claude-settings-route.test.js tests/unit/connections-health-reset.test.js tests/unit/mark-account-unavailable-429.test.js tests/unit/cursor-default-model.test.js tests/unit/cursor-agent-proto.test.js tests/unit/opencode-session.test.js tests/unit/opencode-fingerprint.test.js tests/translator/opencode-fingerprint-restore.test.js tests/unit/huggingface-image-end-to-end.test.js tests/unit/huggingface-router-migration.test.js tests/unit/ollama-usage.test.js tests/unit/antigravity-weekly-quota.test.js tests/unit/antigravity-thought-signature-family.test.js` — **13 files passed, 157 tests passed**.
- Combined focused result: **27 files passed, 298 tests passed**.
- `npx vitest run -c tests/vitest.config.js` — **302 files passed, 1 failed, 13 skipped; 3499 passed, 82 skipped**. Failure: `tests/unit/deploy-atomic.test.js:62`, expected null current target but observed the active release symlink.
- `node --input-type=module` locale smoke command — **exit 0**, `mismatches:[]`, `localeCount:34`, `oldSupportedCount:33`.
- `node --input-type=module` H1 reproduction using `open-sse/utils/error.js` and `errorLog.js` — **exit 0**, classified content-filter result as `PROVIDER`.
- `curl -sS --max-time 5 http://127.0.0.1:3003/api/version` — **exit 0**, returned build ID above.
- `git diff --check origin/main..HEAD` — **exit 2**, one trailing-whitespace report at `src/shared/components/LanguageSwitcher.js:109`.
- `cmp -s cli/hooks/trayRuntime.js <(git show HEAD:cli/hooks/trayRuntime.js)` — **exit 0**.

## 6. Fork custom logic and unverified scope

- ACL per API key remains intact: checks in `src/sse/handlers/chat.js:136-150,262-268`; helper contracts in `src/sse/services/auth.js:422-491`; model filtering in `src/app/api/v1/models/route.js:1-4` and `src/sse/services/allowedModels.js`.
- The range touches `chat.js`, `auth.js`, and `allowedModels.js` for body limits, error-detail length, and combo capability metadata; no ACL removal was observed in their range diffs.
- ZCode remains registered and executable: `open-sse/providers/registry/zcode.js`, `open-sse/executors/zcode.js`, and OAuth wiring in `src/lib/oauth/providers.js:1313+`.
- VansAI branding remains in `src/app/layout.js:20` and `src/dashboardGuard.js:313`; no range diff touches either file.
- Searxng fallback remains `SEARXNG_URL` at `open-sse/config/runtimeConfig.js:47` and registry consumption in `open-sse/providers/registry/searxng.js`; only unrelated HTTP status constants changed in the range.
- Docker persistent volume remains `9router-data` at `docker-compose.yml:15,50-52`; no range diff touches the file.
- `src/mitm/` remains present, including `server.js`, handlers, cert code, and `scrubSchemaKeywords.cjs`; MITM focused tests passed.
- Not verified: authenticated live provider calls; Claude/Kiro/Cursor/Antigravity/OpenCode production handshakes; external quota reset semantics; real API-key ACL behavior against production data; browser visual flows; Docker deployment; PM2/Nginx behavior; production database migration state.

## Appendix: audit inventory and boundary notes

- The first twelve commits are the newer cleanup queue; the remaining commits belong to the earlier queue according to their subjects and ordering. The repository itself reports 58 ahead commits, so the requested count of 61 was not reproducible.
- Largest runtime-risk diffs by committed additions included `16045cbb8` (+1606/-1), `3d5a81411` (+532/-6), `3ed19d7e2` (+546/-1), `a03219598` (+700/-504), and `2eaeba2d2` (+728/-707). These received source/test sampling rather than blind approval.
- `git diff --stat origin/main..HEAD` includes nine audit documents and many tests; documentation volume does not imply equivalent production-code risk.
- `git diff -w` reduced the three dirty semantic files to five added error rules, one imported classifier call, one returned property, and line-ending normalization.
- `cli/hooks/trayRuntime.js` remains dirty only in Git's line-ending view; byte comparison against `git show HEAD:cli/hooks/trayRuntime.js` returned zero.
- `src/i18n/config.js` changed from 146 lines in the parent commit to 14 lines in the current tree; the deleted table was not an exported API.
- The old locale chain had 32 explicit identity branches plus the combined `zh`/`zh-CN` branch; the current lookup covers the same old values through `LOCALES.includes`.
- The new Persian path requires both the locale list and UI switcher map; both are present, and `public/i18n/literals/fa.json` exists in the range.
- `getCapabilitiesForModel` strips a vendor prefix before provider lookup, making the provider-specific key selection behavior material for H3.
- Provider capability objects are shallow-merged with defaults only. They do not inherit missing fields from a model-level object or another provider's object.
- That lookup rule explains why apparently similar DeepSeek entries intentionally repeat context, output, vision, and reasoning fields.
- The Ollama key includes `:cloud`; it is not the same registry ID as the DeepSeek API key.
- ACL range changes were additive: body-size propagation in chat and capability metadata in model listing; no allowed-list predicate was removed.
- `src/app/api/v1/models/route.js` had no range diff, strengthening the ACL-preservation conclusion.
- `docker-compose.yml` had no range diff; `9router-data` is still an explicit named volume, satisfying the persistent-volume safety check.
- The active local server made `/api/version` reachable on port 3003 and reported version 0.91.22. Port 3000 had no listener.
- The active standalone artifact stores compiled Next chunks, not the `open-sse/` source tree; source-file equality against production therefore cannot be inferred from filesystem paths.
- No dirty content-filter marker was found in the active compiled release search, so production inclusion remains unproven rather than asserted.
- The full-suite failure is environment-sensitive: the deployment test's fixture assumes no existing current symlink, while this host has one. It still prevents a green full-suite claim.
- Focused tests did not exercise the exact dirty H1 field contract; the direct reproduction did, and it proves the naming mismatch independently of test coverage.
- No credentials were read. `.env` was not opened or altered.
- No provider request was sent by the audit. All focused tests used mocks, fixtures, temporary databases, or local pure functions.
- No deploy command, PM2 mutation, symlink switch, Docker command, or network mutation was run.
- Recommended boundary sequence: correct the flag contract; add a focused regression test; commit; rebuild; verify build ID; run authenticated smoke calls; rerun the suite in an isolated deployment-test environment.
- Until that sequence completes, the proper status is review evidence collected, not production approval.

Overall disposition: **not fully green; no proven committed-range blocker; merge/deploy boundary remains blocked by the dead H1 flag and by the uncommitted source drift until the intended contract is corrected, committed, rebuilt, and smoke-tested.**
