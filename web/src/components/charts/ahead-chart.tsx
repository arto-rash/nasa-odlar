"use client";

import { scaleLinear, scaleTime } from "d3-scale";
import { area, curveMonotoneX, line } from "d3-shape";
import { useLocale, useTranslations } from "next-intl";
import { useId, useMemo, useState } from "react";
import { fmtDate, fmtNum, type AppLocale } from "@/lib/format";
import type { ForecastPayload, ForecastWeek } from "@/lib/types";
import { useSize } from "@/lib/use-size";
import { ChartTooltip, TipRow } from "./tooltip";

const DAY = 86400000;
const at = (iso: string) => new Date(iso + "T00:00:00Z");
const mid = (w: ForecastWeek) => new Date(at(w.week).getTime() + 3.5 * DAY);

/** One timeline from today to a year ahead: the outlook's likely range for the next
 *  13 weeks against the usual range, then the usual year alone (marked as such). */
export function AheadChart({ f, height = 240, className }: { f: ForecastPayload; height?: number; className?: string }) {
  const t = useTranslations("ahead");
  const locale = useLocale() as AppLocale;
  const hatch = `ahead-hatch-${useId().replace(/:/g, "")}`;
  const [ref, { width }] = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const m = { t: 30, r: 10, b: 26, l: 36 };
  const weeks = f.weeks;
  const outlook = weeks.filter((w) => w.kind === "outlook");
  const start = at(f.as_of);
  const end = new Date(at(weeks[weeks.length - 1].week).getTime() + 7 * DAY);
  const split = new Date(at(weeks[outlook.length - 1]?.week ?? f.as_of).getTime() + 7 * DAY);

  const { xs, ys } = useMemo(() => {
    const top = Math.max(1, ...weeks.map((w) => Math.max(w.q90 ?? 0, w.normal_p90)));
    return {
      xs: scaleTime().domain([start, end]).range([m.l, Math.max(m.l + 1, width - m.r)]),
      ys: scaleLinear().domain([0, top * 1.1]).nice(4).range([height - m.b, m.t]),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weeks, width, height]);

  const paths = useMemo(() => {
    const x = (w: ForecastWeek) => xs(mid(w));
    const usualBand = area<ForecastWeek>().x(x).y0((w) => ys(w.normal_p10)).y1((w) => ys(w.normal_p90)).curve(curveMonotoneX)(weeks) ?? "";
    const usual = line<ForecastWeek>().x(x).y((w) => ys(w.normal)).curve(curveMonotoneX)(weeks) ?? "";
    const likely = area<ForecastWeek>().x(x).y0((w) => ys(w.q10 ?? 0)).y1((w) => ys(w.q90 ?? 0)).curve(curveMonotoneX)(outlook) ?? "";
    const expected = line<ForecastWeek>().x(x).y((w) => ys(w.q50 ?? 0)).curve(curveMonotoneX)(outlook) ?? "";
    return { usualBand, usual, likely, expected };
  }, [weeks, outlook, xs, ys]);

  const months = useMemo(() => xs.ticks(width < 480 ? 4 : 8), [xs, width]);
  const flags = [
    { d: f.season.start, label: t("flagStart") },
    { d: f.season.peak, label: t("flagPeak") },
  ].filter((x): x is { d: string; label: string } => !!x.d && at(x.d) < end);
  const hw = hover != null ? weeks[hover] : null;

  return (
    <div ref={ref} className={className + " relative"}>
      {width > 0 && (
        <svg
          width={width}
          height={height}
          className="block touch-none select-none"
          role="img"
          aria-label={t("title")}
          onPointerMove={(e) => {
            const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
            const d = xs.invert(e.clientX - r.left).getTime();
            const i = weeks.findIndex((w) => d >= at(w.week).getTime() && d < at(w.week).getTime() + 7 * DAY);
            setHover(i >= 0 ? i : null);
          }}
          onPointerLeave={() => setHover(null)}
        >
          <defs>
            <pattern id={hatch} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="6" stroke="var(--line)" strokeWidth="2" />
            </pattern>
          </defs>
          {/* zones */}
          <rect x={xs(split)} y={m.t - 6} width={Math.max(0, xs(end) - xs(split))} height={height - m.b - m.t + 6} fill={`url(#${hatch})`} opacity={0.5} />
          {[split].map((d) => (
            <line key={+d} x1={xs(d)} x2={xs(d)} y1={m.t - 12} y2={height - m.b} stroke="var(--line-strong)" strokeDasharray="3 3" />
          ))}
          {/* narrow: the outlook section is too short for its full label */}
          <text x={xs(start) + 2} y={12} className="fill-ember-300 text-[11px] font-semibold">{xs(split) - xs(start) < 130 ? t("forecast") : t("zoneOutlook")}</text>
          <text x={xs(split) + 6} y={12} className="fill-faint text-[11px] font-semibold">{width < 480 ? t("usual") : t("zoneTypical")}</text>

          {/* y grid */}
          {ys.ticks(4).map((v) => (
            <g key={v}>
              <line x1={m.l} x2={width - m.r} y1={ys(v)} y2={ys(v)} stroke="var(--line)" strokeOpacity={0.6} />
              <text x={m.l - 6} y={ys(v)} dy="0.32em" textAnchor="end" className="fill-faint tabular-nums text-[10.5px]">
                {fmtNum(v, locale, v < 10 && v % 1 ? 1 : 0)}
              </text>
            </g>
          ))}
          {months.map((d) => (
            <text key={+d} x={xs(d)} y={height - 8} textAnchor="middle" className="fill-faint text-[10.5px]">
              {fmtDate(d.toISOString().slice(0, 10), locale, { month: "short", day: undefined, year: d.getUTCMonth() === 0 ? "numeric" : undefined })}
            </text>
          ))}

          {/* usual year */}
          <path d={paths.usualBand} fill="var(--text-faint)" opacity={0.16} />
          <path d={paths.usual} fill="none" stroke="var(--text-faint)" strokeWidth={1.25} strokeDasharray="4 3" />
          {/* outlook */}
          <path d={paths.likely} fill="var(--harmonized)" opacity={0.28} />
          <path d={paths.expected} fill="none" stroke="var(--harmonized)" strokeWidth={2.25} />

          {/* season flags */}
          {flags.map((fl) => (
            <g key={fl.label}>
              <line x1={xs(at(fl.d))} x2={xs(at(fl.d))} y1={m.t} y2={height - m.b} stroke="var(--ember-400)" strokeOpacity={0.6} />
              <circle cx={xs(at(fl.d))} cy={m.t} r={3} fill="var(--ember-400)" />
              <text x={xs(at(fl.d)) + 5} y={m.t + 4} className="fill-ember-300 text-[10.5px] font-medium">{fl.label}</text>
            </g>
          ))}

          {/* today */}
          <line x1={xs(start)} x2={xs(start)} y1={m.t - 12} y2={height - m.b} stroke="var(--text)" strokeOpacity={0.7} />
          <text x={xs(start) + 3} y={height - m.b - 4} className="fill-text text-[10.5px] font-semibold">{t("today")}</text>

          {hw && (
            <line x1={xs(mid(hw))} x2={xs(mid(hw))} y1={m.t} y2={height - m.b} stroke="var(--text)" strokeOpacity={0.35} pointerEvents="none" />
          )}
        </svg>
      )}
      <ChartTooltip show={!!hw} x={hw ? xs(mid(hw)) : 0} y={hw ? ys(Math.max(hw.q50 ?? 0, hw.normal)) : 0} width={width}>
        {hw && (
          <>
            <p className="mb-1 font-medium text-text">
              {fmtDate(hw.week, locale, { day: "numeric", month: "short" })} – {fmtDate(new Date(at(hw.week).getTime() + 6 * DAY).toISOString().slice(0, 10), locale, { day: "numeric", month: "short" })}
            </p>
            {hw.kind === "outlook" ? (
              <>
                <TipRow label={t("forecast")} value={`~${fmtNum(hw.q50, locale, 1)}`} />
                <TipRow label={t("likely")} value={`${fmtNum(hw.q10, locale, 1)}–${fmtNum(hw.q90, locale, 1)}`} />
              </>
            ) : (
              <p className="text-dim">{t("typicalNote")}</p>
            )}
            <TipRow label={t("usual")} value={`~${fmtNum(hw.normal, locale, 1)} (${fmtNum(hw.normal_p10, locale, 1)}–${fmtNum(hw.normal_p90, locale, 1)})`} />
          </>
        )}
      </ChartTooltip>
    </div>
  );
}
