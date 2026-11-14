"use client";

import { ArrowRight, CircleDot, Download, Grid3x3, MapPinned } from "lucide-react";
import { motion } from "motion/react";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { CalendarHeatmap, type CellRef } from "@/components/charts/calendar-heatmap";
import { CellLegend } from "@/components/charts/cell-style";
import { ClimatologyChart } from "@/components/charts/climatology-chart";
import { DailyStrip } from "@/components/charts/daily-strip";
import { FireClock } from "@/components/charts/fire-clock";
import { RiskDial } from "@/components/charts/risk-dial";
import { SeriesChart } from "@/components/charts/series-chart";
import { Sparkline } from "@/components/charts/sparkline";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { RiskBadge } from "@/components/ui/risk-badge";
import { Segmented } from "@/components/ui/segmented";
import { Link } from "@/i18n/navigation";
import { aheadCells, cellState, weekStart, type AheadCells } from "@/lib/calendar-cells";
import { cn } from "@/lib/cn";
import { fmtNum, fmtPct, regionName, weekLabel, weekRange, type AppLocale } from "@/lib/format";
import type { AnnualSeries, CalendarPayload, ForecastPayload, Region, RegionDetail, RiskDetail } from "@/lib/types";
import { DriverList } from "./drivers";
import { reasonText } from "./reasons";

export function CalendarSection({ cal, forecast }: { cal: CalendarPayload; forecast?: ForecastPayload | null }) {
  const t = useTranslations("region");
  const tc = useTranslations("common");
  const tcl = useTranslations("clock");
  const [view, setView] = useState<"radial" | "linear">("radial");
  const [mode, setMode] = useState<"harmonized" | "raw">("harmonized");
  const [focus, setFocus] = useState<number | null>(null);
  const [cell, setCell] = useState<CellRef | null>(null);
  const ahead = useMemo(() => aheadCells(forecast), [forecast]);
  const current = cal.current ? { year: cal.current.year, woy: cal.current.woy } : null;
  const pick = (c: CellRef) => {
    const same = cell && cell.year === c.year && cell.week === c.week;
    setCell(same ? null : c);
    setFocus(same ? null : c.year);
  };
  return (
    <Panel className="p-5 sm:p-7">
      <PanelHeader
        eyebrow={t("clockTitle")}
        title={<span className="text-[1.15rem] text-dim">{t("clockLead")}</span>}
        aside={
          <div className="flex flex-wrap gap-2">
            <Segmented
              label={t("clockTitle")}
              size="sm"
              value={mode}
              onChange={setMode}
              options={[
                { value: "harmonized", label: tc("harmonized"), color: "var(--harmonized)" },
                { value: "raw", label: tc("raw"), color: "var(--modis)" },
              ]}
            />
            <Segmented
              label="view"
              size="sm"
              value={view}
              onChange={setView}
              options={[
                { value: "radial", label: <CircleDot className="size-3.5" aria-label={tc("radial")} /> },
                { value: "linear", label: <Grid3x3 className="size-3.5" aria-label={tc("linear")} /> },
              ]}
            />
          </div>
        }
      />
      <div className="mt-6">
        {view === "radial" ? (
          <FireClock
            years={cal.years}
            matrix={cal.matrix}
            rawMatrix={cal.raw_matrix}
            mode={mode}
            season={cal.season}
            anomalies={cal.anomalies}
            current={current}
            focusYear={focus}
            onFocusYear={setFocus}
            coverage={cal.coverage}
            selected={cell}
            onCell={pick}
            ahead={ahead}
          />
        ) : (
          <CalendarHeatmap years={cal.years} matrix={cal.matrix} rawMatrix={cal.raw_matrix} mode={mode} season={cal.season} anomalies={cal.anomalies} current={current}
            coverage={cal.coverage} selected={cell} onCell={pick} ahead={ahead} />
        )}
      </div>
      <CellBar cal={cal} cell={cell} mode={mode} ahead={ahead} />
      <div className="mt-4 space-y-1.5">
        <CellLegend labels={{ noData: tcl("legendNoData"), reduced: tcl("legendReduced") }} reduced={!!cal.coverage?.gaps.some((g) => g.level === "reduced")} />
        <p className="text-[12.5px] leading-snug text-faint">{tcl("heatNote")}</p>
      </div>
    </Panel>
  );
}

// The picked week: its value and a way to the detections behind it on the map.
function CellBar({ cal, cell, mode, ahead }: { cal: CalendarPayload; cell: CellRef | null; mode: "harmonized" | "raw"; ahead: AheadCells }) {
  const t = useTranslations("clock");
  const ta = useTranslations("ahead");
  const locale = useLocale() as AppLocale;
  if (!cell) return <p className="mt-4 text-center text-[13px] text-faint">{t("pickCell")}</p>;
  const yi = cal.years.indexOf(cell.year);
  const st = cellState(cell.year, cell.week, cal.coverage);
  const m = mode === "raw" && cal.raw_matrix ? cal.raw_matrix : cal.matrix;
  const v = m[yi]?.[cell.week] ?? 0;
  const unseen = st === "nodata" || st === "future";
  const fc = st === "future" ? ahead.get(weekStart(cell.year, cell.week)) : undefined;
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-bg-sunken/60 px-4 py-3 ring-1 ring-line">
      <div className="min-w-0">
        <p className="text-[13.5px] font-medium">
          {cell.year} · {weekLabel(cell.week, locale)}
        </p>
        <p className="text-[13px] text-dim">
          {st === "future" && fc
            ? fc.kind === "outlook"
              ? ta("calendarForecast", { value: fmtNum(fc.value, locale, 1), usual: fmtNum(fc.usual, locale, 1) })
              : ta("calendarTypical", { usual: fmtNum(fc.usual, locale, 1) })
            : unseen ? t(st === "future" ? "future" : "noData") : `${fmtNum(v, locale, v < 10 ? 1 : 0)} ${t("detectionsWeek")}`}
          {(st === "reduced" || st === "partial") && <> · {t(st)}</>}
        </p>
      </div>
      {!unseen && (
        <Link
          href={`/explore?w=${weekStart(cell.year, cell.week)}&r=${cal.region.slug}`}
          className="inline-flex min-h-9 items-center gap-2 rounded-md bg-text px-3.5 py-1.5 text-[13px] font-medium text-bg transition hover:scale-[1.02]"
        >
          <MapPinned className="size-4" /> {t("seeOnMap")}
        </Link>
      )}
    </div>
  );
}

export function NowPanel({ region }: { region: RegionDetail }) {
  const t = useTranslations("region");
  const locale = useLocale() as AppLocale;
  const c = region.current;
  if (!c) return null;
  const pct = c.week_percentile ?? 0;
  return (
    <Panel className="p-5 sm:p-6">
      <PanelHeader eyebrow={t("nowTitle")} title={weekLabel(c.woy, locale)} />
      <div className="mt-5 space-y-5">
        <div>
          <div className="flex items-baseline justify-between">
            <span className="text-[13px] text-dim">{t("thisWeek")}</span>
            <span className="font-display tabular text-[1.6rem]">{fmtNum(c.week_value, locale, c.week_value < 10 ? 1 : 0)}</span>
          </div>
          <PercentileBar value={pct} />
          <p className="mt-2 text-[13px] text-faint">{t("weekPercentile", { pct: fmtNum(pct, locale) })}</p>
        </div>
        <div className="border-t border-line pt-5">
          <div className="flex items-baseline justify-between">
            <span className="text-[13px] text-dim">{t("ytd")}</span>
            <span className="font-display tabular text-[1.6rem]">{fmtNum(c.ytd, locale)}</span>
          </div>
          <PercentileBar value={c.ytd_percentile ?? 0} />
          <div className="mt-2 flex justify-between text-[13px] text-faint">
            <span>{t("ytdRank", { rank: c.ytd_rank ?? "—", years: c.n_years + 1 })}</span>
            <span>{t("ytdVsNormal", { value: fmtNum(c.ytd_median, locale) })}</span>
          </div>
        </div>
      </div>
    </Panel>
  );
}

function PercentileBar({ value }: { value: number }) {
  return (
    <div className="relative mt-2.5 h-2 rounded-full bg-[linear-gradient(90deg,var(--risk-low),var(--risk-moderate),var(--risk-high),var(--risk-extreme))] opacity-90">
      <motion.span
        className="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-bg bg-text shadow-lg"
        initial={{ left: "0%" }}
        whileInView={{ left: `${Math.max(2, Math.min(98, value))}%` }}
        viewport={{ once: true }}
        transition={{ type: "spring", stiffness: 70, damping: 14 }}
      />
    </div>
  );
}

export function RiskPanel({ risk, slug }: { risk: RiskDetail; slug: string }) {
  const t = useTranslations("region");
  const tr = useTranslations("risk");
  const locale = useLocale() as AppLocale;
  return (
    <Panel className="p-5 sm:p-6">
      <PanelHeader
        eyebrow={t("riskTitle")}
        title={<RiskBadge level={risk.short.level} pulse className="text-[13px]" />}
        aside={
          <Link href={`/risk?r=${slug}`} className="inline-flex items-center gap-1 text-[13px] text-dim hover:text-text">
            {t("riskOpen")} <ArrowRight className="size-3.5" />
          </Link>
        }
      />
      <div className="mt-2 flex justify-center">
        <RiskDial probability={risk.short.probability} level={risk.short.level} size={250} />
      </div>
      <p className="mt-3 text-center text-[13px] text-faint">{tr("expected", { value: fmtNum(risk.short.expected7, locale, 1) })}</p>
      <DriverList drivers={risk.short.drivers} className="mt-5" />
      <div className="mt-5">
        <DailyStrip days={risk.daily} compact />
      </div>
    </Panel>
  );
}

export function SeasonPanel({ cal }: { cal: CalendarPayload }) {
  const t = useTranslations("region");
  const locale = useLocale() as AppLocale;
  const s = cal.season;
  return (
    <Panel className="p-5 sm:p-6">
      <PanelHeader eyebrow={t("seasonTitle")} title={weekRange(s.start, s.end, locale)} />
      <dl className="mt-5 grid grid-cols-3 gap-2 text-center">
        {[
          [t("start"), weekLabel(s.start, locale)],
          [t("peak"), weekLabel(s.peak_week, locale)],
          [t("end"), weekLabel(s.end, locale)],
        ].map(([k, v]) => (
          <div key={k} className="rounded-lg bg-bg-sunken/60 px-2 py-3 ring-1 ring-line">
            <dt className="text-[12px] font-semibold text-faint">{k}</dt>
            <dd className="mt-1 text-[13px] leading-snug">{v}</dd>
          </div>
        ))}
      </dl>
      {s.bimodal && <p className="mt-4 rounded-md bg-ember-500/10 px-3 py-2 text-[13px] text-ember-200 ring-1 ring-ember-500/20">{t("bimodal")}</p>}
      <p className="mt-5 text-[12.5px] font-semibold text-faint">{t("critical")}</p>
      <ul className="mt-2 space-y-2">
        {s.critical.slice(0, 3).map((c, i) => (
          <li key={i} className="flex items-center gap-3">
            <span className="h-8 w-1 rounded-full bg-ember" style={{ opacity: 1 - i * 0.3 }} />
            <div className="min-w-0 flex-1">
              <p className="text-[13.5px]">{weekRange(c.start, c.end, locale)}</p>
              <p className="text-[13px] text-faint">{t("criticalShare", { pct: fmtNum(c.share * 100, locale) })}</p>
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

export function NormalYearPanel({ cal }: { cal: CalendarPayload }) {
  const t = useTranslations("region");
  const cur = cal.current;
  const [cmp, setCmp] = useState<number | null>(null);
  const yi = cur ? cal.years.indexOf(cur.year) : -1;
  const recentYears = cal.years.filter((y) => y !== cur?.year).slice(-8).reverse();
  return (
    <Panel className="p-5 sm:p-7">
      <PanelHeader
        eyebrow={t("normalTitle", { year: cur?.year ?? "" })}
        title={<span className="text-[1.05rem] text-dim">{t("normalLead")}</span>}
        aside={
          <label className="flex items-center gap-2 text-[13px] text-dim">
            {t("compareWith")}
            <select
              value={cmp ?? ""}
              onChange={(e) => setCmp(e.target.value ? Number(e.target.value) : null)}
              className="h-8 rounded-md bg-bg-sunken px-3 text-[13px] text-text ring-1 ring-line outline-none"
            >
              <option value="">{t("noCompare")}</option>
              {recentYears.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
              {cal.anomalies.filter((a) => !recentYears.includes(a.year)).map((a) => (
                <option key={a.year} value={a.year}>
                  {a.year} ★
                </option>
              ))}
            </select>
          </label>
        }
      />
      <div className="mt-6">
        <ClimatologyChart
          clim={cal.climatology}
          season={cal.season}
          thisYear={yi >= 0 && cur ? { year: cur.year, values: cal.matrix[yi], upTo: cur.woy } : null}
          compareYear={cmp ? { year: cmp, values: cal.matrix[cal.years.indexOf(cmp)] } : null}
        />
      </div>
    </Panel>
  );
}

export function HistoryPanel({ annual }: { annual: AnnualSeries }) {
  const t = useTranslations("region");
  const tc = useTranslations("common");
  const locale = useLocale() as AppLocale;
  const rows = annual.years.filter((y) => !y.partial);
  const h = annual.trend.harmonized;
  return (
    <Panel className="p-5 sm:p-7">
      <PanelHeader
        eyebrow={t("historyTitle")}
        title={<span className="text-[1.05rem] text-dim">{t("historyLead")}</span>}
        aside={
          <div className="flex gap-2 tabular-nums text-[12.5px]">
            <span className="rounded-md bg-text px-2.5 py-1 text-bg">{tc("harmonized")}: {fmtPct(h.pct_per_decade / 100, locale, 0, true)}/10</span>
            <span className="rounded-md px-2.5 py-1 text-risk-extreme line-through ring-1 ring-risk-extreme/40">
              {tc("raw")}: {fmtPct(annual.trend.naive.pct_per_decade / 100, locale, 0, true)}/10
            </span>
          </div>
        }
      />
      <div className="mt-4 flex flex-wrap gap-4 text-[13px] text-dim">
        <LegendDot color="var(--harmonized)" label={tc("harmonized")} />
        <LegendDot color="var(--modis)" label={tc("naive")} />
        <LegendDot color="var(--harmonized)" label={tc("uncertainty")} band />
      </div>
      <SeriesChart
        className="mt-3"
        ariaLabel={t("historyTitle")}
        data={rows}
        x={(d) => d.year}
        height={300}
        series={[
          { key: "naive", label: tc("naive"), color: "var(--modis)", value: (d) => d.naive, width: 1.5 },
          { key: "harm", label: tc("harmonized"), color: "var(--harmonized)", value: (d) => d.harmonized, width: 2.75, area: true },
          ...(h.intercept != null
            ? [{
                key: "trend", label: t("trend"), color: "var(--text)", dashed: true, width: 1.5,
                endLabel: tc("pctDecade", { value: fmtPct(h.pct_per_decade / 100, locale, 0, true) }),
                value: (d: (typeof rows)[number]) => h.intercept! + h.slope * d.year,
              }]
            : []),
        ]}
        band={{ lo: (d) => d.lo, hi: (d) => d.hi, color: "var(--harmonized)", label: tc("uncertainty") }}
        markers={[{ x: 2012, label: "VIIRS" }]}
      />
    </Panel>
  );
}

function LegendDot({ color, label, band }: { color: string; label: string; band?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className={band ? "h-2.5 w-4 rounded-sm opacity-30" : "h-0.5 w-4 rounded-full"} style={{ background: color }} />
      {label}
    </span>
  );
}

export function AnomaliesPanel({ cal }: { cal: CalendarPayload }) {
  const t = useTranslations("region");
  const tr = useTranslations("reasons");
  const locale = useLocale() as AppLocale;
  const metrics = useMemo(() => new Map(cal.year_metrics.map((m) => [m.year, m])), [cal]);
  return (
    <Panel className="p-5 sm:p-7">
      <PanelHeader eyebrow={t("anomaliesTitle")} title={`${cal.anomalies.length}`} />
      {cal.anomalies.length === 0 ? (
        <p className="mt-4 text-[14px] text-dim">{t("anomaliesEmpty")}</p>
      ) : (
        <ul className="mt-5 grid gap-3 sm:grid-cols-2">
          {cal.anomalies.map((a, i) => {
            const yi = cal.years.indexOf(a.year);
            return (
              <motion.li
                key={a.year}
                initial={{ opacity: 0, y: 10 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.05 }}
                className="flex items-center gap-4 rounded-lg bg-bg-sunken/60 p-4 ring-1 ring-line"
              >
                <div>
                  <p className="font-display text-[1.6rem] leading-none text-ember-200">{a.year}</p>
                  <p className="mt-1 tabular-nums text-[12.5px] text-faint">{fmtNum(metrics.get(a.year)?.total, locale)}</p>
                </div>
                <div className="min-w-0 flex-1">
                  {a.reasons.map((r) => (
                    <p key={r.code} className="text-[13px] leading-snug text-dim">
                      {reasonText(tr, r, locale)}
                    </p>
                  ))}
                </div>
                {yi >= 0 && <Sparkline values={cal.matrix[yi]} width={84} height={30} />}
              </motion.li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

export function ChildrenPanel({ items }: { items: Region[] }) {
  const t = useTranslations("region");
  const locale = useLocale() as AppLocale;
  if (!items.length) return null;
  const sorted = [...items].sort((a, b) => (b.risk?.probability ?? 0) - (a.risk?.probability ?? 0));
  return (
    <Panel className="p-5 sm:p-7">
      <PanelHeader eyebrow={t("districts")} title={`${items.length}`} />
      <ul className="mt-5 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
        {sorted.map((r) => (
          <li key={r.slug}>
            <Link href={`/region/${r.slug}`} className="flex items-center gap-3 rounded-md px-3 py-2 transition hover:bg-panel-hover">
              <span className="size-2 rounded-full" style={{ background: r.risk ? `var(--risk-${r.risk.level})` : "var(--line-strong)" }} />
              <span className="flex-1 truncate text-[13.5px]">{regionName(r, locale)}</span>
              <span className="tabular-nums text-[12.5px] text-faint">{r.risk ? fmtPct(r.risk.probability, locale) : ""}</span>
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

export function ExportBar({ slug }: { slug: string }) {
  const t = useTranslations("region");
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="mr-2 text-[13px] text-faint">{t("export")}</span>
      {(
        [
          ["weekly", "csv"],
          ["annual", "csv"],
          ["hotspots", "geojson"],
        ] as const
      ).map(([kind, format]) => (
        <a
          key={kind}
          href={`/api/v1/export/${slug}?kind=${kind}&format=${format}`}
          className={cn("inline-flex h-8 items-center gap-1.5 rounded-md px-3.5 text-[13px] text-dim ring-1 ring-line transition hover:bg-panel-hover hover:text-text")}
        >
          <Download className="size-3.5" />
          {kind}.{format}
        </a>
      ))}
    </div>
  );
}
