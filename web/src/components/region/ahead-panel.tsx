"use client";

import { CalendarRange, CloudSun, ShieldQuestion, TrendingDown, TrendingUp, Minus } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { AheadChart } from "@/components/charts/ahead-chart";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { RiskBadge } from "@/components/ui/risk-badge";
import { cn } from "@/lib/cn";
import { fmtDate, fmtNum, type AppLocale } from "@/lib/format";
import type { ForecastPayload } from "@/lib/types";

/** Small expected counts read as "<0.1", not a misleading "0.0". */
const approx = (v: number | null | undefined, locale: AppLocale, about = false) =>
  v == null ? "–" : v > 0 && v < 0.05 ? "<0.1" : (about ? "~" : "") + fmtNum(v, locale, v < 10 ? 1 : 0);
const per100 = (v: number | null | undefined) => (v == null ? "–" : String(Math.round(v * 100)));

/** The days, weeks and months ahead in one place, each with how far to trust it. */
export function AheadPanel({ f, notesOpen = false }: { f: ForecastPayload; notesOpen?: boolean }) {
  const t = useTranslations("ahead");
  const locale = useLocale() as AppLocale;
  const o = f.outlook;
  const d = (iso: string | null) => (iso ? fmtDate(iso, locale, { day: "numeric", month: "long" }) : "–");
  const Signal = o.signal === "above" ? TrendingUp : o.signal === "below" ? TrendingDown : Minus;
  const inSeason = f.season.end && f.season.start && f.season.end < f.season.start;
  const r = f.reliability;
  const source = f.forecast_source === "open_meteo" ? "Open-Meteo" : (f.forecast_source ?? "–");
  return (
    <Panel className="p-5 sm:p-7">
      <PanelHeader eyebrow={t("title")} title={<span className="text-[1.05rem] text-dim">{t("lead")}</span>} />
      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <Card label={t("next7")}>
          <RiskBadge level={f.week.level} pulse />
          <p className="mt-2 text-[13px] text-dim">
            {t("expected", { value: approx(f.week.expected7, locale, true), usual: approx(f.week.normal7, locale) })}
          </p>
        </Card>
        <Card label={t("next3m")}>
          <p className={cn("inline-flex items-center gap-1.5 font-display text-[1.25rem] leading-tight", o.signal === "above" ? "text-ember-300" : o.signal === "below" ? "text-viirs" : "text-text")}>
            <Signal className="size-4" aria-hidden /> {t(o.signal)}
          </p>
          <p className="mt-1 text-[13px] text-dim">{t("expected", { value: approx(o.q50, locale, true), usual: approx(o.normal, locale) })}</p>
          <p className="text-[12.5px] text-faint">
            {t("range", { lo: approx(o.q10, locale), hi: approx(o.q90, locale), ulo: approx(o.normal_p10, locale), uhi: approx(o.normal_p90, locale) })}
          </p>
        </Card>
        <Card label={t("season")}>
          {f.season.start || f.season.peak ? (
            <ul className="space-y-0.5 text-[13.5px]">
              {inSeason ? (
                <li className="font-medium">{t("ends", { date: d(f.season.end) })}</li>
              ) : (
                <li className="font-medium">{t("starts", { date: d(f.season.start) })}</li>
              )}
              <li className="text-dim">{t("peak", { date: d(f.season.peak) })}</li>
            </ul>
          ) : (
            <p className="text-[13.5px] text-dim">{t("noSeason")}</p>
          )}
        </Card>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12.5px] text-dim">
        <Key swatch="bg-harmonized" line>{t("forecast")}</Key>
        <Key swatch="bg-harmonized/30">{t("likely")}</Key>
        <Key swatch="bg-faint" dashed>{t("usual")}</Key>
        <Key swatch="bg-faint/20">{t("usualRange")}</Key>
        <span className="ml-auto text-faint">{t("detectionsWeek")}</span>
      </div>
      <AheadChart f={f} className="mt-2" height={250} />

      <details open={notesOpen} className="group mt-5 rounded-lg bg-bg-sunken/60 px-4 py-3 ring-1 ring-line">
        <summary className="flex cursor-pointer list-none items-center gap-2 text-[13.5px] font-medium">
          <ShieldQuestion className="size-4 text-ember-400" aria-hidden /> {t("howSure")}
        </summary>
        <ul className="mt-3 space-y-2.5 text-[13px] leading-snug text-dim">
          <Note icon={CloudSun}>{t("rDays", { source })}</Note>
          <Note icon={TrendingUp}>{t("r7", { years: r.test_years || 6, auc: per100(r.week_auc), base: per100(r.week_auc_season) })}</Note>
          <Note icon={CalendarRange}>{t("r13", { cov: per100(r.outlook_coverage80), base: per100(r.outlook_coverage80_season) })}</Note>
          <Note icon={Minus}>{t("rTypical")}</Note>
        </ul>
      </details>
    </Panel>
  );
}

function Card({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-bg-sunken/60 p-4 ring-1 ring-line">
      <p className="mb-2 text-[12.5px] font-semibold text-faint">{label}</p>
      {children}
    </div>
  );
}

function Key({ swatch, line, dashed, children }: { swatch: string; line?: boolean; dashed?: boolean; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={cn(line || dashed ? "h-0.5 w-4 rounded-full" : "h-2.5 w-4 rounded-sm", swatch)}
        style={dashed ? { background: "repeating-linear-gradient(90deg, var(--text-faint) 0 4px, transparent 4px 7px)" } : undefined}
      />
      {children}
    </span>
  );
}

function Note({ icon: Icon, children }: { icon: typeof Minus; children: React.ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <Icon className="mt-0.5 size-4 shrink-0 text-faint" aria-hidden />
      <span>{children}</span>
    </li>
  );
}
