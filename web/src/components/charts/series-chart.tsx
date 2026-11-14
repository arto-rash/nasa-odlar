"use client";

import { bisector, extent, max } from "d3-array";
import { scaleLinear, scaleTime } from "d3-scale";
import { area, curveMonotoneX, line } from "d3-shape";
import { motion, useReducedMotion } from "motion/react";
import { useLocale } from "next-intl";
import { useMemo, useState } from "react";
import { fmtCompact, fmtNum, type AppLocale } from "@/lib/format";
import { useSize } from "@/lib/use-size";
import { ChartTooltip, TipRow } from "./tooltip";

export interface Series<T> {
  key: string;
  label: string;
  color: string;
  value: (d: T) => number | null;
  dashed?: boolean;
  width?: number;
  hidden?: boolean;
  area?: boolean;
  /** de-emphasise a series without removing it */
  opacity?: number;
  /** text drawn at the line's right end, e.g. a trend's slope */
  endLabel?: string;
}

export interface Marker {
  x: number | Date;
  label: string;
}

export function SeriesChart<T>({
  data, x, series, band, height = 320, markers = [], xFormat, yLabel, fadeBefore, className, ariaLabel, yMax, noTooltip,
}: {
  yMax?: number;
  noTooltip?: boolean;
  data: T[];
  x: (d: T) => number | Date;
  series: Series<T>[];
  band?: { lo: (d: T) => number | null; hi: (d: T) => number | null; color: string; label: string };
  height?: number;
  markers?: Marker[];
  xFormat?: (v: number | Date) => string;
  yLabel?: string;
  fadeBefore?: number | Date;
  className?: string;
  ariaLabel: string;
}) {
  const locale = useLocale() as AppLocale;
  const reduce = useReducedMotion();
  const [ref, { width }] = useSize<HTMLDivElement>();
  const [hi, setHi] = useState<number | null>(null);
  const m = { t: 16, r: 14, b: 28, l: 44 };
  const isTime = data.length > 0 && x(data[0]) instanceof Date;

  const { xs, ys } = useMemo(() => {
    const ext = extent(data, (d) => +x(d)) as [number, number];
    const xs = isTime
      ? scaleTime().domain([new Date(ext[0] ?? 0), new Date(ext[1] ?? 1)]).range([m.l, Math.max(m.l + 1, width - m.r)])
      : scaleLinear().domain(ext[0] === undefined ? [0, 1] : ext).range([m.l, Math.max(m.l + 1, width - m.r)]);
    const vis = series.filter((s) => !s.hidden);
    const top = Math.max(
      max(data, (d) => Math.max(...vis.map((s) => s.value(d) ?? 0))) ?? 1,
      band ? (max(data, (d) => band.hi(d) ?? 0) ?? 0) : 0,
      1,
    );
    const ys = scaleLinear().domain([0, (yMax ?? top) * 1.08]).nice().range([height - m.b, m.t]);
    return { xs, ys };
  }, [data, x, series, band, width, height, isTime, m.l, m.r, m.b, m.t, yMax]);

  const bandPath = useMemo(() => {
    if (!band) return null;
    return area<T>()
      .defined((d) => band.lo(d) != null && band.hi(d) != null)
      .x((d) => xs(x(d) as never))
      .y0((d) => ys(band.lo(d)!))
      .y1((d) => ys(band.hi(d)!))
      .curve(curveMonotoneX)(data);
  }, [band, data, x, xs, ys]);

  const paths = useMemo(
    () =>
      series.map((s) => ({
        s,
        d: line<T>()
          .defined((d) => s.value(d) != null)
          .x((d) => xs(x(d) as never))
          .y((d) => ys(s.value(d)!))
          .curve(curveMonotoneX)(data),
        a: s.area
          ? area<T>()
              .defined((d) => s.value(d) != null)
              .x((d) => xs(x(d) as never))
              .y0(ys(0))
              .y1((d) => ys(s.value(d)!))
              .curve(curveMonotoneX)(data)
          : null,
      })),
    [series, data, x, xs, ys],
  );

  const bis = bisector<T, number>((d) => +x(d)).center;
  const fmtX = xFormat ?? ((v: number | Date) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v)));
  const hd = hi != null ? data[hi] : null;

  return (
    <div ref={ref} className={`relative ${className ?? ""}`} style={{ height }}>
      {width > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={ariaLabel}
          className="block overflow-visible"
          onPointerMove={(e) => {
            const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
            const v = xs.invert(e.clientX - r.left);
            setHi(bis(data, +v));
          }}
          onPointerLeave={() => setHi(null)}
        >
          <defs>
            {paths.map(({ s }) =>
              s.area ? (
                <linearGradient key={s.key} id={`fill-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor={s.color} stopOpacity="0.32" />
                  <stop offset="1" stopColor={s.color} stopOpacity="0" />
                </linearGradient>
              ) : null,
            )}
          </defs>
          {ys.ticks(4).map((v) => (
            <g key={v}>
              <line x1={m.l} x2={width - m.r} y1={ys(v)} y2={ys(v)} stroke="var(--line)" />
              <text x={m.l - 8} y={ys(v)} textAnchor="end" dominantBaseline="middle" className="fill-faint tabular-nums text-[12px]">
                {fmtCompact(v, locale)}
              </text>
            </g>
          ))}
          {(xs.ticks(Math.max(2, Math.floor(width / 90))) as (number | Date)[]).map((v) => (
            <text key={+v} x={xs(v as never)} y={height - 8} textAnchor="middle" className="fill-faint tabular-nums text-[12px]">
              {fmtX(v)}
            </text>
          ))}
          {yLabel && (
            <text x={m.l} y={6} className="fill-faint text-[12px]">
              {yLabel}
            </text>
          )}
          {fadeBefore !== undefined && (
            <rect x={m.l} y={m.t} width={Math.max(0, xs(fadeBefore as never) - m.l)} height={height - m.t - m.b} fill="var(--text)" opacity={0.025} />
          )}
          {markers.map((mk) => (
            <g key={mk.label}>
              <line x1={xs(mk.x as never)} x2={xs(mk.x as never)} y1={m.t - 4} y2={height - m.b} stroke="var(--line-strong)" strokeDasharray="3 4" />
              <text x={xs(mk.x as never) + 6} y={m.t + 6} className="fill-dim text-[12px] font-medium">
                {mk.label}
              </text>
            </g>
          ))}
          {bandPath && (
            <motion.path
              d={bandPath}
              fill={band!.color}
              initial={reduce ? false : { opacity: 0 }}
              animate={{ opacity: 0.2 }}
              transition={{ duration: 1.2, delay: 0.5 }}
            />
          )}
          {paths.map(({ s, d, a }) =>
            s.hidden ? null : (
              <g key={s.key}>
                {a && <motion.path d={a} fill={`url(#fill-${s.key})`} initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 1 }} />}
                <motion.path
                  d={d ?? ""}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={s.width ?? 2}
                  strokeDasharray={s.dashed ? "6 5" : undefined}
                  strokeLinecap={s.dashed ? "butt" : "round"}
                  strokeLinejoin="round"
                  // pathLength draws by rewriting the dash array, so dashed lines only fade in
                  initial={reduce ? false : s.dashed ? { opacity: 0 } : { pathLength: 0, opacity: 0 }}
                  animate={s.dashed ? { opacity: s.opacity ?? 1 } : { pathLength: 1, opacity: s.opacity ?? 1 }}
                  transition={{ duration: s.dashed ? 0.6 : 1.6, ease: [0.65, 0, 0.35, 1] }}
                />
              </g>
            ),
          )}
          {/* after every line, so no line runs over a label */}
          {paths.map(({ s }) =>
            s.hidden || !s.endLabel ? null : <EndLabel key={s.key} data={data} s={s} x={(d) => xs(x(d) as never)} y={ys} />,
          )}
          {hd && (
            <g pointerEvents="none">
              <line x1={xs(x(hd) as never)} x2={xs(x(hd) as never)} y1={m.t} y2={height - m.b} stroke="var(--text)" strokeOpacity={0.25} />
              {series.filter((s) => !s.hidden && s.value(hd) != null).map((s) => (
                <circle key={s.key} cx={xs(x(hd) as never)} cy={ys(s.value(hd)!)} r={4} fill="var(--bg)" stroke={s.color} strokeWidth={2} />
              ))}
            </g>
          )}
        </svg>
      )}
      <ChartTooltip show={!!hd && !noTooltip} x={hd ? xs(x(hd) as never) : 0} y={height / 2} width={width}>
        {hd && (
          <>
            <p className="mb-1 font-medium text-text">{fmtX(x(hd))}</p>
            {series.filter((s) => !s.hidden).map((s) => (
              <TipRow key={s.key} color={s.color} dashed={s.dashed} label={s.label} value={fmtNum(s.value(hd), locale, 0)} />
            ))}
            {band && band.lo(hd) != null && band.lo(hd) !== band.hi(hd) && (
              <TipRow label={band.label} value={`${fmtNum(band.lo(hd), locale)}–${fmtNum(band.hi(hd), locale)}`} />
            )}
          </>
        )}
      </ChartTooltip>
    </div>
  );
}

function EndLabel<T>({ data, s, x, y }: { data: T[]; s: Series<T>; x: (d: T) => number; y: (v: number) => number }) {
  const last = [...data].reverse().find((d) => s.value(d) != null);
  if (!last) return null;
  const right = x(last) - 2;
  const base = y(s.value(last)!) - 9;
  const w = (s.endLabel?.length ?? 0) * 7.6 + 10;
  return (
    <g pointerEvents="none">
      <rect x={right - w + 5} y={base - 14} width={w} height={19} rx={4} fill="var(--panel-solid)" fillOpacity={0.88} />
      <text x={right} y={base} textAnchor="end" className="text-[13px] font-semibold tabular-nums" fill={s.color}>
        {s.endLabel}
      </text>
    </g>
  );
}
