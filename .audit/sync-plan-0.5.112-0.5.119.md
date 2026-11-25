# Sync plan — upstream v0.5.112 → v0.5.119

Date: 2026-11-22
Upstream: `decolua/9router` master = `v0.5.119` (`1855aa44`); no unreleased commits after it.
Our last synced tag: `v0.5.112`.

## New range

69 commits, 211 files, +8,291/−710.

| Version | Commits | Adopt | Hybrid | Skip | Release |
|---|---|---|---|---|---|
| v0.5.116 | 29 | 18 | 7 | 2 | 2 |
| v0.5.119 | 40 | 24 | 11 | 2 | 3 |
| **Total** | **69** | **42** | **18** | **4** | **5** |

Process per batch: cherry-pick `-x` → resolve → `lint-undef` →
`bash scripts/verify-custom-features.sh` → focused tests → `pnpm test` → `pnpm run build`.

## Conditional carry-over merges (6 items)

These are the only deferred commits worth porting. Each is **hybrid mode**:
never overwrite fork-owned logic (ACL, multi-connection, quota latest-wins,
Proxy Fitness, deploy modals, branding/volume). Port only when the prerequisite holds.

| # | Item | Commits | Mode / prerequisite | Target | Risk | Verify |
|---|---|---|---|---|---|---|
| 1 | Headroom native projection | `86adae35`, `792f4719`, `a440ef43` | Hybrid; only if Headroom is used. Fork headroom has 143 local lines of divergence — port the projection, not the file | `open-sse/rtk/headroom.js` + tests | Medium (PDF/tool history loss if wrong) | `tests/unit/headroom*.test.js`, live Claude PDF + tool history request |
| 2 | OpenCode lane fixes | `b8331283`, `e70ea24d`, `ce060c79`, `483c10f5` | Hybrid; fork lane merged Zen into `opencode`, keep its `generateSessionId`/model list | `open-sse/executors/opencode.js`, registry, fingerprint, tests | Medium (lane divergence) | `tests/unit/opencode-*`, free + zen smoke |
| 3 | CommandCode header alignment | `b1effa03` | Hybrid; fork executor/usage path differs (usage service is not wired) | `open-sse/executors/commandcode.js`, headers tests | Low–medium | header snapshot + `commandcode-headers.test.js` |
| 4 | Antigravity Argon catalog + quota | `f172c3c4`, `8a833631` | Hybrid; **re-probe first** with `hub/2.24.0` UA. Fork's 2026-10-17 probe got 404, so do not register models on faith | `open-sse/providers/registry/antigravity.js`, executor UA, usage/google, `ProviderLimits/utils.js` (fork-owned) | High (unserved models + quota UI) | live `generateContent` probe; quota tests; keep `tiered` wire ids if Argon still 404 |
| 5 | Smart Router (System One) | `f3f86fdd` | Dedicated port; depends on upstream `keyAccess`, touches `src/sse/handlers/chat.js` ACL path | `open-sse/services/combo.js`, `systemoneRouter`, combos page | High (ACL) | ACL suite + `verify-custom-features.sh` + combo tests |
| 6 | DeepSeek PoW | `d7bb71ce`, `64a23dc2` | Hybrid; only if the PoW lane is adopted (adds `noble-hashes` and the hash module, then wire registration/usage) | `open-sse/lib/deepseek-pow-hash.js`, CLI build, DeepSeek lane | Medium (new dep, dead if lane unused) | PoW unit + real DeepSeek free request |

Order: 2 → 3 → 1 → 4 (after probe) → 5 → 6. Items 1 and 6 are
conditional on the feature actually being used; if not, keep them skipped.

## Skip permanently

- Release/version commits: `eaeb54a6`, `1339107e`, `54a88d04`, `1855aa44`, `d1970ac9`, `1fe586bb`, `3a978a63`, `f39d8f07`.
- Test triage: `b6a9ca43`.
- Already resolved / bug absent: `00dd3dfc`, `342ecb0d`.
- Subsystem not present (skip unless the capability is wanted):
  `38a0c449` (web-cookie/browser pool), `3b7acf72` (Docker lazy deps), `a76c2afc` (wreq-js),
  `85d73bd6` + `201e81fb` (MiniMax lease), `2720cd2a` (Qoder refactor), `d7bb71ce` if item 6 is not adopted.
