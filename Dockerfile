# syntax=docker/dockerfile:1.7
ARG NODE_IMAGE=node:22-alpine

# Step 1: Build the Next.js app on the native host CPU (BUILDPLATFORM).
# Running Webpack and bundling under native architecture is ~20x faster than QEMU emulation.
FROM --platform=$BUILDPLATFORM ${NODE_IMAGE} AS builder
WORKDIR /app

RUN apk add --no-cache python3 make g++ linux-headers

COPY package.json ./
RUN --mount=type=cache,target=/root/.npm \
  npm install --include=optional --no-audit --no-fund

COPY . ./
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# Step 2: Compile native C++ modules (better-sqlite3) for the TARGETPLATFORM.
# Only compiles native C++ modules; avoids running heavy Next.js build or extracting 500+ unrelated packages under QEMU.
FROM ${NODE_IMAGE} AS native-deps
WORKDIR /app

RUN apk add --no-cache python3 make g++ linux-headers

RUN npm init -y && \
  npm install better-sqlite3@12.10.0 bindings file-uri-to-path --no-audit --no-fund

# Tailscale static binaries for Alpine Linux (bundled so tunnel works in Docker).
# Fetches the latest stable tailscale and tailscaled. Override with --build-arg.
FROM alpine:3.19 AS tailscale
ARG TAILSCALE_VERSION=1.80.3
ARG TARGETARCH
RUN apk add --no-cache curl ca-certificates && \
  mkdir -p /out && \
  TARCH=${TARGETARCH:-amd64} && \
  case "$TARCH" in \
    amd64) TS_ARCH=amd64 ;; \
    arm64) TS_ARCH=arm64 ;; \
    arm) TS_ARCH=arm ;; \
    *) echo "Unsupported arch: $TARCH"; exit 1 ;; \
  esac && \
  curl -fsSL "https://pkgs.tailscale.com/stable/tailscale_${TAILSCALE_VERSION}_${TS_ARCH}.tgz" -o /tmp/tailscale.tgz && \
  tar -xzf /tmp/tailscale.tgz -C /tmp && \
  cp /tmp/tailscale_${TAILSCALE_VERSION}_${TS_ARCH}/tailscale /out/tailscale && \
  cp /tmp/tailscale_${TAILSCALE_VERSION}_${TS_ARCH}/tailscaled /out/tailscaled && \
  chmod +x /out/tailscale /out/tailscaled

FROM ${NODE_IMAGE} AS runner
WORKDIR /app

LABEL org.opencontainers.image.title="9router"

ENV NODE_ENV=production
ENV PORT=20128
ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1
ENV DATA_DIR=/app/data
# API_KEY_SECRET is optional; src/shared/utils/apiKey.js persists a random secret
# under DATA_DIR when no runtime secret is provided.

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/custom-server.js ./custom-server.js
COPY --from=builder /app/open-sse ./open-sse
# Next file tracing can omit sibling files; MITM runs server.js as a separate process.
COPY --from=builder /app/src/mitm ./src/mitm
# Standalone tracing may omit packages loaded through dynamic imports.
COPY --from=builder /app/node_modules/node-forge ./node_modules/node-forge
# SQLite is loaded dynamically by src/lib/db/driver.js; keep the target-architecture
# native driver compiled in native-deps.
COPY --from=native-deps /app/node_modules/better-sqlite3 ./node_modules/better-sqlite3
COPY --from=native-deps /app/node_modules/bindings ./node_modules/bindings
COPY --from=native-deps /app/node_modules/file-uri-to-path ./node_modules/file-uri-to-path
# Ensure `next` is available at runtime in case tracing did not include it.
COPY --from=builder /app/node_modules/next ./node_modules/next
COPY --from=builder /app/node_modules/sql.js ./node_modules/sql.js
RUN node -e "const Database = require('better-sqlite3'); const db = new Database(':memory:'); db.prepare('SELECT 1').get(); db.close(); console.log('SQLite native driver: better-sqlite3')"
# Bundle Tailscale binaries into /usr/local/bin so they survive the /app/data volume mount.
COPY --from=tailscale /out/tailscale /usr/local/bin/tailscale
COPY --from=tailscale /out/tailscaled /usr/local/bin/tailscaled

RUN mkdir -p /app/data /app/data-home && \
  chown -R node:node /app/data /app/data-home /app/.next && \
  ln -sf /app/data-home /root/.9router 2>/dev/null || true

# Fix permissions at runtime (handles mounted volumes). Migrate the historical
# volume name automatically into the canonical 9router-data volume when the
# target has no database yet.
# Tailscale Funnel requires CAP_NET_ADMIN for TUN mode; keep su-exec for dropping privileges.
# When using host socket mode (TAILSCALE_USE_HOST_SOCKET=true), no extra capability is needed.
RUN apk --no-cache add su-exec ip6tables iptables && \
  printf '#!/bin/sh\nset -eu\ncopy_missing() {\n  local source=$1 target=$2 entry name destination\n  mkdir -p "$target"\n  for entry in "$source"/* "$source"/.[!.]* "$source"/..?*; do\n    [ -e "$entry" ] || continue\n    name=$(basename "$entry")\n    destination="$target/$name"\n    if [ -d "$entry" ]; then\n      copy_missing "$entry" "$destination"\n    elif [ ! -e "$destination" ]; then\n      cp -a "$entry" "$destination"\n    fi\n  done\n}\nif [ ! -f /app/data/db/.legacy-volume-migrated ] && [ ! -e /app/data/db/data.sqlite ] && [ -d /migration-data ]; then\n  copy_missing /migration-data /app/data\n  mkdir -p /app/data/db\n  touch /app/data/db/.legacy-volume-migrated\nfi\nchown -R node:node /app/data /app/data-home 2>/dev/null\nexec su-exec node "$@"\n' > /entrypoint.sh && \
  chmod +x /entrypoint.sh

EXPOSE 20128

ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "custom-server.js"]
