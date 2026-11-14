"""ODLAR analytics API (internal; the Laravel gateway is the public face).

    uvicorn odlar.api.main:app --port 8001
"""

from __future__ import annotations

import hashlib
import os
from datetime import date
from typing import Literal

from fastapi import Body, Depends, FastAPI, Header, HTTPException, Path, Query, Request, Response
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse

from odlar.api import service
from odlar.store import Store, get_store
from odlar.week_packs import PACK_DIR

app = FastAPI(title="ODLAR analytics", version="1.0.0",
              description="Harmonized MODIS/VIIRS fire calendar and risk engine for the South Caucasus.")
app.add_middleware(GZipMiddleware, minimum_size=1024)

INTERNAL_TOKEN = os.environ.get("ODLAR_INTERNAL_TOKEN", "")


def guard(x_internal_token: str | None = Header(default=None)) -> None:
    if INTERNAL_TOKEN and x_internal_token != INTERNAL_TOKEN:
        raise HTTPException(status_code=401, detail="invalid internal token")


def store() -> Store:
    try:
        return get_store()
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.exception_handler(service.NotFound)
async def not_found(_req: Request, exc: service.NotFound):
    return JSONResponse(status_code=404, content={"detail": str(exc)})


@app.exception_handler(ValueError)
async def bad_value(_req: Request, exc: ValueError):
    return JSONResponse(status_code=422, content={"detail": str(exc)})


@app.middleware("http")
async def cache_headers(request: Request, call_next):
    response: Response = await call_next(request)
    if request.method == "GET" and response.status_code == 200 and request.url.path != "/health":
        try:
            built = get_store().meta.get("built_at", "")
        except FileNotFoundError:
            built = ""
        response.headers["Cache-Control"] = "public, max-age=300"
        response.headers["ETag"] = '"' + hashlib.sha1(f"{built}{request.url}".encode()).hexdigest()[:20] + '"'
    return response


@app.get("/health")
def health():
    try:
        s = get_store()
        return {"status": "ok", "data_end": s.meta["data_end"], "source": s.meta["source"]}
    except FileNotFoundError:
        return JSONResponse(status_code=503, content={"status": "no_store"})


deps = [Depends(guard)]


@app.get("/overview", dependencies=deps)
def overview(s: Store = Depends(store)):
    return service.overview(s)


@app.get("/meta", dependencies=deps)
def meta(s: Store = Depends(store)):
    return s.meta


@app.get("/regions", dependencies=deps)
def regions(country: str | None = Query(None, max_length=3), parent: str | None = Query(None, max_length=100),
            q: str | None = Query(None, max_length=80), level: str | None = Query(None, max_length=20),
            limit: int | None = Query(None, ge=1, le=50000), lite: bool = False, s: Store = Depends(store)):
    """All regions, or filtered: by country code, parent region slug, level or a
    search query (best matches first); ``lite`` leaves out the annual series."""
    return service.list_regions(s, country, parent, q, level, limit, lite)


@app.get("/regions/geojson", dependencies=deps)
def regions_geojson(bbox: str | None = Query(None, description="west,south,east,north"),
                    zoom: float | None = Query(None, ge=0, le=24), country: str | None = Query(None, max_length=3),
                    s: Store = Depends(store)):
    """Without parameters: every region at map detail (the full set, used by the
    gateway's region sync). With bbox/zoom/country: only the shapes in view."""
    if bbox is None and zoom is None and country is None:
        return Response(service.regions_geojson(s), media_type="application/geo+json")
    return Response(service.region_shapes(s, parse_bbox(bbox), 8.0 if zoom is None else zoom, country),
                    media_type="application/geo+json")


@app.get("/regions/locate", dependencies=deps)
def locate(lat: float, lon: float, s: Store = Depends(store)):
    return service.locate(s, lat, lon)


@app.get("/regions/{slug}", dependencies=deps)
def region(slug: str, s: Store = Depends(store)):
    return service.region_detail(s, slug)


@app.get("/series/{slug}/weekly", dependencies=deps)
def weekly(slug: str, start: date | None = None, end: date | None = None, s: Store = Depends(store)):
    return service.weekly_series(s, slug, start, end)


@app.get("/series/{slug}/annual", dependencies=deps)
def annual(slug: str, s: Store = Depends(store)):
    return service.annual_series(s, slug)


@app.get("/calendar/{slug}", dependencies=deps)
def calendar(slug: str, s: Store = Depends(store)):
    return service.calendar(s, slug)


@app.get("/events", dependencies=deps)
def fire_events(bbox: str | None = Query(None, description="west,south,east,north"),
                region: str | None = Query(None, max_length=100), active: bool = False,
                limit: int = Query(200, ge=1, le=2000), s: Store = Depends(store)):
    """Fires of the last two weeks, biggest first (detections grouped by place and day)."""
    return service.events(s, parse_bbox(bbox), region, active, limit)


@app.get("/static-sources", dependencies=deps)
def static_sources(bbox: str | None = Query(None, description="west,south,east,north"),
                   limit: int = Query(5000, ge=1, le=20000), s: Store = Depends(store)):
    """Steady heat sources (gas flares and the like) removed from the record."""
    return service.static_sources(s, parse_bbox(bbox), limit)


@app.get("/events/{event_id}", dependencies=deps)
def fire_event(event_id: str = Path(..., pattern=r"^-?\d+\.\d+_-?\d+\.\d+_\d{8}$"), s: Store = Depends(store)):
    """One fire with its detections."""
    return service.event_detail(s, event_id)


@app.get("/forecast/map", dependencies=deps)
def forecast_map(week: date, bbox: str | None = Query(None, description="west,south,east,north"),
                 s: Store = Depends(store)):
    """Expected and usual detections per province for one week ahead (13 weeks)."""
    return service.forecast_map(s, week, parse_bbox(bbox))


@app.get("/forecast/{slug}", dependencies=deps)
def forecast(slug: str, s: Store = Depends(store)):
    """The days, weeks and months ahead for one region."""
    return service.forecast(s, slug)


@app.get("/risk", dependencies=deps)
def risk_map(country: str | None = Query(None, max_length=3), limit: int | None = Query(None, ge=1, le=50000),
             s: Store = Depends(store)):
    """Current 7-day risk per province, highest first; optionally one country or the top ``limit``."""
    return service.risk_map(s, country, limit)


@app.get("/risk/{slug}", dependencies=deps)
def risk(slug: str, s: Store = Depends(store)):
    return service.risk_detail(s, slug)


@app.get("/hotspots", dependencies=deps)
def hotspots(start: date, end: date, sensor: Literal["MODIS", "VIIRS", "modis", "viirs"] | None = None,
             region: str | None = None, limit: int = Query(20000, le=50000),
             bbox: str | None = Query(None, description="west,south,east,north in degrees"),
             cell: float | None = Query(None, gt=0, le=5, description="sum per grid cell of this size (degrees)"),
             s: Store = Depends(store)):
    return service.hotspots(s, start, end, sensor, region, limit, parse_bbox(bbox), cell)


def _pack(path) -> FileResponse:
    if not path.is_file():
        raise service.NotFound("no week pack for that year")
    return FileResponse(path, media_type="application/octet-stream")


@app.get("/week-pack/{year}", dependencies=deps)
def week_pack(year: int):
    """A year of sampled detections for the world view (see odlar.week_packs)."""
    return _pack(PACK_DIR / f"{year}.bin")


@app.get("/week-pack/home/{year}", dependencies=deps)
def week_pack_home(year: int):
    """A year of every detection in the area Explore opens on."""
    return _pack(PACK_DIR / "home" / f"{year}.bin")


@app.get("/timeline", dependencies=deps)
def timeline(s: Store = Depends(store)):
    return service.timeline(s)


@app.get("/grid", dependencies=deps)
def grid(year: int | None = None, sensor: Literal["MODIS", "VIIRS"] | None = None,
         bbox: str | None = Query(None, description="west,south,east,north in degrees"),
         step: float = Query(0.1, ge=0.1, le=5), s: Store = Depends(store)):
    return service.grid(s, year, sensor, parse_bbox(bbox), step)


def parse_bbox(bbox: str | None) -> tuple[float, float, float, float] | None:
    if not bbox:
        return None
    try:
        box = tuple(float(v) for v in bbox.split(","))
    except ValueError as exc:
        raise ValueError("bbox must be west,south,east,north") from exc
    if len(box) != 4:
        raise ValueError("bbox must be west,south,east,north")
    return box


@app.post("/aoi/summary", dependencies=deps)
def aoi(geometry: dict = Body(..., embed=True), s: Store = Depends(store)):
    return service.aoi_summary(s, geometry)


@app.get("/harmonization/skill", dependencies=deps)
def skill(region: str | None = None, s: Store = Depends(store)):
    return service.harmonization_skill(s, region)


@app.get("/model/report", dependencies=deps)
def model_report(s: Store = Depends(store)):
    return s.model_report


@app.get("/export/{slug}", dependencies=deps)
def export(slug: str, kind: Literal["weekly", "annual", "hotspots"] = "weekly",
           format: Literal["csv", "json", "geojson"] = "csv", start: date | None = None,
           end: date | None = None, s: Store = Depends(store)):
    body, media, name = service.export(s, slug, kind, format, start, end)
    return Response(content=body, media_type=media, headers={"Content-Disposition": f'attachment; filename="{name}"'})
