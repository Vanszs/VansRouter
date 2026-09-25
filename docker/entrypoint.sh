#!/bin/sh
set -eu

node /usr/local/bin/migrate-legacy-volume.cjs
chown -R node:node /app/data /app/data-home 2>/dev/null || true
exec su-exec node "$@"
