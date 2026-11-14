"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Feature, FeatureCollection, Polygon } from "geojson";
import type { MapLayerMouseEvent, MapMouseEvent } from "maplibre-gl";
import { ArrowRight, Flame, Layers, Loader2, PenLine, Trash2, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FireClock } from "@/components/charts/fire-clock";
import { BaseMap, useMap } from "@/components/map/base-map";
import { MapViewWatcher, useCountryShape, type PointView } from "@/components/map/use-regions";
import { ViewportRegionsLayer } from "@/components/map/viewport-regions";
import { DensityLayer, HotspotLayer, SignatureLayer, useGeoJson, useLayer, useLayerColors, type HotspotPoint, type RegionMode } from "@/components/map/layers";
import { RiskBadge } from "@/components/ui/risk-badge";
import { Link } from "@/i18n/navigation";
import { http } from "@/lib/client";
import { cn } from "@/lib/cn";
import { fmtNum, regionName, type AppLocale } from "@/lib/format";
import type { AoiSummary, HotspotResponse, RiskLevel, TimelinePoint } from "@/lib/types";
import { Timeline } from "./timeline";

const AFTERGLOW_WEEKS = 3;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (s: string, n: number) => iso(new Date(new Date(s + "T00:00:00Z").getTime() + n * 86400000));

export function ExploreClient({
  timeline, initialWeek,
}: {
  timeline: TimelinePoint[];
  initialWeek: string;
}) {
  const t = useTranslations("explore");
  const locale = useLocale() as AppLocale;
  const qc = useQueryClient();
  const signature = useCountryShape("az");
  const [index, setIndex] = useState(() => Math.max(0, timeline.findIndex((p) => p.week === initialWeek)));
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [layers, setLayers] = useState({ hotspots: true, density: false, regions: "outline" as RegionMode | "off" });
  const [sensors, setSensors] = useState({ M: true, V: true });
  const [hover, setHover] = useState<{ slug: string; name_az: string; name_en: string; risk_level?: string; x: number; y: number } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [vertices, setVertices] = useState<[number, number][]>([]);
  const [aoiClosed, setAoiClosed] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);

  const week = timeline[index]?.week ?? initialWeek;
  const range = (w: string) => ({ start: addDays(w, -7 * AFTERGLOW_WEEKS), end: addDays(w, 6) });
  // What the map shows decides what is fetched (see MapViewWatcher): points in
  // view, or per-cell sums when zoomed out.
  const [view, setView] = useState<PointView | null>(null);
  const viewQuery = view ? `${view.bbox ? `&bbox=${view.bbox}` : ""}${view.cell ? `&cell=${view.cell}` : ""}` : "";
  const fetchWeek = (w: string) => {
    const r = range(w);
    return http<HotspotResponse>(`/hotspots?start=${r.start}&end=${r.end}&limit=30000${viewQuery}`);
  };
  const { data, isFetching } = useQuery({
    queryKey: ["hotspots", week, viewQuery],
    queryFn: () => fetchWeek(week),
    enabled: view !== null,
    placeholderData: keepPreviousData,
    staleTime: Infinity,
  });
  const { data: grid } = useQuery({
    queryKey: ["grid", view?.step, view?.bbox],
    queryFn: () => http<{ cells: [number, number, number][] }>(`/grid?step=${view!.step}${view!.bbox ? `&bbox=${view!.bbox}` : ""}`),
    enabled: view !== null && layers.density,
    placeholderData: keepPreviousData,
    staleTime: 30 * 60_000,
  });

  // prefetch ahead while playing so playback stays smooth
  useEffect(() => {
    for (let k = 1; k <= 3; k++) {
      const w = timeline[index + k]?.week;
      if (w && view) qc.prefetchQuery({ queryKey: ["hotspots", w, viewQuery], queryFn: () => fetchWeek(w), staleTime: Infinity });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => setIndex((i) => (i + 1 >= timeline.length ? 0 : i + 1)), 700 / speed);
    return () => clearInterval(id);
  }, [playing, speed, timeline.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input,textarea,select,[role=slider]")) return;
      if (e.code === "Space") {
        e.preventDefault();
        setPlaying((p) => !p);
      }
      if (e.key === "ArrowRight") setIndex((i) => Math.min(timeline.length - 1, i + 1));
      if (e.key === "ArrowLeft") setIndex((i) => Math.max(0, i - 1));
      if (e.key === "Escape") {
        setDrawing(false);
        setVertices([]);
        setAoiClosed(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [timeline.length]);

  useEffect(() => {
    const u = new URL(window.location.href);
    u.searchParams.set("w", week);
    window.history.replaceState(null, "", u);
  }, [week]);

  const points: HotspotPoint[] = useMemo(() => {
    if (!data) return [];
    const w0 = new Date(week + "T00:00:00Z").getTime();
    return data.points.map(([lon, lat, s, , frp, date]) => ({
      lon, lat, sensor: s, frp,
      age: Math.max(0, Math.ceil((w0 - new Date(date + "T00:00:00Z").getTime()) / (7 * 86400000))),
    }));
  }, [data, week]);
  // a sampled answer (more points than the map draws) is scaled back to the true count
  const shown = points.filter((p) => p.age === 0 && sensors[p.sensor]).length;
  const currentCount = data?.sampled && points.length ? Math.round((shown * data.total) / points.length) : shown;

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
        <DensityLayer cells={grid?.cells ?? []} visible={layers.density} />
        <ViewportRegionsLayer
          mode={layers.regions === "off" ? "outline" : layers.regions}
          visible={layers.regions !== "off"}
          selected={selected}
          onHover={drawing ? undefined : onHover}
          onClick={drawing ? undefined : setSelected}
        />
        <SignatureLayer geojson={signature} />
        <HotspotLayer points={points} visible={layers.hotspots} sensors={sensors} />
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
            {hover.risk_level && <RiskBadge level={hover.risk_level as RiskLevel} className="mt-1" />}
          </motion.div>
        )}
      </AnimatePresence>

      {/* layer panel */}
      <motion.aside
        initial={{ opacity: 0, x: -16 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 0.3, duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        className="glass absolute left-3 top-20 z-20 w-[min(300px,calc(100vw-24px))] rounded-lg p-4 sm:left-5 sm:top-24"
      >
        <button className="flex w-full items-center justify-between" onClick={() => setPanelOpen((o) => !o)} aria-expanded={panelOpen}>
          <span className="flex items-center gap-2 text-[12.5px] font-semibold text-faint">
            <Layers className="size-3.5" /> {t("layers")}
          </span>
          <span className="tabular-nums text-[12.5px] text-dim">
            {isFetching ? <Loader2 className="size-3.5 animate-spin" /> : t("pointsShown", { count: currentCount })}
          </span>
        </button>
        <AnimatePresence initial={false}>
          {panelOpen && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
              <div className="mt-3 space-y-1">
                <Toggle on={layers.hotspots} onChange={(v) => setLayers((l) => ({ ...l, hotspots: v }))} label={t("hotspots")} />
                <div className="flex gap-1.5 pl-8">
                  <SensorChip on={sensors.M} color="var(--modis)" label={t("legendModis")} onClick={() => setSensors((s) => ({ ...s, M: !s.M }))} />
                  <SensorChip on={sensors.V} color="var(--viirs)" label={t("legendViirs")} onClick={() => setSensors((s) => ({ ...s, V: !s.V }))} />
                </div>
                <Toggle on={layers.density} onChange={(v) => setLayers((l) => ({ ...l, density: v }))} label={t("heat")} />
                <Toggle on={layers.regions === "risk"} onChange={(v) => setLayers((l) => ({ ...l, regions: v ? "risk" : "outline" }))} label={t("riskLayer")} />
                <Toggle on={layers.regions !== "off"} onChange={(v) => setLayers((l) => ({ ...l, regions: v ? "outline" : "off" }))} label={t("boundaries")} />
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
        {(aoiClosed || selected) && (
          <motion.aside
            key={aoiClosed ? "aoi" : selected}
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 24 }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            className="glass absolute bottom-[112px] right-3 top-20 z-20 w-[min(380px,calc(100vw-24px))] overflow-y-auto rounded-lg p-5 sm:right-5 sm:top-24"
          >
            <button
              onClick={() => {
                setSelected(null);
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
            {aoiClosed ? <AoiResult state={aoi} /> : selected ? <RegionDrawer slug={selected} /> : null}
          </motion.aside>
        )}
      </AnimatePresence>

      {/* timeline */}
      <div className="absolute inset-x-3 bottom-3 z-20 sm:inset-x-5 sm:bottom-5">
        <Timeline points={timeline} index={index} onIndex={setIndex} playing={playing} onPlay={setPlaying} speed={speed} onSpeed={setSpeed} />
      </div>
      {data && currentCount === 0 && !isFetching && layers.hotspots && (
        <p className="pointer-events-none absolute bottom-[100px] left-1/2 z-10 -translate-x-1/2 rounded-md bg-panel-solid/80 px-3 py-1 text-[13px] text-dim">{t("noPoints")}</p>
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
