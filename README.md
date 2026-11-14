# ODLAR — one fire record for the Land of Fire

NASA Space Apps Challenge 2026 · **MODIS and VIIRS Hot Spots**

ODLAR harmonizes NASA's split active-fire archive into one consistent 25-year record. MODIS (1 km, 2000–) and VIIRS (375 m, 2012–) are not comparable as they stand. On that record it builds a burning-activity calendar for every district of Azerbaijan, Georgia and Armenia. It then forecasts fire risk against that history: for the next 7 days, and as a 13-week outlook.

- **Live app:** https://odlar.vercel.app (az / en)
- **API:** https://odlar-api.46-224-126-66.sslip.io/api/v1/status

## Why it matters

| | Raw record | ODLAR |
|---|---|---|
| Bias against VIIRS, held-out years | **−62 %** (MODIS) | **+1 %** |
| South Caucasus trend 2001–2025 | **+87 % / decade** (sensor artefact) | **+3 % / decade** |
| Risk model Brier skill vs climatology | **−0.02** (trained on raw) | **+0.13** |

## Architecture

```
NASA FIRMS ─┐                                     ┌─ Next.js 16 + MapLibre (Vercel)
NASA POWER ─┼─ ml/ Python pipeline ─ store ─ FastAPI ─ Laravel gateway (PostGIS, auth, alerts)
Open-Meteo ─┘   harmonize · calendar · LightGBM
```

| Folder | What it is |
|---|---|
| `ml/` | Pipeline: ingest, quality control, gridding, harmonization (two-part quantile mapping + conditional bias correction + predictive block bootstrap), leave-one-year-out validation, calendar, LightGBM risk and outlook models. Also the FastAPI analytics service. |
| `api/` | Laravel 12 gateway: Sanctum auth, subscriptions, alert engine (`odlar:evaluate-risk`, hourly), PostGIS region geometries, caching proxy to analytics. |
| `web/` | Next.js 16 frontend: landing story, Explore (timeline + area-of-interest calendar), region Fire Clock, Risk, Harmonization Lab, Methodology, Data & API, citizen Simple mode, Alerts. |
| `deploy/` | Production compose and deploy script for the shared Hetzner box. |

## Data

`make pipeline` builds a **synthetic fire world** driven by real NASA POWER weather. It simulates true fires, then observes them through each sensor's detection physics, which gives a hidden ground truth to test harmonization against. For the real archive, set `FIRMS_MAP_KEY` (free from firms.modaps.eosdis.nasa.gov/api/map_key) and run `make pipeline-firms`. The app labels its data source ("Demo data" / "NASA FIRMS").

## Run locally

```bash
make setup
make pipeline          # ~8 min; writes ml/artifacts/
make serve-ml          # :8001
make serve-api         # :8000 (needs Postgres+PostGIS; see api/README.md)
make web               # :3000 — set web/.env.local ODLAR_API_URL=http://127.0.0.1:8000/api/v1
```

Without Laravel, the web app can talk to FastAPI directly (`ODLAR_ML_URL`). Accounts and alerts are then disabled.

## Tests

| Suite | Command | Count |
|---|---|---|
| Python (property-based + ground-truth + endpoints) | `make test-ml` | 81 |
| Laravel (Pest) | `make test-api` | 196 |
| Web unit/component (Vitest) | `make test-web` | 31 |
| End-to-end + axe accessibility (Playwright, desktop + mobile) | `make e2e` | 21 |

## Deploy

- **Frontend:** Vercel project `odlar`. Env vars: `ODLAR_API_URL`, `NEXT_PUBLIC_SITE_URL`.
- **Backend:** `make deploy` rsyncs code and artifacts to `/opt/odlar` and runs `deploy/docker-compose.prod.yml` (db, ml, api). The API joins the existing `portfelim_default` network as `odlar-api`, and the shared Caddy serves it under `odlar-api.46-224-126-66.sslip.io`.
- **Refreshing data:** run `make pipeline`, then `make deploy-artifacts`.
