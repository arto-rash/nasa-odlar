"use client";

import { useQuery } from "@tanstack/react-query";
import type { FeatureCollection } from "geojson";
import type { MapLayerMouseEvent } from "maplibre-gl";
import { ArrowLeft, CalendarRange, Flame, Satellite } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo } from "react";
import { useMap } from "@/components/map/base-map";
import { useGeoJson, useLayer } from "@/components/map/layers";
import { RegionPlace } from "@/components/ui/region-place";
import { Link } from "@/i18n/navigation";
import { http } from "@/lib/client";
import { cn } from "@/lib/cn";
import { fmtDate, fmtNum, regionName, type AppLocale } from "@/lib/format";
import type { FireEvent, FireEventDetail } from "@/lib/types";
import { useWindText, WindArrow } from "@/components/ui/wind";

/** Fires as circles: size by detections, bright while still burning. */
export function FiresLayer({ events, selected, onPick }: { events: FireEvent[]; selected: string | null; onPick: (id: string) => void }) {
  const map = useMap();
  const fc = useMemo<FeatureCollection>(
    () => ({
      type: "FeatureCollection",
      features: events.map((e) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [e.lon, e.lat] },
        properties: {
          id: e.id, n: e.detections, active: e.active, both: e.modis > 0 && e.viirs > 0,
          // the way the wind pushes it (from + 180°), for burning fires with a forecast
          ...(e.active && e.wind?.from != null ? { to: (e.wind.from + 180) % 360, ws: e.wind.gust ?? e.wind.speed ?? 0 } : {}),
        },
      })),
    }),
    [events],
  );
  useGeoJson("fires", fc);
  useLayer({
    id: "fires-glow",
    type: "circle",
    source: "fires",
    filter: ["get", "active"],
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["sqrt", ["get", "n"]], 1, 9, 10, 22, 40, 44],
      "circle-color": "#ff6a1f",
      "circle-opacity": 0.22,
      "circle-blur": 0.8,
    },
  });
  useLayer({
    id: "fires-dot",
    type: "circle",
    source: "fires",
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["sqrt", ["get", "n"]], 1, 3.5, 10, 9, 40, 20],
      "circle-color": ["case", ["get", "active"], "#ff7a2a", "#9a5a3a"],
      "circle-opacity": ["case", ["get", "active"], 0.9, 0.6],
      "circle-stroke-color": ["case", ["==", ["get", "id"], selected ?? ""], "#fff4dc", ["get", "both"], "#ffd8a8", "rgba(0,0,0,0)"],
      "circle-stroke-width": ["case", ["==", ["get", "id"], selected ?? ""], 2.5, 1.2],
    },
  });
  useWindArrows(map);
  useLayer({
    id: "fires-wind",
    type: "symbol",
    source: "fires",
    filter: ["has", "to"],
    layout: {
      "icon-image": "odlar-wind-arrow",
      "icon-rotate": ["get", "to"],
      "icon-rotation-alignment": "map",
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
      // just past the fire's edge, downwind; stronger gusts, bigger arrow
      "icon-offset": [0, -22],
      "icon-size": ["interpolate", ["linear"], ["get", "ws"], 2, 0.55, 10, 0.8, 18, 1.05],
    },
    paint: { "icon-opacity": 0.95 },
  });
  useEffect(() => {
    if (!map) return;
    const click = (e: MapLayerMouseEvent) => {
      const id = e.features?.[0]?.properties?.id;
      if (id) onPick(String(id));
    };
    const enter = () => (map.getCanvas().style.cursor = "pointer");
    const leave = () => (map.getCanvas().style.cursor = "");
    map.on("click", "fires-dot", click);
    map.on("mouseenter", "fires-dot", enter);
    map.on("mouseleave", "fires-dot", leave);
    return () => {
      map.off("click", "fires-dot", click);
      map.off("mouseenter", "fires-dot", enter);
      map.off("mouseleave", "fires-dot", leave);
    };
  }, [map, onPick]);
  return null;
}

/** The arrow icon for the map, drawn once per style (a white arrow with a dark rim). */
function useWindArrows(map: ReturnType<typeof useMap>) {
  useEffect(() => {
    if (!map || map.hasImage("odlar-wind-arrow")) return;
    const size = 40;
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const g = c.getContext("2d");
    if (!g) return;
    g.beginPath();
    g.moveTo(20, 3); g.lineTo(32, 22); g.lineTo(24.5, 22); g.lineTo(24.5, 37); g.lineTo(15.5, 37); g.lineTo(15.5, 22); g.lineTo(8, 22);
    g.closePath();
    g.lineJoin = "round";
    g.lineWidth = 3;
    g.strokeStyle = "rgba(26,13,6,0.9)";
    g.stroke();
    g.fillStyle = "#fff4dc";
    g.fill();
    map.addImage("odlar-wind-arrow", g.getImageData(0, 0, size, size), { pixelRatio: 2 });
  }, [map]);
}

/** "Wind, 16 Nov: 6 m/s, gusts up to 14 m/s, from the north-west, pushing fires south-east." */
export function FireWind({ e, className }: { e: FireEvent; className?: string }) {
  const t = useTranslations("wind");
  const locale = useLocale() as AppLocale;
  const windText = useWindText();
  const w = e.wind;
  if (!w || w.from == null) return null;
  return (
    <div className={cn("flex items-start gap-2.5 rounded-lg bg-bg-sunken/70 px-3 py-2.5 ring-1 ring-line", className)}>
      <WindArrow from={w.from} className={cn("mt-0.5 size-5 shrink-0", (w.gust ?? 0) >= 12 ? "text-ember-300" : "text-text")} />
      <p className="text-[13px] leading-snug text-dim">
        <span className="font-medium text-text">{t("fireTitle", { date: fmtDate(w.date, locale, { day: "numeric", month: "short" }) })}:</span>{" "}
        {t("fireLine", { speed: fmtNum(w.speed, locale, 1), gust: fmtNum(w.gust ?? w.speed, locale, 0), dir: windText(w.from) })}
      </p>
    </div>
  );
}

export function FireFacts({ e, className }: { e: FireEvent; className?: string }) {
  const t = useTranslations("fires");
  const locale = useLocale() as AppLocale;
  const sensors = e.modis > 0 && e.viirs > 0 ? t("both") : e.viirs > 0 ? t("viirsOnly") : t("modisOnly");
  return (
    <p className={cn("flex flex-wrap gap-x-3 gap-y-0.5 tabular-nums text-[12.5px] text-dim", className)}>
      <span className="inline-flex items-center gap-1"><Flame className="size-3.5" aria-hidden />{t("detections", { count: e.detections })}</span>
      <span className="inline-flex items-center gap-1"><CalendarRange className="size-3.5" aria-hidden />{t("days", { count: e.days })}</span>
      <span className="inline-flex items-center gap-1"><Satellite className="size-3.5" aria-hidden />{sensors}</span>
      {e.frp_max != null && <span>{t("frpMax", { value: fmtNum(e.frp_max, locale, 0) })}</span>}
    </p>
  );
}

function Status({ e }: { e: FireEvent }) {
  const t = useTranslations("fires");
  const locale = useLocale() as AppLocale;
  return e.active ? (
    <span className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-ember-300">
      <span className="size-1.5 animate-pulse rounded-full bg-ember-400" /> {t("burning")}
    </span>
  ) : (
    <span className="text-[12.5px] text-faint">{t("lastSeen", { date: fmtDate(e.last_seen, locale, { day: "numeric", month: "short" }) })}</span>
  );
}

/** The fires in view, biggest first. */
export function FiresList({ events, total, onPick }: { events: FireEvent[]; total: number; onPick: (e: FireEvent) => void }) {
  const t = useTranslations("fires");
  const locale = useLocale() as AppLocale;
  return (
    <div>
      <p className="text-[12.5px] font-semibold text-faint">{t("title")}</p>
      <h2 className="font-display mt-1 pr-8 text-[1.5rem] leading-tight">{t("inView", { count: total })}</h2>
      <p className="mt-1 text-[12.5px] leading-snug text-faint">{t("lead")}</p>
      <ul className="mt-4 space-y-1.5">
        {events.slice(0, 60).map((e) => (
          <li key={e.id}>
            <button onClick={() => onPick(e)} className="w-full rounded-md px-3 py-2.5 text-left ring-1 ring-line transition hover:bg-panel-hover">
              <span className="flex items-center justify-between gap-2">
                <span className="truncate text-[13.5px] font-medium">{e.region ? regionName(e.region, locale) : "—"}</span>
                <Status e={e} />
              </span>
              {e.region && <RegionPlace r={e.region} className="text-[12px]" />}
              <FireFacts e={e} className="mt-1" />
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-[12px] leading-snug text-faint">{t("note")}</p>
    </div>
  );
}

const useFire = (id: string | null) =>
  useQuery({ queryKey: ["fire", id], queryFn: () => http<FireEventDetail>(`/events/${id}`), enabled: !!id, staleTime: 10 * 60_000 });

/** Inside the map: frame the picked fire. */
export function FitFire({ id }: { id: string | null }) {
  const map = useMap();
  const { data } = useFire(id);
  useEffect(() => {
    if (!map || !data) return;
    const [w, s, e, n] = data.bbox;
    const pad = 0.03;
    // leave room for the drawer on the right (on phones it covers the map anyway)
    const wide = map.getContainer().clientWidth >= 900;
    const padding = wide ? { top: 90, bottom: 140, left: 340, right: 420 } : { top: 80, bottom: 150, left: 24, right: 24 };
    map.fitBounds([[w - pad, s - pad], [e + pad, n + pad]], { padding, maxZoom: 11, duration: 1200 });
  }, [map, data]);
  return null;
}

/** One fire: where, when, how big, and its detections day by day. */
export function FireDetail({ id, onBack, onWeek }: { id: string; onBack: () => void; onWeek: (date: string) => void }) {
  const t = useTranslations("fires");
  const locale = useLocale() as AppLocale;
  const { data } = useFire(id);
  const top = Math.max(1, ...(data?.per_day ?? []).map((d) => d.modis + d.viirs));
  return (
    <div>
      <button onClick={onBack} className="inline-flex items-center gap-1.5 text-[13px] text-dim hover:text-text">
        <ArrowLeft className="size-3.5" /> {t("back")}
      </button>
      {!data ? (
        <div className="skeleton mt-4 h-40 w-full" />
      ) : (
        <>
          <h2 className="font-display mt-3 pr-8 text-[1.6rem] leading-tight">{data.region ? regionName(data.region, locale) : t("title")}</h2>
          {data.region && <RegionPlace r={data.region} className="mt-1 text-[13px]" />}
          <div className="mt-2"><Status e={data} /></div>
          <p className="mt-1 text-[13px] text-dim">
            {fmtDate(data.first_seen, locale, { day: "numeric", month: "short" })} – {fmtDate(data.last_seen, locale, { day: "numeric", month: "short" })}
          </p>
          <FireFacts e={data} className="mt-2" />
          {data.active && <FireWind e={data} className="mt-3" />}
          <p className="mt-5 text-[12.5px] font-semibold text-faint">{t("perDay")}</p>
          <div className="mt-2 flex h-24 items-end gap-1">
            {data.per_day.map((d) => (
              <div key={d.date} className="flex min-w-0 flex-1 flex-col items-center gap-1" title={`${d.date}: ${d.modis + d.viirs}`}>
                <div className="flex w-full flex-col-reverse overflow-hidden rounded-sm" style={{ height: `${((d.modis + d.viirs) / top) * 72}px` }}>
                  <span className="bg-viirs" style={{ height: `${(d.viirs / Math.max(1, d.modis + d.viirs)) * 100}%` }} />
                  <span className="bg-modis" style={{ height: `${(d.modis / Math.max(1, d.modis + d.viirs)) * 100}%` }} />
                </div>
                <span className="tabular-nums text-[10px] text-faint">{+d.date.slice(8)}</span>
              </div>
            ))}
          </div>
          <div className="mt-5 flex flex-col gap-2">
            <button
              onClick={() => onWeek(data.last_seen)}
              className="rounded-lg px-4 py-2.5 text-left text-[13.5px] ring-1 ring-line-strong transition hover:bg-panel-hover"
            >
              {t("seeWeek")}
            </button>
            {data.region && (
              <Link href={`/region/${data.region.slug}`} className="rounded-lg bg-text px-4 py-2.5 text-[13.5px] font-medium text-bg transition hover:scale-[1.01]">
                {t("openRegion", { name: regionName(data.region, locale) })}
              </Link>
            )}
          </div>
        </>
      )}
    </div>
  );
}
