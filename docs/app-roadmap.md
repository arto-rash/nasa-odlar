# ODLAR app roadmap (Nov 2026)

## Status (11 Nov 2026)
- Batch 1 done (ed57de3): calendar → evidence, no-data marks, season countdown, near me.
- Batches 2–3 done (8b462b6): /forecast, outlook by week, "What's ahead", forecast
  cells in the calendars, Explore forecast weeks, chart in the Risk view. Not done:
  the Risk map's horizon switch and the home "this week & ahead" card.
- Batch 4 done (0b149b7): Fires now (events, Explore layer/list/detail, region list).
- Batch 5 done: region report (aa445d9); Telegram alerts built and tested, **off
  until the bot token is set** (see "Needs from the user").
- Also fixed: refresh OOM on big batches; alert e-mail links went to a 404.

Goal: stand apart from other MODIS/VIIRS entries by being a working app you
can act on: evidence behind every number, honest gaps, and clear forecasts from
tomorrow to a year ahead.

## What already exists (don't rebuild)
- Raw ↔ harmonized toggle, uncertainty bands, unusual-year marks (region page).
- 7-day risk probability + drivers, 8-day daily fire-weather danger, 13-week
  outlook total (q10/q50/q90 against normal) — `risk_detail` in
  `ml/odlar/api/service.py`, shown on `/risk`.
- Weekly climatology per region (mean, p10–p90, season start/peak/end) in the
  calendar (`ml/odlar/calendar/engine.py`).
- Model skill: `/model/report` (short-term skill, outlook pinball skill,
  80% coverage), reliability chart on `/methodology`.
- Email alerts (`odlar:evaluate-risk` hourly, `RiskAlertMail`), AOI drawing,
  Compare, Simple mode with geolocation.

## Forecast horizons (the "how far ahead" model)
One consistent story everywhere, with confidence fading as the horizon grows:

| Horizon | Source | Shown as | Label |
|---|---|---|---|
| Next 8 days | Open-Meteo weather forecast → fire-weather danger | daily bars | "Forecast" |
| Next 7 days | short-term model probability | risk level + drivers | "Forecast" |
| Next 13 weeks | outlook model q10/q50/q90, spread over weeks by the region's seasonal shape | band vs normal band | "Outlook" |
| 14–52 weeks | climatology p10–p90 (+ trend nudge) | faded band | "Typical year — not a forecast" |

Every horizon carries a plain reliability line from back-tests, e.g. "In past
years the real value fell inside this range 8 times in 10."

Stretch (only if limits allow): monthly weather anomalies from a seasonal
forecast (e.g. Open-Meteo seasonal API) to tilt months 2–6. The daily refresh
already uses ~7,800 of the 10,000 free Open-Meteo locations, so this would run
weekly on a coarse grid. Verify limits before building.

## Batches

### Batch 1 — quick wins (mostly frontend)
1. **Calendar → evidence.** Click any calendar cell (year × week) → Explore at
   that week, zoomed to the region, region selected, real MODIS/VIIRS points.
   Same from the weekly chart tooltip. Explore already reads URL state; add
   `week`, `r` (+ fit bounds).
2. **"No data" ≠ "no fire".** Mark weeks where a sensor wasn't observing:
   before MODIS Terra (Nov 2000) / Aqua (Jul 2002), before VIIRS (Jan 2012),
   known satellite outages, and weeks after the data end. Hatched cells in the
   calendar, gaps (not zeros) in charts, legend entry + tooltip text. Coverage
   table is global (per sensor per week), served once in `/meta`.
   Per-region cloud cover is out of scope (would need a full weather re-fetch).
   Add the caveat "a detection is a heat signal, not burned area" next to counts.
3. **Season countdown** in the region header: "Season starts in ~3 weeks",
   "Peak now — 2.4× usual", "Season over — next starts ~March". From the
   existing season profile + current status. Also on Simple mode.
4. **Near me everywhere.** Locate button in the nav/command palette, Explore and
   Risk (geolocation → `/regions/locate` → region). Not stored or sent anywhere else.

### Batch 2 — forecasts, backend
1. `refresh.py` + `pipeline.py`: new table `outlook_weekly` (region, week,
   q10, q50, q90, normal, normal_p10, normal_p90) for the next 13 weeks:
   climatology shape × (q50 / normal 13-week total), same for q10/q90.
   ~27.6k regions × 13 rows. Measure refresh peak memory on the server.
2. Endpoint `/forecast/{slug}`: daily (8 d), week-7 probability, weekly 13 w,
   typical 14–52 w, season callouts (next start/peak with dates), reliability
   per horizon from the model report. Country = sum of children.
3. Endpoint `/forecast/map?week=YYYY-MM-DD`: compact `{region_id: [ratio, level]}`
   for one future week (province level), immutable per data date, nginx-cached.
4. Gateway routes + cache headers (Laravel `AnalyticsController`), pytest +
   PHP tests.

### Batch 3 — forecasts, frontend ("intuitive")
1. **"Ahead" chart** on the region page and risk detail: one timeline from
   today → 12 months: daily danger bars, then the 13-week band against the
   normal band, then the faded typical-year band. "Today" line, season
   shading, callouts ("starts ~in 3 weeks", "peak ~mid-Aug"), the reliability line.
2. **Calendar continues into the future**: a hatched "next 12 months" row with
   expected levels, so the past grid and the future read the same way.
3. **Explore timeline runs into the future**: the scrubber extends 13 weeks
   past today (dashed, "Forecast" chip). In the future part the map colours
   provinces by expected activity vs normal; dots disappear (nothing observed yet).
4. **Risk map horizon switch**: Next 7 days | Next 3 months | Season peak.
5. Home: "This week & ahead" card for Azerbaijan.

### Batch 4 — Fires now (event view)
1. `odlar.events` in the refresh: last 14 days of detections, linked within
   ~2 km and 1 day (grid-based connected components), MODIS+VIIRS together.
   Per event: centroid, bbox, first/last seen, detections, max/total FRP,
   sensors agreeing, region. Stored as `events_now.parquet`. Measure memory.
2. Endpoints `/events?bbox=&region=` and `/events/{id}`.
3. Explore "Fires now" panel: list sorted by size/intensity, map layer with
   event outlines, click → fly + detail (timeline of the event's detections).
   Region page: "Active fires" section.

### Batch 5 — reach
1. **Telegram alerts.** Bot (token from the user, server env only). Link via
   `t.me/<bot>?start=<one-time code>` from Alerts; new `telegram` channel in
   subscriptions; `odlar:evaluate-risk` sends via Bot API. Commands: `/risk`,
   `/near` (share location), `/stop`.
2. **Region report**: `/region/[slug]/report`, print-styled single page
   (calendar, trend, season, outlook, risk, source note) → browser "Save as PDF".
   Share button.

## Every batch
- en + az strings; phone width checked (390 px); light + dark.
- `tsc`, `eslint`, `vitest` (web/node_modules/.bin), `pytest` for ML, PHP tests.
- Deploy: web via push (GitHub Actions); ML/API via `./deploy/deploy.sh` /
  `docker compose build ml`; refresh changes take effect at 06:30 UTC or by a
  manual run. Watch server memory (swap already 1.6–1.9 GB of 2 GB).

## Needs from the user
- Telegram: create a bot with @BotFather, then in /opt/odlar/deploy/.env set
  TELEGRAM_BOT_TOKEN, TELEGRAM_BOT_USERNAME (without @) and TELEGRAM_WEBHOOK_SECRET
  (any long random string), restart the api container, and run
  `php artisan odlar:telegram-webhook https://odlar-api.46-224-126-66.sslip.io`.
- OK on the stretch seasonal-weather source once limits are checked.

## Known issues to fold in when touched
- `odlar:sync-regions` calls the full `/regions/geojson`, which OOMs in DuckDB.
- React #418 hydration warning on Explore.
