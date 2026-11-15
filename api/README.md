# ODLAR API

Laravel 13 gateway for ODLAR (harmonized MODIS/VIIRS fire calendar + fire-risk alerts for 193 countries (27,083 districts and provinces)).
It is the only public API: analytics are proxied (and cached) to the internal FastAPI service in `../ml`;
accounts, subscriptions, alerts and region geometries (PostGIS) live here.

## Endpoints (`/api/v1`, JSON)

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/status` | | `{status, version, ml:{status, data_end, source}}`, never cached, 200 even when ML is down |
| GET | `/overview`, `/regions`, `/regions/geojson`, `/risk`, `/timeline`, `/model/report` | | ML proxy, cached 600 s |
| GET | `/regions/locate?lat=&lon=` | | PostGIS point-in-polygon over leaf regions → `{region:{id,slug,name_en,name_az,country,level}}` or 404 |
| GET | `/regions/{slug}` · `/regions/{slug}/series/annual` · `/regions/{slug}/calendar` · `/regions/{slug}/risk` | | ML proxy |
| GET | `/regions/{slug}/series/weekly?start=&end=` | | dates `Y-m-d` |
| GET | `/hotspots?start=&end=&sensor=&region=&limit=` | | start/end required, range ≤ 92 days, sensor MODIS/VIIRS, limit ≤ 50000 |
| GET | `/grid?year=&sensor=` · `/harmonization/skill?region=` | | ML proxy |
| POST | `/aoi/summary` `{geometry}` | | GeoJSON Polygon/MultiPolygon, not cached |
| GET | `/export/{slug}?kind=weekly\|annual\|hotspots&format=csv\|json\|geojson&start=&end=` | | streamed file, 20/min |
| POST | `/auth/register` · `/auth/login` | | → `{token, user}`, 10/min |
| POST | `/auth/logout` | ✓ | 204, revokes the current token |
| GET/PATCH | `/auth/me` | ✓ | PATCH accepts `name`, `locale` (`az`/`en`) |
| GET/POST | `/subscriptions` | ✓ | POST `{region_slug, threshold?, channels?}` |
| GET/PATCH/DELETE | `/subscriptions/{id}` | ✓ | owner only (others get 404) |
| GET | `/alerts?unread=1` | ✓ | paginated, 15/page, newest first |
| GET | `/alerts/unread-count` | ✓ | `{count}` |
| POST | `/alerts/{id}/read` · `/alerts/read-all` | ✓ | |
| POST | `/alerts/evaluate` | ✓ | runs the risk check for your subscriptions now, 10/min |

Auth is Sanctum personal access tokens: `Authorization: Bearer <token>`. Errors are always JSON:
`{"message": ...}`, plus `errors` for 422 validation. ML 404/422 are passed through with ML's `detail`
as `message`; if ML is unreachable you get `503 {"message":"Analytics service unavailable"}`.
Rate limits: 240/min per IP overall.

## Alerts

`odlar:evaluate-risk` runs hourly (scheduler). For each active subscription it calls ML `/risk/{slug}`
(one call per region per run) and when `short.level ≥ threshold` (low < moderate < high < very_high < extreme)
creates one alert per subscription per `as_of` date. Channels: `in_app` → delivered, `email` → localized
(az/en) mail → sent/failed, `sms`/`push` → not_available (prototype).

`odlar:sync-regions` upserts regions + geometries from ML `/regions/geojson` and `/regions`
(runs at container boot and daily).

## Local development

```bash
docker run -d --name odlar-pg-test -e POSTGRES_USER=odlar -e POSTGRES_PASSWORD=odlar \
  -e POSTGRES_DB=odlar_test -p 5436:5432 postgis/postgis:16-3.4-alpine
docker exec odlar-pg-test psql -U odlar -d odlar_test -c 'CREATE DATABASE odlar'

cp .env.example .env && php artisan key:generate   # set DB_PORT=5436, ODLAR_ML_URL=http://127.0.0.1:8001
composer install
php artisan migrate && php artisan odlar:sync-regions && php artisan db:seed
php artisan serve
```

Demo account (seeded unless `APP_ENV=production`, or with `SEED_DEMO=true`): `demo@odlar.az` / `odlar-demo-2026`.

## Tests

Pest, against the PostGIS container above (`odlar_test` on port 5436, see `phpunit.xml`; override with
`DB_PORT=… php artisan test`). All ML calls are faked (`Http::fake`, stray requests are blocked).

```bash
php artisan test        # or ./vendor/bin/pest
./vendor/bin/pint       # formatting
```

## Docker

`Dockerfile` runs nginx + php-fpm (`pm = ondemand`, 4 children, opcache) + `schedule:work` under supervisord
on `$PORT` (default 8080). `docker/start.sh` caches config, migrates, syncs regions (retries while ML starts),
seeds, then starts supervisord. `APP_KEY` must be supplied through the environment.

## Environment

See `.env.example` for all variables. The ODLAR-specific ones:

| Variable | Default | Purpose |
|---|---|---|
| `ODLAR_ML_URL` | `http://ml:8001` | internal ML base URL |
| `ODLAR_INTERNAL_TOKEN` | empty | sent as `X-Internal-Token` |
| `ODLAR_ML_TIMEOUT` / `ODLAR_ML_RETRIES` / `ODLAR_ML_RETRY_SLEEP_MS` | 20 / 2 / 250 | ML client |
| `ODLAR_CACHE_STORE` / `ODLAR_CACHE_TTL` | `file` / 600 | proxy cache |
| `FRONTEND_URLS` | `http://localhost:3000` | CORS origins (comma separated; `*.vercel.app` always allowed); first one is used in e-mail links |
| `SEED_DEMO` | false | seed the demo account in production |
| `DB_*`, `MAIL_*`, `APP_KEY` | | standard Laravel |
