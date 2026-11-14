"use client";

import { useQuery } from "@tanstack/react-query";
import type { FeatureCollection } from "geojson";
import type { MapLayerMouseEvent } from "maplibre-gl";
import { ArrowLeft, ArrowRight, BellPlus, Search } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DailyStrip } from "@/components/charts/daily-strip";
import { RiskDial } from "@/components/charts/risk-dial";
import { SeriesChart } from "@/components/charts/series-chart";
import { BaseMap, useMap } from "@/components/map/base-map";
import { RegionsLayer, SignatureLayer } from "@/components/map/layers";
import { DriverList } from "@/components/region/drivers";
import { InfoTip } from "@/components/ui/info-tip";
import { RiskBadge } from "@/components/ui/risk-badge";
import { Segmented } from "@/components/ui/segmented";
import { Link } from "@/i18n/navigation";
import { http } from "@/lib/client";
import { cn } from "@/lib/cn";
import { fmtDate, fmtNum, fmtPct, regionName, type AppLocale } from "@/lib/format";
import { matchScore } from "@/lib/search";
import { RISK_LEVELS, type RiskDetail, type RiskMapItem } from "@/lib/types";

export function RiskClient({
  items, regions, asOf, initial,
}: {
  items: RiskMapItem[];
  regions: FeatureCollection;
  asOf: string;
  initial: string | null;
}) {
  const t = useTranslations("risk");
  const tc = useTranslations("common");
  const tl = useTranslations("levels");
  const locale = useLocale() as AppLocale;
  const [selected, setSelected] = useState<string | null>(initial);
  const [country, setCountry] = useState<string>("all");
  const [q, setQ] = useState("");
  const [hover, setHover] = useState<{ name_az: string; name_en: string; probability?: number; x: number; y: number } | null>(null);

  useEffect(() => {
    const u = new URL(window.location.href);
    if (selected) u.searchParams.set("r", selected);
    else u.searchParams.delete("r");
    window.history.replaceState(null, "", u);
  }, [selected]);

  const list = useMemo(
    () =>
      items
        .filter((r) => country === "all" || r.country === country)
        .filter((r) => matchScore(q, r.name_az, r.name_en) > 0),
    [items, country, q],
  );
  // Countries present in the data, Azerbaijan first
  const countryCodes = useMemo(
    () => [...new Set(items.map((r) => r.country))].sort((a, b) => (a === "az" ? -1 : b === "az" ? 1 : a.localeCompare(b))),
    [items],
  );
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of items) c[r.level] = (c[r.level] ?? 0) + 1;
    return c;
  }, [items]);

  const onHover = useCallback((p: { name_az: string; name_en: string; probability?: number } | null, e?: MapLayerMouseEvent) => {
    setHover(p && e ? { ...p, x: e.point.x, y: e.point.y } : null);
  }, []);

  return (
    <div className="grid min-h-dvh lg:h-dvh lg:grid-cols-[minmax(0,1fr)_440px]">
      <div className="relative h-[52vh] lg:h-full">
        <BaseMap className="absolute inset-0" controlsPosition="bottom-left" terrain>
          <RegionsLayer geojson={regions} mode="risk" selected={selected} onHover={onHover} onClick={setSelected} />
          <SignatureLayer geojson={regions} />
          <FlyTo slug={selected} regions={regions} />
        </BaseMap>
        <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-bg/90 to-transparent" />
        <div className="pointer-events-none absolute left-4 top-20 z-10 max-w-[520px] sm:left-6 sm:top-24">
          <h1 className="font-display text-[clamp(2rem,4vw,3rem)] leading-none">{t("title")}</h1>
          <p className="mt-2 tabular-nums text-[13px] text-dim">{t("asOf", { date: fmtDate(asOf, locale, { day: "numeric", month: "long", year: "numeric" }) })}</p>
        </div>
        <div className="glass absolute bottom-4 right-4 z-10 rounded-lg px-3.5 py-3 sm:bottom-6 sm:right-6">
          <p className="mb-2 text-[12px] font-semibold text-faint">{t("legend")}</p>
          <ul className="space-y-1">
            {RISK_LEVELS.map((l) => (
              <li key={l} className="flex items-center gap-2 text-[13px]">
                <span className="h-3 w-5 rounded" style={{ background: `var(--risk-${l})`, opacity: 0.8 }} />
                <span className="flex-1">{tl(l)}</span>
                <span className="tabular-nums text-faint">{counts[l] ?? 0}</span>
              </li>
            ))}
          </ul>
        </div>
        <AnimatePresence>
          {hover && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, x: hover.x + 14, y: hover.y + 14 }}
              exit={{ opacity: 0 }}
              transition={{ type: "spring", stiffness: 700, damping: 45 }}
              className="pointer-events-none absolute left-0 top-0 z-20 rounded-md border border-line-strong bg-panel-solid/95 px-3 py-2 text-[13px] shadow-2xl"
            >
              <p className="font-medium">{regionName(hover, locale)}</p>
              {hover.probability != null && <p className="tabular-nums text-dim">{fmtPct(hover.probability, locale)}</p>}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <aside className="relative border-l border-line bg-bg-elev/60 lg:overflow-y-auto lg:pt-20" data-lenis-prevent>
        <AnimatePresence mode="wait" initial={false}>
          {selected ? (
            <motion.div key={selected} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}>
              <RiskDetailView slug={selected} onBack={() => setSelected(null)} />
            </motion.div>
          ) : (
            <motion.div key="list" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} transition={{ duration: 0.35 }} className="p-5 sm:p-6">
              <p className="text-[13.5px] leading-relaxed text-dim">{t("lead")}</p>
              <div className="mt-5 flex flex-wrap items-center gap-2">
                <Segmented
                  label={tc("country")}
                  size="sm"
                  value={country}
                  onChange={setCountry}
                  options={[{ value: "all", label: tc("all") }, ...countryCodes.map((c) => ({ value: c, label: c.toUpperCase() }))]}
                />
                <label className="flex h-9 flex-1 items-center gap-2 rounded-md bg-bg-sunken px-3 ring-1 ring-line">
                  <Search className="size-3.5 text-faint" />
                  <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("selectRegion")} className="w-full bg-transparent text-[13px] outline-none placeholder:text-faint" />
                </label>
              </div>
              <ol className="mt-4 space-y-1">
                {list.map((r, i) => (
                  <li key={r.slug}>
                    <button onClick={() => setSelected(r.slug)} className="group flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left transition hover:bg-panel-hover">
                      <span className="w-6 tabular-nums text-[12.5px] text-faint">{i + 1}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13.5px]">{regionName(r, locale)}</span>
                        <span className="mt-1 block h-1 overflow-hidden rounded-full bg-line">
                          <span className="block h-full rounded-full transition-all duration-700" style={{ width: `${r.probability * 100}%`, background: `var(--risk-${r.level})` }} />
                        </span>
                      </span>
                      <span className="w-11 text-right tabular-nums text-[13px] tabular text-dim">{fmtPct(r.probability, locale)}</span>
                      <ArrowRight className="size-3.5 text-faint opacity-0 transition group-hover:opacity-100" />
                    </button>
                  </li>
                ))}
              </ol>
            </motion.div>
          )}
        </AnimatePresence>
      </aside>
    </div>
  );
}

function FlyTo({ slug, regions }: { slug: string | null; regions: FeatureCollection }) {
  const map = useMap();
  useEffect(() => {
    if (!map || !slug) return;
    const f = regions.features.find((x) => x.properties?.slug === slug);
    if (!f) return;
    const coords: number[][] = [];
    const walk = (c: unknown) => (Array.isArray(c) && typeof c[0] === "number" ? coords.push(c as number[]) : Array.isArray(c) && c.forEach(walk));
    walk((f.geometry as { coordinates: unknown }).coordinates);
    const xs = coords.map((c) => c[0]);
    const ys = coords.map((c) => c[1]);
    map.fitBounds([[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]], { padding: 80, maxZoom: 8.5, duration: 1400 });
  }, [map, slug, regions]);
  return null;
}

function RiskDetailView({ slug, onBack }: { slug: string; onBack: () => void }) {
  const t = useTranslations("risk");
  const tc = useTranslations("common");
  const locale = useLocale() as AppLocale;
  const { data, isLoading } = useQuery({ queryKey: ["risk", slug], queryFn: () => http<RiskDetail>(`/regions/${slug}/risk`) });
  if (isLoading || !data)
    return (
      <div className="space-y-4 p-6">
        <div className="skeleton h-8 w-48" />
        <div className="skeleton mx-auto h-48 w-64" />
        <div className="skeleton h-40" />
      </div>
    );
  const s = data.short;
  const o = data.outlook;
  const scaleMax = Math.max(o.q90, o.normal_p90, 1);
  const pct = (v: number) => `${(v / scaleMax) * 100}%`;
  return (
    <div className="p-5 sm:p-6">
      <button onClick={onBack} className="inline-flex items-center gap-1.5 text-[13px] text-dim hover:text-text">
        <ArrowLeft className="size-3.5" /> {t("ranking")}
      </button>
      <div className="mt-3 flex items-start justify-between gap-3">
        <h2 className="font-display text-[2rem] leading-tight">{regionName(data.region, locale)}</h2>
        <Link href={`/region/${slug}`} className="mt-2 shrink-0 text-[13px] text-dim underline-offset-4 hover:text-text hover:underline">
          {tc("open")} →
        </Link>
      </div>
      <div className="mt-4 flex justify-center">
        <RiskDial probability={s.probability} level={s.level} size={290} />
      </div>
      <p className="mt-2 text-center text-[13px] text-faint">
        {t("expected", { value: fmtNum(s.expected7, locale, 1) })}
        {s.threshold7 != null && <> · {t("threshold", { value: fmtNum(s.threshold7, locale) })}</>}
        <InfoTip>{t("methodNote")}</InfoTip>
      </p>

      <h3 className="mt-7 text-[12.5px] font-semibold text-faint">{t("why")}</h3>
      <DriverList drivers={s.drivers} className="mt-3" />

      {s.hotspots && (
        <>
          <h3 className="mt-7 text-[12.5px] font-semibold text-faint">{t("hotspotsIn")}</h3>
          <ul className="mt-2 space-y-1">
            {s.hotspots.map((h) => (
              <li key={h.slug} className="flex items-center justify-between text-[13px]">
                <span className="tabular-nums text-dim">{h.slug}</span>
                <RiskBadge level={h.level} />
              </li>
            ))}
          </ul>
        </>
      )}

      <h3 className="mt-7 text-[12.5px] font-semibold text-faint">{t("daily")}</h3>
      <div className="mt-3">
        <DailyStrip days={data.daily} />
      </div>
      <p className="mt-2 text-[12.5px] text-faint">{t("forecastSource", { source: data.forecast_source === "open_meteo" ? "Open-Meteo" : data.forecast_source })}</p>

      <h3 className="mt-7 text-[12.5px] font-semibold text-faint">{t("outlook")}</h3>
      <div className="mt-3 rounded-lg bg-bg-sunken/60 p-4 ring-1 ring-line">
        <p className={cn("font-display text-[1.35rem]", o.signal === "above" ? "text-ember-300" : o.signal === "below" ? "text-viirs" : "text-text")}>
          {o.signal === "above" ? t("outlookAbove") : o.signal === "below" ? t("outlookBelow") : t("outlookNormal")}
        </p>
        <div className="mt-4 space-y-3 text-[12.5px]">
          <RangeBar label={t("outlookRange")} lo={pct(o.q10)} mid={pct(o.q50)} hi={pct(o.q90)} color="var(--harmonized)" values={[o.q10, o.q50, o.q90]} locale={locale} />
          <RangeBar label={t("normalRange")} lo={pct(o.normal_p10)} mid={pct(o.normal)} hi={pct(o.normal_p90)} color="var(--text-faint)" values={[o.normal_p10, o.normal, o.normal_p90]} locale={locale} />
        </div>
      </div>

      <Link
        href={`/alerts?add=${slug}`}
        className="mt-6 flex items-center justify-center gap-2 rounded-lg bg-ember px-4 py-3 text-[13.5px] font-medium text-white transition hover:brightness-110"
      >
        <BellPlus className="size-4" /> {t("subscribe")}
      </Link>

      <h3 className="mt-7 text-[12.5px] font-semibold text-faint">{t("history")}</h3>
      <p className="mt-1 text-[13px] text-dim">{t("historyLead")}</p>
      <SeriesChart
        className="mt-3"
        ariaLabel={t("history")}
        height={200}
        data={data.history.filter((_, i) => i % 2 === 0)}
        x={(d) => new Date(d.date + "T00:00:00Z")}
        xFormat={(v) => fmtDate((v as Date).toISOString().slice(0, 10), locale, { month: "short", day: undefined })}
        series={[
          { key: "p", label: t("probability"), color: "var(--harmonized)", value: (d) => d.probability * 100, width: 1.75, area: true },
          { key: "a", label: t("actual"), color: "var(--viirs)", value: (d) => (d.actual7 == null || d.threshold7 <= 0 ? null : Math.min(100, (d.actual7 / d.threshold7) * 50)), width: 1 },
        ]}
      />
    </div>
  );
}

function RangeBar({ label, lo, mid, hi, color, values, locale }: { label: string; lo: string; mid: string; hi: string; color: string; values: number[]; locale: AppLocale }) {
  return (
    <div>
      <div className="flex justify-between text-faint">
        <span>{label}</span>
        <span className="tabular-nums">
          {fmtNum(values[0], locale)}–{fmtNum(values[2], locale)}
        </span>
      </div>
      <div className="relative mt-1.5 h-2 rounded-full bg-line">
        <motion.span
          className="absolute inset-y-0 rounded-full"
          style={{ background: color, opacity: 0.45 }}
          initial={{ left: mid, right: `calc(100% - ${mid})` }}
          animate={{ left: lo, right: `calc(100% - ${hi})` }}
          transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
        />
        <span className="absolute top-1/2 h-3.5 w-1 -translate-y-1/2 rounded-full" style={{ left: mid, background: color }} />
      </div>
    </div>
  );
}
