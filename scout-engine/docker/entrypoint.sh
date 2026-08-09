#!/bin/sh
set -e
if [ "${SCOUT_SKIP_MIGRATE:-}" != "true" ]; then
  echo "[scout] running migrations..."
  ./node_modules/.bin/tsx src/db/migrate.ts
fi
exec node dist/server.js
