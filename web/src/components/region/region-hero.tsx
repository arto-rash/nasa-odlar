"use client";

import { ChevronRight, TrendingDown, TrendingUp } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { ViewTransition } from "react";
import { InfoTip } from "@/components/ui/info-tip";
import { RiskBadge } from "@/components/ui/risk-badge";
import { Ticker } from "@/components/ui/ticker";
import { Link } from "@/i18n/navigation";
import { fmtNum, fmtPct, regionName, weekRange, type AppLocale } from "@/lib/format";
import type { RegionDetail } from "@/lib/types";
import { SeasonStatusChip } from "./season-status";

export function RegionHero({ region }: { region: RegionDetail }) {
  const t = useTranslations("region");
  const tc = useTranslations("common");
  const tn = useTranslations("nav");
  const locale = useLocale() as AppLocale;
  const s = region.stats;
  const tr = s.trend;
  const crit = region.season?.critical[0];
  return (
    <header className="relative overflow-hidden pt-28 sm:pt-32">
      <div className="relative mx-auto max-w-[1240px] px-5 sm:px-8">
        <nav aria-label="breadcrumb" className="flex items-center gap-1.5 text-[13px] text-faint">
          <Link href="/regions" className="hover:text-text">{tn("regions")}</Link>
          {region.parent && region.level !== "country" && (
            <>
              <ChevronRight className="size-3.5" />
              <Link href={`/region/${region.parent.slug}`} className="hover:text-text">{regionName(region.parent, locale)}</Link>
            </>
          )}
        </nav>
        <div className="mt-4 flex flex-wrap items-end justify-between gap-6">
          <ViewTransition name={`region-${region.slug}`}>
            <h1
              className="anim-rise font-display text-[clamp(2.6rem,6.6vw,5.4rem)] leading-[1.05]"
              style={{ "--rise-y": "20px", "--rise-blur": "8px" } as React.CSSProperties}
            >
              {regionName(region, locale)}
            </h1>
          </ViewTransition>
          {region.risk && (
            <div className="flex items-center gap-3 pb-2">
              <span className="text-[13px] text-faint">{t("riskTitle")}</span>
              <RiskBadge level={region.risk.level} pulse className="text-[13px]" />
              <span className="tabular-nums text-[13px] text-dim">{fmtPct(region.risk.probability, locale)}</span>
            </div>
          )}
        </div>
        <SeasonStatusChip season={region.season} current={region.current} className="mt-5" />

        <dl className="mt-10 grid grid-cols-2 gap-px overflow-hidden rounded-lg bg-line ring-1 ring-line lg:grid-cols-4">
          <Stat label={t("annualMean")} hint={t("annualMeanHint")}>
            <Ticker value={s.annual_mean ?? 0} />
            <span className="ml-1.5 text-[13px] text-faint">{tc("detections")}</span>
          </Stat>
          <Stat label={t("peakSeason")}>
            <span className="text-[1.25rem] leading-snug">{crit ? weekRange(crit.start, crit.end, locale) : "–"}</span>
          </Stat>
          <Stat label={t("recordYear")}>
            {s.record_year ?? "–"}
            <span className="ml-2 tabular-nums text-[13px] text-faint">{fmtNum(s.record_value, locale)}</span>
          </Stat>
          <Stat label={t("trend")} hint={t("trendHint")}>
            <span className="inline-flex items-center gap-2">
              {tr.pct_per_decade >= 0 ? <TrendingUp className="size-5 text-ember-300" /> : <TrendingDown className="size-5 text-viirs" />}
              {fmtPct(tr.pct_per_decade / 100, locale, 0, true)}
              <span className="text-[13px] text-faint">/ 10</span>
            </span>
            <span className="mt-1 block text-[13px] text-faint">
              {tr.significant ? tc("significant") : tc("notSignificant")} ·{" "}
              <span className="line-through decoration-risk-extreme/70">{t("fakeTrend", { value: fmtPct(s.trend_naive.pct_per_decade / 100, locale, 0, true) })}</span>
            </span>
          </Stat>
        </dl>
      </div>
    </header>
  );
}

function Stat({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="bg-bg p-5 sm:p-6">
      <dt className="flex items-center gap-1 text-[12.5px] font-semibold text-faint">
        {label}
        {hint && <InfoTip label={label}>{hint}</InfoTip>}
      </dt>
      <dd className="font-display tabular mt-2 text-[1.9rem] leading-none">{children}</dd>
    </div>
  );
}
