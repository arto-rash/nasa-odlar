"use client";

import { scaleLinear } from "d3-scale";
import { area, curveCatmullRom, line } from "d3-shape";
import { motion, useReducedMotion } from "motion/react";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { fmtNum, monthShort, weekLabel, weekMonth, type AppLocale } from "@/lib/format";
import type { Climatology, SeasonProfile } from "@/lib/types";
import { useSize } from "@/lib/use-size";
import { ChartTooltip, TipRow } from "./tooltip";

/** The "normal year": p10–p90 and IQR bands, median, critical windows, and this year on top. */
export function ClimatologyChart({
  clim, season, thisYear, compareYear, height = 300,
}: {
  clim: Climatology;
  season?: SeasonProfile | null;
  thisYear?: { year: number; values: number[]; upTo: number } | null;
  compareYear?: { year: number; values: number[] } | null;
  height?: number;
}) {
  const t = useTranslations("climatology");
  const locale = useLocale() as AppLocale;
  const reduce = useReducedMotion();
  const [ref, { width }] = useSize<HTMLDivElement>();
  const [hw, setHw] = useState<number | null>(null);
  const m = { t: 18, r: 10, b: 26, l: 36 };
  const weeks = Array.from({ length: 52 }, (_, i) => i);
  const xs = scaleLinear().domain([0, 51]).range([m.l, Math.max(m.l + 1, width - m.r)]);
  const top = Math.max(...clim.p90, ...(thisYear?.values.slice(0, thisYear.upTo + 1) ?? [0]), ...(compareYear?.values ?? [0]), 1);
  const ys = scaleLinear().domain([0, top * 1.1]).nice().range([height - m.b, m.t]);
  const c = curveCatmullRom.alpha(0.5);
  const paths = useMemo(() => {
    const outer = area<number>().x((w) => xs(w)).y0((w) => ys(clim.p10[w])).y1((w) => ys(clim.p90[w])).curve(c)(weeks);
    const inner = area<number>().x((w) => xs(w)).y0((w) => ys(clim.p25[w])).y1((w) => ys(clim.p75[w])).curve(c)(weeks);
    const med = line<number>().x((w) => xs(w)).y((w) => ys(clim.mean[w])).curve(c)(weeks);
    const cur = thisYear ? line<number>().x((w) => xs(w)).y((w) => ys(thisYear.values[w])).curve(c)(weeks.slice(0, thisYear.upTo + 1)) : null;
    const cmp = compareYear ? line<number>().x((w) => xs(w)).y((w) => ys(compareYear.values[w])).curve(c)(weeks) : null;
    return { outer, inner, med, cur, cmp };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clim, thisYear, compareYear, width, height]);

  return (
    <div ref={ref} className="relative" style={{ height }}>
      {width > 0 && (
        <svg
          width={width}
          height={height}
          className="block overflow-visible"
          role="img"
          aria-label={t("aria")}
          onPointerMove={(e) => {
            const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
            setHw(Math.max(0, Math.min(51, Math.round(xs.invert(e.clientX - r.left)))));
          }}
          onPointerLeave={() => setHw(null)}
        >
          {season?.critical.slice(0, 3).map((w, i) => {
            const segs = w.end >= w.start ? [[w.start, w.end]] : [[w.start, 51], [0, w.end]];
            return segs.map(([s, e], j) => (
              <g key={`${i}${j}`}>
                <rect x={xs(s - 0.5)} y={m.t} width={xs(e + 0.5) - xs(s - 0.5)} height={height - m.t - m.b} className="fill-ember-500" opacity={0.07} />
                <rect x={xs(s - 0.5)} y={m.t - 6} width={xs(e + 0.5) - xs(s - 0.5)} height={2.5} rx={1} className="fill-ember-400" opacity={i === 0 ? 0.9 : 0.5} />
              </g>
            ));
          })}
          {ys.ticks(4).map((v) => (
            <g key={v}>
              <line x1={m.l} x2={width - m.r} y1={ys(v)} y2={ys(v)} stroke="var(--line)" />
              <text x={m.l - 8} y={ys(v)} textAnchor="end" dominantBaseline="middle" className="fill-faint tabular-nums text-[12px]">
                {fmtNum(v, locale)}
              </text>
            </g>
          ))}
          {Array.from({ length: 12 }, (_, mo) => {
            const w = weeks.find((i) => weekMonth(i) === mo) ?? 0;
            return (
              <text key={mo} x={xs(w)} y={height - 6} className="fill-faint text-[12px]">
                {monthShort(mo, locale)}
              </text>
            );
          })}
          <motion.path d={paths.outer ?? ""} className="fill-ember-500" initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 0.12 }} transition={{ duration: 1 }} />
          <motion.path d={paths.inner ?? ""} className="fill-ember-400" initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 0.22 }} transition={{ duration: 1, delay: 0.15 }} />
          <motion.path
            d={paths.med ?? ""}
            fill="none"
            stroke="var(--ember-300)"
            strokeWidth={1.5}
            strokeDasharray="4 4"
            initial={reduce ? false : { pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 1.4 }}
          />
          {paths.cmp && <path d={paths.cmp} fill="none" stroke="var(--viirs)" strokeWidth={1.5} opacity={0.9} />}
          {paths.cur && (
            <motion.path
              d={paths.cur}
              fill="none"
              stroke="var(--text)"
              strokeWidth={2.25}
              strokeLinecap="round"
              initial={reduce ? false : { pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 1.8, delay: 0.3, ease: [0.65, 0, 0.35, 1] }}
            />
          )}
          {thisYear && (
            <circle cx={xs(thisYear.upTo)} cy={ys(thisYear.values[thisYear.upTo])} r={4.5} fill="var(--text)" stroke="var(--bg)" strokeWidth={2} />
          )}
          {hw != null && <line x1={xs(hw)} x2={xs(hw)} y1={m.t} y2={height - m.b} stroke="var(--text)" strokeOpacity={0.2} />}
        </svg>
      )}
      <ChartTooltip show={hw != null} x={hw != null ? xs(hw) : 0} y={height / 2} width={width}>
        {hw != null && (
          <>
            <p className="mb-1 font-medium text-text">{weekLabel(hw, locale)}</p>
            {thisYear && hw <= thisYear.upTo && <TipRow color="var(--text)" label={String(thisYear.year)} value={fmtNum(thisYear.values[hw], locale, 1)} />}
            {compareYear && <TipRow color="var(--viirs)" label={String(compareYear.year)} value={fmtNum(compareYear.values[hw], locale, 1)} />}
            <TipRow color="var(--ember-300)" dashed label={t("normal")} value={fmtNum(clim.mean[hw], locale, 1)} />
            <TipRow label={t("range")} value={`${fmtNum(clim.p10[hw], locale, 1)}–${fmtNum(clim.p90[hw], locale, 1)}`} />
          </>
        )}
      </ChartTooltip>
    </div>
  );
}
