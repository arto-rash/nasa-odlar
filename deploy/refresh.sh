#!/usr/bin/env bash
# Move the served record forward to yesterday: new FIRMS NRT detections and
# weather, risk re-scored with the trained models (odlar.refresh). Runs on the
# server from cron once a day (Open-Meteo allows ~10k location-calls a day); the ML API picks up the swapped store by itself.
#   30 6 * * * /opt/odlar/deploy/refresh.sh >> /opt/odlar/refresh.log 2>&1
set -euo pipefail
cd /opt/odlar/deploy
dc() { docker compose -f docker-compose.prod.yml "$@"; }
echo "== $(date -u +%FT%TZ) refresh"
rc=0
dc --profile jobs run --rm -T refresh || rc=$?
# the year file the world map reads; a failure here only leaves it a day behind
dc --profile jobs run --rm -T refresh python -m odlar.week_packs --year "$(date -u +%Y)" || true
# Laravel caches ML responses for 10 min; drop them so the new day shows at once.
dc exec -T api php artisan cache:clear >/dev/null
# the world outlines are built on first use (~15 s): do it now, not for a visitor
curl -s -o /dev/null -m 120 "https://odlar-api.46-224-126-66.sslip.io/api/v1/regions/geojson?zoom=2" || true
echo "== done (exit $rc)"
exit "$rc"
