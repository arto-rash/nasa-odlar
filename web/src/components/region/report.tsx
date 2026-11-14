"use client";

import { Printer, Share2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo } from "react";
import { toast } from "sonner";
import { CalendarHeatmap } from "@/components/charts/calendar-heatmap";
import { CellLegend } from "@/components/charts/cell-style";
import { Wordmark } from "@/components/layout/logo";
import { RegionPlace } from "@/components/ui/region-place";
import { aheadCells } from "@/lib/calendar-cells";
import { fmtDate, fmtNum, fmtPct, regionName, weekRange, type AppLocale } from "@/lib/format";
import type { AnnualSeries, CalendarPayload, ForecastPayload, RegionDetail } from "@/lib/types";
import { AheadPanel } from "./ahead-panel";
import { MonthPanel } from "./month-panel";
import { HistoryPanel } from "./region-panels";
import { SeasonStatusChip } from "./season-status";

/** Paper while it is open: light colours read and print better; the reader's own
 *  theme comes back when they leave. Not saved as their choice. */
function useLightPaper() {
  useEffect(() => {
    const root = document.documentElement;
    const before = root.dataset.theme;
    root.dataset.theme = "light";
    return () => {
      if (before) root.dataset.theme = before;
    };
  }, []);
}

export function RegionReport({
  region, cal, annual, forecast, url,
}: {
  region: RegionDetail;
  cal: CalendarPayload;
  annual: AnnualSeries;
  forecast: ForecastPayload | null;
  /** the region page this report is about */
  url: string;
}) {
  useLightPaper();
  const t = useTranslations("report");
  const tr = useTranslations("region");
  const tcl = useTranslations("clock");
  const locale = useLocale() as AppLocale;
  const ahead = useMemo(() => aheadCells(forecast), [forecast]);
  const s = region.stats;
  const crit = region.season?.critical[0];
  const end = cal.coverage?.end ?? region.current?.as_of ?? "";
  const today = new Date().toISOString().slice(0, 10);
  const share = async () => {
    const data = { title: `${t("title")}: ${regionName(region, locale)}`, url: window.location.href };
    try {
      if (navigator.share) return await navigator.share(data);
      await navigator.clipboard.writeText(data.url);
      toast.success(t("copied"));
    } catch {}
  };
  return (
    <main className="mx-auto max-w-[920px] px-5 pb-16 pt-24 sm:px-8 print:max-w-none print:px-0 print:pt-0">
      <div className="mb-6 flex flex-wrap justify-end gap-2 print:hidden">
        <button onClick={share} className="inline-flex min-h-9 items-center gap-2 rounded-md px-3.5 text-[13.5px] ring-1 ring-line-strong hover:bg-panel-hover">
          <Share2 className="size-4" /> {t("share")}
        </button>
        <button onClick={() => window.print()} className="inline-flex min-h-9 items-center gap-2 rounded-md bg-text px-3.5 text-[13.5px] font-medium text-bg">
          <Printer className="size-4" /> {t("print")}
        </button>
      </div>

      <header className="border-b border-line pb-5">
        <div className="flex items-center justify-between gap-4">
          <Wordmark />
          <p className="tabular-nums text-[12.5px] text-faint">
            {t("meta", { end: end ? fmtDate(end, locale, { day: "numeric", month: "long", year: "numeric" }) : "—", today: fmtDate(today, locale, { day: "numeric", month: "long", year: "numeric" }) })}
          </p>
        </div>
        <p className="mt-6 text-[13px] font-semibold text-faint">{t("title")}</p>
        <h1 className="font-display text-[clamp(2rem,5vw,3.2rem)] leading-[1.05]">{regionName(region, locale)}</h1>
        <RegionPlace r={region} className="mt-1 text-[14px]" />
        <SeasonStatusChip season={region.season} current={region.current} className="mt-4" />
      </header>

      {cal.month && (
        <section className="mt-6 break-inside-avoid">
          <MonthPanel m={cal.month} />
        </section>
      )}

      <section className="mt-6 break-inside-avoid">
        <h2 className="text-[13px] font-semibold text-faint">{t("keyNumbers")}</h2>
        <dl className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-lg bg-line ring-1 ring-line sm:grid-cols-4">
          <Fact label={tr("annualMean")} value={fmtNum(s.annual_mean, locale)} />
          <Fact label={tr("peakSeason")} value={crit ? weekRange(crit.start, crit.end, locale) : "—"} small />
          <Fact label={tr("recordYear")} value={`${s.record_year ?? "—"}`} note={fmtNum(s.record_value, locale)} />
          <Fact label={tr("trend")} value={`${fmtPct(s.trend.pct_per_decade / 100, locale, 0, true)} / 10`}
            note={tr("fakeTrend", { value: fmtPct(s.trend_naive.pct_per_decade / 100, locale, 0, true) })} />
        </dl>
      </section>

      <section className="mt-8 break-inside-avoid">
        <h2 className="text-[13px] font-semibold text-faint">{t("calendar")}</h2>
        <div className="mt-3">
          <CalendarHeatmap years={cal.years} matrix={cal.matrix} season={cal.season} anomalies={cal.anomalies}
            current={cal.current ? { year: cal.current.year, woy: cal.current.woy } : null} coverage={cal.coverage} ahead={ahead} />
        </div>
        <CellLegend labels={{ noData: tcl("legendNoData"), reduced: tcl("legendReduced") }} reduced={!!cal.coverage?.gaps.some((g) => g.level === "reduced")} />
      </section>

      <section className="mt-8 break-inside-avoid">
        <HistoryPanel annual={annual} breaks={region.stats.break} />
      </section>

      {forecast && (
        <section className="mt-8 break-inside-avoid">
          <AheadPanel f={forecast} notesOpen />
        </section>
      )}

      <section className="mt-8 break-inside-avoid border-t border-line pt-5 text-[13px] leading-relaxed text-dim">
        <h2 className="text-[13px] font-semibold text-faint">{t("about")}</h2>
        <p className="mt-2">{t("about1")}</p>
        <p className="mt-2">{t("about2")}</p>
        <p className="mt-2">{t("about3")}</p>
        <p className="mt-3 text-faint">{t("source", { url })}</p>
      </section>
    </main>
  );
}

function Fact({ label, value, note, small }: { label: string; value: string; note?: string; small?: boolean }) {
  return (
    <div className="bg-bg p-4">
      <dt className="text-[12px] font-semibold text-faint">{label}</dt>
      <dd className={small ? "mt-1.5 text-[15px] font-medium leading-snug" : "font-display tabular mt-1.5 text-[1.5rem] leading-none"}>{value}</dd>
      {note && <dd className="mt-1 text-[12px] text-faint">{note}</dd>}
    </div>
  );
}
