# Upstream sync ledger — decolua/9router v0.5.104 → v0.5.112

Branch: `sync/upstream-0.5.112` (not merged, not tagged).

Upstream range: 70 commits (67 non-release), 325 files, +28026/−601.

This is a **partial** sync: the fixes and catalog/provider rows below are
adopted and verified locally. The large feature subsystems and the remaining
provider commits are deferred with the reasons at the end. No push, no tag.

## Adopted upstream commits

| upstream | local | what |
|---|---|---|
| `56dbf466` | `e7db9a64` | Reject SSE errors in non-streaming responses |
| `8db1f4ae` | `cbe5a880` | Enforce Gemini protobuf type predicates on schema items |
| `ced0cf6e` | `8a453e0b` | Normalize NVIDIA NIM reasoning aliases |
| `a199d777` | `7888e655` | Treat `LLM\|id\|secret` as an opaque token in bulk-add |
| `f3e1f716` | `a02c6cfa` | Claude 5.5 thinking rules on Copilot's dotted ids |
| `3fd925ab` | `071f0899` | CodeBuddy plugin request/conversation id headers (CN + intl) |
| `95009651` | `38dbb37a` | Convert `image_url` parts inside tool messages to Claude images |
| `95c9d03e` | `7394c376` | Fill missing streamed tool-call ids; restore renamed tool names |
| `5a4e812e` | `1f5afd1a` | Strip NUL bytes from bound SQLite strings |
| `5cdcddf5` | `b2d7075d` | Advance past a request-scoped 4xx instead of ending the combo |
| `5853a88a` | `a8cf3879` | Reset regex state between model matches |
| `7c42d8f8` | `c3309843` | Rename `max_tokens` to `max_completion_tokens` |
| `08ef047f` | `79428d3f` | undici 7.30.1; bind Headroom to loopback |
| `32a064e2` | `669eab7e` | Pin Node 22.23.4 (October 2026 CVEs) |
| `0ad0a722` | `de6956da` | Keep adaptive thinking for Haiku 5.5 on the passthrough |
| `763fb687` | `f23eec30` | Keep effort `max` for GPT-5.6 / GPT-6 on compatible nodes |
| `2924e055` | `8fa9c90a` | Send DeepSeek the upstream model id it accepts |
| `1da5b0d7` | `950075e4` | Cap `oc/deepseek-v4.1-flash-free` at 330k |
| `313559f4` | `d3a47274` | Honor low/high/max for the Zen free DeepSeek id |
| `32c5f30a` | `f9900090` | Send `reasoning_effort` for OpenCode's GLM-5.3-Flash-Free |
| `dbdbb648` | `988b8581` | Refresh the Copilot fallback catalog |
| `b0655314` | `c93d6599` | Give Grok 4.7 its 500k window |
| `b82f5c4a` | `40173679` | Try the next combo member when credits run out |
| `a3ca2f9b` | `c08d81cd` | Correct API key visibility guidance (i18n) |
| `3b137aa6` | `f3f39ea5` | Back off blocked CodeBuddy international connections |
| `d07e5bc3` | `94aa1fff` | Let a transport declare its thinking shape |
| `351b04cb` | `63646f4e` | Add the SenseNova provider |
| `b9c27225` | `9893babf` | Add the Runcrate provider |
| `f7f6f5ed` | `f5dd88bc` | Add the Nace Drex provider (System One) |
| `5cd4a756` | `8ab9b5a8` | Add Kimi K3.1 Pro to OpenCode Go |
| `acb3c080` | `6508cb2d` | Add GPT-6.1 Terra to Codex |
| `3ce2b828` | `0528bef0` | Normalize Anthropic ids onto Kiro aliases |
| `161e3493` | `2871a31c` | Reference images for Gemini; MITM directory |
| `a3bdaf6d` | `3e237e3f` | Add Kimi K3.1 Pro to CommandCode |
| `b08f12d5` | `69300518` | Skip ChatGPT Free accounts and use a Go-compatible image model |
| `fbac1220` | `d2895658` | Drive image_generation from gpt-6-sol |

## Fork fixes and test triage

| local | what |
|---|---|
| `728b774a` | Intl reuses the hook's request id for the conversation pair while keeping the stable conversation id |
| `3cb858a8` | Credit wording is account-scoped (backoff), not request-scoped |
| `b5f249d9` | Restore the Copilot GPT/Claude rows, drop the duplicate DeepSeek id, keep GLM-5.3-Flash-Free always-on |
| `654ede02` | Align upstream fixtures with the fork: CodeBuddy snapshots, retired OpenCode ids, fork limits, request-scoped combo semantics, Responses fixture |
| `06985d7c` | Restore `normalizeKiroUpstreamModelId`, dropped by the Kiro conflict resolution (177 Kiro tests) |
| `0d62b4dc` | Drop ZCode from the custom-logic label (`agent.md` + skill); the provider code is unchanged |

## Deferred / skipped upstream commits

| upstream | reason |
|---|---|
| `86adae35`, `792f4719`, `a440ef43` | Headroom native projection; the fork's headroom path has 143 local lines of divergence and needs a dedicated port |
| `2720cd2a` | Qoder queue/Sonus-Cantus refactor; the fork's qoder executor is a different implementation |
| `b8331283` | OpenCode free reasoning; the fork's lane already carries its own levels |
| `ca7b5401` | Combo streaming peek; the fork already falls through on empty content, streaming peek deferred |
| `4a76b8de` | CommandCode usage display; the fork's ProviderLimits is a different implementation (quota race fix) |
| `342ecb0d` | Pi settings; the fork already declares `existingProvider` |
| `38a0c449` | Web-cookie executors/browser pool (~10k lines, playwright/wreq deps); separate opt-in subsystem |
| `3b7acf72` | Docker lazy runtime deps; depends on the web-cookie subsystem |
| `d7bb71ce` | DeepSeek PoW via noble-hashes; new dependency, deferred |
| `85d73bd6` | MiniMax lease auth; touches the fork's dashboardGuard paths |
| `e70ea24d`, `ce060c79` | OpenCode fixes; the fork's lane diverged |
| `b1effa03` | CommandCode header alignment; the fork's executor/usage path differs |
| `72cb589e`, `50dcaa0c` | Pi settings; deferred |
| `00dd3dfc` | Media providers; deferred |
| `bc4a3cc7` | Ollama System One; deferred |
| `f3f86fdd` | Smart Router; touches the fork's `chat.js` ACL path |
| `8a842043` | RTK custom system prompt; touches the fork's `chat.js` |
| `9b4ea9eb` | Combo search UI; deferred |
| `31b8439b` | Usage `/api/balance`; deferred |
| `82aeb907`, `f172c3c4` | Antigravity catalog/UA; deferred |
| `483c10f5` | OpenCode fingerprint tool-definition normalization; the fork's fingerprint pass is a different implementation |
| `b6a9ca43` | Upstream test triage; superseded by the local triage commit |
| `5883110b` | Monaco 0.57; dependency upgrade deferred |
| `10cd6c08`, `31a9d262`, `421f2262` | Ollama embedding/TTS, Codex OAuth STT; deferred |
| `1fe586bb`, `3a978a63`, `f39d8f07` | Upstream release commits (version/changelog); skipped by design |

## Verification

- Full suite: 470 files, 4975 tests passed, 121 skipped, 1 todo
  (`CI=true pnpm test`, exit 0).
- Lint: `pnpm run lint` exit 0 (0 errors); `node scripts/lint-undef.cjs` and
  `node scripts/lint-reacthooks.cjs` clean.
- Production build: `SKIP_PREBUILD_LINT=1 pnpm build` exit 0, `✅ build
  complete`, `.next/standalone/server.js` emitted.
