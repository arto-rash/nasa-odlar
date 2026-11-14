"""ODLAR analytics API (internal; the Laravel gateway is the public face).

    uvicorn odlar.api.main:app --port 8001
"""

from __future__ import annotations

import hashlib
import os
from datetime import date
from typing import Literal

from fastapi import Body, Depends, FastAPI, Header, HTTPException, Query, Request, Response
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse

from odlar.api import service
from odlar.store import Store, get_store

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
def regions(s: Store = Depends(store)):
    return service.list_regions(s)


@app.get("/regions/geojson", dependencies=deps)
def regions_geojson(s: Store = Depends(store)):
    return service.regions_geojson(s)


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


@app.get("/risk", dependencies=deps)
def risk_map(s: Store = Depends(store)):
    return service.risk_map(s)


@app.get("/risk/{slug}", dependencies=deps)
def risk(slug: str, s: Store = Depends(store)):
    return service.risk_detail(s, slug)


@app.get("/hotspots", dependencies=deps)
def hotspots(start: date, end: date, sensor: Literal["MODIS", "VIIRS", "modis", "viirs"] | None = None,
             region: str | None = None, limit: int = Query(20000, le=50000), s: Store = Depends(store)):
    return service.hotspots(s, start, end, sensor, region, limit)


@app.get("/timeline", dependencies=deps)
def timeline(s: Store = Depends(store)):
    return service.timeline(s)


@app.get("/grid", dependencies=deps)
def grid(year: int | None = None, sensor: Literal["MODIS", "VIIRS"] | None = None, s: Store = Depends(store)):
    return service.grid(s, year, sensor)


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
