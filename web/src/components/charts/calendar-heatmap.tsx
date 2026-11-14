"use client";

import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { useTheme } from "@/components/layout/theme-toggle";
import { heat, heatScale, isActiveWeek } from "@/lib/colors";
import { fmtNum, monthShort, weekLabel, weekMonth, type AppLocale } from "@/lib/format";
import type { Anomaly, SeasonProfile } from "@/lib/types";
import { useSize } from "@/lib/use-size";
import { ChartTooltip, TipRow } from "./tooltip";

export function CalendarHeatmap({
  years, matrix, rawMatrix, mode = "harmonized", season, anomalies = [], current,
}: {
  years: number[];
  matrix: number[][];
  rawMatrix?: number[][];
  mode?: "harmonized" | "raw";
  season?: SeasonProfile | null;
  anomalies?: Anomaly[];
  current?: { year: number; woy: number } | null;
}) {
  const t = useTranslations("clock");
  const locale = useLocale() as AppLocale;
  const [theme] = useTheme();
  const [ref, { width }] = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<{ yi: number; w: number; x: number; y: number } | null>(null);
  const data = mode === "raw" && rawMatrix ? rawMatrix : matrix;
  const scale = useMemo(() => heatScale(matrix.flat()), [matrix]);
  const anomalous = new Set(anomalies.map((a) => a.year));
  const left = 40;
  const top = 22;
  const cw = Math.max(4, (width - left - 8) / 52);
  const ch = Math.max(7, Math.min(14, cw * 0.9));
  const height = top + years.length * ch + 8;

  return (
    <div ref={ref} className="relative">
      {width > 0 && (
        <svg width={width} height={height} className="block" onPointerLeave={() => setHover(null)}>
          {Array.from({ length: 12 }, (_, m) => {
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
              {data[yi].map((v, w) => (
                <rect
                  key={w}
                  x={left + w * cw + 0.5}
                  y={top + yi * ch + 0.5}
                  width={cw - 1}
                  height={ch - 1}
                  rx={1.5}
                  fill={isActiveWeek(v) ? heat(scale(v), theme) : theme === "dark" ? "rgb(255 240 225 / 0.035)" : "rgb(40 25 10 / 0.05)"}
                  style={{ transition: "fill 600ms var(--ease-out-expo)" }}
                  stroke={hover && hover.yi === yi && hover.w === w ? "var(--text)" : "none"}
                  onPointerEnter={() => setHover({ yi, w, x: left + w * cw + cw / 2, y: top + yi * ch + ch / 2 })}
                />
              ))}
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
            <TipRow label={mode === "raw" ? t("raw") : t("harmonized")} value={fmtNum(data[hover.yi][hover.w], locale, 1)} />
            {rawMatrix && mode === "harmonized" && <TipRow label={t("raw")} value={fmtNum(rawMatrix[hover.yi][hover.w], locale, 0)} />}
          </>
        )}
      </ChartTooltip>
    </div>
  );
}
