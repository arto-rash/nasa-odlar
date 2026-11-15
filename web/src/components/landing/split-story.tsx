"use client";

import { AnimatePresence, motion, useInView, useReducedMotion } from "motion/react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { SeriesChart, type Series } from "@/components/charts/series-chart";
import { Eyebrow } from "@/components/ui/panel";
import { cn } from "@/lib/cn";
import { fmtPct, type AppLocale } from "@/lib/format";
import { pctPerDecade, theilSen } from "@/lib/stats";
import type { Overview } from "@/lib/types";
import { rich } from "@/lib/rich";

type Row = Overview["pilot"][number] & { naiveTrend: number; harmTrend: number };

export function SplitStory({ pilot, endYear }: { pilot: Overview["pilot"]; endYear: number }) {
  const t = useTranslations("home.split");
  const tc = useTranslations("common");
  const locale = useLocale() as AppLocale;
  const ref = useRef<HTMLElement>(null);
  const [step, setStep] = useState(0);
  // No pinned, scroll-driven section (it lagged and held the page on phones): the
  // story plays by itself once in view, one step every few seconds, and stops for
  // good the moment the reader picks a step. Never for reduced motion.
  const [touched, setTouched] = useState(false);
  const inView = useInView(ref, { amount: 0.45 });
  const reduce = useReducedMotion();
  useEffect(() => {
    if (!inView || touched || reduce || step >= 3) return;
    const id = setTimeout(() => setStep((v) => Math.min(3, v + 1)), step === 0 ? 2600 : 3800);
    return () => clearTimeout(id);
  }, [inView, touched, reduce, step]);
  const pick = (i: number) => {
    setTouched(true);
    setStep(i);
  };

  const { rows, naivePct, harmPct } = useMemo(() => {
    const full = pilot.filter((p) => p.year >= 2001 && p.year < endYear);
    const xs = full.map((p) => p.year);
    const n = theilSen(xs, full.map((p) => p.naive));
    const h = theilSen(xs, full.map((p) => p.harmonized));
    const rows: Row[] = full.map((p) => ({
      ...p,
      naiveTrend: n.intercept + n.slope * p.year,
      harmTrend: h.intercept + h.slope * p.year,
    }));
    return {
      rows,
      naivePct: pctPerDecade(xs, full.map((p) => p.naive)),
      harmPct: pctPerDecade(xs, full.map((p) => p.harmonized)),
    };
  }, [pilot, endYear]);

  const series: Series<Row>[] = [
    { key: "modis", label: tc("modis"), color: "var(--modis)", value: (d) => d.modis, hidden: step !== 0, width: 2.25 },
    // once the repair is shown, the raw record stays only as a faint ghost and its fake trend goes away
    { key: "naive", label: tc("naive"), color: "var(--modis)", value: (d) => d.naive, hidden: step === 0, width: step === 3 ? 1.25 : 2.25, opacity: step === 3 ? 0.3 : 1 },
    {
      key: "naiveTrend", label: t("fakeTrend"), color: "var(--risk-extreme)", value: (d) => d.naiveTrend, hidden: step !== 2, dashed: true, width: 1.75,
      endLabel: tc("pctDecade", { value: fmtPct(naivePct, locale, 0, true) }),
    },
    { key: "harmonized", label: tc("harmonized"), color: "var(--harmonized)", value: (d) => d.harmonized, hidden: step < 3, width: 2.75 },
    {
      key: "harmTrend", label: t("realTrend"), color: "var(--text)", value: (d) => d.harmTrend, hidden: step < 3, dashed: true, width: 1.5,
      endLabel: tc("pctDecade", { value: fmtPct(harmPct, locale, 0, true) }),
    },
  ];

  const steps = [
    { title: t("s1t"), body: t("s1") },
    { title: t("s2t"), body: t("s2") },
    { title: t("s3t"), body: t("s3") },
    { title: t("s4t"), body: t("s4") },
  ];

  return (
    <section ref={ref} className="relative py-20 sm:py-28" aria-labelledby="split-title">
      <div>
        <div className="mx-auto grid w-full max-w-[1240px] gap-6 px-5 sm:px-8 lg:grid-cols-[0.85fr_1.15fr] lg:grid-rows-[auto_1fr] lg:gap-x-14 lg:gap-y-6">
          <div className="lg:col-start-1 lg:row-start-1">
            <Eyebrow>{t("eyebrow")}</Eyebrow>
            <h2 id="split-title" className="font-display mt-4 text-[clamp(2.2rem,4.6vw,3.8rem)] leading-[1]">
              {t.rich("title", rich)}
            </h2>
          </div>
          <div className="lg:col-start-1 lg:row-start-2 lg:self-start">
            <ol className="space-y-1">
              {steps.map((s, i) => (
                <li key={i}>
                  <button
                    type="button"
                    onClick={() => pick(i)}
                    aria-pressed={step === i}
                    className={cn(
                      "group flex w-full gap-4 rounded-lg p-3 text-left transition-colors",
                      step === i ? "bg-panel" : "hover:bg-panel/50",
                    )}
                  >
                    <span
                      className={cn(
                        "mt-1 grid size-6 shrink-0 place-items-center rounded-full tabular-nums text-[12.5px] transition-colors",
                        step === i ? "bg-ember text-white" : step > i ? "bg-panel-hover text-dim" : "text-faint ring-1 ring-line-strong",
                      )}
                    >
                      {i + 1}
                    </span>
                    <span className="min-w-0">
                      <span className={cn("block font-medium transition-colors", step === i ? "text-text" : "text-dim")}>{s.title}</span>
                      <AnimatePresence initial={false}>
                        {step === i && (
                          <motion.span
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
                            className="block overflow-hidden text-[14.5px] leading-relaxed text-dim"
                          >
                            <span className="block pt-1.5">{s.body}</span>
                          </motion.span>
                        )}
                      </AnimatePresence>
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          </div>

          <div className="glass relative self-center rounded-lg p-4 sm:p-6 max-lg:row-start-2 lg:col-start-2 lg:row-span-2 lg:row-start-1">
            <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px] text-dim">
              <Legend color="var(--modis)" label={step === 0 ? tc("modis") : tc("naive")} />
              {step >= 3 && <Legend color="var(--harmonized)" label={tc("harmonized")} />}
              {step >= 3 && <Legend color="var(--harmonized)" label={tc("uncertainty")} band />}
              <div className="ml-auto flex gap-2">
                <AnimatePresence>
                  {step >= 2 && (
                    <motion.span
                      key="fake"
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: step === 3 ? 0.45 : 1, scale: 1 }}
                      exit={{ opacity: 0 }}
                      className={cn("rounded-md px-2.5 py-1 tabular-nums text-[12.5px] ring-1", step === 3 && "line-through")}
                      style={{ color: "var(--risk-extreme)", boxShadow: "inset 0 0 0 1px color-mix(in oklab, var(--risk-extreme) 40%, transparent)" }}
                    >
                      {t("fakeTrend")}: {fmtPct(naivePct, locale, 0, true)}
                    </motion.span>
                  )}
                  {step >= 3 && (
                    <motion.span
                      key="real"
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="rounded-md bg-text px-2.5 py-1 tabular-nums text-[12.5px] text-bg"
                    >
                      {t("realTrend")}: {fmtPct(harmPct, locale, 0, true)}
                    </motion.span>
                  )}
                </AnimatePresence>
              </div>
            </div>
            <SeriesChart
              ariaLabel={t("chartAria")}
              data={rows}
              x={(d) => d.year}
              series={series}
              band={step >= 3 ? { lo: (d) => d.lo, hi: (d) => d.hi, color: "var(--harmonized)", label: tc("uncertainty") } : undefined}
              markers={step >= 1 ? [{ x: 2012, label: t("jump") }] : []}
              fadeBefore={step >= 1 ? 2012 : undefined}
              height={340}
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function Legend({ color, label, band }: { color: string; label: string; band?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className={band ? "h-2.5 w-4 rounded-sm opacity-30" : "h-0.5 w-4 rounded-full"} style={{ background: color }} />
      {label}
    </span>
  );
}
