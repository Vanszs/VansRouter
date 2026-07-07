# Migration Guide: 9Router → VansRouter

This guide covers migrating an existing **9Router** (decolua/9router) installation to **VansRouter** with zero downtime and full data preservation.

## What migrates

All data in your 9Router SQLite database transfers automatically:

- **Combos** (model routing configurations)
- **Provider connections** (API keys, OAuth tokens, account settings)
- **API keys** (Hermes/other client authentication)
- **Usage history** (request logs, cost tracking)
- **Settings** (password, strategies, proxy config)

VansRouter auto-detects the legacy schema and upgrades it on first start.

## Prerequisites

- Docker installed
- 9Router running (any version) with data at `~/.9router/`
- VansRouter Docker image: `ghcr.io/vanszs/vansrouter:latest`

## Step 1: Backup

```bash
# Full backup of 9Router data
cp -r ~/.9router ~/backup-9router-$(date +%Y%m%d_%H%M%S)

# Backup any config files that reference 9Router
# (e.g., Hermes Agent config, scripts, cron jobs)
```

## Step 2: Stop 9Router

```bash
docker stop 9router
```

Keep the container (don't `docker rm`) — it serves as your rollback option.

## Step 3: Prepare VansRouter data directory

```bash
# Create VansRouter data directory
mkdir -p ~/.vansrouter/

# Copy data from 9Router
cp -r ~/.9router/db ~/.vansrouter/db
cp ~/.9router/jwt-secret ~/.vansrouter/jwt-secret
cp ~/.9router/machine-id ~/.vansrouter/machine-id
cp -r ~/.9router/auth ~/.vansrouter/auth
cp -r ~/.9router/mitm ~/.vansrouter/mitm 2>/dev/null || true
cp -r ~/.9router/runtime ~/.vansrouter/runtime 2>/dev/null || true
```

## Step 4: Start VansRouter

### Option A: Docker Compose (recommended)

```bash
# Copy environment template
cp .env.example .env
nano .env  # Set JWT_SECRET to match ~/.9router/jwt-secret

# Start
docker compose up -d
```

### Option B: Docker run

```bash
# Read your existing JWT secret
JWT_SECRET=$(cat ~/.vansrouter/jwt-secret)

docker run -d --name vansrouter --restart unless-stopped \
  -p 20128:20128 \
  -v ~/.vansrouter:/app/data \
  -e PORT=20128 \
  -e HOSTNAME=0.0.0.0 \
  -e NODE_ENV=production \
  -e DATA_DIR=/app/data \
  -e JWT_SECRET="$JWT_SECRET" \
  -e API_KEY_SECRET="$JWT_SECRET" \
  -e REQUIRE_API_KEY=false \
  ghcr.io/vanszs/vansrouter:latest
```

## Step 5: Verify

```bash
# Container running?
docker ps --filter name=vansrouter

# Dashboard accessible?
curl -s -o /dev/null -w "%{http_code}" http://localhost:20128/
# Expected: 200

# Check migration logs
docker logs vansrouter | grep -E "migrate|backup"
# Expected: [DB][migrate] App 0.5.x → 0.8.6 | schema 1 → 3 | backup: ...

# API responds?
API_KEY=$(sqlite3 ~/.vansrouter/db/data.sqlite "SELECT key FROM apiKeys WHERE isActive=1;")
curl -s -H "Authorization: Bearer $API_KEY" http://localhost:20128/v1/models | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'Models: {len(d.get(\"data\",[]))}')"
```

Open the dashboard at `http://localhost:20128` and verify:
- All combos appear with correct model lists
- Provider connections show correct status
- Usage history is intact

## Step 6: Update dependent services

If you use **Hermes Agent** or another client:

- **Same port (20128)**: No config changes needed
- **Different port**: Update `base_url` in your client config

If you have auto-update crons for 9Router:

```bash
# Disable old 9Router update
# (method depends on your setup: systemd timer, crontab, or Hermes cron)

# Enable VansRouter auto-update script (example: nightly)
# See scripts/vansrouter-docker-update.sh
```

## Rollback

If anything goes wrong:

```bash
# Stop VansRouter
docker stop vansrouter
docker rm vansrouter

# Restart 9Router
docker start 9router
```

Your original data in `~/.9router/` is untouched. VansRouter data lives in `~/.vansrouter/`.

## Schema changes during migration

VansRouter applies these automatic migrations on first start:

| Migration | What it does |
|-----------|-------------|
| 001-initial | Bootstrap tables (idempotent for existing DBs) |
| 002-fix-empty-allowed-lists | Convert empty ACL arrays `[]` to NULL (unrestricted) |
| 003-add-allowed-lists-columns | Add `allowedProviders`, `allowedCombos`, `allowedKinds` columns |

A backup is automatically created at `~/.vansrouter/db/backups/` before migration runs.

## Differences from 9Router

- **Image**: `ghcr.io/vanszs/vansrouter` (not `decolua/9router`)
- **Data dir**: `~/.vansrouter/` recommended (not `~/.9router/`)
- **Headroom**: Optional sidecar for tool-history safety (not bundled)
- **Circuit breaker**: Built-in provider failure tracking (inspired by OmniRoute)
- **Active development**: Regular updates from upstream 9Router + community
