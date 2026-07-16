<div align="center">
  <img src="./images/9router.png" alt="VansRoute Dashboard" width="800"/>

  # ⚡ VansRoute

  ### Universal AI Gateway — One Endpoint, Every Provider

  *VansRoute combines the provider breadth of 9router with the routing intelligence of OmniRoute, then re-optimizes everything for a faster, more personal AI gateway experience.*

  **Circuit breaker resilience · Kimchi CLI-native · RTK token compression · 40+ providers · 214 tests**

  [![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
  [![Tests](https://img.shields.io/badge/tests-214%20passing-brightgreen)](#-testing)
  [![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](./package.json)
  [![Next.js](https://img.shields.io/badge/Next.js-16-black)](./package.json)

  [🚀 Quick Start](#-quick-start) • [💡 Features](#-key-features) • [🔄 Architecture](#-how-it-works) • [📊 Comparison](#-comparison-vansroute-vs-9router-vs-omniroute) • [🧭 Beginner Guide](#-beginner-setup-guide) • [🙏 Credits](#-credits--references)

  [🇮🇩 Bahasa Indonesia](./README.md) • [🇻🇳 Tiếng Việt](./i18n/README.vi.md) • [🇨🇳 中文](./i18n/README.zh-CN.md) • [🇯🇵 日本語](./i18n/README.ja-JP.md) • [🇷🇺 Русский](./i18n/README.ru.md)
</div>

---

> ⚠️ **Status: porting in progress**
>
> We are currently porting VansRoute to **Go**. During this transition, updates may be slower than usual.
> Incoming commits will **focus on bug fixes only** — please open issues for any bugs you find, but hold off on new feature requests until the Go port stabilizes.
> The current Node.js build remains the recommended way to run VansRoute in the meantime.

---

## 🤔 Why VansRoute?

**Stop wasting money, tokens and hitting limits:**

- ❌ Subscription quota expires unused every month
- ❌ Rate limits stop you mid-coding
- ❌ Tool outputs (git diff, grep, ls...) burn tokens fast
- ❌ 1 provider error → all accounts blocked
- ❌ Manual reactivation after quota reset

**VansRoute solves this:**

- ✅ **RTK Token Saver** — Auto-compress tool_result content, save 20-40% tokens
- ✅ **Circuit Breaker** — If a provider dies, trip the breaker and route to the next one. No cascade.
- ✅ **Account Semaphore** — Per-account concurrency limiter prevents hammering one account
- ✅ **Kimchi CLI-native** — VansRoute's Kimchi provider mimics the official Kimchi CLI exactly
- ✅ **Quota Auto-Reactivation** — Kimchi credits run out → auto-parked until next month → auto-reactivated
- ✅ **Proxy-Aware Resilience** — One dead proxy doesn't block accounts on other proxies
- ✅ **Per-API-key ACL** — Hand out keys that can only touch specific providers/combos/kinds
- ✅ **40+ Providers** — Kimchi, GitHub Copilot, Codex, Gemini, OpenCode, Kilo, NVIDIA, AgentRouter, + more

---

## 📊 Comparison: VansRoute vs 9Router vs OmniRoute

### Logic & Backend — what each has

| Capability | 9Router | OmniRoute | **VansRoute** |
|---|---|---|---|
| **Resilience engine: circuit breaker** | ❌ | ✅ TypeScript + DB-backed persistence | ✅ In-memory JS state machine (CLOSED→DEGRADED→OPEN→HALF_OPEN), no DB dependency |
| **Resilience engine: account semaphore** | ❌ | ✅ TypeScript FIFO queue | ✅ JS account-level FIFO queue with capacity errors, queue draining, and runtime stats |
| **Provider failure tracking** | ❌ | ✅ 5s dedup window | ✅ Deduplicated failure recording with bounded 10K entry map + automatic cooldown |
| **Intelligent breaker classification** | ❌ N/A | ❌ 429 counts toward breaker | ✅ Only 5xx/timeout/network errors trip the breaker; 429 is treated as account-level rate-limit |
| **Proxy-aware resilience** | ❌ | ❌ | ✅ Circuit breaker, semaphore, and account fallback all keyed by `provider:account:proxyHash` so one dead proxy never blocks others |
| **Proxy-aware HTTP layer** | ❌ | ❌ | ✅ Proxy resolution, hashing, no-proxy bypass, and env-proxy normalization built into the fetch path |
| **Account fallback & cooldown** | ❌ | ✅ | ✅ Quota-exhaustion detection, provider cooldown, and breaker-aware fallback in one pipeline |
| **Credential lifecycle automation** | ❌ | ❌ | ✅ OAuth refresh scheduler with stale detection, refreshed-credential merging, and expiry tracking |
| **API-key ACL (multi-tenant)** | ✅ providers only | ❌ | ✅ Per-key ACL for providers, combos, and service kinds; enforced in auth + model resolution |
| **Universal format translator** | ✅ OpenAI↔Claude↔Gemini↔Kiro | ✅ | ✅ Bidirectional request/response translation with unified thinking/reasoning extraction |
| **Provider-agnostic SSE streaming core** | ✅ | ✅ | ✅ Shared base executor, SSE frame parsing, NDJSON wrapping, and stream-error normalization |
| **Loop-guard & protocol prompts** | ❌ | ❌ | ✅ Detects infinite tool loops and injects termination/tool-protocol prompts |
| **Token compression pipeline** | ✅ RTK | ✅ RTK + Caveman | ✅ RTK + Caveman + Ponytail + Headroom, injected before translation |
| **Combo routing strategies** | 4 (fallback / round-robin / fusion / capacity) | 17 strategies | 4 inherited strategies (fallback / round-robin / fusion / capacity) |
| **Settings hot-cache** | ❌ 3 sync DB reads per request | ❌ | ✅ 5s TTL in-memory cache eliminates repeated settings reads |
| **Connections hot-cache** | ❌ 1 sync DB read per request | ❌ | ✅ 2s TTL in-memory cache with write-time invalidation |
| **Per-provider parallel selection** | ❌ global mutex | ❌ | ✅ Per-provider mutex allows concurrent credential selection across different providers |
| **Model lockout / rate-limit gating** | ✅ DB flat field | ✅ in-memory Map | ✅ DB flat field with inherited lockout logic |
| **Usage tracking & estimation** | ✅ basic | ✅ | ✅ Token usage normalization, input/output estimation, and buffered usage logging |
| **Structured error mapping** | ✅ | ✅ | ✅ Central error config, provider-specific messages, OpenAI-format error bodies, and retry-after parsing |
| **Runtime-adaptive SQLite backend** | ✅ better-sqlite3 only | ❌ | ✅ Auto-selects better-sqlite3 / Bun / node:sqlite / sql.js depending on runtime |
| **Database migration engine** | ✅ | ✅ | ✅ Versioned migrations, schema sync, legacy import, and automatic backups |
| **Instrumentation hooks** | ❌ | ❌ | ✅ Next.js instrumentation hook schedules periodic background reactivation tasks |
| **Dashboard & API middleware** | ✅ basic | ✅ | ✅ Dashboard guard, public-LLM-API access control, and real-client-IP extraction |
| **Provider registry pluggability** | ✅ static JS registry | ✅ static JS registry | ✅ Registry per provider + capability/alias/ACL catalog |
| **Provider breadth** | 40+ | 231+ | 40+ |

### What VansRoute has that neither 9Router nor OmniRoute has

1. **Zero-DB resilience stack** — circuit breaker + account semaphore + failure tracking run entirely in-memory, removing the `domainState.js`/DB dependency found in OmniRoute.
2. **Proxy-aware everything** — breaker, semaphore, account fallback, and HTTP fetch are all keyed by proxy hash, so a dead proxy isolates itself instead of taking the whole provider down.
3. **Dual hot-cache + per-provider parallelism** — settings cache (5s TTL) + connections cache (2s TTL with invalidation) + per-provider mutex = far fewer synchronous DB reads per request than 9Router's global-mutex approach.
4. **Credential lifecycle automation** — built-in OAuth refresh scheduler, stale-credential detection, and refreshed-token merging keep long-lived connections alive without manual reconnection.
5. **Loop-guard & protocol prompt injection** — detects repetitive tool-call loops and injects termination/tool-protocol prompts to nudge models toward clean completion.

### What VansRoute does NOT have (yet)

- OmniRoute's 17 combo strategies (VansRoute has 4)
- OmniRoute's `sessionPool` with fingerprint rotation
- OmniRoute's `autoCombo` with complexity routing and task fitness scoring
- OmniRoute's broader provider registry (231 vs 40+)

---

## 🔄 How It Works

```
┌─────────────┐
│  Your CLI   │  (Claude Code, Codex, Cursor, Cline, OpenCode...)
│   Tool      │
└──────┬──────┘
       │ POST http://localhost:3003/v1/chat/completions
       ↓
┌──────────────────────────────────────────────────────────┐
│                     VansRoute Engine                      │
│                                                           │
│  1. Auth & ACL check (cached API key validation)          │
│  2. Circuit Breaker check (skip dead proxy buckets)      │
│  3. Account Semaphore (queue if at concurrency cap)      │
│  4. RTK / Caveman / Ponytail token compression           │
│  5. Format translation (OpenAI ↔ Claude ↔ Gemini ↔ Kiro) │
│  6. Kimchi CLI-aligned param stripping                    │
│  7. Executor → upstream provider (via proxy if configured) │
│  8. Response translation back to client format            │
│                                                           │
│  On success: clearProviderFailure() + clearAccountError  │
│  On error:  recordProviderFailure() → breaker counts      │
│             markAccountUnavailable() → try next account   │
│             Kimchi quota? → deactivate until month end   │
└──────────────────────────────────────────────────────────┘
       │
       ├─→ Kimchi (5 CLI models, quota auto-reactivation)
       ├─→ AgentRouter ($200 free credits, passthrough)
       ├─→ GitHub Copilot / Codex (subscription tier)
       ├─→ Gemini CLI / OpenCode (free tier)
       ├─→ OpenRouter / NVIDIA / others
       └─→ Combo (fallback / round-robin / fusion / capacity)
```

---

## 🚀 Quick Start

```bash
git clone https://github.com/Vanszs/VansRouter.git
cd VansRouter
pnpm install
pnpm run build
cp -r public .next/standalone/public
cp -r .next/static .next/standalone/.next/static
pnpm start
```

Open `http://localhost:3003/dashboard`, add provider connections, generate a VansRoute API key, and point your CLI to `http://localhost:3003/v1`.

> **Port convention:** `pnpm dev` runs on `http://localhost:20127`. `pnpm start` (production / standalone) defaults to `http://localhost:3003` unless you override `PORT` in `.env`.

### PM2 (production)

```bash
npm install -g pm2
PORT=3003 pm2 start server.js --name vansroute
pm2 save
```

### NPM (global, recommended for desktop)

If you just want to run VansRouter as a CLI on your machine:

```bash
npm install -g vansrouter
vansrouter
# or run directly
npx vansrouter
```

This pulls the published package from https://www.npmjs.com/package/vansrouter and launches the dashboard at `http://localhost:20128`.

### Docker

```bash
docker run -d \
  -p 3003:3003 \
  -v vansrouter-data:/home/node/.vansrouter \
  --name vansrouter \
  ghcr.io/vanszs/vansrouter:latest
```

---

## 🧭 Beginner Setup Guide

Set `X-9Router-Token-Saver: off` to bypass all token savers for one chat request.

<details>
<summary><b>🪟 Windows (from zero)</b></summary>

### Step 1 — Install Node.js

1. Go to https://nodejs.org → download **LTS** (e.g. `node-v22.x.x-x64.msi`)
2. Run installer, check "Add to PATH"
3. Verify: `node --version` and `npm --version`

### Step 2 — Install pnpm

```cmd
npm install -g pnpm
pnpm --version
```

### Step 3 — Install Git

Download from https://git-scm.com/download/win, install with defaults.

### Step 4 — Clone and install

```cmd
git clone https://github.com/Vanszs/VansRouter.git
cd VansRouter
copy .env.example .env
pnpm install
```

### Step 5 — Configure `.env`

```
JWT_SECRET=ganti-dengan-string-acak-panjang
INITIAL_PASSWORD=passwordmu
DATA_DIR=C:\Users\NamaKamu\.vansroute
PORT=3003
NODE_ENV=production
NEXT_PUBLIC_BASE_URL=http://localhost:3003
```

### Step 6 — Build

```cmd
pnpm run build
```

### Step 7 — Run

```cmd
pnpm start
```

Open: http://localhost:3003

### Windows PM2 (auto-start)

```cmd
npm install -g pm2 pm2-windows-startup
pm2 start server.js --name vansroute
pm2-startup install
pm2 save
```

</details>

<details>
<summary><b>🐧 Linux / WSL (from zero)</b></summary>

```bash
# Install Node.js 20+
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install pnpm
npm install -g pnpm

# Clone
git clone https://github.com/Vanszs/VansRouter.git
cd VansRouter
cp .env.example .env
pnpm install

# Configure
nano .env  # set JWT_SECRET, INITIAL_PASSWORD, PORT

# Build & run
pnpm run build
cp -r public .next/standalone/public
cp -r .next/static .next/standalone/.next/static
pnpm start
```

### PM2 (production)

```bash
npm install -g pm2
PORT=3003 pm2 start server.js --name vansroute
pm2 startup
pm2 save
```

</details>

<details>
<summary><b>🐳 Docker</b></summary>

```bash
docker run -d \
  -p 20128:20128 \
  -v "$HOME/.9router:/app/data" \
  -e DATA_DIR=/app/data \
  --name vansrouter \
  ghcr.io/vanszs/vansrouter:latest
```

Or with docker-compose:

```bash
docker-compose up -d
```

</details>

---

## 🛠️ Supported CLI Tools

| Tool | Status | Config Path |
|------|--------|-------------|
| **Claude Code** | ✅ Full support | `~/.claude/settings.json` |
| **Codex** | ✅ Full support | `~/.codex/config.json` |
| **Cursor** | ✅ Full support | Settings → Models → OpenAI API |
| **Cline** | ✅ Full support | VS Code extension settings |
| **OpenCode** | ✅ Full support | `opencode.json` |
| **OpenClaw** | ✅ Full support | CLI config |
| **GitHub Copilot** | ✅ Full support | `hub.github.com` |
| **Gemini CLI** | ✅ Full support | `~/.gemini/config.json` |
| **Antigravity** | ✅ Full support | Antigravity settings |
| **Copilot** | ✅ Full support | VS Code extension |
| **Kilo** | ✅ Full support | Kilo settings |
| **Cline** | ✅ Full support | Cline settings |
| **DeepSeek TUI** | ✅ Full support | DeepSeek config |
| **Jcode** | ✅ Full support | Jcode settings |
| **Droid** | ✅ Full support | Droid config |
| **Hermes** | ✅ Full support | Hermes config |

---

## 🌐 Supported Providers

### Free Tier Providers

| Provider | Free Quota | Models |
|----------|-----------|-------|
| **Kimchi** (CLI-aligned) | ~1.6B tokens/month | kimi-k2.7, minimax-m3, kimi-k2.6, nemotron-3-ultra-fp4, glm-5.2-fp8 |
| **AgentRouter** | $200 free credits | Passthrough (any model) |
| **Kilo** | Free tier | Various |
| **OpenCode** | Free tier | Various |
| **Gemini CLI** | Free tier | Gemini models |

### Subscription Providers

| Provider | Auth | Models |
|----------|------|-------|
| **GitHub Copilot** | OAuth | Claude, GPT, Gemini |
| **Codex** | OAuth | GPT models |
| **Antigravity** | OAuth | Various |
| **Gemini CLI** | OAuth | Gemini models |

### API Key Providers

| Provider | Type | Notable Models |
|----------|------|----------------|
| **OpenRouter** | Passthrough | 100+ models |
| **NVIDIA NIM** | Per-model | Kimi K2.6, Llama, GLM |
| **SiliconFlow** | Per-model | GLM, DeepSeek, Qwen |
| **Z.AI** | Per-model | GLM series |
| + 30+ more | Various | Various |

---

## 💡 Key Features

### Resilience Engine

| Feature | What it does |
|---------|-------------|
| **Circuit Breaker** | Per-proxy-bucket state machine: CLOSED → DEGRADED → OPEN → HALF_OPEN. After 5 failures (5xx/timeout only, not 429), provider is skipped until probe succeeds. |
| **Account Semaphore** | Per `provider:account:proxyHash` FIFO queue with 30s timeout. Default maxConcurrency = 3. |
| **Provider Failure Tracking** | `recordProviderFailure()` with 5s dedup per connection, bounded to 10K entries. |
| **Proxy-Aware** | Breaker and semaphore keyed by `provider:proxyHash`. One dead proxy doesn't block others. |
| **Quota Auto-Reactivation** | Kimchi accounts auto-deactivated on credit exhaustion, auto-reactivated on the 1st of each month. |

### Kimchi CLI Alignment

| Model | Reasoning | Vision | Temperature | Structured Output |
|-------|-----------|--------|-------------|-------------------|
| `kimchi/kimi-k2.7` | ✅ toggle off | ✅ + video | ❌ (CLI: false) | ✅ |
| `kimchi/kimi-k2.6` | ✅ toggle | ✅ + video | ✅ | ✅ |
| `kimchi/minimax-m3` | ✅ | ✅ | ✅ | — |
| `kimchi/nemotron-3-ultra-fp4` | ❌ | ❌ | ✅ | — |
| `kimchi/glm-5.2-fp8` | ✅ (OpenAI) | ❌ | ✅ | — |

### Token Compression

| Saver | What it does | Savings |
|-------|-------------|---------|
| **RTK** | Compresses `tool_result` content before sending upstream | 20-40% |
| **Caveman** | Instructs the model to respond in ultra-terse mode | 15-75% |
| **Ponytail** | Forces the laziest (simplest) code output | 10-50% |
| **Headroom** | External compression service (optional) | Variable |

### Combo Strategies

| Strategy | Description |
|----------|-------------|
| **Fallback** | Try provider A → if fail → try B → if fail → try C |
| **Round Robin** | Rotate across providers evenly |
| **Fusion** | Send to multiple providers in parallel, judge picks best response |
| **Capacity** | Auto-switch based on provider availability and load |

### Other Features

- **Per-API-key ACL** — scope each key to specific providers, combos, and model kinds
- **Secured `/v1` by default** — safe to expose on a VPS
- **Kiro format support** — with provider/combo/kind ACLs
- **NVIDIA Kimi stream coercion** — forces `stream:false` upstream, translates back to SSE
- **Kimi native tool parser** — handles leaked `functions.NAME:ID {JSON}` markup
- **Compact request handling** — trims redundant context before dispatch
- **Settings cache** — 5s TTL, eliminates sync DB reads per request
- **Connections cache** — 2s TTL with invalidation on writes

---

## 💰 Pricing at a Glance

| Tier | Providers | Cost | Best For |
|------|-----------|------|----------|
| **Free** | Kimchi, AgentRouter, Kilo, OpenCode | $0 | Hobby / testing |
| **Subscription** | GitHub Copilot, Codex, Antigravity | $10-20/mo | Professional coding |
| **Pay-per-use** | OpenRouter, NVIDIA, SiliconFlow | $0.2-3/1M tokens | Production scale |
| **Combo** | Mix of above | $0-20/mo | Best of all worlds |

---

## 🎯 Use Cases

### Solo Developer
- Connect Claude Code to Kimchi (free) + GitHub Copilot (subscription)
- RTK saves 30% tokens on tool outputs
- Circuit breaker prevents downtime when Kimchi rate-limits

### Team Lead
- Per-API-key ACL: dev keys can only use Kimchi (free), prod keys use Copilot
- Combo: fallback from Copilot → Kimchi → AgentRouter
- Usage dashboard tracks spend per key

### VPS Deployment
- PM2 + standalone build = production-grade
- Proxy-aware resilience: if one proxy dies, others keep working
- Kimchi quota auto-reactivation: no manual babysitting

---

## ❓ Frequently Asked Questions

<details>
<summary><b>Why is VansRoute faster than 9Router?</b></summary>

VansRoute caches `getSettings()` (5s TTL) and `getProviderConnections()` (2s TTL), eliminating 4+ synchronous `better-sqlite3` reads per request. The per-provider mutex (replacing the global mutex) allows parallel credential selection across different providers.
</details>

<details>
<summary><b>What happens when Kimchi credits run out?</b></summary>

The account is automatically deactivated (`isActive: false`, `testStatus: "quota_exhausted"`, `rateLimitedUntil` set to the 1st of next month). On the 1st, `reactivateExpiredKimchiAccounts()` runs via the instrumentation hook and reactivates all exhausted accounts. No manual intervention needed.
</details>

<details>
<summary><b>What happens when a proxy dies?</b></summary>

The circuit breaker for that specific proxy bucket (`provider:proxyHash`) trips OPEN after 5 failures. Accounts using that proxy are skipped. Accounts on other proxies continue working normally. The breaker automatically enters HALF_OPEN after the reset timeout to probe recovery.
</details>

<details>
<summary><b>Does 429 trip the circuit breaker?</b></summary>

No. 429 (rate limit) is per-account, not per-provider. Only 408, 500, 502, 503, 504 count toward the circuit breaker. This prevents false trips when multiple accounts hit rate limits simultaneously.
</details>

<details>
<summary><b>How do I add a new provider?</b></summary>

1. Create `open-sse/providers/registry/{providerId}.js` following the `REGISTRY_TEMPLATE`
2. Add models to the provider entry
3. Add the provider ID to `src/shared/constants/providers.js`
4. Regenerate the registry index if needed
</details>

<details>
<summary><b>Is VansRoute compatible with 9Router configs?</b></summary>

Yes. VansRoute retains full format compatibility with 9Router. The DB schema, API endpoints, and CLI tool configurations are identical. You can migrate by copying your `.vansroute/` data directory.
</details>

---

## 📖 Setup Guide

### 1. Environment Variables

```env
# Required
JWT_SECRET=your-random-secret-at-least-32-chars
INITIAL_PASSWORD=your-dashboard-password
PORT=3003

# Optional
DATA_DIR=~/.vansroute        # Default: ~/.vansroute
NODE_ENV=production
NEXT_PUBLIC_BASE_URL=http://localhost:3003
ANTIGRAVITY_TIMEOUT_MS=15000 # Antigravity quota fetch timeout
```

### 2. Build & Run

```bash
pnpm install
pnpm run build
cp -r public .next/standalone/public
cp -r .next/static .next/standalone/.next/static
pnpm start
```

### 3. Dashboard Configuration

1. Open `http://localhost:3003/masuk` (login)
2. Go to **Providers** → add API keys / OAuth
3. Go to **Settings** → generate VansRoute API key
4. Go to **CLI Tools** → configure your tool (Claude Code, Codex, etc.)
5. Point your CLI to `http://localhost:3003/v1`

### 4. Kimchi Setup

VansRoute's Kimchi provider exposes exactly 5 models matching the Kimchi CLI:

```json
{
  "model": "kimchi/kimi-k2.6",
  "baseURL": "http://localhost:3003/v1",
  "apiKey": "your-vansroute-key"
}
```

When credits run out, accounts are auto-parked until the 1st of next month.

### 5. Combo Setup

Create a combo in the dashboard to enable fallback:

```
combo/my-fallback:
  1. kimchi/kimi-k2.6 (free)
  2. openrouter/anthropic/claude-3.5-sonnet (paid)
  3. nvidia/moonshotai/kimi-k2.6(high) (free)
```

---

## 📊 Available Models

### Kimchi (CLI-aligned, 5 models)

| Model ID | Family | Context | Max Output | Reasoning |
|----------|--------|---------|------------|-----------|
| `kimchi/kimi-k2.7` | kimi-k2 | 262K | 262K | ✅ (toggle off) |
| `kimchi/kimi-k2.6` | kimi-k2 | 262K | 262K | ✅ (toggle) |
| `kimchi/minimax-m3` | minimax | 1M | 512K | ✅ |
| `kimchi/nemotron-3-ultra-fp4` | nemotron | 128K | 8K | ❌ |
| `kimchi/glm-5.2-fp8` | glm | 128K | 128K | ✅ (OpenAI) |

### NVIDIA NIM (Kimi variants)

| Model ID | Upstream ID | Max Tokens |
|----------|-------------|------------|
| `nvidia/moonshotai/kimi-k2.6(none)` | moonshotai/kimi-k2.6 | 16384 |
| `nvidia/moonshotai/kimi-k2.6(low)` | moonshotai/kimi-k2.6 | 16384 |
| `nvidia/moonshotai/kimi-k2.6(medium)` | moonshotai/kimi-k2.6 | 16384 |
| `nvidia/moonshotai/kimi-k2.6(high)` | moonshotai/kimi-k2.6 | 16384 |

### AgentRouter (passthrough)

Any model ID works — AgentRouter routes to the upstream provider.

---

## 🐛 Troubleshooting

| Error | Cause | Solution |
|-------|-------|----------|
| `EADDRINUSE` | Port already in use | Change `PORT` in `.env` or kill the process |
| `EACCES` | Permission denied | Run as admin (Windows) or check folder permissions |
| `Model not found` | Wrong model ID | Check `/v1/models` for available models |
| `expanded is not defined` | — | ✅ Fixed in VansRoute |
| `handleViewDetail is not defined` | — | ✅ Fixed in VansRoute |
| Kimchi always 503 | All accounts rate-limited | Wait for cooldown or add more accounts |
| Kimchi quota exhausted | Credits used up | Auto-reactivates on the 1st of next month |
| Provider circuit breaker open | 5+ failures (5xx) | Wait 30s for HALF_OPEN probe |

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| **Framework** | Next.js 16 (standalone output) |
| **Runtime** | Node.js 20+ |
| **Database** | better-sqlite3 (synchronous, cached) |
| **Process Manager** | PM2 |
| **Container** | Docker / docker-compose |
| **Testing** | Vitest (214 tests) |
| **Language** | JavaScript ESM (.js) |
| **Package Manager** | pnpm |

---

## 📝 API Reference

### Chat Completions

```http
POST /v1/chat/completions
Authorization: Bearer <your-vansroute-key>
Content-Type: application/json

{
  "model": "kimchi/kimi-k2.6",
  "messages": [{"role": "user", "content": "Hello"}],
  "stream": true
}
```

### Models List

```http
GET /v1/models
Authorization: Bearer <your-vansroute-key>
```

### Embeddings

```http
POST /v1/embeddings
Authorization: Bearer <your-vansroute-key>
Content-Type: application/json

{
  "model": "nvidia/nv-embedqa-e5-v5",
  "input": "text to embed"
}
```

### Image Generation

```http
POST /v1/images/generations
Authorization: Bearer <your-vansroute-key>
Content-Type: application/json

{
  "model": "openai/gpt-image-1",
  "prompt": "a cat"
}
```

### Claude Messages (Anthropic format)

```http
POST /v1/messages
Authorization: Bearer <your-vansroute-key>
Content-Type: application/json

{
  "model": "kimchi/kimi-k2.6",
  "max_tokens": 1024,
  "messages": [{"role": "user", "content": "Hello"}]
}
```

---

## 🧪 Testing

```bash
# All tests
pnpm test

# Unit tests only
pnpm test tests/unit/

# Translator tests
pnpm test tests/translator/

# Targeted resilience + Kimchi audit suite (214 tests)
npx vitest run --config tests/vitest.config.js --pool=forks \
  tests/unit/kimi-max-tokens.test.js \
  tests/unit/kimchi-cli-derived.test.js \
  tests/unit/kimchi-cli-config.test.js \
  tests/unit/kimchi-quota-reactivation.test.js \
  tests/unit/loop-guard.test.js \
  tests/unit/loop-guard-wiring.test.js \
  tests/unit/termination-prompt.test.js \
  tests/unit/kimi-nvidia-hardening.test.js \
  tests/unit/kimi-native-tool-parser.test.js \
  tests/translator/thinking-unified.test.js \
  tests/unit/circuit-breaker.test.js \
  tests/unit/account-semaphore.test.js \
  tests/unit/proxy-aware-resilience.test.js
```

---

## 📁 Project Structure

```
VansRouter/
├── src/
│   ├── shared/utils/
│   │   └── circuitBreaker.js              # Circuit breaker (CLOSED→OPEN→HALF_OPEN)
│   ├── sse/
│   │   ├── handlers/chat.js               # Retry loop with breaker + semaphore
│   │   └── services/
│   │       └── kimchiQuotaReactivation.js  # Monthly auto-reactivation
│   ├── lib/
│   │   ├── network/connectionProxy.js      # getProxyHash() for proxy-aware resilience
│   │   └── db/repos/
│   │       ├── settingsRepo.js             # Cached getSettings() (5s TTL)
│   │       └── connectionsRepo.js         # Cached getProviderConnections() (2s TTL)
│   ├── instrumentation.js                 # Next.js startup hook
│   └── app/                               # Dashboard + API routes
├── open-sse/
│   ├── services/
│   │   ├── accountFallback.js             # + provider failure tracking (proxy-aware)
│   │   └── accountSemaphore.js            # Per-account concurrency limiter (proxy-aware)
│   ├── utils/
│   │   └── circuitBreaker.js              # Circuit breaker
│   ├── providers/registry/
│   │   ├── kimchi.js                      # 5 CLI-aligned models
│   │   └── agentrouter.js                 # Passthrough ($200 free)
│   └── handlers/chatCore.js               # Core SSE engine
├── tests/unit/
│   ├── circuit-breaker.test.js            # 16 tests
│   ├── account-semaphore.test.js          # 17 tests
│   ├── proxy-aware-resilience.test.js     # 16 tests
│   ├── kimchi-cli-config.test.js          # 10 tests
│   ├── kimchi-quota-reactivation.test.js  # 10 tests
│   └── ...                                # Full audit suite
└── .docs/audit/                           # Audit documentation
```

---

## 📧 Support

- **GitHub Issues**: [Vanszs/VansRouter/issues](https://github.com/Vanszs/VansRouter/issues)

---

## 👥 Contributors

Thanks to all contributors who helped make VansRoute better!

[![Contributors](https://contrib.rocks/image?repo=Vanszs/VansRouter&max=150&columns=15&anon=1)](https://github.com/Vanszs/VansRouter/graphs/contributors)

---

## 🙏 Credits & References

VansRoute builds on the work of two excellent open-source projects:

- **[9Router](https://github.com/decolua/9router)** by [@decolua](https://github.com/decolua) — the foundation: provider registry, RTK token saver, format translation, combo strategies, per-API-key ACL, Kimi native tool parser, NVIDIA stream coercion. VansRoute started as a hardened fork of 9Router and retains full format compatibility.

- **[OmniRoute](https://github.com/diegosouzapw/OmniRoute)** by [@diegosouzapw](https://github.com/diegosouzapw) — the resilience inspiration: circuit breaker pattern, account semaphore, provider-level failure tracking, provider exhaustion detection. VansRoute ported these concepts from OmniRoute's TypeScript implementation to plain JavaScript ESM, simplified the persistence layer (in-memory instead of DB-backed), and added Kimchi-specific quota auto-reactivation.

Full credit to both projects. VansRoute stands on their work.

---

## 📄 License

MIT — see [LICENSE](./LICENSE)
