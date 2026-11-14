"use client";

import { useQuery } from "@tanstack/react-query";
import { scaleLinear, scaleLog } from "d3-scale";
import { line } from "d3-shape";
import { GripVertical } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useRef, useState } from "react";
import { SeriesChart } from "@/components/charts/series-chart";
import { ChartTooltip, TipRow } from "@/components/charts/tooltip";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { Reveal } from "@/components/ui/reveal";
import { http } from "@/lib/client";
import { fmtNum, fmtPct, regionName, type AppLocale } from "@/lib/format";
import { useRegions } from "@/lib/queries";
import type { AnnualSeries, Skill } from "@/lib/types";
import { useSize } from "@/lib/use-size";

const SEASON_COLOR: Record<string, string> = { DJF: "#62d9e0", MAM: "#7fb38a", JJA: "#ff7a3d", SON: "#e3c35b" };

export function CompareClient({ initial, initialAnnual, initialSkill }: { initial: string; initialAnnual: AnnualSeries; initialSkill: Skill }) {
  const t = useTranslations("compare");
  const locale = useLocale() as AppLocale;
  const [slug, setSlug] = useState(initial);
  const { data: regions } = useRegions();
  const { data: annual = initialAnnual } = useQuery({
    queryKey: ["annual", slug],
    queryFn: () => http<AnnualSeries>(`/regions/${slug}/series/annual`),
    initialData: slug === initial ? initialAnnual : undefined,
  });
  const { data: skill = initialSkill } = useQuery({
    queryKey: ["skill", slug],
    queryFn: () => http<Skill>(`/harmonization/skill?region=${slug}`),
    initialData: slug === initial ? initialSkill : undefined,
  });
  const sorted = useMemo(
    () => [...(regions ?? [])].sort((a, b) => (a.level === "country" ? -1 : 0) - (b.level === "country" ? -1 : 0) || regionName(a, locale).localeCompare(regionName(b, locale), locale)),
    [regions, locale],
  );

  return (
    <div className="mx-auto grid max-w-[1240px] gap-5 px-5 sm:px-8">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-3 text-[13px] text-dim">
          {t("region")}
          <select value={slug} onChange={(e) => setSlug(e.target.value)} className="h-10 min-w-[220px] rounded-md bg-panel px-4 text-[14px] text-text ring-1 ring-line-strong outline-none">
            {sorted.map((r) => (
              <option key={r.slug} value={r.slug}>
                {r.level === "country" ? "● " : ""}
                {regionName(r, locale)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <BeforeAfter annual={annual} />
      <div className="grid gap-5 lg:grid-cols-2">
        <TransferPanel skill={skill} />
        <ValidationPanel skill={skill} />
      </div>
      <MetricsPanel skill={skill} />
      {skill.synthetic_truth && <TruthPanel truth={skill.synthetic_truth} />}
    </div>
  );
}

function BeforeAfter({ annual }: { annual: AnnualSeries }) {
  const t = useTranslations("compare");
  const locale = useLocale() as AppLocale;
  const tc = useTranslations("common");
  const [pos, setPos] = useState(0.5);
  const ref = useRef<HTMLDivElement>(null);
  const rows = annual.years.filter((y) => !y.partial);
  const yMax = Math.max(...rows.map((r) => Math.max(r.naive, r.hi)), 1);
  const drag = (clientX: number) => {
    const r = ref.current?.getBoundingClientRect();
    if (r) setPos(Math.max(0.02, Math.min(0.98, (clientX - r.left) / r.width)));
  };
  return (
    <Panel className="overflow-hidden p-5 sm:p-7">
      <PanelHeader
        eyebrow={t("series")}
        title={
          <span className="flex flex-wrap items-center gap-3 text-[1.1rem]">
            <span className="text-modis">{t("before")}</span>
            <span className="text-faint">↔</span>
            <span className="text-harmonized">{t("after")}</span>
          </span>
        }
        aside={
          <div className="flex gap-2 tabular-nums text-[12.5px]">
            <span className="rounded-md px-2.5 py-1 text-modis ring-1 ring-modis/40">
              {tc("raw")}: {fmtPct(annual.trend.naive.pct_per_decade / 100, locale, 0, true)}/10
            </span>
            <span className="rounded-md bg-harmonized px-2.5 py-1 text-white">
              {tc("harmonized")}: {fmtPct(annual.trend.harmonized.pct_per_decade / 100, locale, 0, true)}/10
            </span>
          </div>
        }
      />
      <div
        ref={ref}
        className="relative mt-6 cursor-ew-resize touch-none select-none"
        onPointerDown={(e) => {
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          drag(e.clientX);
        }}
        onPointerMove={(e) => e.buttons && drag(e.clientX)}
        role="slider"
        aria-label={t("drag")}
        aria-valuenow={Math.round(pos * 100)}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") setPos((p) => Math.max(0.02, p - 0.05));
          if (e.key === "ArrowRight") setPos((p) => Math.min(0.98, p + 0.05));
        }}
      >
        <SeriesChart
          noTooltip
          ariaLabel={t("before")}
          data={rows}
          x={(d) => d.year}
          yMax={yMax}
          height={340}
          series={[
            { key: "naive", label: tc("naive"), color: "var(--modis)", value: (d) => d.naive, width: 2.5, area: true },
            { key: "viirs", label: "VIIRS", color: "var(--viirs)", value: (d) => (d.year >= 2012 ? d.viirs : null), width: 1, dashed: true },
          ]}
          markers={[{ x: 2012, label: "VIIRS" }]}
        />
        <div className="absolute inset-0 bg-bg-elev" style={{ clipPath: `inset(0 0 0 ${pos * 100}%)` }}>
          <SeriesChart
            noTooltip
            ariaLabel={t("after")}
            data={rows}
            x={(d) => d.year}
            yMax={yMax}
            height={340}
            series={[{ key: "h", label: tc("harmonized"), color: "var(--harmonized)", value: (d) => d.harmonized, width: 2.5, area: true }]}
            band={{ lo: (d) => d.lo, hi: (d) => d.hi, color: "var(--harmonized)", label: tc("uncertainty") }}
            markers={[{ x: 2012, label: "VIIRS" }]}
          />
        </div>
        <div className="pointer-events-none absolute inset-y-0" style={{ left: `${pos * 100}%` }}>
          <div className="absolute inset-y-0 -ml-px w-0.5 bg-text/80" />
          <div className="absolute top-1/2 -ml-[18px] -mt-[18px] grid size-9 place-items-center rounded-full bg-text text-bg shadow-xl">
            <GripVertical className="size-4" />
          </div>
          <span className="absolute -ml-[calc(100%+70px)] top-2 rounded-md bg-modis/20 px-2 py-0.5 text-[12.5px] text-modis">{t("before")}</span>
          <span className="absolute top-2 ml-3 rounded-md bg-harmonized/20 px-2 py-0.5 text-[12.5px] text-harmonized">{t("after")}</span>
        </div>
      </div>
    </Panel>
  );
}

function TransferPanel({ skill }: { skill: Skill }) {
  const t = useTranslations("compare");
  const tc = useTranslations("common");
  const locale = useLocale() as AppLocale;
  const reduce = useReducedMotion();
  const [ref, { width }] = useSize<HTMLDivElement>();
  const h = 300;
  const m = { t: 10, r: 12, b: 34, l: 44 };
  const bySeason = useMemo(() => {
    const g: Record<string, { modis: number; viirs: number }[]> = {};
    for (const r of skill.transfer ?? []) (g[r.season] ??= []).push({ modis: r.modis, viirs: r.viirs });
    return g;
  }, [skill]);
  const all = Object.values(bySeason).flat();
  const xMax = Math.max(...all.map((d) => d.modis), 1);
  const yMax = Math.max(...all.map((d) => d.viirs), 1);
  const xs = scaleLinear().domain([0, xMax]).range([m.l, Math.max(m.l + 1, width - m.r)]);
  const ys = scaleLinear().domain([0, yMax]).nice().range([h - m.b, m.t]);
  return (
    <Panel className="p-5 sm:p-7">
      <PanelHeader eyebrow={t("transfer")} title={<span className="text-[1rem] leading-snug text-dim">{t("transferLead")}</span>} />
      <div ref={ref} className="mt-5" style={{ height: h }}>
        {width > 0 && (
          <svg width={width} height={h} role="img" aria-label={t("transfer")}>
            {ys.ticks(4).map((v) => (
              <g key={v}>
                <line x1={m.l} x2={width - m.r} y1={ys(v)} y2={ys(v)} stroke="var(--line)" />
                <text x={m.l - 8} y={ys(v)} textAnchor="end" dominantBaseline="middle" className="fill-faint tabular-nums text-[12px]">
                  {fmtNum(v, locale)}
                </text>
              </g>
            ))}
            {xs.ticks(5).map((v) => (
              <text key={v} x={xs(v)} y={h - m.b + 16} textAnchor="middle" className="fill-faint tabular-nums text-[12px]">
                {fmtNum(v, locale)}
              </text>
            ))}
            <text x={width - m.r} y={h - 4} textAnchor="end" className="fill-faint text-[12px]">MODIS / {tc("perWeek")}</text>
            <text x={m.l} y={m.t + 2} className="fill-faint text-[12px]">VIIRS</text>
            <line x1={xs(0)} y1={ys(0)} x2={xs(Math.min(xMax, yMax))} y2={ys(Math.min(xMax, yMax))} stroke="var(--line-strong)" strokeDasharray="4 4" />
            {Object.entries(bySeason).map(([s, pts], i) => (
              <motion.path
                key={s}
                d={line<{ modis: number; viirs: number }>().x((d) => xs(d.modis)).y((d) => ys(d.viirs))(pts) ?? ""}
                fill="none"
                stroke={SEASON_COLOR[s]}
                strokeWidth={2.25}
                initial={reduce ? false : { pathLength: 0 }}
                whileInView={{ pathLength: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 1.4, delay: i * 0.15 }}
              />
            ))}
          </svg>
        )}
      </div>
      <div className="mt-3 flex flex-wrap gap-4 text-[13px] text-dim">
        {Object.keys(bySeason).map((s) => (
          <span key={s} className="inline-flex items-center gap-2">
            <span className="h-0.5 w-4 rounded-full" style={{ background: SEASON_COLOR[s] }} />
            {t(`seasons.${s}` as "seasons.DJF")}
          </span>
        ))}
      </div>
    </Panel>
  );
}

function ValidationPanel({ skill }: { skill: Skill }) {
  const t = useTranslations("compare");
  const locale = useLocale() as AppLocale;
  const [ref, { width }] = useSize<HTMLDivElement>();
  const [hi, setHi] = useState<number | null>(null);
  const pts = (skill.loyo_annual ?? []).filter((d) => d.obs > 0);
  const h = 300;
  const m = { t: 10, r: 12, b: 34, l: 44 };
  const lo = Math.max(1, Math.min(...pts.map((d) => Math.min(d.obs, d.pred, Math.max(d.modis, 1)))) * 0.8);
  const top = Math.max(...pts.map((d) => Math.max(d.obs, d.pred)), 10) * 1.2;
  const xs = scaleLog().domain([lo, top]).range([m.l, Math.max(m.l + 1, width - m.r)]).clamp(true);
  const ys = scaleLog().domain([lo, top]).range([h - m.b, m.t]).clamp(true);
  const p = hi != null ? pts[hi] : null;
  return (
    <Panel className="p-5 sm:p-7">
      <PanelHeader eyebrow={t("validation")} title={<span className="text-[1rem] leading-snug text-dim">{t("validationLead")}</span>} />
      <div ref={ref} className="relative mt-5" style={{ height: h }}>
        {width > 0 && (
          <svg width={width} height={h} role="img" aria-label={t("validation")} onPointerLeave={() => setHi(null)}>
            {xs.ticks(4).map((v) => (
              <text key={v} x={xs(v)} y={h - m.b + 16} textAnchor="middle" className="fill-faint tabular-nums text-[12px]">
                {fmtNum(v, locale)}
              </text>
            ))}
            {ys.ticks(4).map((v) => (
              <g key={v}>
                <line x1={m.l} x2={width - m.r} y1={ys(v)} y2={ys(v)} stroke="var(--line)" />
                <text x={m.l - 8} y={ys(v)} textAnchor="end" dominantBaseline="middle" className="fill-faint tabular-nums text-[12px]">
                  {fmtNum(v, locale)}
                </text>
              </g>
            ))}
            <line x1={xs(lo)} y1={ys(lo)} x2={xs(top)} y2={ys(top)} stroke="var(--line-strong)" strokeDasharray="4 4" />
            <text x={width - m.r} y={h - 4} textAnchor="end" className="fill-faint text-[12px]">{t("obs")}</text>
            {pts.map((d, i) => (
              <g key={i} onPointerEnter={() => setHi(i)}>
                <line x1={xs(d.obs)} x2={xs(d.obs)} y1={ys(d.modis || lo)} y2={ys(d.pred)} stroke="var(--modis)" strokeOpacity={0.18} />
                <circle cx={xs(d.obs)} cy={ys(Math.max(d.modis, lo))} r={2} fill="var(--modis)" opacity={0.45} />
                <motion.circle
                  cx={xs(d.obs)}
                  cy={ys(d.pred)}
                  r={hi === i ? 6 : 3.5}
                  fill="var(--harmonized)"
                  stroke="var(--bg)"
                  initial={{ opacity: 0, scale: 0 }}
                  whileInView={{ opacity: 0.9, scale: 1 }}
                  viewport={{ once: true }}
                  transition={{ delay: Math.min(i * 0.004, 0.8) }}
                />
              </g>
            ))}
          </svg>
        )}
        <ChartTooltip show={!!p} x={p ? xs(p.obs) : 0} y={p ? ys(p.pred) : 0} width={width}>
          {p && (
            <>
              <p className="mb-1 font-medium">{p.year}</p>
              <TipRow color="var(--viirs)" label={t("obs")} value={fmtNum(p.obs, locale)} />
              <TipRow color="var(--harmonized)" label={t("pred")} value={fmtNum(p.pred, locale)} />
              <TipRow color="var(--modis)" label={t("rawModis")} value={fmtNum(p.modis, locale)} />
            </>
          )}
        </ChartTooltip>
      </div>
      <div className="mt-3 flex flex-wrap gap-4 text-[13px] text-dim">
        <span className="inline-flex items-center gap-2"><span className="size-2 rounded-full bg-harmonized" />{t("pred")}</span>
        <span className="inline-flex items-center gap-2"><span className="size-2 rounded-full bg-modis opacity-60" />{t("rawModis")}</span>
      </div>
    </Panel>
  );
}

function MetricsPanel({ skill }: { skill: Skill }) {
  const t = useTranslations("compare");
  const locale = useLocale() as AppLocale;
  const items = [
    { k: t("bias"), v: fmtPct(skill.bias, locale, 1, true), sub: `${t("rawBias")}: ${fmtPct(skill.raw_modis_bias, locale, 0, true)}`, good: true },
    { k: t("coverage"), v: fmtPct(skill.annual_interval_coverage, locale), sub: `${t("weeklyCoverage")}: ${fmtPct(skill.weekly_interval_coverage, locale)}` },
    { k: t("spearman"), v: fmtNum(skill.annual_spearman, locale, 2) },
    { k: t("medianError"), v: fmtPct(skill.annual_median_rel_error, locale, 0) },
  ];
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg bg-line ring-1 ring-line lg:grid-cols-4">
      {items.map((it, i) => (
        <Reveal key={it.k} delay={i * 0.06} className="bg-bg p-5 sm:p-6">
          <p className="text-[12.5px] font-semibold text-faint">{it.k}</p>
          <p className="font-display tabular mt-2 text-[2.2rem] leading-none text-ember">{it.v}</p>
          {it.sub && <p className="mt-2 tabular-nums text-[12.5px] text-faint">{it.sub}</p>}
        </Reveal>
      ))}
    </div>
  );
}

function TruthPanel({ truth }: { truth: NonNullable<Skill["synthetic_truth"]> }) {
  const t = useTranslations("compare");
  const tc = useTranslations("common");
  const locale = useLocale() as AppLocale;
  const rows = truth.by_year.filter((r) => r.year >= 2001 && r.year <= 2011);
  return (
    <Panel className="p-5 sm:p-7">
      <PanelHeader eyebrow={t("truthTitle")} title={<span className="text-[1rem] text-dim">{t("truthLead", { bias: fmtPct(truth.bias, locale, 1, true) })}</span>} />
      <SeriesChart
        className="mt-5"
        ariaLabel={t("truthTitle")}
        data={rows}
        x={(d) => d.year}
        height={240}
        series={[
          { key: "cf", label: t("hiddenTruth"), color: "var(--viirs)", value: (d) => d.viirs_cf, width: 2, dashed: true },
          { key: "h", label: tc("harmonized"), color: "var(--harmonized)", value: (d) => d.harmonized, width: 2.5 },
        ]}
      />
    </Panel>
  );
}
