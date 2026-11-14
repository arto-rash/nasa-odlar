"use client";

import { ArrowRight, BellRing, Flame, LineChart, Map } from "lucide-react";
import { motion } from "motion/react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { FireClock } from "@/components/charts/fire-clock";
import { Button } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/panel";
import { Reveal } from "@/components/ui/reveal";
import { RiskBadge } from "@/components/ui/risk-badge";
import { Ticker } from "@/components/ui/ticker";
import { Link } from "@/i18n/navigation";
import { heat } from "@/lib/colors";
import { fmtCompact, fmtNum, fmtPct, regionName, weekRange, type AppLocale } from "@/lib/format";
import type { CalendarPayload, Overview } from "@/lib/types";
import { useTheme } from "@/components/layout/theme-toggle";
import { DriverLine } from "@/components/region/drivers";
import { reasonText } from "@/components/region/reasons";
import { rich } from "@/lib/rich";
import { RegionPlace } from "@/components/ui/region-place";

export function Numbers({ overview }: { overview: Overview }) {
  const t = useTranslations("home.numbers");
  const locale = useLocale() as AppLocale;
  const items = [
    { v: <Ticker value={25} />, l: t("years") },
    { v: <Ticker value={5} />, l: t("satellites") },
    { v: <Ticker value={overview.n_regions - 3} />, l: t("regions") },
    { v: <Ticker value={overview.meta.n_hotspots} format={(x) => fmtCompact(x, locale)} />, l: t("hotspots") },
    {
      v: <Ticker value={overview.skill.bias * 100} digits={1} format={(x) => `${x >= 0 ? "+" : ""}${fmtNum(x, locale, 1)}%`} />,
      l: t("bias"),
      sub: t("rawBias", { value: fmtPct(overview.skill.raw_modis_bias, locale, 0, true) }),
    },
    { v: <Ticker value={overview.model.harmonized.roc_auc} digits={2} />, l: t("auc") },
  ];
  return (
    <section className="mx-auto max-w-[1240px] px-5 py-24 sm:px-8">
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg bg-line ring-1 ring-line md:grid-cols-3 lg:grid-cols-6">
        {items.map((it, i) => (
          <Reveal key={i} delay={i * 0.06} className="bg-bg p-6">
            <p className="font-display tabular text-[clamp(2rem,3.4vw,2.9rem)] leading-none text-ember">{it.v}</p>
            <p className="mt-3 text-[13px] leading-snug text-dim">{it.l}</p>
            {it.sub && <p className="mt-1 tabular-nums text-[12.5px] text-faint">{it.sub}</p>}
          </Reveal>
        ))}
      </div>
    </section>
  );
}

export function ClockTeaser({ cal }: { cal: CalendarPayload }) {
  const t = useTranslations("home.clock");
  const tr = useTranslations("reasons");
  const locale = useLocale() as AppLocale;
  const [theme] = useTheme();
  const [focus, setFocus] = useState<number | null>(null);
  return (
    <section className="relative mx-auto max-w-[1240px] px-5 py-24 sm:px-8">
      <div className="grid items-center gap-12 lg:grid-cols-[1fr_1.1fr]">
        <div>
          <Reveal>
            <Eyebrow>{t("eyebrow")}</Eyebrow>
            <h2 className="font-display mt-4 text-[clamp(2.2rem,4.4vw,3.6rem)] leading-[1.02]">{t.rich("title", rich)}</h2>
            <p className="mt-5 max-w-[50ch] text-[16px] leading-relaxed text-dim">{t("lead")}</p>
          </Reveal>
          <Reveal delay={0.1} className="mt-8 grid gap-3 sm:grid-cols-2">
            <Fact label={t("season")} value={weekRange(cal.season.start, cal.season.end, locale)} />
            <Fact
              label={t("peak")}
              value={cal.season.critical[0] ? weekRange(cal.season.critical[0].start, cal.season.critical[0].end, locale) : "—"}
            />
          </Reveal>
          {cal.anomalies.length > 0 && (
            <Reveal delay={0.15} className="mt-6">
              <p className="mb-2 text-[12.5px] font-semibold text-faint">{t("anomalies")}</p>
              <div className="flex flex-wrap gap-2">
                {cal.anomalies.slice(0, 6).map((a) => (
                  <button
                    key={a.year}
                    onMouseEnter={() => setFocus(a.year)}
                    onMouseLeave={() => setFocus(null)}
                    onFocus={() => setFocus(a.year)}
                    onBlur={() => setFocus(null)}
                    className="rounded-md bg-panel px-3 py-1.5 text-[13px] ring-1 ring-line transition hover:ring-ember-400"
                  >
                    <span className="tabular-nums text-ember-200">{a.year}</span>
                    <span className="ml-2 text-dim">{a.reasons[0] ? reasonText(tr, a.reasons[0], locale) : ""}</span>
                  </button>
                ))}
              </div>
            </Reveal>
          )}
          <Reveal delay={0.2} className="mt-9 flex items-center gap-5">
            <Link href={`/region/${cal.region.slug}`}>
              <Button variant="primary" className="group">
                {t("cta")} <ArrowRight className="size-4 transition group-hover:translate-x-1" />
              </Button>
            </Link>
            <div className="flex items-center gap-2 text-[12.5px] text-faint">
              {t("legendLow")}
              <span className="h-2 w-28 rounded-full" style={{ background: `linear-gradient(90deg, ${[0.05, 0.25, 0.45, 0.65, 0.85, 1].map((v) => heat(v, theme)).join(",")})` }} />
              {t("legendHigh")}
            </div>
          </Reveal>
        </div>
        <Reveal delay={0.1}>
          <FireClock
            years={cal.years}
            matrix={cal.matrix}
            season={cal.season}
            anomalies={cal.anomalies}
            current={cal.current ? { year: cal.current.year, woy: cal.current.woy } : null}
            focusYear={focus}
            onFocusYear={setFocus}
          />
        </Reveal>
      </div>
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-panel p-4 ring-1 ring-line">
      <p className="text-[12.5px] font-semibold text-faint">{label}</p>
      <p className="mt-1.5 font-medium capitalize-first">{value}</p>
    </div>
  );
}

export function Audiences() {
  const t = useTranslations("home.audiences");
  return (
    <section className="mx-auto max-w-[1240px] px-5 py-24 sm:px-8">
      <Reveal>
        <Eyebrow>{t("eyebrow")}</Eyebrow>
        <h2 className="font-display mt-4 max-w-[22ch] text-[clamp(2.2rem,4.4vw,3.6rem)] leading-[1.02]">{t.rich("title", rich)}</h2>
      </Reveal>
      <div className="mt-12 grid gap-5 lg:grid-cols-2">
        <AudienceCard
          icon={<LineChart className="size-5" />}
          title={t("sciTitle")}
          body={t("sci")}
          cta={t("sciCta")}
          href="/explore"
          art={<SciArt />}
        />
        <AudienceCard
          icon={<BellRing className="size-5" />}
          title={t("citTitle")}
          body={t("cit")}
          cta={t("citCta")}
          href="/simple"
          art={<PhoneArt />}
          warm
        />
      </div>
    </section>
  );
}

function AudienceCard({ icon, title, body, cta, href, art, warm }: { icon: React.ReactNode; title: string; body: string; cta: string; href: string; art: React.ReactNode; warm?: boolean }) {
  return (
    <Reveal>
      <Link href={href} className="group relative block h-full overflow-hidden rounded-lg border-t-4 bg-panel p-7 ring-1 ring-line transition-colors hover:ring-line-strong sm:p-9" style={{ borderTopColor: warm ? "var(--ember-500)" : "var(--viirs)" }}>
        <span className="text-dim">{icon}</span>
        <h3 className="font-display mt-4 text-[1.75rem] leading-tight">{title}</h3>
        <p className="mt-3 max-w-[46ch] leading-relaxed text-dim">{body}</p>
        <span className="mt-7 inline-flex items-center gap-2 text-[15px] font-semibold text-text underline decoration-line-strong underline-offset-4 group-hover:decoration-text">
          {cta} <ArrowRight className="size-4" />
        </span>
        <div className="pointer-events-none mt-8">{art}</div>
      </Link>
    </Reveal>
  );
}

function SciArt() {
  const bars = [3, 4, 3, 5, 4, 6, 5, 7, 6, 8, 7, 9, 18, 21, 17, 19, 22, 20];
  return (
    <div className="flex h-28 items-end gap-1.5">
      {bars.map((b, i) => (
        <motion.span
          key={i}
          initial={{ height: 0 }}
          whileInView={{ height: `${(i < 12 ? b * 2.6 : b * 1.0) * 4}%` }}
          viewport={{ once: true }}
          transition={{ delay: i * 0.03, duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          className="flex-1"
          style={{ background: i < 12 ? "var(--modis)" : "var(--harmonized)", opacity: 0.85 }}
        />
      ))}
    </div>
  );
}

function PhoneArt() {
  const tl = useTranslations("levelsPlain");
  return (
    <div className="mx-auto w-[220px] rounded-lg bg-bg-sunken p-3 ring-1 ring-line-strong">
      <div className="rounded-md border-t-4 border-risk-high bg-bg p-4">
        <Flame className="size-5 text-risk-high" />
        <p className="font-display mt-3 text-[1.35rem] leading-tight">{tl("high")}</p>
        <div className="mt-4 flex gap-1">
          {[0.3, 0.5, 0.8, 0.9, 0.7, 0.4, 0.3].map((v, i) => (
            <span key={i} className="h-8 flex-1" style={{ background: `color-mix(in oklab, var(--risk-high) ${v * 100}%, transparent)` }} />
          ))}
        </div>
      </div>
    </div>
  );
}

export function RiskNow({ overview }: { overview: Overview }) {
  const t = useTranslations("home.riskNow");
  const locale = useLocale() as AppLocale;
  return (
    <section className="mx-auto max-w-[1240px] px-5 py-24 sm:px-8">
      <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr]">
        <Reveal>
          <Eyebrow>{t("eyebrow")}</Eyebrow>
          <h2 className="font-display mt-4 text-[clamp(2.2rem,4.4vw,3.6rem)] leading-[1.02]">{t.rich("title", rich)}</h2>
          <p className="mt-5 max-w-[46ch] leading-relaxed text-dim">{t("lead")}</p>
          <Link href="/risk" className="mt-8 inline-block">
            <Button variant="outline" className="group">
              <Map className="size-4" /> {t("cta")} <ArrowRight className="size-4 transition group-hover:translate-x-1" />
            </Button>
          </Link>
        </Reveal>
        <ul className="divide-y divide-line overflow-hidden rounded-lg bg-panel ring-1 ring-line">
          {overview.risk_top.slice(0, 6).map((r, i) => (
            <Reveal as="li" key={r.slug} delay={i * 0.05}>
              <Link href={`/region/${r.slug}`} className="group flex items-center gap-4 px-5 py-4 transition hover:bg-panel-hover sm:px-6">
                <span className="w-5 tabular-nums text-[13px] text-faint">{String(i + 1).padStart(2, "0")}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{regionName(r, locale)}</p>
                  <RegionPlace r={r} />
                  {r.driver && <DriverLine code={r.driver} className="mt-0.5 text-[13px] text-dim" />}
                </div>
                <div className="hidden w-32 sm:block">
                  <div className="h-1.5 overflow-hidden rounded-full bg-bg-sunken">
                    <motion.div
                      initial={{ width: 0 }}
                      whileInView={{ width: `${r.probability * 100}%` }}
                      viewport={{ once: true }}
                      transition={{ duration: 1, delay: 0.2 + i * 0.05, ease: [0.16, 1, 0.3, 1] }}
                      className="h-full rounded-full"
                      style={{ background: `var(--risk-${r.level})` }}
                    />
                  </div>
                </div>
                <span className="w-12 text-right tabular-nums text-[13px] tabular text-dim">{fmtPct(r.probability, locale)}</span>
                <RiskBadge level={r.level} pulse className="hidden sm:inline-flex" />
              </Link>
            </Reveal>
          ))}
        </ul>
      </div>
    </section>
  );
}

export function Pipeline() {
  const t = useTranslations("home.pipeline");
  const steps = [1, 2, 3, 4].map((n) => ({ t: t(`s${n}t`), b: t(`s${n}`) }));
  return (
    <section className="mx-auto max-w-[1240px] px-5 py-24 sm:px-8">
      <Reveal>
        <Eyebrow>{t("eyebrow")}</Eyebrow>
        <h2 className="font-display mt-4 text-[clamp(2.2rem,4.4vw,3.6rem)] leading-[1.02]">{t.rich("title", rich)}</h2>
      </Reveal>
      <div className="relative mt-14">
        <div className="absolute left-0 right-0 top-[22px] hidden h-px bg-line lg:block" />
        <ol className="grid gap-8 lg:grid-cols-4">
          {steps.map((s, i) => (
            <Reveal as="li" key={i} delay={0.25 * i} className="relative">
              <span className="relative inline-block bg-bg pr-3 font-display text-[1.6rem] leading-[44px] text-ember-400">{i + 1}</span>
              <h3 className="font-display mt-3 text-[1.35rem]">{s.t}</h3>
              <p className="mt-2 text-[14.5px] leading-relaxed text-dim">{s.b}</p>
            </Reveal>
          ))}
        </ol>
      </div>
    </section>
  );
}

export function WhyNow() {
  const t = useTranslations("home.why");
  return (
    <section className="mx-auto max-w-[1240px] px-5 py-24 sm:px-8">
      <div className="relative overflow-hidden rounded-lg border-l-4 border-ember-500 bg-panel p-8 ring-1 ring-line sm:p-12">
        <Reveal>
          <Eyebrow>{t("eyebrow")}</Eyebrow>
          <h2 className="font-display mt-4 max-w-[20ch] text-[clamp(2rem,4vw,3.2rem)] leading-[1.04]">{t.rich("title", rich)}</h2>
          <p className="mt-5 max-w-[60ch] leading-relaxed text-dim">{t("lead")}</p>
        </Reveal>
        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          {[
            { a: t("snpp"), b: t("snppWhen") },
            { a: t("modis"), b: t("modisWhen") },
          ].map((x, i) => (
            <Reveal key={i} delay={0.1 * i} className="flex items-center justify-between gap-4 rounded-md bg-bg-sunken px-5 py-4 ring-1 ring-line">
              <span>{x.a}</span>
              <span className="tabular-nums text-[14px] font-semibold text-ember-300">{x.b}</span>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
