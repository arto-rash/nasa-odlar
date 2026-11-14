"use client";

import { ArrowDown, ArrowRight } from "lucide-react";
import { motion, useScroll, useTransform } from "motion/react";
import dynamic from "next/dynamic";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { Button, Magnetic } from "@/components/ui/button";
import { RiskBadge } from "@/components/ui/risk-badge";
import { Eyebrow } from "@/components/ui/panel";
import { Link } from "@/i18n/navigation";
import { fmtDate, fmtPct, regionName, type AppLocale } from "@/lib/format";
import type { Overview } from "@/lib/types";
import { rich } from "@/lib/rich";
import { DataBadge } from "./data-badge";

const HeroMap = dynamic(() => import("./hero-map"), { ssr: false });

/** true once the browser is idle after load — the globe waits so it never competes with hydration. */
function useIdle(timeout = 1500) {
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    const done = () => setIdle(true);
    if ("requestIdleCallback" in window) {
      const id = requestIdleCallback(done, { timeout });
      return () => cancelIdleCallback(id);
    }
    const id = setTimeout(done, 200);
    return () => clearTimeout(id);
  }, [timeout]);
  return idle;
}

export function Hero({ overview }: { overview: Overview }) {
  const t = useTranslations("home");
  const locale = useLocale() as AppLocale;
  const idle = useIdle();
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  const mapScale = useTransform(scrollYProgress, [0, 1], [1, 1.12]);
  const mapOpacity = useTransform(scrollYProgress, [0, 0.9], [1, 0.15]);
  const textY = useTransform(scrollYProgress, [0, 1], [0, -120]);
  const top = overview.risk_top[0];
  const highCount = ["high", "very_high", "extreme"].reduce((s, k) => s + (overview.risk_counts[k as keyof typeof overview.risk_counts] ?? 0), 0);

  return (
    <section ref={ref} className="relative h-[100svh] min-h-[640px] overflow-hidden">
      <motion.div style={{ scale: mapScale, opacity: mapOpacity }} className="absolute inset-0">
        {idle && <HeroMap />}
      </motion.div>
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_70%_40%,transparent_0%,var(--bg)_var(--hero-vignette,78%))]" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-bg via-bg/70 to-transparent" />

      <motion.div style={{ y: textY }} className="relative z-10 mx-auto flex h-full max-w-[1240px] flex-col justify-end px-5 pb-16 sm:px-8 sm:pb-20">
        <div className="grid items-end gap-10 lg:grid-cols-[1fr_340px]">
          <div>
            <div style={{ "--d": "0.15s", "--rise-y": "10px" } as React.CSSProperties} className="anim-rise mb-6 flex flex-wrap items-center gap-3">
              <Eyebrow>{t("eyebrow")}</Eyebrow>
              <DataBadge source={overview.meta.source} />
            </div>
            <h1 className="font-display max-w-[20ch] text-balance text-[clamp(2.6rem,6vw,5.2rem)] leading-[1.02]">{t.rich("title", rich)}</h1>
            <p
              style={{ "--d": "0.55s" } as React.CSSProperties}
              className="anim-rise mt-7 max-w-[56ch] text-[clamp(1rem,1.5vw,1.2rem)] leading-relaxed text-dim"
            >
              {t("lead")}
            </p>
            <div style={{ "--d": "0.7s" } as React.CSSProperties} className="anim-rise mt-9 flex flex-wrap gap-3">
              <Magnetic>
                <Link href="/explore">
                  <Button variant="ember" size="lg" className="group">
                    {t("ctaExplore")}
                    <ArrowRight className="size-4 transition group-hover:translate-x-1" />
                  </Button>
                </Link>
              </Magnetic>
              <Link href="/simple">
                <Button variant="outline" size="lg">
                  {t("ctaSimple")}
                </Button>
              </Link>
            </div>
          </div>

          <aside
            style={{ "--d": "0.9s", "--rise-x": "20px", "--rise-y": "0px" } as React.CSSProperties}
            className="anim-rise glass hidden rounded-lg p-5 lg:block"
          >
            <div className="flex items-center justify-between">
              <p className="text-[12.5px] font-semibold text-faint">{t("todayCard")}</p>
              <p className="tabular-nums text-[12.5px] text-faint">{fmtDate(overview.meta.data_end, locale, { day: "numeric", month: "short", year: "numeric" })}</p>
            </div>
            <p className="font-display mt-3 text-[1.6rem] leading-tight">{t("regionsAtRisk", { count: highCount })}</p>
            {top && (
              <Link href={`/region/${top.slug}`} className="mt-4 flex items-center justify-between gap-3 rounded-lg bg-bg-sunken/60 p-3 ring-1 ring-line transition hover:ring-line-strong">
                <div className="min-w-0">
                  <p className="text-[12.5px] text-faint">{t("todayTop")}</p>
                  <p className="truncate font-medium">{regionName(top, locale)}</p>
                </div>
                <div className="text-right">
                  <RiskBadge level={top.level} pulse />
                  <p className="mt-1 tabular-nums text-[13px] text-dim">{fmtPct(top.probability, locale)}</p>
                </div>
              </Link>
            )}
            <div className="mt-4 flex h-1.5 overflow-hidden rounded-full">
              {(["low", "moderate", "high", "very_high", "extreme"] as const).map((l) => (
                <span key={l} style={{ flex: overview.risk_counts[l] ?? 0, background: `var(--risk-${l})` }} />
              ))}
            </div>
          </aside>
        </div>
      </motion.div>

      <div style={{ "--d": "1.6s", "--rise-y": "0px" } as React.CSSProperties} className="anim-rise absolute bottom-5 left-1/2 z-10 -translate-x-1/2 text-faint">
        <ArrowDown className="size-4" aria-label={t("scroll")} />
      </div>
    </section>
  );
}
