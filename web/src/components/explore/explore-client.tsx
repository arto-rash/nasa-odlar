"use client";

import { keepPreviousData, useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Feature, FeatureCollection, Polygon } from "geojson";
import type { MapLayerMouseEvent, MapMouseEvent } from "maplibre-gl";
import { ArrowRight, ChevronDown, Flame, Layers, Loader2, PenLine, Trash2, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FireClock } from "@/components/charts/fire-clock";
import { BaseMap, useMap } from "@/components/map/base-map";
import { FlyTo } from "@/components/map/fly-to";
import { NearMeControl } from "@/components/map/near-me-control";
import { MapViewWatcher, useCountryShape, type PointView } from "@/components/map/use-regions";
import { ViewportRegionsLayer } from "@/components/map/viewport-regions";
import { DensityLayer, HotspotLayer, SignatureLayer, useGeoJson, useLayer, useLayerColors, type HotspotPoint, type RegionMode } from "@/components/map/layers";
import { RiskBadge } from "@/components/ui/risk-badge";
import { Link } from "@/i18n/navigation";
import { http } from "@/lib/client";
import { cn } from "@/lib/cn";
import { AFTERGLOW_WEEKS, packAreaFor, packPoints, weekPackQuery, yearsFor, type WeekPack } from "@/lib/map-data";
import { useMediaQuery } from "@/lib/use-media";
import { fmtDate, fmtNum, regionName, type AppLocale } from "@/lib/format";
import type { AoiSummary, FireEvent, ForecastMap, HotspotResponse, RiskLevel, TimelinePoint } from "@/lib/types";
import { FORECAST_STOPS } from "@/components/map/layers";
import { Timeline } from "./timeline";
import { FireDetail, FiresLayer, FiresList, FitFire } from "./fires";
import { StaticSourcesLayer, useStaticSources } from "./static-sources";
import { ImageryLayers } from "@/components/map/imagery";
import { RegionPlace } from "@/components/ui/region-place";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (s: string, n: number) => iso(new Date(new Date(s + "T00:00:00Z").getTime() + n * 86400000));
/** weeks the outlook covers after the record's last (filling) week */
const FORECAST_WEEKS = 13;

export function ExploreClient({
  timeline, initialWeek, initialRegion = null, initialFire = null, initialSatellite = false,
}: {
  timeline: TimelinePoint[];
  initialWeek: string;
  initialRegion?: string | null;
  initialFire?: string | null;
  initialSatellite?: boolean;
}) {
  const t = useTranslations("explore");
  const tf = useTranslations("fires");
  const [fires, setFires] = useState(!!initialFire);
  const [fireId, setFireId] = useState<string | null>(initialFire);
  const locale = useLocale() as AppLocale;
  const qc = useQueryClient();
  const signature = useCountryShape("az");
  const [index, setIndex] = useState(() => Math.max(0, timeline.findIndex((p) => p.week === initialWeek)));
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [layers, setLayers] = useState({ hotspots: true, density: false, regions: "outline" as RegionMode | "off", flares: false,
    imagery: (initialSatellite ? "satellite" : "map") as "map" | "satellite", nasaDay: true });
  const { data: flares } = useStaticSources(layers.flares);
  const [sensors, setSensors] = useState({ M: true, V: true });
  const [hover, setHover] = useState<{ id?: number; slug: string; name_az: string; name_en: string; country?: string; level?: string; country_name_en?: string; country_name_az?: string; state_name_en?: string; state_name_az?: string; risk_level?: string; x: number; y: number } | null>(null);
  const [selected, setSelected] = useState<string | null>(initialRegion);
  const [drawing, setDrawing] = useState(false);
  const [vertices, setVertices] = useState<[number, number][]>([]);
  const [aoiClosed, setAoiClosed] = useState(false);
  // phones start with both panels folded so the map has the screen; after a tap
  // each panel keeps what the user chose
  const phone = useMediaQuery("(max-width: 639px)");
  const [panelChoice, setPanelChoice] = useState<boolean | null>(null);
  const [timelineChoice, setTimelineChoice] = useState<boolean | null>(null);
  const panelOpen = panelChoice ?? !phone;
  const timelineOpen = timelineChoice ?? !phone;

  // the record, then the weeks ahead: past them the map shows the forecast, not detections
  const line = useMemo<TimelinePoint[]>(() => {
    const last = timeline[timeline.length - 1]?.week;
    if (!last) return timeline;
    const ahead = Array.from({ length: FORECAST_WEEKS }, (_, k) => ({
      week: addDays(last, 7 * (k + 1)), modis: 0, viirs: 0, harmonized: 0, lo: 0, hi: 0, forecast: true,
    }));
    return [...timeline, ...ahead];
  }, [timeline]);
  const isFuture = index >= timeline.length;
  const week = line[index]?.week ?? initialWeek;
  const range = (w: string) => ({ start: addDays(w, -7 * AFTERGLOW_WEEKS), end: addDays(w, 6) });
  // What the map shows decides what is fetched (see MapViewWatcher): points in
  // view, or per-cell sums when zoomed out.
  const [view, setView] = useState<PointView | null>(null);
  const viewQuery = view
    ? `&limit=${view.limit}${view.bbox ? `&bbox=${view.bbox}` : ""}${view.cell ? `&cell=${view.cell}` : ""}`
    : "";
  // The whole world and the home area read weeks from the year files, so moving
  // along the timeline costs nothing. Elsewhere each week is a query for the visible
  // area: a dragged timeline asks only once it pauses, and the last request is cancelled.
  const packArea = view ? packAreaFor(view.bbox) : null;
  const [apiWeek, setApiWeek] = useState(week);
  useEffect(() => {
    const id = setTimeout(() => setApiWeek(week), playing ? 0 : 140);
    return () => clearTimeout(id);
  }, [week, playing]);
  // NASA's picture for the satellite view: the last day of the week shown (not
  // after yesterday, the newest day NASA has), and none for forecast weeks
  const [yesterday] = useState(() => new Date(Date.now() - 864e5).toISOString().slice(0, 10));
  const nasaDay = isFuture ? null : [addDays(apiWeek, 6), yesterday].sort()[0];
  const packResults = useQueries({
    // with no file for the view, the world's (if loaded) shows until the query answers
    queries: yearsFor(week).map((y) => ({ ...weekPackQuery(y, packArea ?? "world"), enabled: packArea !== null && !isFuture })),
  });
  const packs = packResults.every((r) => r.data) ? packResults.map((r) => r.data as WeekPack) : null;
  const packsKey = packResults.map((r) => r.dataUpdatedAt).join();
  const packFailed = packResults.some((r) => r.isError);
  const packRate = packs?.[0]?.rate ?? 1;
  const fetchWeek = (w: string, signal?: AbortSignal) => {
    const r = range(w);
    return http<HotspotResponse>(`/hotspots?start=${r.start}&end=${r.end}${viewQuery}`, { signal });
  };
  const { data, isFetching: weekFetching } = useQuery({
    queryKey: ["hotspots", apiWeek, viewQuery],
    queryFn: ({ signal }) => fetchWeek(apiWeek, signal),
    enabled: view !== null && !isFuture && (packArea === null || packFailed),
    placeholderData: keepPreviousData,
    staleTime: Infinity,
  });
  const isFetching = weekFetching || (packArea !== null && !packs && !packFailed);
  const { data: grid } = useQuery({
    queryKey: ["grid", view?.step, view?.bbox],
    queryFn: () => http<{ cells: [number, number, number][] }>(`/grid?step=${view!.step}${view!.bbox ? `&bbox=${view!.bbox}` : ""}`),
    enabled: view !== null && layers.density,
    placeholderData: keepPreviousData,
    staleTime: 30 * 60_000,
  });

  // what comes next: the next files at world zoom, nearby weeks when zoomed in
  useEffect(() => {
    if (!view || isFuture) return;
    const at = timeline.findIndex((p) => p.week === apiWeek);
    for (const k of [1, 2, 3, -1]) {
      const w = timeline[at + k]?.week;
      if (!w) continue;
      if (packArea) yearsFor(w).forEach((y) => void qc.prefetchQuery(weekPackQuery(y, packArea)));
      else qc.prefetchQuery({ queryKey: ["hotspots", w, viewQuery], queryFn: ({ signal }) => fetchWeek(w, signal), staleTime: Infinity });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiWeek, viewQuery, packArea]);

  // Playback only moves on once the next week's detections are loaded, so every
  // frame shows its own week (on a slow connection it plays slower, not frozen).
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      setIndex((i) => {
        const next = i + 1 >= timeline.length ? 0 : i + 1;
        const w = timeline[next]?.week;
        if (!w) return i;
        const ready = packArea
          ? yearsFor(w).every((y) => qc.getQueryData(["week-pack", packArea, y]))
          : qc.getQueryData(["hotspots", w, viewQuery]);
        return ready ? next : i;
      });
    }, 700 / speed);
    return () => clearInterval(id);
  }, [playing, speed, timeline, qc, viewQuery, packArea]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input,textarea,select,[role=slider]")) return;
      if (e.code === "Space") {
        e.preventDefault();
        setPlaying((p) => !p);
      }
      if (e.key === "ArrowRight") setIndex((i) => Math.min(line.length - 1, i + 1));
      if (e.key === "ArrowLeft") setIndex((i) => Math.max(0, i - 1));
      if (e.key === "Escape") {
        setDrawing(false);
        setVertices([]);
        setAoiClosed(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [line.length]);

  useEffect(() => {
    const u = new URL(window.location.href);
    u.searchParams.set("w", week);
    if (fireId) u.searchParams.set("fire", fireId);
    else u.searchParams.delete("fire");
    if (layers.imagery === "satellite") u.searchParams.set("sat", "1");
    else u.searchParams.delete("sat");
    window.history.replaceState(null, "", u);
  }, [week, fireId, layers.imagery]);
  const { data: fireData } = useQuery({
    queryKey: ["events", view?.bbox ?? null],
    queryFn: () => http<{ total: number; events: FireEvent[] }>(`/events?limit=300${view?.bbox ? `&bbox=${view.bbox}` : ""}`),
    enabled: fires && view !== null,
    placeholderData: keepPreviousData,
    staleTime: 10 * 60_000,
  });
  const goToDate = useCallback(
    (date: string) => {
      const i = timeline.findIndex((p, k) => p.week <= date && (timeline[k + 1]?.week ?? "9999") > date);
      if (i >= 0) setIndex(i);
    },
    [timeline],
  );

  const worldPoints = useMemo(
    () => (packs ? packPoints(packs, week) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [packsKey, week],
  );
  const usesPacks = !!worldPoints && (packArea !== null || !data);
  const points: HotspotPoint[] = useMemo(() => {
    if (isFuture) return [];
    if (usesPacks) return worldPoints;
    if (!data) return [];
    const w0 = new Date(week + "T00:00:00Z").getTime();
    return data.points.map(([lon, lat, s, , frp, date]) => ({
      lon, lat, sensor: s, frp,
      age: Math.max(0, Math.ceil((w0 - new Date(date + "T00:00:00Z").getTime()) / (7 * 86400000))),
    }));
  }, [data, week, usesPacks, worldPoints, isFuture]);
  const { data: forecast, isFetching: forecastFetching } = useQuery({
    queryKey: ["forecast-map", week, view?.bbox ?? null],
    queryFn: () => http<ForecastMap>(`/forecast/map?week=${week}${view?.bbox ? `&bbox=${view.bbox}` : ""}`),
    enabled: isFuture && view !== null,
    placeholderData: keepPreviousData,
    staleTime: 30 * 60_000,
  });
  const forecastById = useMemo(() => new Map((forecast?.values ?? []).map(([id, e, u]) => [id, [e, u]] as const)), [forecast]);
  // a sampled answer (more points than the map draws) is scaled back to the true count
  const shown = points.filter((p) => p.age === 0 && sensors[p.sensor]).length;
  const currentCount = usesPacks
    ? shown * packRate
    : data?.sampled && points.length ? Math.round((shown * data.total) / points.length) : shown;

  const aoi = useMutation({
    mutationFn: (coords: [number, number][]) =>
      http<AoiSummary>("/aoi/summary", { method: "POST", json: { geometry: { type: "Polygon", coordinates: [[...coords, coords[0]]] } } }),
  });

  const finishPolygon = useCallback(
    (raw: [number, number][]) => {
      // a double-click also fires two clicks; drop the duplicate vertices it adds
      const vs = raw.filter((v, i) => i === 0 || Math.hypot(v[0] - raw[i - 1][0], v[1] - raw[i - 1][1]) > 1e-3);
      if (vs.length < 3) return;
      setVertices(vs);
      setDrawing(false);
      setAoiClosed(true);
      aoi.mutate(vs);
    },
    [aoi],
  );

  const onHover = useCallback((p: { slug: string; name_az: string; name_en: string; risk_level?: string } | null, e?: MapLayerMouseEvent) => {
    if (!p || !e) return setHover(null);
    setHover({ ...p, x: e.point.x, y: e.point.y });
  }, []);

  return (
    <div className="fixed inset-0 bg-bg">
      <BaseMap className="absolute inset-0 [&_.maplibregl-ctrl-top-right]:!top-[84px] [&_.maplibregl-ctrl-top-right]:!right-2 sm:[&_.maplibregl-ctrl-top-right]:!right-3" controlsPosition="top-right" options={{ doubleClickZoom: false }}>
        <MapViewWatcher onChange={setView} />
        <FlyTo slug={initialRegion} duration={0} />
        <NearMeControl onFound={(r) => setSelected(r.slug)} />
        <DensityLayer cells={grid?.cells ?? []} visible={layers.density} />
        <ViewportRegionsLayer
          mode={isFuture ? "forecast" : layers.regions === "off" ? "outline" : layers.regions}
          visible={isFuture || layers.regions !== "off"}
          forecast={isFuture ? forecast : undefined}
          selected={selected}
          onHover={drawing ? undefined : onHover}
          onClick={drawing ? undefined : setSelected}
        />
        <SignatureLayer geojson={signature} />
        <HotspotLayer points={points} visible={layers.hotspots} sensors={sensors} onImagery={layers.imagery === "satellite"} />
        {fires && <FiresLayer events={fireData?.events ?? []} selected={fireId} onPick={setFireId} />}
        {layers.flares && <StaticSourcesLayer data={flares} />}
        {layers.imagery === "satellite" && <ImageryLayers day={layers.nasaDay ? nasaDay : null} />}
        <FitFire id={fireId} />
        <AoiLayer
          drawing={drawing}
          vertices={vertices}
          closed={aoiClosed}
          onAdd={(v) => {
            const first = vertices[0];
            setVertices((vs) => [...vs, v]);
            return first;
          }}
          onFinish={() => finishPolygon(vertices)}
          onCloseNear={() => finishPolygon(vertices)}
        />
      </BaseMap>

      {/* hover card */}
      <AnimatePresence>
        {hover && !drawing && (
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1, x: hover.x + 16, y: hover.y + 16 }}
            exit={{ opacity: 0 }}
            transition={{ type: "spring", stiffness: 700, damping: 45 }}
            className="pointer-events-none fixed left-0 top-0 z-30 rounded-md border border-line-strong bg-panel-solid/95 px-3 py-2 text-[13px] shadow-2xl"
          >
            <p className="font-medium">{regionName(hover, locale)}</p>
            <RegionPlace r={hover} />
            {isFuture ? (
              (() => {
                const fc = hover.id != null ? forecastById.get(hover.id) : undefined;
                return fc ? (
                  <p className="mt-1 tabular-nums text-dim">{t("forecastHover", { value: fmtNum(fc[0], locale, fc[0] < 10 ? 1 : 0), usual: fmtNum(fc[1], locale, fc[1] < 10 ? 1 : 0) })}</p>
                ) : null;
              })()
            ) : (
              hover.risk_level && <RiskBadge level={hover.risk_level as RiskLevel} className="mt-1" />
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* layer panel */}
      <motion.aside
        initial={{ opacity: 0, x: -16 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 0.3, duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        className={cn(
          "glass absolute left-3 top-20 z-20 max-h-[calc(100dvh-210px)] overflow-y-auto rounded-lg sm:left-5 sm:top-24",
          panelOpen ? "w-[min(300px,calc(100vw-24px))] p-4" : "w-auto px-3 py-2.5",
        )}
      >
        <button
          className="flex w-full items-center justify-between gap-3"
          onClick={() => setPanelChoice(!panelOpen)}
          aria-expanded={panelOpen}
          aria-label={t(panelOpen ? "hidePanel" : "showPanel", { name: t("layers") })}
        >
          <span className="flex items-center gap-2 text-[12.5px] font-semibold text-faint">
            <Layers className="size-3.5" /> {t("layers")}
          </span>
          <span className="flex items-center gap-2 tabular-nums text-[12.5px] text-dim">
            {isFetching ? <Loader2 className="size-3.5 animate-spin" /> : t("pointsShown", { count: currentCount })}
            <ChevronDown className={cn("size-4 transition-transform", panelOpen && "rotate-180")} />
          </span>
        </button>
        <AnimatePresence initial={false}>
          {panelOpen && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
              <div className="mt-3 space-y-1">
                <div className="mb-2 grid grid-cols-2 gap-1 rounded-lg bg-bg-sunken/70 p-1 ring-1 ring-line" role="radiogroup" aria-label={t("basemap")}>
                  {(["map", "satellite"] as const).map((k) => (
                    <button
                      key={k}
                      role="radio"
                      aria-checked={layers.imagery === k}
                      onClick={() => setLayers((l) => ({ ...l, imagery: k }))}
                      className={cn("rounded-md px-3 py-1.5 text-[13px] transition", layers.imagery === k ? "bg-text font-medium text-bg" : "text-dim hover:text-text")}
                    >
                      {t(k === "map" ? "basemapMap" : "basemapSatellite")}
                    </button>
                  ))}
                </div>
                {layers.imagery === "satellite" && (
                  <>
                    <Toggle on={layers.nasaDay} onChange={(v) => setLayers((l) => ({ ...l, nasaDay: v }))}
                      label={nasaDay ? t("nasaDay", { date: nasaDay }) : t("nasaDayNone")} />
                    <p className="pl-8 pr-1 text-[12px] leading-snug text-faint">{t("nasaDayNote")}</p>
                  </>
                )}
                <Toggle on={layers.hotspots} onChange={(v) => setLayers((l) => ({ ...l, hotspots: v }))} label={t("hotspots")} />
                <div className="flex gap-1.5 pl-8">
                  <SensorChip on={sensors.M} color="var(--modis)" label={t("legendModis")} onClick={() => setSensors((s) => ({ ...s, M: !s.M }))} />
                  <SensorChip on={sensors.V} color="var(--viirs)" label={t("legendViirs")} onClick={() => setSensors((s) => ({ ...s, V: !s.V }))} />
                </div>
                <Toggle on={layers.density} onChange={(v) => setLayers((l) => ({ ...l, density: v }))} label={t("heat")} />
                <Toggle on={layers.regions === "risk"} onChange={(v) => setLayers((l) => ({ ...l, regions: v ? "risk" : "outline" }))} label={t("riskLayer")} />
                <Toggle on={layers.regions !== "off"} onChange={(v) => setLayers((l) => ({ ...l, regions: v ? "outline" : "off" }))} label={t("boundaries")} />
                <Toggle
                  on={fires}
                  onChange={(v) => {
                    setFires(v);
                    setFireId(null);
                    if (v && isFuture) setIndex(timeline.length - 1); // fires are the last two weeks
                  }}
                  label={tf("toggle")}
                />
                <Toggle on={layers.flares} onChange={(v) => setLayers((l) => ({ ...l, flares: v }))} label={t("flares")} />
                {layers.flares && (
                  <p className="pl-8 pr-1 text-[12px] leading-snug text-faint">
                    {flares ? t("flaresNote", { count: flares.total }) : t("flaresLoading")}
                  </p>
                )}
              </div>
              <div className="mt-4 border-t border-line pt-4">
                {!drawing && !aoiClosed ? (
                  <button
                    onClick={() => {
                      setDrawing(true);
                      setVertices([]);
                      setSelected(null);
                    }}
                    className="flex w-full items-start gap-3 rounded-md p-3 text-left ring-1 ring-line-strong transition-colors hover:bg-panel-hover"
                  >
                    <PenLine className="mt-0.5 size-4 shrink-0 text-ember-400" />
                    <span>
                      <span className="block text-[13.5px] font-medium">{t("drawAoi")}</span>
                      <span className="block text-[12.5px] leading-snug text-faint">{t("aoiHint")}</span>
                    </span>
                  </button>
                ) : (
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[13px] leading-snug text-dim">{drawing ? t("drawHint") : t("aoiTitle")}</p>
                    <button
                      onClick={() => {
                        setDrawing(false);
                        setVertices([]);
                        setAoiClosed(false);
                        aoi.reset();
                      }}
                      className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-3 text-[13px] text-dim ring-1 ring-line hover:text-text"
                    >
                      <Trash2 className="size-3.5" /> {t("clearAoi")}
                    </button>
                  </div>
                )}
              </div>
              <p className="mt-4 hidden text-[12.5px] text-faint sm:block">{t("keyboard")}</p>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.aside>

      {/* right drawer: AOI result or selected region */}
      <AnimatePresence>
        {(aoiClosed || selected || fires) && (
          <motion.aside
            key={aoiClosed ? "aoi" : fireId ? `fire-${fireId}` : (selected ?? "fires")}
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 24 }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            className={cn("glass absolute right-3 top-20 z-20 w-[min(380px,calc(100vw-24px))] overflow-y-auto rounded-lg p-5 sm:right-5 sm:top-24",
              timelineOpen ? "bottom-[96px] sm:bottom-[112px]" : "bottom-[76px] sm:bottom-[88px]")}
          >
            <button
              onClick={() => {
                setSelected(null);
                if (fireId) setFireId(null);
                else if (!selected && fires) setFires(false);
                if (aoiClosed) {
                  setAoiClosed(false);
                  setVertices([]);
                  aoi.reset();
                }
              }}
              className="absolute right-3 top-3 grid size-8 place-items-center rounded-full text-dim hover:bg-panel-hover hover:text-text"
              aria-label="close"
            >
              <X className="size-4" />
            </button>
            {aoiClosed ? (
              <AoiResult state={aoi} />
            ) : fireId ? (
              <FireDetail id={fireId} onBack={() => setFireId(null)} onWeek={goToDate} />
            ) : selected ? (
              <RegionDrawer slug={selected} />
            ) : fires ? (
              fireData ? <FiresList events={fireData.events} total={fireData.total} onPick={(e: FireEvent) => setFireId(e.id)} /> : <div className="skeleton mt-6 h-64 w-full" />
            ) : null}
          </motion.aside>
        )}
      </AnimatePresence>

      {/* timeline */}
      <div className="absolute inset-x-3 bottom-3 z-20 sm:inset-x-5 sm:bottom-5">
        <Timeline points={line} future={line.length - timeline.length} index={index} onIndex={setIndex} playing={playing} onPlay={setPlaying} speed={speed} onSpeed={setSpeed}
          open={timelineOpen} onOpen={setTimelineChoice} />
      </div>
      {isFuture && (
        <div className="pointer-events-none absolute bottom-[84px] left-1/2 z-10 w-[min(440px,calc(100vw-24px))] -translate-x-1/2 sm:bottom-[104px]">
          <div className="glass rounded-lg px-3.5 py-2.5 text-[12.5px]">
            <p className="flex items-center justify-between gap-2 font-medium text-text">
              <span>{t("forecastLegend", { date: fmtDate(week, locale, { day: "numeric", month: "short" }) })}</span>
              {forecastFetching && <Loader2 className="size-3.5 animate-spin text-faint" />}
            </p>
            <div className="mt-1.5 flex items-center gap-2 tabular-nums text-faint">
              <span>{FORECAST_STOPS[0][0]}</span>
              <span className="h-2 flex-1 rounded-full" style={{ background: `linear-gradient(90deg, ${FORECAST_STOPS.map((x) => x[1]).join(",")})` }} />
              <span>{FORECAST_STOPS[FORECAST_STOPS.length - 1][0]}+</span>
            </div>
            <p className="mt-1.5 leading-snug text-dim">{forecast && forecast.values.length === 0 ? t("forecastEmpty") : t("forecastNote")}</p>
          </div>
        </div>
      )}
      {!isFuture && (data || usesPacks) && currentCount === 0 && !isFetching && layers.hotspots && (
        <p className="pointer-events-none absolute bottom-[84px] left-1/2 z-10 sm:bottom-[100px] -translate-x-1/2 rounded-md bg-panel-solid/80 px-3 py-1 text-[13px] text-dim">{t("noPoints")}</p>
      )}
    </div>
  );
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button role="switch" aria-checked={on} onClick={() => onChange(!on)} className="flex w-full items-center gap-3 rounded-md px-1 py-1.5 text-left text-[13.5px] transition hover:bg-panel-hover/50">
      <span className={cn("relative h-5 w-8 shrink-0 rounded-full transition-colors", on ? "bg-ember-500" : "bg-line-strong")}>
        <motion.span layout className="absolute top-0.5 size-4 rounded-full bg-white shadow" style={{ left: on ? 14 : 2 }} transition={{ type: "spring", stiffness: 600, damping: 35 }} />
      </span>
      <span className={on ? "text-text" : "text-dim"}>{label}</span>
    </button>
  );
}

function SensorChip({ on, color, label, onClick }: { on: boolean; color: string; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} aria-pressed={on} className={cn("inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12.5px] ring-1 transition", on ? "text-text ring-line-strong" : "text-faint ring-line opacity-60")}>
      <span className="size-2 rounded-full" style={{ background: color }} />
      {label}
    </button>
  );
}

function AoiLayer({
  drawing, vertices, closed, onAdd, onFinish, onCloseNear,
}: {
  drawing: boolean;
  vertices: [number, number][];
  closed: boolean;
  onAdd: (v: [number, number]) => [number, number] | undefined;
  onFinish: () => void;
  onCloseNear: () => void;
}) {
  const map = useMap();
  const verts = useRef(vertices);
  useEffect(() => {
    verts.current = vertices;
  }, [vertices]);
  const ring = vertices.length >= 3 ? [...vertices, vertices[0]] : vertices;
  const fc: FeatureCollection = {
    type: "FeatureCollection",
    features: [
      ...(vertices.length >= 3
        ? [{ type: "Feature", geometry: { type: "Polygon", coordinates: [ring] }, properties: { k: "poly" } } as Feature<Polygon>]
        : []),
      ...(vertices.length >= 2 ? [{ type: "Feature", geometry: { type: "LineString", coordinates: ring }, properties: { k: "line" } } as Feature] : []),
      ...vertices.map((v, i) => ({ type: "Feature", geometry: { type: "Point", coordinates: v }, properties: { k: "pt", first: i === 0 } }) as Feature),
    ],
  };
  const lc = useLayerColors();
  useGeoJson("aoi", fc);
  useLayer({ id: "aoi-fill", type: "fill", source: "aoi", filter: ["==", ["get", "k"], "poly"], paint: { "fill-color": "#ff7a2a", "fill-opacity": closed ? 0.14 : 0.08 } });
  useLayer({ id: "aoi-line", type: "line", source: "aoi", filter: ["==", ["get", "k"], "line"], paint: { "line-color": lc.aoiLine, "line-width": 2, "line-dasharray": closed ? [1, 0] : [2, 1.5] } });
  useLayer({
    id: "aoi-pts",
    type: "circle",
    source: "aoi",
    filter: ["==", ["get", "k"], "pt"],
    paint: { "circle-radius": ["case", ["get", "first"], 6, 4], "circle-color": lc.aoiPoint, "circle-stroke-color": lc.aoiLine, "circle-stroke-width": 2 },
  });

  useEffect(() => {
    if (!map || !drawing) return;
    map.getCanvas().style.cursor = "crosshair";
    const click = (e: MapMouseEvent) => {
      const vs = verts.current;
      if (vs.length >= 3) {
        const p0 = map.project(vs[0]);
        if (Math.hypot(p0.x - e.point.x, p0.y - e.point.y) < 12) return onCloseNear();
      }
      onAdd([+e.lngLat.lng.toFixed(5), +e.lngLat.lat.toFixed(5)]);
    };
    const dbl = (e: MapMouseEvent) => {
      e.preventDefault();
      onFinish();
    };
    map.on("click", click);
    map.on("dblclick", dbl);
    return () => {
      map.getCanvas().style.cursor = "";
      map.off("click", click);
      map.off("dblclick", dbl);
    };
  }, [map, drawing, onAdd, onFinish, onCloseNear]);
  return null;
}

function AoiResult({ state }: { state: { isPending: boolean; isError: boolean; data?: AoiSummary } }) {
  const t = useTranslations("explore");
  const locale = useLocale() as AppLocale;
  if (state.isPending)
    return (
      <div className="space-y-3 pt-6">
        <div className="skeleton h-6 w-40" />
        <div className="skeleton aspect-square w-full" />
      </div>
    );
  if (state.isError || !state.data) return <p className="pt-6 text-[13px] text-risk-extreme">{t("aoiError")}</p>;
  const d = state.data;
  const cal = d.calendar;
  return (
    <div>
      <p className="text-[12.5px] font-semibold text-faint">{t("aoiTitle")}</p>
      <p className="font-display mt-1 text-[1.6rem]">{t("aoiArea", { area: fmtNum(d.area_km2, locale) })}</p>
      <p className="text-[13px] text-dim">{t("aoiDetections", { count: fmtNum(d.detections, locale) })}</p>
      <p className="mt-5 text-[12.5px] font-semibold text-faint">{t("aoiCalendar")}</p>
      <FireClock years={cal.years} matrix={cal.matrix} rawMatrix={cal.raw_matrix} season={cal.season} anomalies={cal.anomalies} current={cal.current} className="mt-2" />
      <p className="mt-4 text-[12.5px] font-semibold text-faint">{t("aoiRegions")}</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {d.regions.map((s) => (
          <Link key={s} href={`/region/${s}`} className="rounded-md bg-bg-sunken px-2.5 py-1 tabular-nums text-[12.5px] text-dim ring-1 ring-line hover:text-text">
            {s}
          </Link>
        ))}
      </div>
    </div>
  );
}

function RegionDrawer({ slug }: { slug: string }) {
  const t = useTranslations("explore");
  const tr = useTranslations("region");
  const locale = useLocale() as AppLocale;
  const { data } = useQuery({
    queryKey: ["calendar", slug],
    queryFn: () => http<import("@/lib/types").CalendarPayload>(`/regions/${slug}/calendar`),
  });
  const { data: risk } = useQuery({ queryKey: ["risk", slug], queryFn: () => http<import("@/lib/types").RiskDetail>(`/regions/${slug}/risk`) });
  if (!data) return <div className="skeleton mt-6 aspect-square w-full" />;
  return (
    <div>
      <p className="text-[12.5px] font-semibold text-faint">{tr("clockTitle")}</p>
      <h2 className="font-display mt-1 pr-8 text-[1.7rem] leading-tight">{regionName(data.region, locale)}</h2>
      <RegionPlace r={data.region} className="mt-1 text-[13px]" />
      {risk && (
        <div className="mt-2 flex items-center gap-2">
          <span className="text-[13px] text-faint">{t("riskNow")}</span>
          <RiskBadge level={risk.short.level} pulse />
        </div>
      )}
      <FireClock years={data.years} matrix={data.matrix} season={data.season} anomalies={data.anomalies} current={data.current} className="mt-3" />
      <Link
        href={`/region/${slug}`}
        className="mt-4 flex items-center justify-between rounded-lg bg-text px-4 py-3 text-[13.5px] font-medium text-bg transition hover:scale-[1.01]"
      >
        <span className="flex items-center gap-2">
          <Flame className="size-4" /> {t("openRegion")}
        </span>
        <ArrowRight className="size-4" />
      </Link>
    </div>
  );
}
