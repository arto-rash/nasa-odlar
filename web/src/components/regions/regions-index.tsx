"use client";

import { Search, TrendingDown, TrendingUp } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { Sparkline } from "@/components/charts/sparkline";
import { RiskBadge } from "@/components/ui/risk-badge";
import { Segmented } from "@/components/ui/segmented";
import { Link } from "@/i18n/navigation";
import { countryLabel, fmtNum, fmtPct, regionName, type AppLocale } from "@/lib/format";
import { useCountryRegions, useRegionSearch } from "@/lib/queries";
import type { Region } from "@/lib/types";

type Sort = "risk" | "activity" | "trend" | "name";

const HOME = ["az", "ge", "am"];
const PAGE = 120;

/**
 * Regions of one country at a time (the world has ~25,000), plus a search over
 * all of them. Country cards: the home countries and the one selected.
 */
export function RegionsIndex({ countries, initial }: { countries: Region[]; initial: Region[] }) {
  const t = useTranslations("regions");
  const tc = useTranslations("common");
  const locale = useLocale() as AppLocale;
  const [country, setCountry] = useState("az");
  const [sort, setSort] = useState<Sort>("risk");
  const [q, setQ] = useState("");
  const [shown, setShown] = useState(PAGE);
  const { data: byCountry } = useCountryRegions(country);
  const { data: found } = useRegionSearch(q, 200);
  const searching = q.trim().length > 0;
  const source = searching ? found : (byCountry ?? (country === "az" ? initial : undefined));

  // one entry per country code (a big country's states share its code), home first
  const options = useMemo(() => {
    const seen = new Map<string, Region>();
    for (const c of countries) if (!seen.has(c.country)) seen.set(c.country, c);
    return [...seen.values()].sort(
      (a, b) => Number(HOME.includes(b.country)) - Number(HOME.includes(a.country)) ||
        countryLabel(a, locale).localeCompare(countryLabel(b, locale), locale),
    );
  }, [countries, locale]);
  const cards = countries.filter((c) => c.kind !== "state" && (HOME.includes(c.country) || c.country === country))
    .sort((a, b) => HOME.indexOf(a.country) - HOME.indexOf(b.country));

  const list = useMemo(() => {
    const l = (source ?? []).filter((r) => r.level !== "country");
    const by: Record<Sort, (a: Region, b: Region) => number> = {
      risk: (a, b) => (b.risk?.probability ?? 0) - (a.risk?.probability ?? 0),
      activity: (a, b) => (b.density ?? 0) - (a.density ?? 0),
      trend: (a, b) => (b.trend_pct ?? 0) - (a.trend_pct ?? 0),
      name: (a, b) => regionName(a, locale).localeCompare(regionName(b, locale), locale),
    };
    return searching ? l : [...l].sort(by[sort]);
  }, [source, sort, locale, searching]);

  return (
    <div className="mx-auto max-w-[1240px] px-5 sm:px-8">
      <div className="grid gap-4 md:grid-cols-3">
        {cards.map((c, i) => (
          <motion.div key={c.slug} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 + i * 0.07, duration: 0.7, ease: [0.16, 1, 0.3, 1] }}>
            <Link href={`/region/${c.slug}`} className="group glass relative block overflow-hidden rounded-lg p-5 transition hover:ring-1 hover:ring-line-strong">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-[12.5px] font-semibold text-faint">{tc("country")}</p>
                  <p className="font-display mt-1 text-[1.7rem] leading-tight">{regionName(c, locale)}</p>
                </div>
                {c.risk && <RiskBadge level={c.risk.level} />}
              </div>
              <div className="mt-4 flex items-end justify-between">
                <p className="tabular-nums text-[13px] text-dim">
                  {fmtNum(c.annual_mean, locale)} <span className="text-faint">/ {t("annual")}</span>
                </p>
                <Sparkline values={c.annual ?? []} width={140} height={40} splitAt={11} />
              </div>
            </Link>
          </motion.div>
        ))}
      </div>

      <div className="sticky top-[72px] z-30 mt-10 flex flex-wrap items-center gap-2 rounded-full bg-bg/80 py-2 sm:top-20">
        <label className="flex h-9 items-center gap-2 rounded-md bg-bg-sunken px-3 ring-1 ring-line">
          <span className="sr-only">{tc("country")}</span>
          <select
            value={country}
            onChange={(e) => {
              setCountry(e.target.value);
              setShown(PAGE);
            }}
            className="max-w-[220px] bg-transparent text-[13px] outline-none"
          >
            {options.map((c) => (
              <option key={c.country} value={c.country}>
                {countryLabel(c, locale)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex h-9 min-w-[180px] flex-1 items-center gap-2 rounded-md bg-bg-sunken px-3.5 ring-1 ring-line">
          <Search className="size-3.5 text-faint" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("search")} className="w-full bg-transparent text-[13px] outline-none placeholder:text-faint" />
        </label>
        <Segmented
          label={t("sort")}
          size="sm"
          value={sort}
          onChange={setSort}
          options={[
            { value: "risk", label: t("sortRisk") },
            { value: "activity", label: t("sortActivity") },
            { value: "trend", label: t("sortTrend") },
            { value: "name", label: t("sortName") },
          ]}
        />
      </div>
      <p className="mt-3 text-[13px] text-faint">{t("count", { count: list.length })}</p>

      <motion.ul layout className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <AnimatePresence initial={false}>
          {list.slice(0, shown).map((r) => (
            <motion.li
              layout
              key={r.slug}
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.97 }}
              transition={{ type: "spring", stiffness: 380, damping: 34 }}
            >
              <Link href={`/region/${r.slug}`} className="group flex h-full flex-col rounded-lg bg-panel p-4 ring-1 ring-line transition duration-300 hover:-translate-y-0.5 hover:bg-panel-hover hover:ring-line-strong">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-[15px] font-medium">{regionName(r, locale)}</p>
                    <p className="mt-0.5 text-[12.5px] text-faint">{countryLabel(r, locale)}</p>
                  </div>
                  {r.risk && (
                    <span className="text-right">
                      <RiskBadge level={r.risk.level} />
                      <span className="mt-1 block tabular-nums text-[12.5px] text-faint">{fmtPct(r.risk.probability, locale)}</span>
                    </span>
                  )}
                </div>
                <div className="mt-auto flex items-end justify-between gap-3 pt-4">
                  <div className="text-[12.5px] text-dim">
                    <p className="tabular-nums">{t("density", { value: fmtNum(r.density, locale, 1) })}</p>
                    {r.trend_pct !== undefined && (
                      <p className="mt-0.5 inline-flex items-center gap-1 tabular-nums">
                        {r.trend_pct >= 0 ? <TrendingUp className="size-3 text-ember-300" /> : <TrendingDown className="size-3 text-viirs" />}
                        {fmtPct(r.trend_pct / 100, locale, 0, true)}/10
                      </p>
                    )}
                  </div>
                  <Sparkline values={r.annual ?? []} width={110} height={34} />
                </div>
              </Link>
            </motion.li>
          ))}
        </AnimatePresence>
      </motion.ul>
      {list.length > shown && (
        <div className="mt-6 flex justify-center">
          <button type="button" onClick={() => setShown((n) => n + PAGE * 2)} className="rounded-full bg-panel px-5 py-2 text-[13px] ring-1 ring-line-strong transition hover:ring-ember-400">
            {t("showMore", { count: list.length - shown })}
          </button>
        </div>
      )}
    </div>
  );
}
