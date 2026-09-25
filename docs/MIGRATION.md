# Migration Guide: 9Router → VansRouter

This guide covers migrating an existing **9Router** (Vanszs/VansRouter) installation to **VansRouter** with zero downtime and full data preservation.

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
- VansRouter Docker image: `ghcr.io/vanszs/vansrouter:X.Y.Z` (replace with the release you are installing)

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
# Keep the existing canonical data directory. VansRouter deliberately preserves
# the ~/.9router path for compatibility; do not create a second database tree.
mkdir -p ~/.9router/

# If the legacy files are already in ~/.9router, no copy is needed.
# The following is only for a separately backed-up legacy directory:
# cp -r /path/to/legacy/db ~/.9router/db
# cp /path/to/legacy/jwt-secret ~/.9router/jwt-secret
```

## Step 4: Start VansRouter

### Option A: Docker Compose (recommended)

```bash
# Copy environment template
cp .env.example .env
nano .env  # Set VANSROUTER_VERSION; INITIAL_PASSWORD may use the 123456 default

# Compose uses the canonical named volume by default. To reuse ~/.9router,
# create this override before starting so the host data is actually mounted:
cat > docker-compose.override.yml <<'YAML'
services:
  vansrouter:
    volumes:
      - ${HOME}/.9router:/app/data
YAML

# Check legacy image references and data-root assumptions
pnpm preflight:upgrade -- --env-file .env --compose-file docker-compose.yml

# Start
docker compose up -d
```

Do not remove the read-only `vansrouter-data:/migration-data` mount until the
new container has been verified.

### Option B: Docker run

```bash
# Read your existing JWT secret
JWT_SECRET=$(cat ~/.9router/jwt-secret)

docker run -d --name vansrouter --restart unless-stopped \
  -p 20128:20128 \
  -v ~/.9router:/app/data \
  -e PORT=20128 \
  -e HOSTNAME=0.0.0.0 \
  -e NODE_ENV=production \
  -e DATA_DIR=/app/data \
  -e JWT_SECRET="$JWT_SECRET" \
  -e API_KEY_SECRET="$JWT_SECRET" \
  -e INITIAL_PASSWORD="$(openssl rand -base64 24)" \
  -e REQUIRE_API_KEY=false \
  ghcr.io/vanszs/vansrouter:X.Y.Z
```

If the existing native/PM2 deployment uses `/var/lib/9router`, keep that root
and make it explicit in the shell before deployment; the preflight refuses an
implicit shell/PM2 mismatch:

```bash
DATA_DIR=/var/lib/9router node scripts/preflight-upgrade.cjs \
  --env-file .env --compose-file docker-compose.yml --pm2
```

## Step 5: Verify

```bash
# Container running?
docker ps --filter name=vansrouter

# Dashboard login page?
curl -s -o /dev/null -w "%{http_code}" http://localhost:20128/masuk
# Expected: 200

# Check migration logs
docker logs vansrouter | grep -E "migrate|backup"
# Expected: [DB][migrate] App 0.5.x → 0.8.6 | schema 1 → 3 | backup: ...

# API responds?
API_KEY=$(sqlite3 ~/.9router/db/data.sqlite "SELECT key FROM apiKeys WHERE isActive=1;")
curl -s -H "Authorization: Bearer $API_KEY" http://localhost:20128/v1/models | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'Models: {len(d.get(\"data\",[]))}')"
```

Open the dashboard at `http://localhost:20128/masuk` and verify:
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

Your original data in `~/.9router/` remains the canonical VansRouter data directory; no second data tree is created.

## Schema changes during migration

VansRouter applies these automatic migrations on first start:

| Migration | What it does |
|-----------|-------------|
| 001-initial | Bootstrap tables (idempotent for existing DBs) |
| 002-fix-empty-allowed-lists | Convert empty ACL arrays `[]` to NULL (unrestricted) |
| 003-add-allowed-lists-columns | Add `allowedProviders`, `allowedCombos`, `allowedKinds` columns |

A backup is automatically created at `~/.9router/db/backups/` before migration runs.

## Differences from 9Router

- **Image**: `ghcr.io/vanszs/vansrouter` (not `Vanszs/VansRouter`)
- **Data dir**: `~/.9router/` remains canonical for compatibility
- **Headroom**: Optional sidecar for tool-history safety (not bundled)
- **Circuit breaker**: Built-in provider failure tracking (inspired by OmniRoute)
- **Active development**: Regular updates from upstream 9Router + community
