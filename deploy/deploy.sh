#!/usr/bin/env bash
# Ship the backend to the shared Hetzner box and (re)start the stack.
#   ./deploy/deploy.sh                 # code + artifacts
#   ARTIFACTS_ONLY=1 ./deploy/deploy.sh # refreshed model/store only (no rebuild)
set -euo pipefail
HOST="${ODLAR_HOST:-portfelim-hz}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RSYNC=(rsync -az --delete --exclude .git --exclude node_modules --exclude vendor --exclude .venv
       --exclude 'data/cache' --exclude '__pycache__' --exclude '.env' --exclude 'storage/logs/*'
       --exclude '.pytest_cache' --exclude '.hypothesis' --exclude 'artifacts')

echo "==> artifacts"
ssh "$HOST" "mkdir -p /opt/odlar/artifacts /opt/odlar/ml /opt/odlar/api /opt/odlar/deploy"
rsync -az --delete "$ROOT/ml/artifacts/" "$HOST:/opt/odlar/artifacts/"

if [[ "${ARTIFACTS_ONLY:-}" == "1" ]]; then
  ssh "$HOST" "cd /opt/odlar/deploy && docker compose -f docker-compose.prod.yml restart ml"
  exit 0
fi

echo "==> code"
"${RSYNC[@]}" "$ROOT/ml/" "$HOST:/opt/odlar/ml/"
"${RSYNC[@]}" "$ROOT/api/" "$HOST:/opt/odlar/api/"
rsync -az "$ROOT/deploy/docker-compose.prod.yml" "$HOST:/opt/odlar/deploy/"
# the ML image bakes a fallback copy of the artifacts
rsync -az --delete "$ROOT/ml/artifacts/" "$HOST:/opt/odlar/ml/artifacts/"

echo "==> build + up"
ssh "$HOST" "cd /opt/odlar/deploy && docker compose -f docker-compose.prod.yml up -d --build && docker image prune -f >/dev/null && docker compose -f docker-compose.prod.yml ps"
