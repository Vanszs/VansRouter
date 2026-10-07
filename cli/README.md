# VansRouter - FREE AI Router & Token Saver

**Never stop coding. Save 20-40% tokens with RTK + auto-fallback to FREE & cheap AI models.**

**Connect All AI Code Tools (Claude Code, Cursor, Antigravity, Copilot, Codex, Gemini, OpenCode, Cline, OpenClaw...) to 40+ AI Providers & 100+ Models.**

[![npm](https://img.shields.io/npm/v/vansrouter.svg)](https://www.npmjs.com/package/vansrouter)
[![Downloads](https://img.shields.io/npm/dm/vansrouter.svg)](https://www.npmjs.com/package/vansrouter)
[![Docker Pulls](https://img.shields.io/docker/pulls/vanszs/vansrouter.svg?logo=docker&label=Docker%20pulls)](https://hub.docker.com/r/vanszs/vansrouter)
[![GHCR](https://img.shields.io/badge/GHCR-Vanszs%2FVansRouter-blue?logo=github)](https://github.com/Vanszs/VansRouter/pkgs/container/VansRouter)
[![License](https://img.shields.io/npm/l/vansrouter.svg)](https://github.com/Vanszs/VansRouter/blob/main/LICENSE)


[🌐 Website](http://localhost:20128) • [📖 Full Docs](https://github.com/Vanszs/VansRouter)

---

## 🤔 Why VansRouter?

**Stop wasting money, tokens and hitting limits:**

- ❌ Subscription quota expires unused every month
- ❌ Rate limits stop you mid-coding
- ❌ Tool outputs (git diff, grep, ls...) burn tokens fast
- ❌ Expensive APIs ($20-50/month per provider)

**VansRouter solves this:**

- ✅ **RTK Token Saver** - Auto-compress tool_result, save 20-40% tokens
- ✅ **Maximize subscriptions** - Track quota, use every bit before reset
- ✅ **Auto fallback** - Subscription → Cheap → Free, zero downtime
- ✅ **Multi-account** - Round-robin between accounts per provider
- ✅ **Universal** - Works with any OpenAI/Claude-compatible CLI

---

## ⚡ Quick Start

**Option 1 — npm (recommended for desktop):**

```bash
npm install -g vansrouter
vansrouter

# Or run directly with npx
npx vansrouter
```

**Option 2 — Docker (server/VPS):**

```bash
docker run -d --name vansrouter -p 20128:20128 \
  -v "$HOME/.9router:/app/data" \
  -e DATA_DIR=/app/data \
  -e INITIAL_PASSWORD="$(openssl rand -base64 24)" \
  ghcr.io/vanszs/vansrouter:X.Y.Z
```

Save the generated `INITIAL_PASSWORD` securely. If omitted, a new installation uses the compatibility default `123456`; change it before public exposure. Published images: [Docker Hub](https://hub.docker.com/r/vanszs/vansrouter) • [GHCR](https://github.com/Vanszs/VansRouter/pkgs/container/VansRouter) (multi-platform amd64/arm64).

🎉 Dashboard opens at `http://localhost:20128/masuk`

**2. Connect a FREE provider (no signup needed):**

Dashboard → Providers → Connect **Kiro AI** (free Claude unlimited) or **OpenCode Free** (no auth) → Done!

**3. Use in your CLI tool:**

```
Claude Code/Codex/OpenClaw/Cursor/Cline Settings:
  Endpoint: http://localhost:20128/v1
  API Key:  [copy from dashboard]
  Model:    kr/claude-sonnet-4.5
```

That's it! Start coding with FREE AI models.

---

## 🚀 CLI Options

```bash
vansrouter                    # Start with default settings
vansrouter --port 8080        # Custom port
vansrouter --no-browser       # Don't open browser
vansrouter --skip-update      # Skip auto-update check
vansrouter --help             # Show all options
```

**Dashboard**: `http://localhost:20128/masuk` (after login, `/dashboard`)

---

## 🔌 Connect to a Remote 9Router

Already running 9Router on another machine (e.g. a team server on your LAN)? Point this machine's CLI tools at it — no local server is started:

```bash
npx 9router connect http://<server-host>:20128                       # pick tools interactively
npx 9router connect http://<server-host>:20128 --tools claude,codex  # or choose up front
npx 9router connect --reset --tools claude,codex                     # undo
```

It logs in with the dashboard password (hidden prompt), reuses or creates an API key named `cli-<hostname>`, and writes each tool's config (backing up the original once as `*.bak-9router`).

Supported tools: `claude`, `codex`, `opencode`, `droid`, `crush`, `kilo`, `cline`, `pi`, `omp`, or `all`.

### Models

Models come from the **server's own CLI-tools configuration**, so a client gets whatever the operator already picked on the dashboard. Nothing is hardcoded.

| Tool | Model taken from (first match wins) |
|---|---|
| `claude` | tier flag (`--opus` …) → server's Claude tier → *left unset* (Claude Code's own default) |
| others | `--model` → that tool's own model on the server → server's OpenCode model → *tool skipped* |

`kilo` has no readable model on the server, so it always uses `--model` or the OpenCode model. `omp` (Oh My Pi) needs no model: it uses proxy discovery, so every server model appears under `9router` in `/model`. A Claude tier the server doesn't set is removed from your config rather than kept from an earlier run. A skipped tool makes the command exit `1`.

### Overriding the server's models

```bash
# One Claude tier; the other tiers still come from the server
npx 9router connect http://<server-host>:20128 --tools claude --sonnet cc/claude-sonnet-5-5

# Every Claude tier
npx 9router connect http://<server-host>:20128 --tools claude \
  --fable cc/claude-fable-5-1 --opus cc/claude-opus-5-5 \
  --sonnet cc/claude-sonnet-5-5 --haiku cc/claude-haiku-4-5-20251001

# All non-Claude tools at once
npx 9router connect http://<server-host>:20128 --tools codex,opencode,kilo --model ocg/deepseek-flash

# Claude and other tools in one run
npx 9router connect http://<server-host>:20128 --tools claude,codex --opus cc/claude-opus-5-5 --model gpt-6

# A different model per tool: --model covers every non-Claude tool in a run, so run once per tool
npx 9router connect http://<server-host>:20128 --tools codex --model gpt-6
npx 9router connect http://<server-host>:20128 --tools opencode --model ocg/glm-5.3
```

A model the server doesn't list is still written, with a `not listed by server` warning. To see the ids it serves: `curl http://<server-host>:20128/v1/models -H "Authorization: Bearer <your key>"`.

### Checking the current config

`9router show` prints what each CLI tool on this machine is currently set to — base URL, masked API key and models. It only reads local files and never contacts a server.

```bash
npx 9router show                 # every supported tool
npx 9router show claude          # one tool
npx 9router show claude codex    # several
npx 9router show claude --json   # machine-readable (key still masked)
```

```
✅ Claude Code
   File:     ~/.claude/settings.json
   Base URL: http://<server-host>:20128/v1
   API key:  sk-a1b…9f3c
   Models:
     fable   cc/claude-fable-5-1
     opus    cc/claude-opus-5-5
     sonnet  cc/claude-sonnet-5-5
```

Tools not pointed at 9router are listed as `not configured`. For Codex, OpenCode and Cline it also warns when a 9router entry exists but another provider is the active one.

### Other options

| Option | Purpose |
|---|---|
| `--password <pw>` | Dashboard password (or `NINE_ROUTER_PASSWORD`); prompted if omitted — preferred, keeps it out of shell history |
| `--save` | After a successful login, save the password for this server to `~/.9router/connect.env` (plain text, mode 600) so later runs skip the prompt. Delete the file to forget it |
| `--api-key <key>` | Use this key and skip login. The server's models can't be read without a login, so pass model flags |
| `--key-name <name>` | API key name to reuse/create (default `cli-<hostname>`) |
| `--print-env` | Also print `OPENAI_BASE_URL` / `OPENAI_API_KEY` for other CLIs |
| `--reset` | Remove the 9router settings from the selected tools |

See `9router connect --help` for the full list.

> ⚠️ Over plain `http://` the password and API key are sent unencrypted — use a trusted LAN/VPN or put HTTPS in front. The API key is stored in each tool's config file.

---

## 🛠️ Supported CLI Tools

Claude-Code • OpenClaw • Codex • OpenCode • Cursor • Antigravity • Cline • Continue • Droid • Roo • Copilot • Kilo Code • Gemini CLI • Qwen Code • iFlow • Crush • Crusher • Aider

Any tool supporting OpenAI/Claude-compatible API works.

---

## 💾 Data Location

- **macOS/Linux**: `~/.9router/db/data.sqlite`
- **Windows**: `%APPDATA%\9router\db\data.sqlite`
- **Docker**: `/app/data/db/data.sqlite` (mount `$HOME/.9router` to persist)

---

## 📚 Documentation

Full docs, advanced setup, video tutorials & development guide:

- **GitHub**: https://github.com/Vanszs/VansRouter
- **Full README**: https://github.com/Vanszs/VansRouter/blob/main/README.md
- **Website**: http://localhost:20128

---

## 🙏 Acknowledgments

- **[CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI)** - Original Go implementation

## 📄 License

MIT License - see [LICENSE](LICENSE) for details.
