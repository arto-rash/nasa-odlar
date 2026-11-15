"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { BellRing, Check, Flame, LocateFixed, Loader2, MapPin, Phone, Search } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { DailyStrip } from "@/components/charts/daily-strip";
import { DriverList } from "@/components/region/drivers";
import { Link, useRouter } from "@/i18n/navigation";
import { http, HttpError } from "@/lib/client";
import { cn } from "@/lib/cn";
import { fmtNum, regionName, weekRange, type AppLocale } from "@/lib/format";
import { useCountryRegions, useRegionSearch } from "@/lib/queries";
import { matchScore } from "@/lib/search";
import { useAuth, useUi } from "@/lib/store";
import { useHydrated } from "@/lib/use-hydrated";
import { useNearMe } from "@/lib/use-near-me";
import type { RegionDetail, RegionRef, RiskDetail, Subscription } from "@/lib/types";
import { SeasonStatusChip } from "@/components/region/season-status";
import { RegionPlace } from "@/components/ui/region-place";

type Prefetched = { slug: string; region: RegionDetail; risk: RiskDetail };

export function SimpleClient({ initial, saved, prefetched }: { initial?: string; saved?: string; prefetched?: Prefetched }) {
  const stored = useUi((s) => s.homeRegion);
  const setHome = useUi((s) => s.setHomeRegion);
  const hydrated = useHydrated();
  useEffect(() => {
    if (initial) setHome(initial);
  }, [initial, setHome]);
  // the server only knows the cookie; once hydrated, the persisted store is the source of truth
  const home = hydrated ? stored : (initial ?? saved ?? null);
  return (
    <AnimatePresence mode="wait" initial={false}>
      {home ? (
        <motion.div key="card" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}>
          <RiskCard slug={home} prefetched={prefetched?.slug === home ? prefetched : undefined} onChange={() => setHome(null)} />
        </motion.div>
      ) : (
        <motion.div key="pick" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}>
          <Picker onPick={setHome} />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Picker({ onPick }: { onPick: (slug: string) => void }) {
  const t = useTranslations("simple");
  const locale = useLocale() as AppLocale;
  const [q, setQ] = useState("");
  const { data: found } = useRegionSearch(q, 30);
  const { data: home } = useCountryRegions("az", true);
  const regions = q.trim() ? found : home;
  const list = useMemo(
    () =>
      (regions ?? [])
        .filter((r) => r.level !== "country")
        .map((r) => ({ r, s: matchScore(q, r.name_az, r.name_en) }))
        .filter((x) => x.s > 0)
        .sort((a, b) => b.s - a.s || regionName(a.r, locale).localeCompare(regionName(b.r, locale), locale))
        .slice(0, q ? 20 : 12),
    [regions, q, locale],
  );
  const { locate, locating } = useNearMe(useCallback((r: RegionRef) => onPick(r.slug), [onPick]));
  return (
    <div className="mx-auto max-w-[560px] px-4 pb-16 pt-28 sm:pt-36 lg:max-w-[680px]">
      <h1 className="font-display text-[2.6rem] leading-[1.02]">{t("pick")}</h1>
      <p className="mt-3 text-[16px] leading-relaxed text-dim">{t("pickLead")}</p>
      <button onClick={locate} disabled={locating} className="mt-7 flex h-14 w-full items-center justify-center gap-3 rounded-lg bg-text text-[16px] font-medium text-bg transition active:scale-[0.98] disabled:opacity-70">
        {locating ? <Loader2 className="size-5 animate-spin" /> : <LocateFixed className="size-5" />}
        {locating ? t("locating") : t("locate")}
      </button>
      <label className="mt-4 flex h-14 items-center gap-3 rounded-lg bg-panel px-4 ring-1 ring-line-strong focus-within:ring-ember-400">
        <Search className="size-5 text-faint" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("pick")} className="w-full bg-transparent text-[16px] outline-none placeholder:text-faint" autoComplete="off" />
      </label>
      <ul className="mt-3 divide-y divide-line overflow-hidden rounded-lg bg-panel ring-1 ring-line">
        {list.map(({ r }) => (
          <li key={r.slug}>
            <button onClick={() => onPick(r.slug)} className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left text-[16px] transition hover:bg-panel-hover active:bg-panel-hover">
              <span className="size-2.5 shrink-0 rounded-full" style={{ background: r.risk ? `var(--risk-${r.risk.level})` : "var(--line-strong)" }} />
              <span className="min-w-0 flex-1">
                <span className="block">{regionName(r, locale)}</span>
                <RegionPlace r={r} className="text-[13px]" />
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RiskCard({ slug, prefetched, onChange }: { slug: string; prefetched?: Prefetched; onChange: () => void }) {
  const t = useTranslations("simple");
  const tl = useTranslations("levelsPlain");
  const tlev = useTranslations("levels");
  const ta = useTranslations("alerts");
  const locale = useLocale() as AppLocale;
  const token = useAuth((s) => s.token);
  const router = useRouter();
  const { data: region } = useQuery({ queryKey: ["region", slug], queryFn: () => http<RegionDetail>(`/regions/${slug}`), initialData: prefetched?.region });
  const { data: risk } = useQuery({ queryKey: ["risk", slug], queryFn: () => http<RiskDetail>(`/regions/${slug}/risk`), initialData: prefetched?.risk });
  const subs = useQuery({ queryKey: ["subs", token], queryFn: () => http<{ data: Subscription[] }>("/subscriptions"), enabled: Boolean(token), retry: false });
  const subscribed = subs.data?.data.some((s) => s.region.slug === slug);
  const sub = useMutation({
    mutationFn: () => http<Subscription>("/subscriptions", { method: "POST", json: { region_slug: slug, threshold: "high", channels: ["in_app", "email"] } }),
    onSuccess: () => {
      subs.refetch();
      toast.success(t("notifyDone"));
    },
    onError: (e) => toast.error(e instanceof HttpError && e.status === 501 ? ta("gatewayMissing") : (e as Error).message),
  });

  if (!region || !risk) return <div className="skeleton mx-auto mt-32 h-[70vh] max-w-[560px] lg:max-w-[1120px]" />;
  const level = risk.short.level;
  const high = ["high", "very_high", "extreme"].includes(level);
  const c = region.current;
  const ratio = c && c.week_median ? c.week_value / Math.max(c.week_median, 0.5) : 1;
  const vs = ratio > 1.3 ? "more" : ratio < 0.7 ? "less" : "same";
  const advice = t.raw(high ? "adviceHigh" : "adviceLow") as string[];
  const crit = region.season?.critical[0];

  return (
    <div className="mx-auto max-w-[560px] px-4 pb-16 pt-24 sm:pt-32 lg:max-w-[1120px] lg:px-8">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-2 text-[15px] text-dim">
          <MapPin className="size-4 shrink-0" />
          <span className="min-w-0">
            <span className="block">{regionName(region, locale)}</span>
            <RegionPlace r={region} />
          </span>
        </p>
        <button onClick={onChange} className="rounded-md px-3 py-1.5 text-[13px] text-dim ring-1 ring-line hover:text-text">
          {t("change")}
        </button>
      </div>

      {/* phones: one column; laptops: the risk and its week on the left, what to do on the right */}
      <div className="lg:mt-4 lg:grid lg:grid-cols-[1.2fr_1fr] lg:items-start lg:gap-6">
      <div>
      <motion.section
        initial={{ scale: 0.97, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        className="relative mt-4 overflow-hidden rounded-lg p-7 ring-1 ring-line-strong lg:mt-0"
        style={{ background: "var(--panel-solid)", borderTop: `6px solid var(--risk-${level})` }}
      >
        <p className="text-[13px] font-semibold text-dim">{t("thisWeek")}</p>
        <div className="mt-3 flex items-center gap-3">
          <Flame className="size-9" style={{ color: `var(--risk-${level})` }} />
          <h1 className="font-display text-[2.7rem] leading-none">{tl(level)}</h1>
        </div>
        <div className="mt-6 flex gap-1.5" role="img" aria-label={tlev(level)}>
          {(["low", "moderate", "high", "very_high", "extreme"] as const).map((l, i) => (
            <motion.span
              key={l}
              initial={{ scaleY: 0.3, opacity: 0.3 }}
              animate={{ scaleY: 1, opacity: ["low", "moderate", "high", "very_high", "extreme"].indexOf(level) >= i ? 1 : 0.18 }}
              transition={{ delay: 0.2 + i * 0.08, type: "spring", stiffness: 300, damping: 20 }}
              className="h-3 flex-1 origin-bottom rounded-full"
              style={{ background: `var(--risk-${l})` }}
            />
          ))}
        </div>
        <p className="mt-6 text-[15px] text-dim">
          {t("vsNormal")}: <b className="text-text">{t(vs)}</b>
        </p>
        <DriverList drivers={risk.short.drivers.slice(0, 3)} className="mt-4" />
      </motion.section>

      <section className="mt-5 rounded-lg bg-panel p-6 ring-1 ring-line">
        <h2 className="text-[13px] font-semibold text-faint">{t("week")}</h2>
        <div className="mt-4">
          <DailyStrip days={risk.daily} />
        </div>
      </section>

      </div>
      <div>
      <section className="mt-5 rounded-lg bg-panel p-6 ring-1 ring-line lg:mt-0">
        <h2 className="text-[13px] font-semibold text-faint">{t("advice")}</h2>
        <ul className="mt-4 space-y-3">
          {advice.map((a, i) => (
            <li key={i} className="flex gap-3 text-[16px] leading-snug">
              <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-bg-sunken text-[13px] font-semibold text-text ring-1 ring-line-strong">{i + 1}</span>
              {a}
            </li>
          ))}
        </ul>
        <a href="tel:112" className="mt-5 flex h-12 items-center justify-center gap-2 rounded-lg bg-risk-extreme/15 text-[15px] font-semibold text-risk-extreme ring-1 ring-risk-extreme/30">
          <Phone className="size-4" /> {t("call")}
        </a>
      </section>

      {crit && (
        <section className="mt-5 rounded-lg bg-panel p-6 ring-1 ring-line">
          <h2 className="text-[13px] font-semibold text-faint">{t("season")}</h2>
          <p className="mt-3 text-[17px] leading-relaxed">{t("seasonText", { range: weekRange(crit.start, crit.end, locale) })}</p>
          <SeasonStatusChip season={region.season} current={region.current} className="mt-3" />
          <SeasonBar start={crit.start} end={crit.end} now={c?.woy ?? null} />
        </section>
      )}

      <section className="mt-5">
        {subscribed ? (
          <div className="flex h-14 items-center justify-center gap-2 rounded-lg bg-risk-low/15 text-[16px] font-medium text-risk-low ring-1 ring-risk-low/30">
            <Check className="size-5" /> {t("notifyDone")}
          </div>
        ) : (
          <button
            onClick={() => (token ? sub.mutate() : router.push(`/login?next=/simple`))}
            disabled={sub.isPending}
            className="flex h-14 w-full items-center justify-center gap-2 rounded-lg bg-ember text-[16px] font-semibold text-white transition active:scale-[0.98]"
          >
            {sub.isPending ? <Loader2 className="size-5 animate-spin" /> : <BellRing className="size-5" />}
            {t("notify")}
          </button>
        )}
        <p className="mt-2 text-center text-[13px] text-faint">{t("notifyLead")}</p>
        <p className="mt-6 text-center text-[13px]">
          <Link href={`/region/${slug}`} className="text-dim underline-offset-4 hover:text-text hover:underline">
            {regionName(region, locale)} → {fmtNum(region.stats.annual_mean, locale)}
          </Link>
        </p>
      </section>
      </div>
      </div>
    </div>
  );
}

function SeasonBar({ start, end, now }: { start: number; end: number; now: number | null }) {
  const segs = end >= start ? [[start, end]] : [[start, 51], [0, end]];
  return (
    <div className="relative mt-5 h-3 rounded-full bg-line">
      {segs.map(([s, e], i) => (
        <span key={i} className="absolute inset-y-0 rounded-full bg-ember" style={{ left: `${(s / 52) * 100}%`, width: `${((e - s + 1) / 52) * 100}%` }} />
      ))}
      {now !== null && <span className={cn("absolute -top-1 h-5 w-1 rounded-full bg-text")} style={{ left: `${(now / 52) * 100}%` }} />}
    </div>
  );
}
