# Sync execution — upstream v0.5.112 → v0.5.119 (release 0.92.0)

Date: 2026-11-22
Branch: `release/0.92.0` (local only, not pushed)
Base: `main` @ `6d378528`

Method: isolated `git cherry-pick -n` probe first, then per-commit port.
Conflicts were resolved against the fork's own code, not by taking upstream
wholesale. No merge base exists with upstream (`git merge-base` → rc=1), so
every pick is a content patch.

## New range (69 commits)

| Bucket | Count |
|---|---|
| Applied (full or partial, trailer present) | **55** |
| Skipped — code | **9** |
| Skipped — upstream release/version | **5** |

### Code skips (9)

| Commit | Reason | Evidence |
|---|---|---|
| `f0938ea7` | lazy-runtime loader absent | `open-sse/services/lazyRuntime.js` missing |
| `64a23dc2` | DeepSeek PoW lane absent | `open-sse/lib/deepseek-pow-hash.js` missing |
| `8a833631` | Antigravity Argon catalogue deliberately absent | `registry/antigravity.js:55` says the catalogue omits it; live probe 2026-10-17 got 404 |
| `97b2c545` | deepseek-web / zstd transport absent | `executors/deepseek-web.js`, `utils/zstdCompat.js` missing |
| `0760c302` | muse-web / web-cookie subsystem absent | `executors/muse-web.js`, `services/webIdentity.js`, `utils/webCookieAuth.js` missing |
| `a76c2afc` | wreq-js TLS transport absent | `services/opencodeTlsClient.js` missing, `wreq-js` not a dependency |
| `201e81fb` | MiniMax desktop lease absent | `services/minimaxCodeLease.js` missing |
| `9ae6e147` | already fixed in fork | fork drops upstream `[DONE]` and emits one at flush (`stream.js`) |
| `850eb573` | fork modal is a different component | `AddCustomModelModal.js` uses `caps.stt`, not an explicit type state |

### Release skips (5)

`eaeb54a6`, `1339107e`, `54a88d04`, `1855aa44`, `d1970ac9` — upstream CHANGELOG/version bumps.

## Carry-over commits (13)

| Commit | Result |
|---|---|
| `792f4719`, `a440ef43`, `86adae35` (headroom) | **applied**; Claude/Gemini/Responses/CommandCode projections. Integration tests that also assert upstream cache markers were dropped. |
| `f3f86fdd` (Smart Router) | **applied**; routers + combo + chat ACL path + CLI/tooling; combos page keeps the fork layout and only gains the `smart` strategy option. |
| `b8331283`, `e70ea24d`, `ce060c79`, `483c10f5` (OpenCode) | **skipped** — depend on the wreq-js TLS client and upstream session stores the fork does not have. |
| `b1effa03` (CommandCode headers) | **skipped** — fork executor is the 0.25.7 generation; adopting 1.88.5 is a provider rewrite. |
| `f172c3c4` (Argon catalogue/UA) | **skipped** — same probe evidence as `8a833631`. |
| `d7bb71ce` (DeepSeek PoW) | **skipped** — no PoW lane. |

## Partial ports (intentional)

| Commit | Ported | Left out |
|---|---|---|
| `b114fa9f` | tool-name resolution, error-text, raw args, effort, 64k default, cache tokens | CLI 1.88.5 headers, auto-import route |
| `2275bc0d` | new NIM model rows + registry entry | `node:test` file (incompatible with this repo's vitest runner) |
| `14b27dc7` | provider + reasoning-alias lift in `stream.js` | nothing else |
| `43bc940e` | live CLI version + billing header | dashboard live model list |
| `fa73c938` | shared catalog resolver + `/v1/models` resolver | dashboard live-catalog hardcodes |
| `597ee684` | catalog/shared selectors | providers/[id] live gate |
| `989b1eec` | overload retry | session-drop (fork mints per request) |
| `8aef7480` / `10b0afa4` | Claude Fable 5.2 / Haiku 5.5 / CLI 2.1.322 | Gemini 4 Carbon catalogue |
| `12256f72` | selection util, status filter, shift-range, visible targets | none |
| `69d51c0c` | shared resolver + Add All button | none |
| `7abc190d` | `thinking_levels` + opencode effort variants | none |
| `86adae35` | native Claude projection | two chatCore integration tests (cache markers) |

## Guardian checks

- `node scripts/lint-undef.cjs` → clean
- `bash ~/.config/opencode/skills/vansrouter-upstream-sync/scripts/verify-custom-features.sh` → ALL CHECKS PASSED
- ACL suite: `handler-acl-enforcement` + `apikey-acl-security` → 67 passed
- Smart Router suite → 19 passed
- Headroom suites → 61 passed
- Full suite (live MiMo excluded): **518 files / 5498 passed / 0 failed**
- Production build: `✅ build complete` (`EXIT=0`).

## Rollback

The release branch is local. Revert individual batch commits (each carries a
`cherry picked from commit <sha>` trailer) or reset to `6d378528`.
