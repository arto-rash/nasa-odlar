"use client";

import { useLocale, useTranslations } from "next-intl";
import { useId, useMemo, useState } from "react";
import { useTheme } from "@/components/layout/theme-toggle";
import { cellState } from "@/lib/calendar-cells";
import { heatScale } from "@/lib/colors";
import { fmtNum, monthShort, weekLabel, weekMonth, type AppLocale } from "@/lib/format";
import type { Anomaly, Coverage, SeasonProfile } from "@/lib/types";
import { useSize } from "@/lib/use-size";
import { cellFill, HatchDefs } from "./cell-style";
import { ChartTooltip, TipRow } from "./tooltip";

export type CellRef = { year: number; week: number };

export function CalendarHeatmap({
  years, matrix, rawMatrix, mode = "harmonized", season, anomalies = [], current, coverage, selected, onCell,
}: {
  years: number[];
  matrix: number[][];
  rawMatrix?: number[][];
  mode?: "harmonized" | "raw";
  season?: SeasonProfile | null;
  anomalies?: Anomaly[];
  current?: { year: number; woy: number } | null;
  coverage?: Coverage;
  selected?: CellRef | null;
  onCell?: (c: CellRef) => void;
}) {
  const t = useTranslations("clock");
  const locale = useLocale() as AppLocale;
  const [theme] = useTheme();
  const hatch = `hatch-${useId().replace(/:/g, "")}`;
  const [ref, { width }] = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<{ yi: number; w: number; x: number; y: number } | null>(null);
  const data = mode === "raw" && rawMatrix ? rawMatrix : matrix;
  const scale = useMemo(() => heatScale(matrix.flat()), [matrix]);
  const states = useMemo(() => years.map((y) => Array.from({ length: 52 }, (_, w) => cellState(y, w, coverage))), [years, coverage]);
  const anomalous = new Set(anomalies.map((a) => a.year));
  const left = 40;
  const top = 22;
  const cw = Math.max(4, (width - left - 8) / 52);
  const ch = Math.max(7, Math.min(14, cw * 0.9));
  const height = top + years.length * ch + 8;
  const hs = hover ? states[hover.yi][hover.w] : "ok";

  return (
    <div ref={ref} className="relative">
      {width > 0 && (
        <svg width={width} height={height} className="block" onPointerLeave={() => setHover(null)}>
          <defs>
            <HatchDefs id={hatch} />
          </defs>
          {Array.from({ length: 12 }, (_, m) => {
            // narrow screens: every other month, so the labels don't run together
            if (cw * 4.33 < 30 && m % 2 === 1) return null;
            const w = Array.from({ length: 52 }, (_, i) => i).find((i) => weekMonth(i) === m) ?? 0;
            return (
              <text key={m} x={left + w * cw} y={12} className="fill-faint text-[12px]">
                {monthShort(m, locale)}
              </text>
            );
          })}
          {season?.critical.slice(0, 3).map((c, i) => {
            const segs = c.end >= c.start ? [[c.start, c.end]] : [[c.start, 51], [0, c.end]];
            return segs.map(([s, e], j) => (
              <rect key={`${i}-${j}`} x={left + s * cw} y={top - 6} width={(e - s + 1) * cw} height={3} rx={1.5} className="fill-ember-400" opacity={i === 0 ? 1 : 0.5} />
            ));
          })}
          {years.map((y, yi) => (
            <g key={y}>
              <text x={left - 8} y={top + yi * ch + ch / 2} textAnchor="end" dominantBaseline="middle" className={`tabular-nums text-[9.5px] ${anomalous.has(y) ? "fill-ember-200" : "fill-faint"}`}>
                {y}
              </text>
              {data[yi].map((v, w) => {
                const st = states[yi][w];
                const sel = selected && selected.year === y && selected.week === w;
                return (
                  <g key={w}>
                    <rect
                      x={left + w * cw + 0.5}
                      y={top + yi * ch + 0.5}
                      width={cw - 1}
                      height={ch - 1}
                      rx={1.5}
                      fill={cellFill(st, v, scale, theme, hatch)}
                      style={{ transition: "fill 600ms var(--ease-out-expo)", cursor: onCell && st !== "future" && st !== "nodata" ? "pointer" : undefined }}
                      stroke={sel ? "var(--ember-200)" : hover && hover.yi === yi && hover.w === w ? "var(--text)" : "none"}
                      strokeWidth={sel ? 1.5 : 1}
                      onPointerEnter={() => setHover({ yi, w, x: left + w * cw + cw / 2, y: top + yi * ch + ch / 2 })}
                      onClick={() => onCell?.({ year: y, week: w })}
                    />
                    {st === "reduced" && (
                      <circle cx={left + w * cw + cw / 2} cy={top + yi * ch + ch / 2} r={Math.min(1.6, ch / 5)} fill="var(--text-faint)" pointerEvents="none" />
                    )}
                  </g>
                );
              })}
            </g>
          ))}
          {current && years.includes(current.year) && (
            <rect
              x={left + current.woy * cw}
              y={top + years.indexOf(current.year) * ch}
              width={cw}
              height={ch}
              fill="none"
              stroke="var(--ember-200)"
              strokeWidth={1.5}
              rx={2}
              pointerEvents="none"
            />
          )}
        </svg>
      )}
      <ChartTooltip show={!!hover} x={hover?.x ?? 0} y={hover?.y ?? 0} width={width}>
        {hover && (
          <>
            <p className="mb-1 font-medium text-text">
              {years[hover.yi]} · {weekLabel(hover.w, locale)}
            </p>
            {hs === "nodata" || hs === "future" ? (
              <p className="text-dim">{hs === "nodata" ? t("noData") : t("future")}</p>
            ) : (
              <>
                <TipRow label={mode === "raw" ? t("raw") : t("harmonized")} value={fmtNum(data[hover.yi][hover.w], locale, 1)} />
                {rawMatrix && mode === "harmonized" && <TipRow label={t("raw")} value={fmtNum(rawMatrix[hover.yi][hover.w], locale, 0)} />}
                {(hs === "reduced" || hs === "partial") && <p className="mt-1 text-dim">{t(hs)}</p>}
              </>
            )}
          </>
        )}
      </ChartTooltip>
    </div>
  );
}
