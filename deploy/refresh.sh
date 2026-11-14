#!/usr/bin/env bash
# Move the served record forward to yesterday: new FIRMS NRT detections and
# weather, risk re-scored with the trained models (odlar.refresh). Runs on the
# server from cron twice a day; the ML API picks up the swapped store by itself.
#   30 6,18 * * * /opt/odlar/deploy/refresh.sh >> /opt/odlar/refresh.log 2>&1
set -euo pipefail
cd /opt/odlar/deploy
dc() { docker compose -f docker-compose.prod.yml "$@"; }
echo "== $(date -u +%FT%TZ) refresh"
dc --profile jobs run --rm -T refresh
# Laravel caches ML responses for 10 min; drop them so the new day shows at once.
dc exec -T api php artisan cache:clear >/dev/null
echo "== done"
