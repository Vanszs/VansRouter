# Upstream v0.5.81 triage for VansRouter — 2026-09-22

Read-only triage. No code changed. Refreshed with `git fetch upstream` at audit time.

## Audited range

- `v0.5.81` = commit `a8c9d3802` ("docs: update changelog header to v0.5.81", 2026-09-18 18:32 +0700).
- Tag range `v0.5.79..v0.5.81` contains only **2 commits** (`23ae82d8e` "# v0.5.81 (2026-09-18)", `a8c9d3802`),
  i.e. the tag itself carries only the changelog. The shipped work therefore has to be read from the
  changelog entry, not from a tag-to-tag commit range: `git show v0.5.81:CHANGELOG.md`.
- Fetch also brought newer upstream history than the previous audit pass: tip is now `21583c03e` and a
  `v0.5.85` tag exists. Those are **out of scope** here (the request was v0.5.81) and are not triaged below.
- Fork reference: `main` @ `91816788c` (v0.91.22).

Decision values: ADOPT = take as-is (no custom-logic overlap) · HYBRID = take part, with an explicit boundary ·
SKIP = do not take (overlaps custom logic, or YAGNI) · UNVERIFIED = cannot be judged without more evidence.

## Triage table

| # | Change (v0.5.81 changelog) | Decision | Sumber (SHA) | Reason | Files touched in our fork | Custom-logic risk |
|---|---|---|---|---|---|---|
| 1 | Xiaomi MiMo: merge Desktop support into `xiaomi-mimo` with dual auth + Preview models + encrypted-callback OAuth | UNVERIFIED | `73cb89143` | Our fork has `open-sse/providers/registry/xiaomi-tokenplan.js`, upstream's entry name/shape differs; mapping the two needs a per-file comparison that this pass did not do | `open-sse/providers/registry/xiaomi-*.js`, executors, `src/lib/oauth/providers.js` | OAuth plumbing is shared; wrong port can disturb existing providers |
| 2 | Claude Code: 1M-context toggle (`[1m]`) + drive `CLAUDE_CODE_AUTO_COMPACT_WINDOW` from dashboard | HYBRID | changelog v0.5.81 only (no per-commit SHA collected) | Take the marker handling and the setting, but our CLI-tools pages carry fork-specific copy/layout | `open-sse/**` (model marker strip), `src/app/(dashboard)/dashboard/cli-tools/**` | Low, but UI is fork-customised (branding) |
| 3 | Models: add DeepSeek-V4.1-Flash (DeepSeek, CodeBuddy-Intl, Ollama) + `low..max` reasoning levels + vision capability for DeepSeek-V4.* | ADOPT | `367fc546d` | Data/registry-only change; no custom-code intersection | `open-sse/providers/registry/{deepseek,codebuddy-intl,ollama*}.js`, `open-sse/providers/capabilities.js` | None (registry data) |
| 4 | i18n: Persian (fa) | ADOPT | `725e2c118` | Additive locale bundle; no behaviour change | `public/i18n/**`, `src/i18n/**` | Low; check for hardcoded VansAI strings before adopting wholesale |
| 5 | OpenCode / OpenCode Go: resolve 403 `FreeTierError` + 429 (canonical session, valid UA, stable session reuse), `forceStream` for free-tier SSE | HYBRID (already partly adopted) | `93837af09`, `058ceace4` | The core is already in our tree — UA gate, canonical ids, deterministic translation, `forceStream: true`; remaining pieces are model-specific | `open-sse/executors/opencode.js`, `open-sse/providers/registry/opencode.js` | Low; the file is shared with our custom provider guard — keep edits local |
| 6 | OpenCode: cloak decoy tools, normalize Muse Free tool choice, strip prior reasoning items on Responses models, route Union Alpha via Messages API | HYBRID | `aa14ef72e`, `eafac37dc` | Each is a small, testable translator/tool-shape fix; adopt only the ones a report actually needs (YAGNI otherwise) | `open-sse/executors/opencode.js`, `open-sse/translator/**` | Medium if applied blindly — tool-shape logic is shared across providers |
| 7 | Kiro: preserve underscores in tool names, restore client tool names in responses, neutral placeholder for tool-result-only turns, forward tool-result images | ADOPT | `c49efdf52`, `82b1bca42` | Translator-level fixes with existing test coverage in this repo | `open-sse/translator/**`, `open-sse/rtk/**` (kiro path) | Low; Kiro path already fork-tested |
| 8 | Stream: report aborts after HTTP 200 in-band (per-format error frames) instead of closing silently | ADOPT | `930012136` | Generic handler behaviour, no custom overlap | `open-sse/handlers/**` | Low |
| 9 | Command Code: preserve images/`reasoning_effort`, retry transient stream errors, avoid fake stop chunks, Quota Tracker support | UNVERIFIED | `13b468b88`, `092c84eac` | This pass did not confirm whether our fork ships the Command Code provider at all | `open-sse/providers/registry/**`, `open-sse/executors/**` | Unknown until provider presence is checked |
| 10 | Zed: harden OAuth lifecycle (`systemId`, proxy timeout), live model resolution, lower display priority | HYBRID | `ef1817522`, `4641c2b76` | Only worth it if Zed is actually used here (previously flagged as YAGNI); the OAuth part touches a shared file | `src/lib/oauth/providers.js`, `open-sse/providers/registry/zed.js` | Medium — shared OAuth surface |
| 11 | Antigravity: scope cached thought signatures to model family, strip Claude Code billing headers, sanitize Hermes identity | SKIP | `bc3be0cb2`, `b3d6e089c` | Our Antigravity integration is fork-modified (fingerprint/version handling); upstream's refactors would likely regress our custom path | — | High |
| 12 | Codex: route bare `codex-auto-review` to the Codex provider | ADOPT | `efc80ba2e` | One-line routing fix | `open-sse/**` (codex model resolution) | Low |
| 13 | Auth: do not cool down an account for request-scoped 4xx errors | HYBRID | changelog v0.5.81 only (no per-commit SHA collected) | Behaviour lives in files this fork customises heavily (`src/sse/services/auth.js`, account fallback) — port the rule, not the upstream diff | `src/sse/services/auth.js`, `open-sse/services/accountFallback*` | High if the upstream patch is applied as-is |
| 14 | Usage: DeepSeek credit balance as currency credit instead of 0/total bar | ADOPT | `3ac100d52` | Display-only | `src/app/(dashboard)/dashboard/**` | Low |
| 15 | Model Catalog: scope synced catalog to gateways + declare vision caps for DeepSeek V4.1-Flash ids | HYBRID | changelog v0.5.81 / `367fc546d` (caps part) | The vision-cap declaration is data (ADOPT); the gateway scoping touches shared catalog logic | `open-sse/services/**catalog**`, `open-sse/providers/capabilities.js` | Medium |

## Executive summary — what to do first

| Rank | Item | Target files | Tests that must pass | Expected diff |
|---|---|---|---|---|
| 1 | #7 Kiro translator fixes | `open-sse/translator/**` | `npx vitest run -c tests/vitest.config.js tests/unit/rtkKiro.test.js tests/translator/` | small (tens of lines) |
| 2 | #3 DeepSeek-V4.1-Flash + vision caps | `open-sse/providers/registry/{deepseek,codebuddy-intl,ollama*}.js`, `capabilities.js` | `tests/translator/golden-url-header.test.js`, `tests/unit/provider-thinking-config.test.js` | trivial (data only) |
| 3 | #8 stream abort reporting | `open-sse/handlers/**` | `tests/unit/` (stream/translator suites) | small |
| 4 | #12 codex-auto-review routing | codex model resolution | `tests/unit/` codex suites | trivial |
| 5 | #14 DeepSeek usage display | dashboard usage page | `node scripts/lint-reacthooks.cjs` + smoke | small |
| 6 | #6 OpenCode tool-shape leftovers | `open-sse/executors/opencode.js` | `tests/unit/opencode-*.test.js` | small each, skip without a report |
| 7 | #4 Persian i18n | `public/i18n/**` | lint + smoke | medium (files only) |

Ordering rule used: registry/data-only and translator fixes first (lowest blast radius, existing tests),
shared-auth/OAuth items last (or skipped), and every "fix" without a matching symptom marked YAGNI.

## UNVERIFIED

| Item | What would prove it |
|---|---|
| #1 Xiaomi MiMo merge | A per-file comparison of `xiaomi-mimo` (upstream) vs our `xiaomi-tokenplan.js`, plus whether the OAuth callback flow exists here |
| #9 Command Code | `ls open-sse/providers/registry \| grep -i command` and an executor check |
| #4 Persian i18n cost | Diff of upstream `fa` bundle vs our UI strings (branding replacements would be needed) |
| #10 Zed usefulness | Whether any connection in this deployment uses Zed |
| #5/#6 remaining OpenCode items | A live free-tier request from an allowed client, or a user report naming the failing model |
| Any Antigravity/Codex effect | Live provider calls; no credentials in this environment |

## Notes

- Ponytail rule applied: items whose only justification is "upstream did it" (Zed priority cosmetics, Antigravity
  refactors, gateway catalog scoping) are SKIP/HYBRID rather than ADOPT; nothing here adds a dependency or a new
  abstraction — the ADOPT list is registry data, translator fixes, and display changes.
- Ranks 1–4 are small enough to land one commit each with the existing test suites as proof.
