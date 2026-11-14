"use client";

import { animate, useReducedMotion } from "motion/react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useTheme } from "@/components/layout/theme-toggle";
import { cellState, weekStart, type AheadCells } from "@/lib/calendar-cells";
import { heatScale } from "@/lib/colors";
import { fmtNum, monthShort, weekLabel, type AppLocale } from "@/lib/format";
import type { Anomaly, Coverage, SeasonProfile } from "@/lib/types";
import { useSize } from "@/lib/use-size";
import {
  arcPath, clockLayout, hitTest, polar, ringRadii, sectorPath, TAU, weekAngle, WEEKS, windowAngles,
} from "./fire-clock-geometry";
import type { CellRef } from "./calendar-heatmap";
import { aheadOpacity, cellFill, HatchDefs } from "./cell-style";

interface Props {
  years: number[];
  matrix: number[][];
  rawMatrix?: number[][];
  mode?: "harmonized" | "raw";
  season?: SeasonProfile | null;
  anomalies?: Anomaly[];
  current?: { year: number; woy: number } | null;
  focusYear?: number | null;
  onFocusYear?: (y: number | null) => void;
  coverage?: Coverage;
  selected?: CellRef | null;
  /** with this, a tap picks a week (and the parent decides what that does) */
  onCell?: (c: CellRef) => void;
  /** weeks ahead (by Monday): shown faint in the cells not observed yet */
  ahead?: AheadCells;
  className?: string;
}

export function FireClock({
  years, matrix, rawMatrix, mode = "harmonized", season, anomalies = [], current, focusYear, onFocusYear, coverage, selected, onCell, ahead, className,
}: Props) {
  const t = useTranslations("clock");
  const ta = useTranslations("ahead");
  const locale = useLocale() as AppLocale;
  const [theme] = useTheme();
  const [wrapRef, { width }] = useSize<HTMLDivElement>();
  const size = Math.min(width, 720);
  const L = useMemo(() => clockLayout(size, years.length), [size, years.length]);
  const centre = {
    label: Math.min(12, L.inner * 0.17),
    value: Math.min(Math.max(18, L.inner * 0.42), L.inner * 0.46),
    gap: Math.min(16, L.inner * 0.32),
  };
  const reduce = useReducedMotion();
  const uid = useId().replace(/:/g, "");
  const [hover, setHover] = useState<{ yearIndex: number; week: number } | null>(null);
  const [sweep, setSweep] = useState(reduce ? TAU : 0);
  const started = useRef(false);

  const data = mode === "raw" && rawMatrix ? rawMatrix : matrix;
  // One shared scale so raw and harmonized are visually comparable.
  const scale = useMemo(() => heatScale(matrix.flat()), [matrix]);
  const anomalous = useMemo(() => new Set(anomalies.map((a) => a.year)), [anomalies]);
  const states = useMemo(() => years.map((y) => Array.from({ length: WEEKS }, (_, w) => cellState(y, w, coverage))), [years, coverage]);
  const fcast = useMemo(
    () => years.map((y, yi) => Array.from({ length: WEEKS }, (_, w) => (states[yi][w] === "future" ? ahead?.get(weekStart(y, w)) : undefined))),
    [years, states, ahead],
  );

  const cells = useMemo(() => {
    if (size < 40) return [];
    return years.map((_, yi) => {
      const [r0, r1] = ringRadii(L, yi);
      return Array.from({ length: WEEKS }, (_, w) =>
        sectorPath(L, r0 + 0.35, r1 - 0.35, weekAngle(w) + 0.004, weekAngle(w + 1) - 0.004),
      );
    });
  }, [L, years, size]);

  useEffect(() => {
    if (reduce || size < 40 || started.current) return;
    started.current = true;
    const c = animate(0, TAU, { duration: 1.9, ease: [0.65, 0, 0.35, 1], onUpdate: setSweep });
    return () => c.stop();
  }, [size, reduce]);

  const activeYi = hover?.yearIndex ?? (focusYear != null ? years.indexOf(focusYear) : -1);
  const wedge = sweep >= TAU - 1e-3 ? null : wedgePath(L, sweep);

  const centerYear = hover ? years[hover.yearIndex] : focusYear ?? null;
  const centerVal = hover ? data[hover.yearIndex]?.[hover.week] : centerYear != null ? sum(data[years.indexOf(centerYear)]) : null;
  const curYi = current ? years.indexOf(current.year) : -1;
  const hoverState = hover ? states[hover.yearIndex]?.[hover.week] : undefined;
  const hoverFc = hover ? fcast[hover.yearIndex]?.[hover.week] : undefined;
  const unseen = !hoverFc && (hoverState === "nodata" || hoverState === "future");

  return (
    <div ref={wrapRef} className={className}>
      {size > 40 && (
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          className="mx-auto block touch-none select-none overflow-visible"
          role="img"
          aria-label={t("aria", { from: years[0], to: years[years.length - 1] })}
          onPointerMove={(e) => {
            const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
            const h = hitTest(L, e.clientX - r.left, e.clientY - r.top);
            setHover(h);
          }}
          onPointerLeave={() => setHover(null)}
          onClick={(e) => {
            // taps fire no pointermove first, so hit-test the tap itself
            const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
            const h = hitTest(L, e.clientX - r.left, e.clientY - r.top) ?? hover;
            if (!h) return;
            if (onCell) onCell({ year: years[h.yearIndex], week: h.week });
            else onFocusYear?.(years[h.yearIndex] === focusYear ? null : years[h.yearIndex]);
          }}
          style={{ cursor: onCell || onFocusYear ? "pointer" : undefined }}
        >
          <defs>
            <HatchDefs id={`hatch-${uid}`} />
            <linearGradient id={`win-${uid}`} x1="0" x2="1">
              <stop offset="0" stopColor="var(--ember-200)" />
              <stop offset="1" stopColor="var(--ember-600)" />
            </linearGradient>
            <radialGradient id={`core-${uid}`}>
              <stop offset="0" stopColor="var(--ember-500)" stopOpacity="0.18" />
              <stop offset="1" stopColor="var(--ember-500)" stopOpacity="0" />
            </radialGradient>
            {wedge && (
              <mask id={`sweep-${uid}`}>
                <path d={wedge} fill="white" />
              </mask>
            )}
          </defs>

          <circle cx={L.cx} cy={L.cy} r={L.inner * 0.98} fill={`url(#core-${uid})`} />

          {/* month spokes + labels */}
          {Array.from({ length: 12 }, (_, m) => {
            const a = (m / 12) * TAU;
            const [x0, y0] = polar(L, a, L.inner - 4);
            const [x1, y1] = polar(L, a, L.outer + 6);
            const [lx, ly] = polar(L, a + TAU / 24, L.outer + 24);
            return (
              <g key={m}>
                <line x1={x0} y1={y0} x2={x1} y2={y1} stroke="var(--line)" />
                <text x={lx} y={ly} textAnchor="middle" dominantBaseline="middle" className="fill-faint text-[12px] font-medium">
                  {monthShort(m, locale)}
                </text>
              </g>
            );
          })}

          <g mask={wedge ? `url(#sweep-${uid})` : undefined}>
            {cells.map((row, yi) => (
              <g
                key={years[yi]}
                style={{
                  opacity: activeYi >= 0 && activeYi !== yi ? 0.32 : 1,
                  transition: "opacity 300ms var(--ease-out-expo)",
                }}
              >
                {row.map((d, w) => {
                  const fc = fcast[yi]?.[w];
                  const v = fc ? fc.value : (data[yi]?.[w] ?? 0);
                  const st = states[yi]?.[w] ?? "ok";
                  return (
                    <path
                      key={w}
                      d={d}
                      fill={cellFill(st, v, scale, theme, `hatch-${uid}`)}
                      fillOpacity={st === "reduced" ? 0.45 : aheadOpacity(fc?.kind)}
                      style={{ transition: "fill 700ms var(--ease-out-expo)" }}
                    />
                  );
                })}
              </g>
            ))}
          </g>

          {/* hovered ring outline */}
          {activeYi >= 0 && (
            <g pointerEvents="none">
              <circle cx={L.cx} cy={L.cy} r={ringRadii(L, activeYi)[0]} fill="none" stroke="var(--text)" strokeOpacity={0.5} strokeWidth={0.75} />
              <circle cx={L.cx} cy={L.cy} r={ringRadii(L, activeYi)[1]} fill="none" stroke="var(--text)" strokeOpacity={0.5} strokeWidth={0.75} />
            </g>
          )}

          {/* the picked week */}
          {selected && years.includes(selected.year) && (
            <path
              d={sectorPath(L, ringRadii(L, years.indexOf(selected.year))[0], ringRadii(L, years.indexOf(selected.year))[1], weekAngle(selected.week), weekAngle(selected.week + 1))}
              fill="none"
              stroke="var(--ember-200)"
              strokeWidth={1.75}
              pointerEvents="none"
            />
          )}

          {/* critical windows as ember arcs outside the clock */}
          {season?.critical.slice(0, 3).map((c, i) => {
            const [a0, a1] = windowAngles(c.start, c.end);
            return (
              <path
                key={i}
                d={arcPath(L, L.outer + 9, a0, a1)}
                fill="none"
                stroke={`url(#win-${uid})`}
                strokeWidth={i === 0 ? 4 : 2.5}
                strokeLinecap="round"
                opacity={sweep / TAU}
              />
            );
          })}
          {season?.peaks.slice(0, 2).map((p) => {
            const [x, y] = polar(L, weekAngle(p.week + 0.5), L.outer + 9);
            return (
              <g key={p.week} opacity={sweep / TAU}>
                <circle cx={x} cy={y} r={5.5} fill="var(--bg)" stroke="var(--ember-200)" strokeWidth={1.5} />
                <circle cx={x} cy={y} r={2} fill="var(--ember-100)" />
              </g>
            );
          })}

          {/* anomaly markers at 12 o'clock */}
          {years.map((y, yi) =>
            anomalous.has(y) ? (
              <circle key={y} cx={L.cx - 5} cy={L.cy - (ringRadii(L, yi)[0] + L.ring / 2)} r={Math.max(1.6, L.ring * 0.22)} fill="var(--ember-100)" />
            ) : null,
          )}

          {/* now hand */}
          {current && curYi >= 0 && sweep >= TAU - 1e-3 && (
            <g pointerEvents="none">
              {(() => {
                const a = weekAngle(current.woy + 0.5);
                const [x0, y0] = polar(L, a, L.inner * 0.6);
                const [x1, y1] = polar(L, a, L.outer + 18);
                const [dx, dy] = polar(L, a, ringRadii(L, curYi)[0] + L.ring / 2);
                return (
                  <>
                    <line x1={x0} y1={y0} x2={x1} y2={y1} stroke="var(--text)" strokeOpacity={0.7} strokeWidth={1} strokeDasharray="2 3" />
                    <circle cx={dx} cy={dy} r={5} fill="var(--ember-300)" className="origin-center animate-pulse" />
                    <circle cx={dx} cy={dy} r={2.2} fill="#fff" />
                    <text x={x1} y={y1} dy={-4} textAnchor="middle" className="fill-text text-[12px] font-semibold">
                      {t("now")}
                    </text>
                  </>
                );
              })()}
            </g>
          )}

          {/* year labels on the 12 o'clock axis */}
          {[0, Math.floor(years.length / 2), years.length - 1].map((yi) => (
            <text
              key={yi}
              x={L.cx + 6}
              y={L.cy - (ringRadii(L, yi)[0] + L.ring / 2)}
              dominantBaseline="middle"
              className="fill-faint tabular-nums text-[8.5px]"
            >
              {years[yi]}
            </text>
          ))}

          {/* center readout: sized to stay inside the hole on small clocks */}
          <g pointerEvents="none" textAnchor="middle">
            <text x={L.cx} y={L.cy - centre.gap} className="fill-faint font-semibold" style={{ fontSize: centre.label }}>
              {hover ? `${years[hover.yearIndex]} · ${weekLabel(hover.week, locale)}` : centerYear ?? t("annualMean")}
            </text>
            <text x={L.cx} y={L.cy + centre.value * 0.35} className="font-display fill-text tabular" style={{ fontSize: centre.value }}>
              {hoverFc
                ? `~${fmtNum(hoverFc.value, locale, hoverFc.value < 10 ? 1 : 0)}`
                : unseen
                ? "—"
                : centerVal != null
                ? fmtNum(centerVal, locale, centerVal < 10 ? 1 : 0)
                : fmtNum(season?.annual_mean ?? 0, locale)}
            </text>
            <text x={L.cx} y={L.cy + centre.gap + centre.label * 0.7} className="fill-dim" style={{ fontSize: centre.label }}>
              {hoverFc ? ta(hoverFc.kind === "outlook" ? "forecast" : "usual") : unseen ? t(hoverState === "future" ? "future" : "legendNoData") : hover ? t("detectionsWeek") : t("detectionsYear")}
            </text>
          </g>
        </svg>
      )}
      <table className="sr-only">
        <caption>{t("tableCaption")}</caption>
        <thead>
          <tr>
            <th>{t("year")}</th>
            <th>{t("total")}</th>
          </tr>
        </thead>
        <tbody>
          {years.map((y, i) => (
            <tr key={y}>
              <td>{y}</td>
              <td>{Math.round(sum(data[i]))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function sum(a: number[] | undefined) {
  return (a ?? []).reduce((s, v) => s + v, 0);
}

function wedgePath(L: ReturnType<typeof clockLayout>, angle: number): string {
  if (angle <= 0) return "M0,0";
  const r = L.outer + 40;
  const steps = Math.max(2, Math.ceil((angle / TAU) * 64));
  let d = `M${L.cx},${L.cy}`;
  for (let i = 0; i <= steps; i++) {
    const [x, y] = polar(L, (angle * i) / steps, r);
    d += `L${x.toFixed(1)},${y.toFixed(1)}`;
  }
  return d + "Z";
}
