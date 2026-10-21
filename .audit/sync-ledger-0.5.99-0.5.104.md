# Upstream sync ledger — decolua/9router v0.5.99 → v0.5.104

Branch: `sync/upstream-0.5.104`, fast-forwarded into `main`.
Upstream range: `ce4460ef7` (v0.5.99) → `87a74e1b` (v0.5.104) = 38 commits, plus the
still-unadopted tail of the v0.5.95 → v0.5.99 range.

No push, no tag, no DB change. Every entry below is a local commit.

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
| `85bc33cea` | `f76016ba` | MiniMax Code (mcode) credits provider |
| `8a90d3c9d` | `5a7cbaac` | CLI: `connect` models from the server; `show`, `--save`, Pi and Oh My Pi |
| `4fa46034a` | `ff9ee84a` | Netlify relay proxy pool |
| `b2aaf83b` | `0e20a79a` + `ba650e3b` | Qoder: the add-on (free-credit promo) quota |
| `d95bb8ea` | `0b5e0186` | Dashboard: unclip the proxy dropdown and tooltips via a body portal |
| `da1756a8` | `e490a037` | Model picker: regex/negation search, batch select, provider filtering |

Already adopted before this pass: `1d4335d4`, `29fc880e`, `9c141910`, `a8f63f4d`,
`eb373017`, `165f9b90`, `468aa7d9`.

## Fork fixes found while adopting

These were not upstream commits — the upstream version of the same change did not
fit this fork, or the fork had a latent defect that the upstream test exposed.

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

## Skipped, with the reason

| upstream | reason |
|---|---|
| `d8c585fb7` feat(keys): per-API-key access control | Touches the protected ACL files `src/sse/handlers/chat.js` and `src/app/api/v1/models/route.js`. This fork already has its own per-key ACL (`allowedProviders` / `allowedCombos` / `allowedKinds`), and upstream reverted this commit itself in `6ed88685`. |
| `2aa9307f5` feat(keys): per-key token quotas | Reverted upstream in `6ed88685`; same protected-file surface. |
| `3c48d275a` "Features:" | Upstream changelog-only commit. This fork writes its own entries in its own style. |
| `87a74e1bd` "# v0.5.104" | Upstream changelog-only commit, same reason. |
| `acb5c34c` fix(opencode): Muse Spark on the Free lane | The OpenCode Free Muse Spark entries were deliberately removed from this fork, so only the Meta-provider half is taken — see `98254cbd`. |
| `ef4679dfa`, `e964e4826`, `59e9b5264`, `5bdcd5e7`, `c86443689` | The OpenCode lane changes. Out of scope for this pass ("focus on else except opencode"). `5bdcd5e7` is additionally contradicted by the live probe in `.audit/probe-opencode-zen-2026-10-17.txt`: `/zen/v1` does not reject everything for this fork's client shape, so its premise does not hold here. |
| `28d40159` → `ProviderLimits/index.js` | The upstream half of that commit rewrites the usage page's auto-ping state around upstream's quota-visibility layer. This fork's usage page carries a per-model quota layer instead; porting it would drop the fork's per-model breakdown. The service layer is already byte-identical to upstream. |
| `a9d0ad269` feat(bedrock): AWS Bedrock | Needs a new dependency (`@aws-sdk/credential-providers`) and touches the protected `src/app/api/providers/route.js`. |
| `a9c9f6836` feat(hermes): per-profile configuration | Rewrites the `hermes-settings` route, which this fork deliberately hardened — the route validates the role name and the YAML values before it writes the config file. Upstream's version of that route does not carry the validation. |
| `d6431f8b` feat(cli-tools): Hermes audio transcription | Same route rewrite, and it builds on the per-profile feature above. |
| `fb30246c` fix(tests): isolate zed-native-auth DATA_DIR | Already present in this fork — the test points DATA_DIR at a temp dir before the DB layer loads and cleans up afterwards. The cherry-pick was a no-op and was skipped. |
| `7e0043def` Merge branch 'chore/codex-drop-gpt-5.5' | Merge commit with no diff of its own. |

## Audit evidence kept in the tree

- `.audit/probe-opencode-zen-2026-10-17.txt`
- `.audit/probe-gemini4-argon-2026-10-17.txt`
