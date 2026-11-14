# ODLAR — one fire record for the Land of Fire

NASA Space Apps Challenge 2026 · **MODIS and VIIRS Hot Spots**

ODLAR harmonizes NASA's split active-fire archive into one consistent 25-year record. MODIS (1 km, 2000–) and VIIRS (375 m, 2012–) are not comparable as they stand. On that record it builds a burning-activity calendar for every district, answers "is this month normal here?", and forecasts fire risk against that history: for the next 7 days, and as a 13-week outlook. It covers **193 countries, 27,092 districts**, updated every day from NASA FIRMS; Azerbaijan is the home pilot.

- **Live app:** https://odlar.app (az / en)
- **API:** https://odlar.app/api/v1/status

## Why it matters

Computed from the built record (all 180 batches, 2001–2025, 14 Nov 2026):

| | Raw record | ODLAR |
|---|---|---|
| Error against real VIIRS on held-out years (median batch) | **−75 %** (MODIS) | **±1.3 %** |
| Countries where fires look like they are rising (175 countries) | **99 %** | **23 %** |
| World trend 2001–2025 | **+94 % / decade** (sensor artefact) | **−9 % / decade** |
| South Caucasus trend 2001–2025 | **+81 % / decade** | **−15 % / decade** |
| Azerbaijan, July 2026 against the usual July | **4.1×** ("alarm") | **0.6×** (below normal) |
| 7-day risk, Brier skill vs climatology (median batch) | **0.06** (trained on raw) | **0.17** |

Real changes survive the correction (Canada +46 %, India +11 % per decade, both significant).

**After Suomi NPP.** Suomi NPP, the reference satellite, stopped sending fire data on 2 Nov 2026. The record continues on its scale from NOAA-20 (`ml/odlar/harmonize/bridge.py`); hiding S-NPP's real Jul 2025 – Oct 2026 record and rebuilding it this way came out 5.6 % low worldwide. MODIS itself switches off in 2027.

## Architecture

```
NASA FIRMS ─┐                                     ┌─ Next.js 16 + MapLibre (own server)
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

The live record is real **NASA FIRMS** data (MODIS C6.1; VIIRS Suomi NPP, NOAA-20, NOAA-21), built per region batch with `python -m odlar.pipeline --source firms --batch <name>` (needs `FIRMS_MAP_KEY`, free from firms.modaps.eosdis.nasa.gov/api/map_key) and moved forward daily by `python -m odlar.refresh`. Weather is NASA POWER (history) and Open-Meteo (recent days and forecast). `make pipeline` without a key builds a small **synthetic fire world** for offline development and tests.

## Run locally

```bash
make setup
make pipeline          # synthetic, ~8 min; writes ml/artifacts/
make serve-ml          # :8001
make serve-api         # :8000 (needs Postgres+PostGIS; see api/README.md)
make web               # :3000 — set web/.env.local ODLAR_API_URL=http://127.0.0.1:8000/api/v1
```

Without Laravel, the web app can talk to FastAPI directly (`ODLAR_ML_URL`). Accounts and alerts are then disabled.

## Tests

| Suite | Command |
|---|---|
| Python (property-based + ground-truth + endpoints) | `make test-ml` |
| Laravel (Pest) | `make test-api` |
| Web unit/component (Vitest) | `make test-web` |
| End-to-end + axe accessibility (Playwright, desktop + mobile) | `make e2e` |

## Deploy

- **Frontend:** every push to `main` that touches `web/` builds a standalone Next.js server in GitHub Actions and ships it to our own server (`.github/workflows/deploy-web.yml`; repo variable `BUILD_ENV` holds `NEXT_PUBLIC_SITE_URL` and `ODLAR_API_URL`). The server health-checks each release and rolls back by itself.
- **Backend:** `make deploy` rsyncs code and artifacts to `/opt/odlar` and runs `deploy/docker-compose.prod.yml` (db, ml, api). The API joins the existing `portfelim_default` network as `odlar-api`, and the shared Caddy serves it under `odlar-api.46-224-126-66.sslip.io`.
- **Refreshing data:** a daily job on the server (06:30 UTC) runs `odlar.refresh` for every batch: new FIRMS detections and weather, risk re-scored with the trained models. Full rebuilds run on a workstation, never on the server.
