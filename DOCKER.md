# Docker

Run VansRouter in a container. Published images:
- GHCR: [`ghcr.io/Vanszs/VansRouter`](https://github.com/Vanszs/VansRouter/pkgs/container/VansRouter)
- Docker Hub: [`vanszs/vansrouter`](https://hub.docker.com/r/vanszs/vansrouter)

Multi-platform `linux/amd64` + `linux/arm64`.

---

# 👤 For Users

## Quick start

```bash
docker run -d \
  -p 20128:20128 \
  -v "$HOME/.9router:/app/data" \
  -e DATA_DIR=/app/data \
  --name vansrouter \
  ghcr.io/Vanszs/VansRouter:latest
```

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

## Optional env vars

```bash
docker run -d \
  -p 20128:20128 \
  -v "$HOME/.9router:/app/data" \
  -e DATA_DIR=/app/data \
  -e PORT=20128 \
  -e HOSTNAME=0.0.0.0 \
  -e DEBUG=true \
  --name vansrouter \
  ghcr.io/Vanszs/VansRouter:latest
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
    image: ghcr.io/Vanszs/VansRouter:latest
    container_name: vansrouter
    restart: always
    ports:
      - "20128:20128"
    volumes:
      - vansrouter-data:/app/data
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
    image: ghcr.io/chopratejas/headroom:latest
    container_name: headroom
    restart: always
    ports:
      - "8787:8787"

volumes:
  vansrouter-data:
    name: vansrouter-data
```

### Option C: Separate Containers

Run Headroom independently:

In the dashboard, open `Endpoint` → `Token Saver` → `Headroom`, confirm the URL is `http://headroom:8787`, recheck status, then enable Headroom.

If Headroom runs on the Docker host instead of as a sidecar, use `http://host.docker.internal:8787` on macOS/Windows. On Linux, add `--add-host=host.docker.internal:host-gateway` or the equivalent compose `extra_hosts` entry.

## Update to latest

```bash
docker pull ghcr.io/Vanszs/VansRouter:latest
docker rm -f vansrouter
# re-run the quick start command
```

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

Push a git tag `v*` → GitHub Actions builds multi-platform (amd64+arm64) and pushes to:
- `ghcr.io/Vanszs/VansRouter:v{version}` + `:latest`
- `vanszs/vansrouter:v{version}` + `:latest`

```bash
# Use scripts/release.js (recommended)
node scripts/release.js "Release title" "Notes"

# Or manually
git tag v0.7.x && git push origin v0.7.x
```

Workflow: `.github/workflows/release.yml`
