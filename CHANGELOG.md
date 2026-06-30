# v0.7.7 (2026-06-30)

Sync of upstream `decolua/9router` bug-fix batch onto the VansRouter fork, plus two repo-maintenance chores. No source-code regressions vs. v0.7.6.

## Fixed
- **translator**: preserve `cache_control` when `collapseTextParts` would otherwise drop it (`c0bd3e0d`).
- **translator**: map mid-conversation `system` message to `user` in the Claude response stream (`5f6f0b95`).
- **translator / responses**: handle `response.done` terminal events correctly (`b970c143`).
- **kiro**: replace missing `uuid` dep with `node:crypto.randomUUID()` (`89cb9763`).
- **kiro**: strip leaked `<thinking>` tags from the content stream (`e985f1e0`, #2158).
- **headroom**: translate `openai-responses` input through OpenAI before compression so non-OpenAI providers don't see Responses-only fields (`96411bb4`).
- **headroom**: skip unsafe Responses tool history (`e0512cf1`, #2132).
- **antigravity**: strip `deprecated`/`readOnly`/`writeOnly` from tool schemas before sending to Gemini (`26fd991b`, `4a80c16e`).
- **alicode**: preserve `cache_control` for DashScope providers (`199e3f67`, #2069).
- **kilocode**: expose full gateway catalog in the combo model picker (`30a69fa7`).
- **gemini**: backfill `thoughtSignature` and suppress `stream done sent` errors (`2d9294c2`).
- **gemini**: normalize `contents` to prevent `400 invalid_argument` from upstream (`bdaf57f1`, #2192).
- **OpenCode Go**: fix GLM routing (`a6a7bdbe`).
- **tray**: make Windows context menu DPI-aware so the icon renders crisp on high-DPI displays (`71329cc0`).
- **token-saver**: switch to full-width card layout (`31321e57`).
- **capabilities**: refine Qwen vision/video and thinking model patterns (`04c3e4a6`).

## Tests
- Update `tests/translator/__snapshots__/golden-url-header.test.js.snap` to the v0.7.6 snapshot (`8c3258ec`).
- New regression tests: `tests/unit/alicode-cache-control-2069.test.js`, `tests/unit/kiro-thinking-strip.test.js`, plus updates to `tests/unit/openai-responses-terminal-event.test.js`.

## Docs
- `AGENTS.md`: add a new **"Release Pipeline Rules (MANDATORY)"** section with three rules learned from the v0.7.5 → v0.7.6 cycle: (1) push merge to `origin/main` before pushing a release tag, otherwise `check-branch` sets `is-main=false` and the publish jobs are silently SKIPPED; (2) verify `npm`/`GHCR` artifacts immediately after pushing a tag — never trust the workflow's overall `success` conclusion alone; (3) never edit a source file with duplicate declarations of the same import (`runtime.js` once had `import { readFileSync, existsSync } from "node:fs"` twice and Next.js webpack rejected it).

## Chore
- Untrack `.kimchi/docs/lighthouse-reports/` (20 generated HTML/JSON files) from git. These are one-time lighthouse audit artifacts that were inflating the repo's HTML language percentage to 52.5%; now that `.kimchi/` and `.understand-anything/` are in `.gitignore`, the local copies remain on disk for reference but won't be re-committed.

## Verified
- `pnpm test tests/unit/runtime-detect.test.js` → 24/24 pass.
- `pnpm test` (full) → 1847 pass + 14 pre-existing `tests/unit/all-endpoints-robust.test.js` 401-Invalid-API-key failures (confirmed pre-existing on `main` before this release; not a regression).
- `pnpm run build` → build complete (no-undef lint: clean included).
- `pnpm lint:undef` → clean.

## Install
```bash
npm install -g vansrouter
```

# v0.7.6 (2026-06-30)

Hotfix release. v0.7.5 was published as a tag (a03d07d0 → fae6fa1c → 68e53b4e) but the auto-generated release workflow run (run 28419859527) failed at the webpack/parse stage of `next build` because `src/shared/utils/runtime.js` accidentally declared the same `import { readFileSync, existsSync } from "node:fs"` twice on lines 1 and 3. As a result neither the Docker image nor the npm package was published. This release removes the duplicate import and republishes with version 0.7.6.

## Fixed
- Remove the duplicate `import { readFileSync, existsSync } from "node:fs"` at the top of `src/shared/utils/runtime.js`. Without the fix, Next.js webpack rejects the module with `Module parse failed: Identifier 'readFileSync' has already been declared` and the entire release pipeline (GHCR image build + npm publish) fails.

## Verified
- `pnpm test tests/unit/runtime-detect.test.js` → 24/24 pass.
- `pnpm run build` → build complete (no-undef lint: clean included).
- `pnpm lint:undef` → clean.

## Install
```bash
npm install -g vansrouter
```

# v0.7.5 (2026-06-29)

Auto-update flow now detects the runtime (PM2, systemd, screen, tmux, Docker, or plain foreground) and offers a one-click Update & Restart button when a process manager is present. Running under PM2/systemd/screen/tmux, the npm install + restart happens in a detached child process spawned before exit, so the user no longer has to manually copy the command and re-run the binary.

## Added
- New helper `src/shared/utils/runtime.js` exporting `detectRuntime()` and `updateAndRestartCommand(runtime, pkg)`. Priority: pm2 > systemd > tmux > screen > docker > direct. Each runtime returns a tailored install+restart command; `direct` returns null so the original copy-and-restart UI stays in place.
- `/api/version/shutdown` reads an optional `{packageName, mode}` body. In `auto` mode (default) it spawns the detached install+restart child before exiting when the detected runtime supports it; otherwise it falls back to the original shutdown flow.
- `/api/version` response now includes `runtime`, `canAutoRestart`, and `installCommand` fields so the Sidebar can adapt its UI without hardcoding the package name.
- Sidebar UI shows the detected runtime (e.g. `Runtime: pm2 - auto-restart supported`) and renames the button to `Update & Restart` when auto-restart is available. The install-command copy target switches to the runtime-specific command.

## Fixed
- `GITHUB_RAW_PKG` was reading `main` but we push releases to `dev` (per user instruction not to push to main), so the Sidebar always reported `github_behind_npm` after a publish. Now points to `dev` so the comparison reflects what we actually released.

## Changed
- `README.md` + `cli/README.md` install commands corrected: Docker mount now points to `~/.9router:/app/data` (was `vansrouter-data:/home/node/.vansrouter`), port aligned with Dockerfile (`-p 20128:20128`), PM2 `--name vansrouter` (was `vansroute`), and a port-clarification note added.
- `donateUrl` cleared (was pointing to upstream `9router.com`). `DonateModal` now handles an empty donateUrl gracefully (`Donate is not configured.`).
- `.gitignore` now excludes `.kimchi/` and `.understand-anything/` so future tooling generations don't clutter the repo.
- `DonateModal` react-hooks `set-state-in-effect` regression fixed by wrapping synchronous `setFetchState` in `Promise.resolve().then()`.
- `tests/translator/__snapshots__/golden-url-header.test.js.snap` regenerated for the new `VansRouter/0.7.5` User-Agent, `vansrouter` `X-CLIENT-TYPE`/`X-Msh-Platform`, and `0.7.5` `X-CLIENT-VERSION`/`X-CORE-VERSION`.
- `.kimchi` (12M) and `.understand-anything` (5.3M) tooling artifacts committed to dev (one-time, before gitignore added).

## Tests
- New `tests/unit/runtime-detect.test.js`, 24 cases covering every runtime path (env-var-only, filesystem-only, combined) plus all `updateAndRestartCommand` outputs. Uses `vi.mock('node:fs')` so filesystem probes are deterministic on systemd test runners.
- `tests/translator/golden-url-header.test.js` snapshot regenerated.
- Confirmed `tests/unit/all-endpoints-robust.test.js` (14 failures returning 401 Invalid API key) also fails on `dev` before this release — pre-existing flaky tests with missing test API key setup, not a regression of this release.

## Install
```bash
npm install -g vansrouter
```

# v0.7.4 (2026-06-29)

Publish with a 2FA-bypass token (Classic Automation or Granular with bypass enabled). Earlier v0.7.3 publish attempt failed with EOTP because the token required an authenticator OTP; this release uses a bypass-2FA token issued from the package owner account (blugaaaaaaaa) so CI can publish without interactive 2FA.

## Changed
- Bump version to 0.7.4.
- No source changes since v0.7.3; this is a release-pipeline fix.

## Install
```bash
npm install -g vansrouter
```

# v0.7.3 (2026-06-29)

Publish npm package under the unscoped name `vansrouter`. The user owns `vansrouter` on npmjs.com via account `blugaaaaaaaa`; earlier attempts failed because the tokens in use were organization-scoped (`vanroute` org) instead of USER-scoped from the owner account.

## Changed
- Keep CLI npm package name as `vansrouter` (revert from scoped `@vanroute/vansrouter` experiment).
- Update version endpoint, updater config, sidebar messages, and CLI README install commands back to `vansrouter`.
- Bump version to `0.7.3` (v0.7.0/v0.7.1/v0.7.2 npm publish attempts failed with E404 due to org-scoped tokens).

## Install
```bash
npm install -g vansrouter
```

# v0.7.0 (2026-06-29)

First independent VansRouter release. Fork branding is now applied throughout the UI, CLI, documentation, and published artifacts while preserving the `~/.9router` data directory for backward compatibility.

## Infrastructure
- Unified release workflow (`.github/workflows/release.yml`) publishes both Docker images (GHCR + Docker Hub) and the `vansrouter` npm package on every `v*` tag push.
- Docker image: `ghcr.io/Vanszs/VansRouter:latest` and `vanszs/vansrouter:latest`.
- npm package: `vansrouter`.

## Branding
- Rename CLI npm package and UI labels from `9Router` to `VansRouter`.
- Update landing page, login page, CLI tray, terminal UI, and docs links to point to `github.com/Vanszs/VansRouter`.
- Update Docker / Compose docs to use VansRouter image while keeping host data path at `$HOME/.9router`.

## Notes
- Data directory remains `~/.9router` so existing users do not need to migrate.
- Internal provider/model IDs and autostart system identifiers are unchanged to avoid breaking existing configs.

# v0.5.12 (2026-06-26)

## Features
- Add token-saver dashboard page — decolua
- Add bulk delete for provider connections — teddytkz
- Resolve GitHub Copilot model catalog from upstream — caiqinzhou
- Add Venice AI provider — Brokenc0de
- Add Kiro external_idp import for Microsoft SSO (CLIProxyAPI) — Stevanus Pangau
- Overhaul Blackbox provider catalog + WebUI test support — suryacagur

## Fixes
- Provider thinking compatibility (DeepSeek/Gemini) — Mink Nguyen
- Stop double-counting streaming usage at source — decolua
- Usage logging dedupe to reduce stats churn — Mink Nguyen
- Prevent non-JSON SSE lines / duplicate [DONE] from breaking clients (PR #2046) — qianze
- Resolve Gemini TTS models from catalog — nguyenha935
- Support Kiro IDC (organization) token import — quanturbo
- Preserve forced streaming for JSON clients (#2031) — Joseph Yaksich
- Preserve Responses text format (Codex) — tenglong
- Support Gemini native TTS generateContent endpoint — nguyenha935
- Add missing zh-CN endpoint key label (i18n) — weimaozhen
- CodeBuddy: only send reasoning params when client requests reasoning (#2071) — Rex
- Show custom provider models in combo picker — Sapto
- Docker: add docker-compose.yml with headroom enabled by default — nitsuahlabs
- Clarify token diagnostics vs provider billing (headroom, #1998) — Sutarto Jordan Chrisfivo
- Translate openai-responses input through OpenAI for compression (#1998) — Ankit
- Kiro: report 1M context window for claude-opus-4.8 — EdisonPVE
- Avoid stale redirects after auth changes (#2100) — Emirhan
- Mark Claude Opus 4.7 (dashed id) as 1M context — Brokenc0de
- Preserve reasoning effort through Codex translations — ntdung6868
- Token-saver: full width card layout — decolua
- Antigravity: retry transient upstream failures — Sutarto Jordan Chrisfivo
- Param-support: handle strip rules without match/drop (#1960) — Joseph Yaksich
- Translator: resolve custom provider prefix in debug endpoint (#1083) — hamsa0x7

# v0.5.8 (2026-06-21)

## Features
- **Antigravity**: native image generation support (image models tagged kind:image, hiển thị trong media-providers UI)
- **CodeBuddy CN**: API key auth + credit quota tracker
- **CodeBuddy CN**: short model prefix alias "cbcn"

## Fixes
- **MiniMax-M3**: enable vision capability
- **Headroom**: support Docker sidecar proxy
- **Antigravity**: image executor fixes
- **mimo-free**: Chrome User-Agent rotation to bypass anti-abuse gate
- **cloudflare-ai**: flatten content-part arrays to string to avoid oneOf 400 (#1926)
- **Translator**: normalize tools to Anthropic-native shape for non-Anthropic providers
- **CLI**: handle Next.js 16 nested standalone output path (#1940)
- **Codex**: preserve custom tools during request normalization
- **next.config**: add new route for responses endpoint to API

# v0.5.6 (2026-06-20)

## Features
- **Ponytail**: minimalist code generation feature
- **Headroom**: proxy lifecycle management + dashboard UI (one-click start/stop, install detection, status probing, token saver, claude↔openai shape conversion)
- **CodeBuddy CN**: new OAuth provider (copilot.tencent.com) — 15-model catalog, /v2 inference, forced streaming, OpenAI-style reasoning
- **OpenCode-Go**: align models with official endpoints; route Qwen 3.7 MiniMax via /v1/messages, GLM/Kimi/DeepSeek/MiMo via /chat/completions

## Fixes
- **Anthropic-compatible validation**: use POST /v1/messages (GET /models not spec, false "invalid" for valid keys)
- **CLI tools**: tolerate JSONC configs in all 8 settings routes (opencode, openclaw, kilo, droid, cowork, copilot, claude, cline)
- **Gemini/Antigravity**: preserve 'pattern' in tool schema translation (glob/grep)
- **Combo/Fusion**: flatten Anthropic-style tool messages in panel calls (prevent 503)
- **Models**: store provider custom models by provider scope
- **Perplexity**: use /v1/models endpoint for key validation

# v0.5.4 (2026-06-18)

## Fixes
- **Kiro**: honor thinking effort budgets
- **AG/Kiro/Xiaomi**: provider fixes
- **Combo/Fusion**: flatten tool history in panel calls to prevent 503
- **LLM selector**: show custom vision models in selector and model list
- **Image**: prevent compatible nodes from shadowing provider aliases

# v0.5.2 (2026-06-17)

## Features
- **Combo Fusion strategy** — fans the prompt out to all member models in parallel, then a configurable judge model synthesizes one final answer (quorum-grace, anonymized sources, graceful degradation)
- **Per-combo strategy selector** — pick `fallback` / `round-robin` / `fusion` / `capacity` per combo (replaces the old round-robin toggle), with a judge picker for fusion
- **Capacity auto-switch** — reorders models per request so images/PDFs route to capable models first
- **Kiro headless API-key auth** (`ksk_`) + direct `claude↔kiro` route that avoids the lossy OpenAI two-hop pivot
- **Claude auto-ping** — warms the 5h quota window right after reset so a fresh window starts immediately (per-connection toggle)

## Fixes
- **Claude 429**: stop hammering the OAuth usage endpoint — cache resetAt, throttle quota refresh to 3 min, cool down after a 429 (chat unaffected)
- **Usage logs always empty**: missing `await` on `getAdapter()` in `getRecentLogs` made `/api/usage/logs` & `/api/usage/request-logs` return nothing
- **Executors**: strip params unsupported by the provider/model (drops deprecated `temperature` for claude-opus-4 → Anthropic 400)
- **Translator**: derive deterministic tool_call ids for gemini/antigravity → OpenAI so function call/response pair correctly (fixes tool-pairing 400s)
- **Antigravity**: strip `optional` from tool schemas before sending to Gemini
- **Claude-to-OpenAI**: handle OpenAI-format responses in the non-streaming path (e.g. xiaomi-tokenplan)
- **Usage views**: show edited connection names consistently across Providers & Quota Tracker
- **Security**: hardened reverse-proxy local-access trust
- **Security**: SSRF hardening on web fetch

## Internal
- Large **open-sse / translator refactor** (~40 commits): unified provider/model registry (LiteLLM-style `models[]` + `kind` field, 100 co-located registry files), single-sourced media/OAuth/refresh/token URLs, registry-based dispatch for usage & token-refresh, DRY translator concerns (buildUsage, encodeDataUri, finishReasonMap, chunkBuilder, reasoningDelta…), ESM-safe registry init, large-file splits, dead-code removal, and golden/no-regression test gates

# v0.4.80 (2026-06-13)

## Features
- Vercel AI Gateway: support embeddings, images and credit usage (#1183)
- Add MiMo Free no-auth provider (#1789)
- Vertex: support ADC `authorized_user` credential
- Cowork: re-enable Claude Cowork with preset-only stdio MCP
- Codex: bulk add accounts via JSON (#1719)
- Kiro: enable multi-endpoint failover for GenerateAssistantResponse (#1722)

## Fixes
- Security: re-auth on DB export/import + SSRF guard on web fetch
- Auth: real client IP rate-limiting + remote default-password guard
- Cerebras/Mistral: strip unsupported `client_metadata` from downstream requests (#1742)
- SiliconFlow: update baseUrl `.cn` -> `.com` + curate verified model list (#1760)
- Gemini-to-OpenAI: route unsigned thought parts to `reasoning_content` (#1752)
- Claude-to-OpenAI: strip Anthropic billing header from system prompt (#1765)
- Anthropic-compatible: send Bearer auth for third-party gateways (#1795)
- Usage-stats: avoid partial stats on initial SSE race (#1767)
- Proxy: use `export default` in proxy.js for Next.js 16 middleware detection
- Claude passthrough: add body normalization
- GitHub Copilot: refresh missing/expired token on models discovery (#1727) + add mappable gpt-5-mini/gpt-5.4-nano slots for Copilot MITM (#1653)
- Kiro: auto-resolve profileArn to prevent 403 on IDC login, enhance profile ARN resolution, update endpoint to `runtime.us-east-1.kiro.dev` (#1713)
- Tunnel: detect system-installed Tailscale via dual-socket probe (#1723) + non-blocking probes to prevent UI freeze
- CommandCode: force `stream=true` in transformRequest (#1706)
- Qoder: increase timeouts for reasoning models and improve stream handling
- Dashboard: show provider node name instead of connection name in topology (#1770) + show explicit `kind="llm"` combos on combos page (#1684)

## Docs
- README: add Indonesian 9Router tutorial video (#1709)

# v0.4.71 (2026-06-06)

## Features
- Caveman: add wenyan classical Chinese levels and sync upstream prompts; locale-based visibility on endpoint page
- i18n: endpoint exposure notice across multiple languages + Russian README
- Antigravity: add gemini-3.5-flash-extra-low (Low) model
- xiaomi-tokenplan: add Claude-native MiMo V2.5 Pro alias via dedicated executor
- Qoder: fetch latest model + dashboard import-model button (#1642)
- MiniMax: add MiniMax-M3 + update Quota Tracker coding/CN (#1631)

## Fixes
- Codex: harden streaming timeouts (stall/connect raised to 60s, configurable per-provider), accept `response.done` event, and always emit a terminal `response.failed` + `[DONE]` for Responses passthrough when a stream closes, stalls, or aborts before a terminal event — prevents codex clients from hanging (#1648, #1680, #1688, #1618)
- Codex: durable OAuth refresh lifecycle (#1664)
- Tunnel: skip virtual interfaces to prevent false netchange watchdog
- Claude: fix forced tool_choice 400 on cc/ OAuth route (#1592)
- Proxy: raise Next client body limit to 128MB via `NINEROUTER_PROXY_CLIENT_MAX_BODY_SIZE` (#1529, #1572)
- MiniMax: echo `reasoning_content` on follow-up turns to avoid 400 (#1543)
- Kiro: handle 400 on tool-bearing history without client tools; add mappable "auto" model slot; fix binary EventStream crash + add models & TTS tool filtering
- Antigravity: passthrough tab-autocomplete + mark default agent slot mandatory
- Qoder: allow `qmodel_latest` model key (#1638)
- Providers: restore one-connection guard for compatible/embedding nodes
- Model-test: route image/STT probes to their real endpoints, harden STT ping; add opencode-go + xiaomi-tokenplan to connection test (#1576, #1628)

## Improvements
- Dashboard: reorganize menu actions across sidebar/header/profile
- Translator: add data-driven coverage, bug-exposing cases, and real provider smoke tests

# v0.4.66 (2026-05-29)

## Features
- Add Qoder provider: device-flow OAuth, COSY signing, WAF-bypass body encoding, live model catalog, dashboard quota tracker, 11 models (#1372)
- Add new models: Claude Opus 4.8 (Claude Code), GPT 5.4 Mini (Codex)

## Fixes
- DeepSeek thinking mode: echo `reasoning_content` back on follow-up/tool-call turns so OpenCode-free and custom providers no longer 400 with "reasoning_content must be passed back" (#1543)
- Reasoning injector: match deepseek/kimi model ids case-insensitively (covers custom providers using capitalized model names)
- OpenCode suggested-models: include free models without the `-free` suffix, e.g. `big-pickle` (#1535)

## Improvements
- Codex: trim sunset models, keep gpt-5.5 / gpt-5.4 / gpt-5.3-codex family, add gpt-5.4-mini
- volcengine-ark: refresh model list (add DeepSeek-V4-Flash/Pro, drop EOL entries)
- Lower stream stall timeout 35s → 30s for faster hang detection

# v0.4.63 (2026-05-26)

## Fixes
- GitHub Copilot: never route Gemini/Claude models to the `/responses` endpoint; prevents misleading "does not support Responses API" 400s (#1062)
- proxyFetch: restore missing `Readable` import causing runtime `ReferenceError` in DNS-bypass fetch path

## Improvements
- Lower stream stall timeout from 60s → 35s for faster hang detection

# v0.4.62 (2026-05-26)

## Fixes
- Codex: auto-retry when upstream drops mid-stream (no more hangs)
- Codex: fix random 400/404 errors, tool-calling failures, and unstable prompt cache
- MITM: support Antigravity 2.x 
- Sanitize Read tool args to prevent retry loops from non-Anthropic models (#1144)
- Implement json_schema fallback for OpenAI-compatible providers without native Structured Output (#1343)
- Strip empty Read pages argument in OpenAI-to-Claude translator (#1354)
- Forward Gemini output dimensions for embeddings (#1366)
- Resolve setState-in-effect errors in dashboard components (#1362)
- Gemini CLI: reuse stored OAuth project IDs for quota checks and show clearer setup guidance when the project is missing (#1271, #1428)

## Features
- Add Cloudflare Workers proxy deployer and pool integration (#1360)
- Add Deno Deploy relays support and improved proxy pools dashboard layout (#1437)

## Improvements
- Refactor Tunnel into dedicated Cloudflare and Tailscale manager modules
- Refactor tokenRefresh service with in-flight dedup to prevent refresh_token_reused errors

# v0.4.59 (2026-05-21)

## Fixes
- OAuth: fix login flow on Windows

# v0.4.58 (2026-05-21)

## Features
- xAI Grok provider (OAuth, API key, image)
- Provider limits: paginated accounts with page size controls

## Fixes
- Tailscale: fix connection status on Windows (#1300)
- Tunnel: fix false "checking" when tunnel URL is reachable
- Stream: fix pipe errors on client disconnect/abort

# v0.4.55 (2026-05-18)

## Features
- Xiaomi MiMo Token Plan: region selector (Singapore / China / Europe) — keys are cluster-specific
- Antigravity: risk confirmation dialog before first connection
- Gemini CLI: surface upstream retry delay on 429 errors

## Fixes
- MITM: cannot kill process on macOS under sudo (lsof not found in PATH)
- Stream: false-positive stall timeout on Claude reasoning / Kiro responses
- Tunnel: cannot re-enable after disable (stuck state)
- Tunnel: cloudflared error messages now include log tail for easier debugging
- Language switcher: applies selected locale immediately on close (#1234)
- Antigravity OAuth: metadata now matches the official client

## Improvements
- Gemini CLI: bump engine to 0.34.0
- Re-hide `qwen` (OAuth EOL) and `iflow` (not ready) providers

# v0.4.52 (2026-05-17)

## Features
- Add Vercel AI Gateway provider support (#1183)
- rtk: Kiro format tool result compression — handle conversationState.history & currentMessage, preserve error results, ~13.6% savings (#1194)

## Fixes
- openclaw: normalize agent.model object form `{primary, fallbacks}` before .startsWith → fix TypeError & 'not configured' status (#1216)
- Usage Details pagination: stay inside mobile viewport <640px (#1218)
- Fix test model error
- Fix MIMO provider in Codex
- Disable log file creation when using MITM AG

# v0.4.50 (2026-05-16)

## Fixes
- Fix duplicate tray icon on macOS when hiding to tray
- Fix tray not showing in background mode on macOS
- Fix hide to tray broken on Windows/Linux
- Fix Shutdown button in web UI not working

# v0.4.49 (2026-05-16)

## Features
- Add Kiro provider support: full request/response translation, live model listing, reasoning content support
- Add `buildOutput` RTK filter with autodetect for npm/yarn/cargo build logs
- Add MITM warning notification in tray and dashboard

## Improvements
- Add modalities (input/output) to model configuration for OpenCode
- Fix tray hide-to-tray: keep current process alive instead of spawning detached child (fixes macOS NSStatusItem ghost icon)
- Fix tray kill: graceful shutdown with SIGTERM/SIGKILL escalation
- Fix SIGHUP handling so macOS terminal close doesn't kill tray process
- Hide deprecated providers (qwen, iflow, antigravity)
- Update i18n across 32 languages

## Fixes
- Fix model check (test-models) blocked by dashboardGuard: pass machineId-based CLI token in internal self-calls

# v0.4.46 (2026-05-15)

## Breaking Changes
- Tunnel public URL changed — old tunnel links no longer work, please reconnect to get the new URL

# v0.4.44 (2026-05-15)

## Features
- Add Blackbox provider with `bb` alias (#1143)
- Add Xiaomi token plan provider
- Enhance model select modal UX + modal traffic lights (#1111)
- Default Usage dashboard period to Today (#1141)

## Fixes
- Fix Cowork model selection and Windows CLI packaging (#1129)
- Update provider name retrieval for compatibility provider (#1135)
- Update JWT_SECRET handling

# v0.4.41 (2026-05-14)

## Features
- Add jcode CLI tool integration with auto-configuration (#1047)
- Redesign CLI Tools dashboard: grid layout (1/2/3 cols) + dedicated detail page per tool
- Add drag-and-drop reordering for combo models (#1108)
- Add Today period option to Usage & Analytics (#1063)
- Add DeepSeek V4 Pro effort aliases (#950)

## Fixes
- fix(autostart): work on nvm + npm 9/10, actually register with launchctl (#1104, fixes #1082)
- Fix Ollama usage not tracked/shown in UI (#1102)
- fix(opencode): preserve DeepSeek reasoning content (#1099, fixes #1093)
- Fix TUI input lag (replace enquirer with native readline, persistent raw mode)
- fix(ui): show API key row actions on mobile (#1112)

## Improvements
- Sync DeepSeek TUI card style with other CLI tools (badges, layout, manual config modal)
- Add official logos for Amp CLI, jcode, Qwen Code (replace generic icons)
- Resize deepseek-tui icon 1024→128 with padding for visual consistency

# v0.4.39 (2026-05-14)

## Fixes
- fix(docker): restore `/app/server.js` (v0.4.38 regression)

