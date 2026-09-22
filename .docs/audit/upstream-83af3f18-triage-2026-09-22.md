# Upstream triage — 83af3f18 (v0.5.75) → tip (v0.5.85), 2026-09-22

Read-only triage for VansRouter. No source file changed.

## Range audited

- Start commit: `83af3f1853b295eda428f3d3d8f5ff96ca25bfab` — "# v0.5.75 (2026-09-10)", **upstream-only**
  (`git merge-base --is-ancestor 83af3f18 main` → false).
- Tip at audit time: `21583c03e` — "# v0.5.85 (2026-09-22)" (`upstream/master`).
- Distance: **70 commits** (`git rev-list --count 83af3f18..upstream/master`).
- Tags inside the range (verified with `git tag --contains 83af3f18`):
  `v0.5.75` = `83af3f185` · `v0.5.79` = `8e15f0bdd` · `v0.5.81` = `a8c9d3802` · `v0.5.85` = `21583c03e`.
- v0.5.81 is **not** re-audited here: see `.docs/audit/upstream-v0.5.81-triage-2026-09-22.md`. Only its delta
  (changes upstream added to that entry after release) is listed below.

Decision values: ADOPT · SKIP · HYBRID · UNVERIFIED (same definitions as the v0.5.81 report).

## v0.5.75 — triage

| # | Change | Decision | Citation | Reason / boundary | Files in our fork | Risk |
|---|---|---|---|---|---|---|
| 1 | Video: OpenRouter + Vertex (Veo) on `/v1/videos/*` via a provider adapter layer; poll resolves provider from `x-connection-id`/`?provider=` | HYBRID | `v0.5.75` changelog; upstream `open-sse/providers/registry/` video entries | A new adapter layer is the largest single item in the range; adopt per-provider only when a user actually requests that provider (YAGNI otherwise) | `src/app/api/v1/videos/**`, `open-sse/executors/**` | Medium — new surface next to our own route handlers |
| 2 | Antigravity: weekly quota tracking + free-tier handling | SKIP | `v0.5.75` changelog (#3892) | Our Antigravity integration is fork-modified (fingerprint/version); upstream refactors regress it | — | High |
| 3 | Codex: GPT Image 2.5 / Flare / Sunburst image models + multi-image; same ids in OpenAI catalog | ADOPT | upstream `open-sse/providers/registry/codex.js`, `openai*` catalog | Registry/catalog data only | `open-sse/providers/registry/codex.js`, capabilities | Low |
| 4 | Qoder: usage to all clients, image upload via `/api/v2/image/upload`, stubs for oversized blocks | UNVERIFIED | `v0.5.75` changelog | Not established whether this fork ships the Qoder provider at all | `open-sse/providers/registry/**` | Unknown |
| 5 | OpenCode Go: new models (glm-5.3, kimi-k3, deepseek-flash, longcat-2.0, hy4-preview, hy3; qwen3.8-* on `/messages`; grok-4.6/gpt-5.6-luna on Responses) | ADOPT | upstream `open-sse/providers/registry/opencode-go.js` | Registry list data; our file already lists part of this | `open-sse/providers/registry/opencode-go.js` | Low |
| 6 | CLI tools: group model selector by provider + full-text search + manual model id | HYBRID | upstream `src/shared/components/ModelSelectModal.js` | UI is fork-customised; our picker already gained a capability filter — take only the grouping if wanted | `src/shared/components/ModelSelectModal.js` | Low |
| 7 | CodeBuddy-CN: `deepseek-v4-flash` → `deepseek-v4.1-flash` | ADOPT | `5c399b640` | One-line registry/catalog swap | `open-sse/providers/registry/codebuddy-cn.js` | Low |
| 8 | Tools: scope Claude tool-type defaulting to gateways declaring `requireClaudeToolType` | SKIP (already present) | our `open-sse/translator/concerns/toolCall.js:269` already reads `PROVIDERS?.[provider]?.quirks?.requireClaudeToolType` | Upstream fix is the same rule we already apply | — | None |
| 9 | Claude: cap re-anchored `cache_control` at the 4-marker budget; wrap bare single-object content turns | ADOPT | `v0.5.75` changelog | Prevents 400s that otherwise trigger full combo failover | `open-sse/translator/**` | Low–Medium |
| 10 | Cline/ClinePass: envelope unwrap + live catalog; stop `workos:` prefixing keys; token refresh | SKIP (already done) | our `6c433d9e5` (v0.91.22) and upstream `122f23eebc` | Issue #123 was already fixed here; catalog drift is a separate optional item | — | None |
| 11 | Kiro: never send top-level `systemPrompt`; route through current runtime surfaces | ADOPT | `v0.5.75` changelog (#3776) | Prevents `400 REQUEST_BODY_INVALID`; Kiro path is fork-tested | `open-sse/translator/**`, kiro runtime files | Low |
| 12 | Codex: strip Unicode-property tool schema patterns; restore `Version` header | ADOPT | `v0.5.75` changelog (#3922) | Validator compatibility | `open-sse/executors/codex.js` | Low |
| 13 | DeepSeek: keep Anthropic-only tool types when forwarding to `/anthropic/v1/messages` | ADOPT | `v0.5.75` changelog | Translator correctness | `open-sse/translator/**` | Low |
| 14 | Qoder: drop Responses usage plumbing from shared handler code | SKIP | `v0.5.75` changelog | It touches shared accounting; we never adopted the Qoder-side plumbing it removes | — | Medium |
| 15 | Providers: clear stale health state (`modelLock_*`, `backoffLevel`, `rateLimitedUntil`, `errorCode`) on re-validation; drop duplicate `qwen` provider | HYBRID | `v0.5.75` changelog (#3810, #3830) | The state keys live in our custom auth/fallback path — port the clearing rule, not the diff | `src/sse/services/auth.js`, `open-sse/services/accountFallback*` | High if applied as-is |
| 16 | Video/Vertex: reject job ids and model ids that would escape the request URL path (SSRF) | ADOPT | `v0.5.75` changelog | Security guard at a trust boundary — never simplified away | video routes/executors | Low |
| 17 | Usage: parse Fable weekly limit from `limits[]` instead of fabricating a row; 24h dashboard cookie `maxAge` | HYBRID | `v0.5.75` changelog (#3847) | Usage row is display-only (adopt); the cookie belongs to `dashboardGuard` which is fork-custom | `src/app/(dashboard)/**`, `src/dashboardGuard.js` | Medium |

## v0.5.79 — triage

| # | Change | Decision | Citation | Reason / boundary | Files in our fork | Risk |
|---|---|---|---|---|---|---|
| 18 | OpenCode/Go: 403 `FreeTierError` + 429 fixes (canonical session, UA, stable reuse), `forceStream` | SKIP (already adopted) | `6091ff597`, `93837af09`, `0c6ab4f99`, `058ceace4` | Our tree already carries the canonical-id translation, UA gate and `forceStream`; remaining upstream extras are covered in the v0.5.81 report | `open-sse/executors/opencode.js` | None |
| 19 | OpenCode: normalize Muse Free tool choice; strip prior reasoning items on Responses models | HYBRID | `aa14ef72e`, `eafac37dc` | Model-specific shape fixes — adopt only with a report naming the failing model | `open-sse/executors/opencode.js` | Medium (shared tool-shape logic) |
| 20 | OpenCode Go: route every responses-only model (incl. thinking variants) to `/responses`; route Union Alpha via Messages API | HYBRID | `702b57c30`, `2b65c49ff` | Same rule as above: adopt per failing model, not wholesale | registry + executor | Medium |
| 21 | Kiro: preserve underscores in tool names, restore sanitized names, neutral placeholder, forward tool-result images | ADOPT | `c49efdf52`, `82b1bca42`, `f4f06f290` | Translator fixes with existing local test coverage | `open-sse/translator/**` | Low |
| 22 | Stream: report aborts after HTTP 200 in-band instead of closing silently | ADOPT | `930012136` | Generic handler behaviour | `open-sse/handlers/**` | Low |
| 23 | Models: DeepSeek-V4.1-Flash (DeepSeek, CodeBuddy-Intl, Ollama) + `low..max` effort + vision caps | ADOPT | `367fc546d`, `5c399b640` | Registry/capability data only | `open-sse/providers/registry/{deepseek,codebuddy-intl,ollama*}.js`, `capabilities.js` | Low |
| 24 | Model catalog: scope synced catalog to gateways; declare vision for DeepSeek V4.1-Flash ids | HYBRID | `912ed295d` | Capability data is ADOPT; gateway scoping touches shared catalog logic | `open-sse/services/**catalog**`, `capabilities.js` | Medium |
| 25 | Claude Code: 1M-context toggle (`[1m]`) + `CLAUDE_CODE_AUTO_COMPACT_WINDOW` from dashboard | HYBRID | `17c4cc768` | Marker handling is small; the dashboard control lives in fork-customised CLI-tools pages | `open-sse/**`, `src/app/(dashboard)/dashboard/cli-tools/**` | Low |
| 26 | i18n: Persian (fa) | ADOPT | `725e2c118` | Additive locale bundle | `public/i18n/**` | Low (check branding strings) |
| 27 | Command Code: images/`reasoning_effort`, transient-stream retry, no fake stop chunks | UNVERIFIED | `13b468b88`, `092c84eac` | Provider presence in this fork not established | `open-sse/providers/registry/**` | Unknown |
| 28 | Zed: harden OAuth lifecycle, live model resolution, lower display priority | HYBRID | `ef1817522`, `4641c2b76` | Only if Zed is used here; OAuth file is shared | `src/lib/oauth/providers.js`, `registry/zed.js` | Medium |
| 29 | Antigravity: thought signatures per model family, strip Claude Code billing headers, Hermes identity | SKIP | `bc3be0cb2`, `b3d6e089c`, `f64229530` | Fork-modified integration | — | High |
| 30 | Codex: route bare `codex-auto-review` to the Codex provider | ADOPT | `efc80ba2e` | One-line routing fix | codex model resolution | Low |
| 31 | Auth: do not cool down an account for request-scoped 4xx | HYBRID | `20a43f5a2` | Rule is right; the file is our custom auth/ACL path — port the rule, not the patch | `src/sse/services/auth.js` | High if applied as-is |
| 32 | Usage: DeepSeek credit balance as currency credit | ADOPT | `3ac100d52` | Display-only | dashboard usage page | Low |

## v0.5.81 — reference + delta only

Full triage: `.docs/audit/upstream-v0.5.81-triage-2026-09-22.md` (15 rows: Xiaomi MiMo, Claude Code 1M, DeepSeek models,
fa i18n, OpenCode/Go, OpenCode extras, Kiro, stream abort, Command Code, Zed, Antigravity, Codex, auth cooldown,
DeepSeek usage, catalog scoping). **Not repeated here.**

Delta added to that release entry after the tag was cut (visible in `v0.5.85:CHANGELOG.md`, absent from
`v0.5.81:CHANGELOG.md`):

| # | Change | Decision | Citation | Reason | Files in our fork | Risk |
|---|---|---|---|---|---|---|
| 33 | Cursor: stop AgentService empty turns (`OUT 0`) and silent hangs — fold system prompts instead of `custom_system_prompt`, send `ModelDetails`, read Composer/Grok `thinking_delta`, ack request-context without echoing MCP tools, reject IDE execs | HYBRID | `v0.5.85:CHANGELOG.md` v0.5.81 section (entry amended upstream after release) | This is the closest upstream work to our open issue #131 (Cursor returns no tokens). Our executor is a fork-ahead variant (MCP tool encoding), so take the specific behaviours only — start with the empty-turn/hang handling, keep our `encodeMcpTools` path | `open-sse/executors/cursor.js`, `open-sse/utils/cursorProtobuf.js` | Medium — our cursor file already diverges from upstream |
| 34 | RTK: for Cursor, compress source-format `tool_result` / `role:tool` **before** translation (other providers keep the post-translate pass) | ADOPT | same changelog section | Pre-translate pass is a small hook; our RTK already runs at `chatCore` with a size parameter | `open-sse/rtk/index.js`, cursor translator path | Low–Medium |

## v0.5.85 — triage

| # | Change | Decision | Citation | Reason / boundary | Files in our fork | Risk |
|---|---|---|---|---|---|---|
| 35 | **OpenCode Zen (`opencode-zen`) provider with free-tier fingerprint** | ADOPT | `v0.5.85:CHANGELOG.md` | Directly fills the gap behind our open issue #121 ("OpenCode Zen missing from API provider list") — and we already built the canonical-session/UA plumbing it needs | `open-sse/providers/registry/opencode-zen.js`, executor, `src/shared/constants/providers.js` | Low–Medium (new provider entry; no ACL change) |
| 36 | Model capabilities exposed on `/v1/models` + aggregated across combo targets | HYBRID | `v0.5.85:CHANGELOG.md` | The metadata part is additive, but `/v1/models` is ACL-critical in this fork (per-key `isKindAllowed`) — extend, never rewrite | `src/app/api/v1/models/route.js`, `open-sse/providers/capabilities.js` | Medium–High |
| 37 | Combos: Cursor/Claude Default presets; bulk select/delete; bulk strategy change | HYBRID | `v0.5.85:CHANGELOG.md` | UI-only, but our combo page already carries custom vision warnings and layouts | `src/app/(dashboard)/dashboard/combos/page.js` | Low |
| 38 | System One: `/v1/systemone` decision endpoint + sidebar/Media Providers wiring | SKIP | `v0.5.85:CHANGELOG.md` | Niche endpoint, new surface, no user request — YAGNI | — | Medium |
| 39 | Qoder CN provider (`qoder-cn`, OAuth, COSY protocol) | UNVERIFIED | `v0.5.85:CHANGELOG.md` | Same open question as #4/#27: does this fork ship Qoder at all | — | Unknown |
| 40 | Analytics: Requests mode, provider/model breakdown, All Time filter | HYBRID | `v0.5.85:CHANGELOG.md` | Dashboard-only; adopt charts without touching our custom usage plumbing | `src/app/(dashboard)/dashboard/usage/**` | Low |
| 41 | HF: migrate to Inference Providers router (`router.huggingface.co`), expand image catalog, add STT route | ADOPT | `v0.5.85:CHANGELOG.md`, upstream `open-sse/providers/registry/huggingface.js` | Registry baseUrl/catalog change | `open-sse/providers/registry/huggingface.js` | Low |
| 42 | Responses API: report usage on `response.completed` (client auto-compact) | ADOPT | `v0.5.85:CHANGELOG.md` (#3432) | Generic handler fix; clients depend on it | `open-sse/handlers/**` | Low |
| 43 | Translator: map Claude `refusal` → `content_filter` with explanation | ADOPT | `v0.5.85:CHANGELOG.md` | Small, testable translation fix | `open-sse/translator/response/**` | Low |
| 44 | Translator: strip replayed reasoning fields for Groq, Mistral, Cerebras | ADOPT | `v0.5.85:CHANGELOG.md` (#4220) | Prevents provider 400s | `open-sse/translator/request/**` | Low |
| 45 | Antigravity: drop requestType `agent`; split weekly vs 5-hour quotas, dedupe dashboard rows | SKIP | `v0.5.85:CHANGELOG.md` | Fork-modified integration (same reason as #2/#29) | — | High |
| 46 | Qoder: prevent signed request replay, handle billing blocks, preserve SSE error status | UNVERIFIED | `v0.5.85:CHANGELOG.md` | Depends on #39 | — | Unknown |
| 47 | Performance: bound usage `lastUsed` scan to a 2-day window; map large budgets to `max` reasoning tier | ADOPT | `v0.5.85:CHANGELOG.md` | Small perf/correctness win | `open-sse/services/usage*`, capabilities | Low |
| 48 | Docker: publish verified multi-platform images | SKIP | `v0.5.85:CHANGELOG.md` | Our fork deploys with `scripts/deploy-atomic.cjs`, not upstream's image flow | — | None |
| 49 | CLI Tools: dynamic configuration, settings APIs, official logos (Pi, OMP, Crush, ForgeCode, Smelt, CodeWhale) | HYBRID | `v0.5.85:CHANGELOG.md` | UI additions; our CLI-tools pages are customised | `src/app/(dashboard)/dashboard/cli-tools/**` | Low |

## Executive summary — do first (ranked by value ÷ risk)

| Rank | Item | Target files | Tests that must pass | Expected diff |
|---|---|---|---|---|
| 1 | #35 `opencode-zen` provider (closes the open half of issue #121) | `open-sse/providers/registry/opencode-zen.js`, executor, providers constants | `tests/translator/golden-url-header.test.js`, `tests/unit/opencode*.test.js` | small–medium (new registry entry + registration) |
| 2 | #42 Responses `usage` on `response.completed` | `open-sse/handlers/**` | `tests/unit/`, translator suites | small |
| 3 | #43 + #44 translator fixes (`refusal` mapping, reasoning strip) | `open-sse/translator/{request,response}/**` | `tests/translator/` | small |
| 4 | #33 + #34 Cursor delta (empty-turn handling + pre-translate RTK) — the only concrete lead for open issue #131 | `open-sse/executors/cursor.js`, `open-sse/rtk/index.js` | `tests/unit/cursor-*.test.js`, `tests/unit/rtk.test.js` | medium (cursor file diverges from upstream) |
| 5 | #21 + #22 Kiro + stream-abort fixes | `open-sse/translator/**`, `open-sse/handlers/**` | `tests/unit/rtkKiro.test.js`, `tests/translator/` | small |
| 6 | #23 + #41 registry data (DeepSeek-V4.1-Flash, HF router) | registry + capabilities | `tests/translator/golden-url-header.test.js` | trivial |
| 7 | #47 usage scan bound | `open-sse/services/usage*` | `tests/unit/` usage suites | small |

Ordering rationale: registry/data and translator fixes first (lowest blast radius, existing tests), UI and
ACL-adjacent items (#36, #37, #49) later, fork-modified integrations (#2, #29, #45) never as-is.

## UNVERIFIED

| Item | What would prove it |
|---|---|
| #4, #39, #46 Qoder presence and behaviour | `ls open-sse/providers/registry \| grep -i qoder` + executor check in this tree |
| #27 Command Code presence | same, `grep -i commandcode` |
| #1 video path usability here | whether any connection uses OpenRouter/Veo, plus our `/v1/videos` handler parity |
| #35 `opencode-zen` fingerprint specifics | a live free-tier request from an allowed client |
| v0.5.85 item SHAs | Per-item commit mapping was not collected for v0.5.85 (citations there are changelog + upstream file paths); a `git log --grep` pass per item would add SHAs |
| #33/#34 Cursor delta effect | Cursor credentials + a captured `[STREAM]` log (same blocker as issue #131) |

## Safety re-audit of the 21 ADOPT rows (independent check)

Two independent read-only audits were run against the ADOPT rows. The second pass (different reviewer) falsified the
first pass in the opposite direction — the first was over-strict — so the reconciled verdict below is the operative one.

**Reconciled verdict**

| Verdict | Items | Decisive evidence |
|---|---|---|
| **ADOPT (in-range work, small port)** | **#30** bare `codex-auto-review` routing · **#34** Cursor RTK pre-translate · **#35** `opencode-zen` (PAYG-sized first) · **#41** HF router (2-file port) | #30: `git grep -n codex-auto-review main` → 0 hits; upstream `efc80ba2e` = `codex.js` +3 / `model.js` +2. #34: `git grep -n preTranslateRtk main` → 0 hits; `compressMessages` is called once on `translatedBody` (`chatCore.js:308`) and Cursor's translator folds results into `<tool_result>` XML beforehand (`translator/request/openai-to-cursor.js:39-45`) — the first pass had cited a stale comment (`rtk/index.js:2`). #35: registry index is per-file (`providers/registry/index.js:85,234-236`) and provider/ACL lists are derived (`src/shared/constants/providers.js:2`); `isProviderAllowed` is a runtime filter that only bites keys with a non-empty `allowedProviders` (`src/sse/services/auth.js:456-459`) → no ACL edit. #41: `registry/huggingface.js:33` + `handlers/imageProviders/huggingface.js:8` still on the legacy host; the port also revives HF STT, which is unreachable today (no `sttConfig`, `stt.js:78` → `sttCore.js:174-178` returns 400) |
| **SKIP — already present locally, and some stronger** | #3 Codex image models (11 `kind:"image"` entries match; `handlers/imageProviders/codex.js` diff empty; `image-generation.test.js` passes) · #9 Claude cache cap + bare-object wrap (`formats/claude.js:12-19,39-57`; tested at `tests/translator/upstream-claude-deepseek-fixes.test.js:66-80`; upstream commit `8a81085a7` is **pre-base**) · #11 Kiro `systemPrompt` (`claude-to-kiro.js:450-452`, `executors/kiro.js:102`) · #12 Codex schema strip + `Version` header (identical, local keeps an extra array guard) · #13 DeepSeek Anthropic tool types (tested) · #16 Vertex SSRF (**local stronger** — per-segment project/location check from fork commit `af64d4a39`; upstream tip has none, so porting would regress) | Ancestry is the discriminator: every "already present" item is a **pre-base** commit (`git merge-base --is-ancestor <sha> 83af3f18` → true) that the fork already absorbed |
| **NEEDS-BOUNDARY** | #5 OpenCode Go models (must carry local `supportedFormats`/`targetFormat`) · #26 Persian locale (merge keys only; `src/app/layout.js:20` is VansAI-branded) | Local multi-endpoint guard and branding are fork-specific |
| **HYBRID (unchanged from first pass)** | #21, #22, #23, #32, #42, #43, #44, #47 | Translator/stream/usage/thinking code already customised locally; #23 is worse than a swap — the DeepSeek and Ollama registries do **not** carry `deepseek-v4.1-flash` |

Net: the genuinely actionable in-range set is **#30, #34, #35, #41**; the rest is either already absorbed (pre-base
commits) or needs a boundary.

Corrections that matter:

- **#34 was wrongly called "already present"** by the first pass — it is real work (~12 lines: hoist
  `tokenSaverEnabled` above translation in `chatCore.js`, add the Cursor branch, keep the fork's `clientBodyBytes`
  third argument) and, with #33, it is one of only two concrete leads for open issue #131.
- **#30 is missing**, not equivalent — cheapest real win (2 lines).
- **#9 downgraded to SKIP** (present + tested + pre-base), which removes the "translator is customised" objection.
- **#35/#41 are ADOPT-sized**, not sprawling: one registry file + registration lines for Zen; two files for the HF
  router. ACL concerns are runtime filters, not code edits.
- **No contact** for any of these items with `src/sse/handlers/chat.js`, `open-sse/providers/registry/zcode.js`,
  `src/app/layout.js`, `src/dashboardGuard.js`, `docker-compose.yml`, `src/app/api/providers/route.js`;
  `src/app/api/v1/models/route.js` and `src/sse/services/auth.js` are touched only by other items (#36/#39 and #18).

Evidence and coverage gaps:

- Both passes ran on the unmodified tree: `62 passed` (rtk, video-providers, deepseek-usage, codex-tool-normalization)
  and `93 passed` (kiro-request-body-invalid, image-generation, upstream-claude-deepseek-fixes, system-inject,
  rtkKiro) — these prove the *existing* guards hold, not that un-ported items are safe.
- Upstream regression tests absent locally: `codex-auto-review-routing`, `rtk-cursor-pretranslate`,
  `opencode-zen-models`, `huggingface-router-migration`, `huggingface-image-end-to-end`,
  plus `openai-responses-usage-completed`, `claude-refusal-stream`, `thinking-budget-max-level` for the HYBRID set.
- `tests/__baseline__/known-fails.txt:13-21` lists rtk cases that now pass 34/34 — that baseline is stale; do not use
  it to dismiss rtk failures.
- Not verified: live provider behaviour (no credentials), the `opencode-zen` free-tier fingerprint, HF router
  availability, dashboard rendering for #32, and the #47 perf claim.

## Notes

- v0.5.85's changelog file also carries the **amended** v0.5.81 entry — upstream edits past release notes, so
  re-reading the newest tag's changelog is the only way to see late-added bullets (#33, #34 here).
- Ponytail: nothing above needs a new dependency; the ADOPT list is registry data, translator fixes, handler
  correctness and one new provider entry. The large items (video adapter layer, System One, Docker pipeline,
  Antigravity refactors) are SKIP/HYBRID on purpose.
