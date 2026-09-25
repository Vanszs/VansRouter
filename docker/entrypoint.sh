#!/bin/sh
set -eu

node /usr/local/bin/migrate-legacy-volume.cjs
chown -R node:node /app/data /app/data-home 2>/dev/null || true

# No locality knob here on purpose. Docker NATs published-port traffic from the
# host, so the app sees the container gateway as the TCP peer and cannot tell the
# host from the LAN (on Docker Desktop / rootless the LAN is masqueraded to the
# same address). Instead of guessing, a non-local login on the default password
# gets a password-change-only grant from the API — see /api/auth/login.

exec su-exec node "$@"
