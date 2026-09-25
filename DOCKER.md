# Docker

Run VansRouter in a container. Published images:
- GHCR: [`ghcr.io/vanszs/vansrouter`](https://github.com/Vanszs/VansRouter/pkgs/container/VansRouter)
- Docker Hub: [`vanszs/vansrouter`](https://hub.docker.com/r/vanszs/vansrouter) (if published separately)

Multi-platform `linux/amd64` + `linux/arm64`.

---

# 👤 For Users

## Quick start

```bash
docker run -d \
  -p 20128:20128 \
  -v 9router-data:/app/data \
  -v vansrouter-data:/migration-data:ro \
  -e DATA_DIR=/app/data \
  --name vansrouter \
  ghcr.io/vanszs/vansrouter:X.Y.Z
```

Replace `X.Y.Z` with the exact published release tag; do not run the placeholder or `latest`.

The `vansrouter-data` mount is read-only compatibility input for pre-v0.91.22 named-volume installs. It is copied automatically into the canonical `9router-data` volume only when that volume has no database. If the old install used `$HOME/.9router:/app/data`, keep using that bind mount or migrate its contents into `9router-data` first.

App listens on port `20128`. Open: http://localhost:20128

## Manage container

```bash
docker logs -f vansrouter        # view logs
docker stop vansrouter           # stop
docker start vansrouter          # start again
docker rm -f vansrouter          # remove
```

## Data persistence

```bash
-v "$HOME/.9router:/app/data" \
-e DATA_DIR=/app/data
```

Without `DATA_DIR`, the app falls back to `~/.9router/` (macOS/Linux) or `%APPDATA%\9router\` (Windows). In the container, `DATA_DIR=/app/data` makes the bind mount work.

Data layout under `$DATA_DIR/`:

```text
$DATA_DIR/
├── db/
│   ├── data.sqlite       # main SQLite database
│   └── backups/          # auto backups
└── ...                   # certs, logs, runtime configs
```

Host path: `$HOME/.9router/db/data.sqlite`
Container path: `/app/data/db/data.sqlite`

Production requirements:
- Run one VansRouter process per SQLite file. Multiple containers/processes with separate local volumes do not share proxy-pool fitness state.
- If scaling horizontally, provide a shared database/backend for routing state before enabling multiple app instances.
- Keep the persistent volume name `9router-data` used by `docker-compose.yml`; renaming it creates a new empty database volume.
- Production requires a native SQLite driver. The `sql.js` fallback is single-process development fallback only.

## Optional env vars

Add options to the quick-start command:

```bash
-e PORT=20128 \
-e HOSTNAME=0.0.0.0 \
-e DEBUG=true
```

## Optional Headroom sidecar

Headroom is an optional sidecar service for tool-history safety and advanced request processing.

### Option A: Docker Compose (Recommended)

Use the provided `docker-compose.yml`:

```bash
# Copy and customize environment
cp .env.example .env
nano .env

# Start both services
docker compose up -d
```

### Option B: Manual Compose

Create your own `docker-compose.yml`:

```yaml
services:
  vansrouter:
    image: ghcr.io/vanszs/vansrouter:X.Y.Z
    container_name: vansrouter
    restart: always
    ports:
      - "20128:20128"
    volumes:
      - 9router-data:/app/data
    env_file:
      - .env
    environment:
      DATA_DIR: /app/data
      PORT: "20128"
      HOSTNAME: "0.0.0.0"
      NODE_ENV: production
      HEADROOM_URL: http://headroom:8787
    depends_on:
      - headroom

  headroom:
    image: ghcr.io/chopratejas/headroom@sha256:50b85d8e320cfcdf1b38919bb7ae067b93ff7a8de0a93f05b2c1246370200d1c
    container_name: headroom
    restart: always
    ports:
      - "8787:8787"

volumes:
  9router-data:
    name: 9router-data
```

### Option C: Separate Containers

Run Headroom independently:

In the dashboard, open `Endpoint` → `Token Saver` → `Headroom`, confirm the URL is `http://headroom:8787`, recheck status, then enable Headroom.

If Headroom runs on the Docker host instead of as a sidecar, use `http://host.docker.internal:8787` on macOS/Windows. On Linux, add `--add-host=host.docker.internal:host-gateway` or the equivalent compose `extra_hosts` entry.

## Update without manual asset or database steps

`9router-data` is the canonical volume. The compose file also mounts historical `vansrouter-data` read-only for automatic compatibility copying. The entrypoint stages and validates the legacy SQLite database before atomically installing it; a valid canonical database is preserved, while an invalid interrupted copy is replaced only from a validated migration source. The `.legacy-volume-migrated` marker is written last. Legacy installs that used a host bind mount (`$HOME/.9router:/app/data`) must keep that bind mount or copy its contents into `9router-data` before switching to named volumes.

```bash
docker compose pull vansrouter
docker compose up -d --no-deps vansrouter
```

For Compose, set `VANSROUTER_VERSION` in `.env` to an immutable SemVer release tag (never `latest`; prefer the recorded digest) before pulling. Do not copy `.next`, delete either volume, or run application migrations manually. After a successful upgrade, remove the `vansrouter-data:/migration-data:ro` mount only after confirming the new container reports the expected version and data.

---

# 🛠 For Developers

## Build image locally (test)

```bash
docker build -t vansrouter .

docker run --rm -p 20128:20128 \
  -v "$HOME/.9router:/app/data" \
  -e DATA_DIR=/app/data \
  vansrouter
```

## Publish (automatic via CI)

Push an annotated release tag `vX.Y.Z` after the checks in `.agent/cicd.md`. GitHub Actions builds multi-platform (amd64+arm64) and promotes the verified image to:
- `ghcr.io/vanszs/vansrouter:X.Y.Z` + `:latest`

Docker Hub is not published by the current workflow; treat its listing as a separate/manual distribution only.

```bash
# Follow .agent/cicd.md; do not tag or publish manually.
git status --short
node cli/scripts/validate-release.cjs vX.Y.Z --pretag
```

Workflow: `.github/workflows/release.yml`
