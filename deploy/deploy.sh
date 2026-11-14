#!/usr/bin/env bash
# Ship the backend to the shared Hetzner box and (re)start the stack.
#   ./deploy/deploy.sh                 # code + artifacts
#   ARTIFACTS_ONLY=1 ./deploy/deploy.sh # refreshed model/store only (no rebuild)
# Either way the server then runs the daily refresh once, so the uploaded store
# (as old as the local build) is brought up to yesterday right away.
set -euo pipefail
HOST="${ODLAR_HOST:-portfelim-hz}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RSYNC=(rsync -az --delete --exclude .git --exclude node_modules --exclude vendor --exclude .venv
       --exclude 'data/cache' --exclude '__pycache__' --exclude '.env' --exclude 'storage/logs/*'
       --exclude '.pytest_cache' --exclude '.hypothesis' --exclude 'artifacts' --exclude 'data/boundaries/world')

echo "==> artifacts"
ssh "$HOST" "mkdir -p /opt/odlar/artifacts /opt/odlar/ml /opt/odlar/api /opt/odlar/deploy"
rsync -az --delete "$ROOT/ml/artifacts/" "$HOST:/opt/odlar/artifacts/"

if [[ "${ARTIFACTS_ONLY:-}" == "1" ]]; then
  rsync -az "$ROOT/deploy/refresh.sh" "$HOST:/opt/odlar/deploy/"
  ssh "$HOST" "/opt/odlar/deploy/refresh.sh"
  exit 0
fi

echo "==> code"
"${RSYNC[@]}" "$ROOT/ml/" "$HOST:/opt/odlar/ml/"
"${RSYNC[@]}" "$ROOT/api/" "$HOST:/opt/odlar/api/"
rsync -az "$ROOT/deploy/docker-compose.prod.yml" "$ROOT/deploy/refresh.sh" "$HOST:/opt/odlar/deploy/"
# the ML image bakes a fallback copy of the artifacts
rsync -az --delete "$ROOT/ml/artifacts/" "$HOST:/opt/odlar/ml/artifacts/"

echo "==> build + up"
ssh "$HOST" "cd /opt/odlar/deploy && docker compose -f docker-compose.prod.yml up -d --build && docker image prune -f >/dev/null && docker compose -f docker-compose.prod.yml ps"

echo "==> refresh"
ssh "$HOST" "/opt/odlar/deploy/refresh.sh"
