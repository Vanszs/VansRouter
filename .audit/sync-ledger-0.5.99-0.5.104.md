# Upstream sync ledger — decolua/9router v0.5.95 → v0.5.104

Branch: `sync/upstream-0.5.104`, fast-forwarded into `main`.
Upstream releases in scope: `a99cf572` (v0.5.95) → `ce4460ef7` (v0.5.99) →
`87a74e1b` (v0.5.104). v0.5.95 → v0.5.99 is 29 commits, v0.5.99 → v0.5.104 is
38 commits.

No push, no tag, no DB change. Every entry below is a local commit.

The accounting is content-based, not `git cherry`-based: every upstream commit in
the range was checked for a distinctive marker in the local tree, and the
commits the marker scan could not classify were verified by hand.

## Adopted upstream commits

| upstream | local | what |
|---|---|---|
| `3ef4d8e3` | `36659fbd` | Cursor IDE quota via the Cursor DashboardService |
| `e7f41c13` | `36659fbd` | Cursor: recover long sessions from empty AgentService turns |
| `f6c26d8ea` | `36659fbd` | Cursor: resolve "Auto (Server Picks)" to the account's default agent model |
| `cfd8c6184` | `36659fbd` | Cursor: hold strictProxy on the AgentService h2 path |
| `f7708c9d` | `b29d0c6e` | Cursor KV ack round-trip tests |
| `8f4e3800` | `1b288e1c` | Combo: fall through a seat that answers 200 with no usable content |
| `db81a8c9` | `30d4aae9` | Headroom: stop reporting phantom savings when tools dominate the body |
| `51a1827e` | `2d8dd4c1` | GitHub: route Copilot embeddings to api.githubcopilot.com |
| `7878f53b` | `539dd0aa` | Codex: drop the retired gpt-5.5 (registry, images, auto-ping) |
| `f5f88039` | `9871c3f3` | Capabilities: advertise PDF input on the current Claude families |
| `4c58e7f3` | `6f06357b` | Capabilities: the missing OpenCode Free reasoning entries |
| `2d94d3ab8` | `d407cff6` | Dashboard: open the 9Remote sidebar item directly on the website |
| `eea082157` | `a8cd1f47` | Dashboard: mobile layouts for endpoint, provider models and cli-tools |
| `63de82b8e` | `ebe4512e` | CodeBuddy CN: sync the catalogue with the 2026-09-30 server config |
| `24034f69c` | `fa0e8ac4` | Antigravity: refresh the model catalogue, MITM defaults to Gemini 3.8 |
| `b00ba1aa4` | `c83f7882` | Muse: route Responses-only models to their declared transport, nest reasoning effort |
| `be51142b4` | `dd69d0e6` | Quota: auto-ping anchored at fixed local times |
| `28d40159` | `e7fd89f9` | Quota: unify the auto-ping mode selection |
| `cff2b1d9` | `8e87e683` | Antigravity: bump the IDE fingerprint to 2.22.0 |
| `f68d2f5e` | `30ebbbd0` | Antigravity: preserve the client identity on model catalog requests (upstream #3414) |
| `90f89471` | `816cace0` | Nous: API-key attribution tags |
| `813a0121` | `f70a5b7e` | Usage: token fallback for `input_tokens` rows, stable key masking |
| `a07ed95be` | `3f1e98be` | Antigravity: Claude Sonnet 5.5 and Opus 5.5 support |
| `85bc33ce` | `f76016ba` | MiniMax Code (mcode) credits provider |
| `8a90d3c9d` | `5a7cbaac` | CLI: `connect` models from the server; `show`, `--save`, Pi and Oh My Pi |
| `4fa46034a` | `ff9ee84a` | Netlify relay proxy pool |
| `b2aaf83b` | `0e20a79a` + `ba650e3b` | Qoder: the add-on (free-credit promo) quota |
| `d95bb8ea` | `0b5e0186` | Dashboard: unclip the proxy dropdown and tooltips via a body portal |
| `da1756a8` | `e490a037` | Model picker: regex/negation search, batch select, provider filtering |
| `a9d0ad26` | `d6fc55a0` | AWS Bedrock provider with SSO/profile credentials |
| `a9c9f6836` | `bcfe7d90` | Hermes per-profile configuration across API, Dashboard and CLI |
| `d6431f8b` | `dac458a0` | Hermes audio transcription via 9router |

Already adopted before this pass: `1d4335d4`, `29fc880e`, `9c141910`, `a8f63f4d`,
`eb373017`, `165f9b90`, `468aa7d9`.

## Fork fixes found while adopting

Not upstream commits — the upstream version of the same change did not fit this
fork, or the fork had a latent defect that the upstream test exposed.

| local | what |
|---|---|
| `98254cbd` | Muse Spark needed the thinking suffix preserved *and* a real capability entry; both were missing in the fork. |
| `a74c7020` | `getModelUpstreamId` now keeps the `(level)` suffix, so `chatCore` has to strip it again before the id goes on the wire. |
| `ba72b046` | The `codebuddy-intl` DeepSeek thinking-level entry sat below the unqualified `*deepseek-v4.*` glob, so it never fired. |
| `2f0e9c39` | The Antigravity base-url list had the daily IDE host twice after the 2.22.0 bump. |
| `44b7c1dd` | A compatible node's API dialect now comes from its stored `apiType` first; the provider id bakes it in at creation and goes stale when the node is edited. |
| `4f0ea4d7` | Claude Opus 5.5 was never listed for the claude provider, so it resolved to the default capabilities (`reasoning:false`). |
| `ca5fb13c` | The protected-model guard tracks the new claude-opus-5-5 id. |
| `066f2a15` | The golden url/header snapshots mask the MiniMax per-request session id and the host timezone. |
| `bfa9561a` | The model picker's load-on-open effect stays inside the react-hooks regression guard. |
| `4cfdbe90` | The `.next-atomic-*` deploy staging directories no longer reach eslint. |
| `47b559fe` | The new Hermes STT path validates its model before it reaches the YAML, like the chat model does. |

## Decompositions this sync forced

The sync pushed three files past 1k lines. Each was split along a seam the
codebase already uses.

| local | what |
|---|---|
| `945665e4` | `tokenRefresh/providers.js` (728 → 1017) becomes one file per provider under `tokenRefresh/providers/` with an index barrel — the same shape `open-sse/services/usage/` already has. The exported set is byte-identical (20 functions). |
| `945665e4` | `proxy-pools/page.js` (986 → 1016): the four inline "deploy a relay" modals (Vercel, Cloudflare, Deno, Netlify) become one spec-driven `RelayDeployModal`. The page ends at 963 lines, smaller than before the sync, and the Netlify modal the sync added is now actually reachable from the menu item that opens it. |
| `945665e4` | `test/testUtils.js` (954 → 1014): the per-provider test endpoint table moves to `test/oauthTestConfig.js`; the probing stays. The table is imported after the open-sse modules on purpose — `@/lib/oauth/constants/oauth.js` reads `PROVIDER_OAUTH` at module scope. |
| `f479df4e` | The split moved two lazy imports one directory deeper without rebasing them; the xai refresh silently returned null and the kiro profile fetch was broken. Both paths carry the extra level now. |
| `b899b86a` | The MiniMax Code usage tracker moves next to the other trackers in `open-sse/services/usage/`. |

## Skipped, with the reason

| upstream | reason |
|---|---|
| `d8c585fb7` feat(keys): per-API-key access control | Touches the protected ACL files `src/sse/handlers/chat.js` and `src/app/api/v1/models/route.js`. This fork already has its own per-key ACL (`allowedProviders` / `allowedCombos` / `allowedKinds`), and upstream reverted this commit itself in `6ed88685`. |
| `2aa9307f5` feat(keys): per-key token quotas | Reverted upstream in `6ed88685`; same protected-file surface. |
| `3c48d275a` "Features:" | Upstream changelog-only commit. This fork writes its own entries in its own style. |
| `87a74e1bd` "# v0.5.104" | Upstream changelog-only commit, same reason. |
| `acb5c34c` fix(opencode): Muse Spark on the Free lane | The OpenCode Free Muse Spark entries were deliberately removed from this fork, so only the Meta-provider half is taken — see `98254cbd`. |
| `ef4679df` fix(opencode): encode inverted timestamp in session IDs | Already covered, and then some: `4f5bb8d93` encodes the timestamp for the request id as well as the session id, splits the id cache so request churn cannot evict a live session id, and raises the cap to 5000. This fork routes `opencode` and `opencode-zen` through one executor, so the upstream commit's second file does not exist here. |
| `e964e4826`, `59e9b5264`, `5bdcd5e7`, `c86443689` | The remaining OpenCode lane changes. `5bdcd5e7` is additionally contradicted by the live probe in `.audit/probe-opencode-zen-2026-10-17.txt`: `/zen/v1` does not reject everything for this fork's client shape, so its premise does not hold here. |
| `28d40159` → `ProviderLimits/index.js` | The upstream half of that commit rewrites the usage page's auto-ping state around upstream's quota-visibility layer. This fork's usage page carries a per-model quota layer instead; porting it would drop the fork's per-model breakdown. The service layer is already byte-identical to upstream. |
| `7e0043def` Merge branch 'chore/codex-drop-gpt-5.5' | Merge commit with no diff of its own. |
| `fb30246c` fix(tests): isolate zed-native-auth DATA_DIR | Already present in this fork — the test points DATA_DIR at a temp dir before the DB layer loads and cleans up afterwards. The cherry-pick was a no-op and was skipped. |

## Audit evidence kept in the tree

- `.audit/probe-opencode-zen-2026-10-17.txt`
- `.audit/probe-gemini4-argon-2026-10-17.txt`
