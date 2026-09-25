<div align="center">
  <img src="./images/9router.png?1" alt="VansRouter Dashboard" width="800"/>
  
  # VansRouter

  **Universal AI API Gateway, Protocol Translator & Token Optimization Proxy**
  
  Connect any AI developer tool or client (Claude Code, Cursor, OpenCode, Codex, Cline, Kilo, etc.) to 150+ AI providers through a unified OpenAI-compatible endpoint.

  [![npm](https://img.shields.io/npm/v/vansrouter.svg)](https://www.npmjs.com/package/vansrouter)
  [![Downloads](https://img.shields.io/npm/dm/vansrouter.svg)](https://www.npmjs.com/package/vansrouter)
  [![GHCR](https://img.shields.io/badge/GHCR-vanszs%2Fvansrouter-blue?logo=github)](https://github.com/Vanszs/VansRouter/pkgs/container/vansrouter)
  [![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://github.com/Vanszs/VansRouter/blob/main/LICENSE)

  [Quick Start](#-quick-start) • [Architecture](#-architecture) • [Features](#-features) • [Client Tools](#-client-tools) • [Configuration](#-configuration)
</div>

---

## 💡 Overview

VansRouter sits between your AI coding tools and upstream model providers. It acts as an intelligent proxy that handles protocol translation, credential rotation, token compression, and multi-tier failover.

```
Client (OpenAI / Claude format)
        │
        ▼
   POST /v1/*
        │
┌───────┴─────────────────────────────────────────────┐
│                     VansRouter                      │
│                                                     │
│  1. Auth & ACL       (Verify API key, check ACL)    │
│  2. Token Saver      (RTK context compression)     │
│  3. Model Routing    (Direct, Combo, or Failover)   │
│  4. Translation      (OpenAI ↔ Claude ↔ Gemini)     │
│  5. Circuit Breaker  (Proxy & Account Health)       │
└───────┬─────────────────────────────────────────────┘
        │
        ▼
Upstream Provider (Anthropic, OpenAI, Meta, Google, DeepSeek, etc.)
```

---

## 🚀 Quick Start

### Option 1: Global CLI (Recommended for Local Dev)

Requirements: Node.js >= 22.5.0

```bash
npm install -g vansrouter
vansrouter
```

The Web Dashboard will launch at `http://localhost:20128`.

*(On macOS without NVM, run `sudo npm install -g vansrouter --prefer-online` if your global node_modules directory requires root permissions).*

### Option 2: Docker Container (Recommended for Servers)

```bash
docker run -d \
  --name vansrouter \
  -p 20128:20128 \
  -v 9router-data:/app/data \
  --restart always \
  ghcr.io/vanszs/vansrouter:X.Y.Z
```

Open `http://localhost:20128` to set up your dashboard credentials.

### Option 3: Run from Source

```bash
git clone https://github.com/Vanszs/VansRouter.git
cd VansRouter
pnpm install
pnpm run build
pnpm run start
```

---

## ⚡ Features

### 1. Unified Multi-Modal Gateway
Exposes a single OpenAI-compatible `/v1` endpoint supporting:
- **Chat & Reasoning**: OpenAI Chat, Anthropic Claude Messages, OpenAI Responses, and Google Gemini formats.
- **Vision & Document OCR**: Multimodal image-to-text understanding and document parsing (`imageToText`).
- **Image Generation**: DALL-E, FLUX, Imagen, Muse Image, and custom diffusion endpoints (`/v1/images/generations`).
- **Speech & Audio**: Real-time Text-to-Speech (`/v1/audio/speech`) and Audio Transcription / STT (`/v1/audio/transcriptions`).
- **Text Embeddings**: Vector embedding models across OpenAI, Qwen, Perplexity, and custom self-hosted nodes (`/v1/embeddings`).
- **Web Search**: Built-in unauthenticated local SearXNG search or provider-backed search integration.

### 2. Lossless Protocol Translation
Send standard OpenAI requests to Anthropic Claude or Google Gemini models, or vice versa, without rewriting your client code. VansRouter handles tool-call schema conversion, stream chunk demuxing, thinking tags (`<think>`), and token estimation automatically.

### 3. Token & Context Optimization
- **RTK (Real-Time Compression)**: Analyzes and trims repetitive tool outputs (`git diff`, `grep`, directory trees, test logs) within context history, reducing payload sizes on long sessions.
- **Caveman Mode**: Injects concise communication prompts to reduce verbose assistant replies.
- **Ponytail Mode**: Enforces lazy-senior-developer principles to minimize unnecessary boilerplate generation.
- **LoopGuard Protection**: Protects against model reasoning and tool-calling loops with $O(K)$ bounded sliding window checks, preventing event-loop stalls on 1,000+ message histories.

### 4. Multi-Account Rotation & Failover
- **Combo Routing**: Combine multiple providers under a single virtual model name with customizable fallback strategies (Priority Fallback, Round-Robin, Fusion Judge, and Capacity Auto-Switch).
- **Circuit Breakers**: Tracks consecutive upstream failures and temporary 429 rate limits, automatically routing traffic to healthy standby accounts or proxy pools.
- **Proxy Pool Integration**: Bind specific providers or accounts to SOCKS5/HTTP proxy pools with health scoring.

### 5. Multi-Tenant Access Control (ACL)
Issue scoped API keys with granular permissions:
- Restrict keys to specific **Providers** (e.g. only Claude and DeepSeek).
- Restrict keys to specific **Combos** or **Models**.
- Restrict keys to specific **Service Kinds** (e.g., allow `llm` and `web`, deny `image` or `tts`).

---

## 🛠️ Client Tools Setup

Configure your favorite AI agent by pointing its base URL to VansRouter:

### OpenCode
```json
{
  "provider": {
    "vansrouter": {
      "name": "VansRouter",
      "api": "https://api.meta.ai/v1", // or http://localhost:20128/v1
      "type": "openai",
      "key": "your-vansrouter-api-key"
    }
  }
}
```

### Claude Code CLI
```bash
export ANTHROPIC_BASE_URL="http://localhost:20128"
export ANTHROPIC_API_KEY="your-vansrouter-api-key"
claude
```

### Cursor IDE
1. Open Cursor Settings → **Models** → **OpenAI API Key**.
2. Set **Base URL**: `http://localhost:20128/v1`
3. Enter your VansRouter API key.
4. Add desired model names (e.g., `claude-sonnet-4.5`, `gpt-5.4`, `deepseek-v4-flash`).

### Codex CLI
In `~/.codex/config.toml`:
```toml
model = "claude-sonnet-4.5"
model_provider = "openai-chat-completions"

[model_providers.openai-chat-completions]
base_url = "http://localhost:20128/v1"
env_key = "VANSROUTER_API_KEY"
```

---

## ⚙️ Configuration

VansRouter is configured via environment variables:

| Variable | Default | Description |
|---|---|---|
| `PORT` | `20128` (or `3003`) | Port to listen on. |
| `HOSTNAME` | `0.0.0.0` | Bind host address. |
| `DATA_DIR` | `~/.9router` | Root directory for persistent SQLite database and backups. |
| `REQUIRE_API_KEY` | `false` | Enforce valid Bearer API key on all `/v1/*` routes. |
| `JWT_SECRET` | Auto-generated | Secret for signing dashboard session cookies. |
| `INITIAL_PASSWORD` | none in production | Strong first-login password; required until a password hash is stored. |
| `HTTP_PROXY`, `HTTPS_PROXY` | `""` | Outbound proxy for upstream provider requests. |
| `SEARXNG_URL` | `http://127.0.0.1:8888/search` | Endpoint for the local SearXNG search provider. |

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
