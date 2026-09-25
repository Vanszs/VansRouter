# syntax=docker/dockerfile:1.7@sha256:a57df69d0ea827fb7266491f2813635de6f17269be881f696fbfdf2d83dda33e
ARG APP_VERSION=unknown
ARG VCS_REF=unknown

# Step 1: Build the Next.js app on the native host CPU (BUILDPLATFORM).
# Running Webpack and bundling under native architecture is ~20x faster than QEMU emulation.
FROM --platform=$BUILDPLATFORM node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402 AS builder
WORKDIR /app

RUN apk add --no-cache python3 make g++ linux-headers

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    PNPM_HOME=/pnpm \
    npm_config_build_from_source=true \
    npm_config_nodedir=/usr/local
ENV PATH="${PNPM_HOME}:${PATH}"
RUN corepack enable && corepack prepare "pnpm@9.15.9" --activate

# Use the repository's lockfile and package-manager policy for the image build.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,target=/pnpm/store \
  pnpm install --frozen-lockfile --store-dir=/pnpm/store

COPY . ./
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm run build

# Step 2: Stage target-native runtime modules (better-sqlite3) for the TARGETPLATFORM.
# The target binary is checksum-pinned and avoids running heavy Next.js build or extracting 500+ unrelated packages under QEMU.
FROM node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402 AS native-deps
ARG TARGETARCH
WORKDIR /app

RUN apk add --no-cache curl ca-certificates

# Keep the native dependency graph locked independently of the application install.
# The prebuilt native binary is downloaded separately and checksum-verified; the
# package install script is disabled so it cannot fetch an unpinned artifact.
COPY docker/native-deps/package.json docker/native-deps/package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund && \
  bs_version=12.10.0 && \
  bs_abi=127 && \
  test "$(node -p 'process.versions.modules')" = "$bs_abi" && \
  bs_sha_x64=9b14618f3d9aa9b70daade965bca892f324b063e1cc7532b030d7138a8f9d070 && \
  bs_sha_arm64=b5e92ec2637bb578cc12b8b9b94877a82c3ef5e862ccc72d420706aab978bb9a && \
  case "${TARGETARCH:-amd64}" in \
    amd64) bs_arch=x64; bs_sha="$bs_sha_x64" ;; \
    arm64) bs_arch=arm64; bs_sha="$bs_sha_arm64" ;; \
    *) echo "Unsupported arch: ${TARGETARCH:-amd64}"; exit 1 ;; \
  esac && \
  archive=/tmp/better-sqlite3-linux-musl.tgz && \
  curl -fsSL "https://github.com/WiseLibs/better-sqlite3/releases/download/v${bs_version}/better-sqlite3-v${bs_version}-node-v${bs_abi}-linuxmusl-${bs_arch}.tar.gz" -o "$archive" && \
  echo "${bs_sha}  ${archive}" | sha256sum -c - && \
  tar -xzf "$archive" -C node_modules/better-sqlite3 && \
  test -f node_modules/better-sqlite3/build/Release/better_sqlite3.node
RUN node -e "const Database = require('better-sqlite3'); const db = new Database(':memory:'); db.prepare('SELECT 1').get(); db.close(); console.log('native dependency stage: better-sqlite3')"

# Tailscale static binaries for Alpine Linux (bundled so tunnel works in Docker).
# The archive checksum is verified before extraction.
FROM alpine:3.19@sha256:6baf43584bcb78f2e5847d1de515f23499913ac9f12bdf834811a3145eb11ca1 AS tailscale
ARG TARGETARCH
RUN apk add --no-cache curl ca-certificates && \
  mkdir -p /out && \
  TS_VERSION=1.102.4 && \
  TS_SHA_AMD64=50748df1045e60b5b695f19f4c56b0da36c019948b440fb456b6584a50f0d8b9 && \
  TS_SHA_ARM64=9dd1e6a592a014bbaea0103167ffe299adeda4ba14e078ce9c2895364f6c4c3f && \
  TARCH=${TARGETARCH:-amd64} && \
  case "$TARCH" in \
    amd64) TS_ARCH=amd64; TS_SHA="$TS_SHA_AMD64" ;; \
    arm64) TS_ARCH=arm64; TS_SHA="$TS_SHA_ARM64" ;; \
    *) echo "Unsupported arch: $TARCH"; exit 1 ;; \
  esac && \
  curl -fsSL "https://pkgs.tailscale.com/stable/tailscale_${TS_VERSION}_${TS_ARCH}.tgz" -o /tmp/tailscale.tgz && \
  echo "${TS_SHA}  /tmp/tailscale.tgz" | sha256sum -c - && \
  tar -xzf /tmp/tailscale.tgz -C /tmp && \
  cp /tmp/tailscale_${TS_VERSION}_${TS_ARCH}/tailscale /out/tailscale && \
  cp /tmp/tailscale_${TS_VERSION}_${TS_ARCH}/tailscaled /out/tailscaled && \
  chmod +x /out/tailscale /out/tailscaled

FROM node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402 AS runner
ARG APP_VERSION
ARG VCS_REF
WORKDIR /app

LABEL org.opencontainers.image.title="VansRouter" \
      org.opencontainers.image.source="https://github.com/Vanszs/VansRouter" \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.revision="${VCS_REF}" \
      org.opencontainers.image.licenses="MIT"

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
# native driver staged in native-deps.
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
