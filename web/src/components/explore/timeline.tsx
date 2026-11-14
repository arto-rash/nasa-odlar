"use client";

import { scaleLinear } from "d3-scale";
import { area, curveMonotoneX, line } from "d3-shape";
import { Pause, Play } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useRef } from "react";
import { cn } from "@/lib/cn";
import { fmtDate, type AppLocale } from "@/lib/format";
import type { TimelinePoint } from "@/lib/types";
import { useSize } from "@/lib/use-size";

export function Timeline({
  points, index, onIndex, playing, onPlay, speed, onSpeed,
}: {
  points: TimelinePoint[];
  index: number;
  onIndex: (i: number) => void;
  playing: boolean;
  onPlay: (p: boolean) => void;
  speed: number;
  onSpeed: (s: number) => void;
}) {
  const t = useTranslations("explore");
  const locale = useLocale() as AppLocale;
  const [ref, { width }] = useSize<HTMLDivElement>();
  const h = 64;
  const dragging = useRef(false);
  const xs = useMemo(() => scaleLinear().domain([0, Math.max(points.length - 1, 1)]).range([0, Math.max(width, 1)]), [points.length, width]);
  const max = useMemo(() => Math.max(...points.map((p) => Math.max(p.viirs, p.harmonized, p.modis)), 1), [points]);
  const ys = scaleLinear().domain([0, Math.sqrt(max)]).range([h, 4]);
  const y = (v: number) => ys(Math.sqrt(Math.max(v, 0)));
  const paths = useMemo(() => {
    const idx = points.map((_, i) => i);
    const a = (k: keyof TimelinePoint) =>
      area<number>().x((i) => xs(i)).y0(h).y1((i) => y(points[i][k] as number)).curve(curveMonotoneX)(idx) ?? "";
    return {
      viirs: a("viirs"),
      modis: a("modis"),
      harm: line<number>().x((i) => xs(i)).y((i) => y(points[i].harmonized)).curve(curveMonotoneX)(idx) ?? "",
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, xs]);
  const years = useMemo(() => {
    const out: { i: number; y: number }[] = [];
    points.forEach((p, i) => {
      const yr = +p.week.slice(0, 4);
      if (i === 0 || +points[i - 1].week.slice(0, 4) !== yr) out.push({ i, y: yr });
    });
    return out;
  }, [points]);

  const setFromPointer = (clientX: number, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    onIndex(Math.max(0, Math.min(points.length - 1, Math.round(xs.invert(clientX - r.left)))));
  };
  const cur = points[index];

  return (
    <div className="glass flex items-center gap-3 rounded-lg p-2.5 pr-4 sm:gap-4">
      <button
        type="button"
        onClick={() => onPlay(!playing)}
        aria-label={playing ? t("pause") : t("play")}
        className="grid size-12 shrink-0 place-items-center rounded-full bg-text text-bg transition hover:scale-105 active:scale-95"
      >
        {playing ? <Pause className="size-5" /> : <Play className="ml-0.5 size-5" />}
      </button>
      <div className="w-[118px] shrink-0">
        <p className="text-[12px] font-semibold text-faint">{t("weekShort")}</p>
        <p className="font-display tabular text-[1.15rem] leading-tight">
          {cur ? fmtDate(cur.week, locale, { day: "numeric", month: "short", year: "numeric" }) : "—"}
        </p>
      </div>
      <div
        ref={ref}
        role="slider"
        tabIndex={0}
        aria-label={t("timelineAria")}
        aria-valuemin={0}
        aria-valuemax={points.length - 1}
        aria-valuenow={index}
        aria-valuetext={cur?.week}
        className="relative h-[64px] min-w-0 flex-1 cursor-ew-resize touch-none select-none outline-none"
        onPointerDown={(e) => {
          dragging.current = true;
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          setFromPointer(e.clientX, e.currentTarget);
        }}
        onPointerMove={(e) => dragging.current && setFromPointer(e.clientX, e.currentTarget)}
        onPointerUp={() => (dragging.current = false)}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") onIndex(Math.min(points.length - 1, index + (e.shiftKey ? 52 : 1)));
          if (e.key === "ArrowLeft") onIndex(Math.max(0, index - (e.shiftKey ? 52 : 1)));
        }}
      >
        {width > 0 && (
          <svg width={width} height={h} className="absolute inset-0 overflow-visible">
            {years.filter((d) => d.y % (width < 640 ? 5 : 2) === 0).map((d) => (
              <g key={d.y}>
                <line x1={xs(d.i)} x2={xs(d.i)} y1={0} y2={h} stroke="var(--line)" />
                <text x={xs(d.i) + 3} y={10} className="fill-faint tabular-nums text-[12px]">
                  {d.y}
                </text>
              </g>
            ))}
            <path d={paths.modis} fill="var(--modis)" opacity={0.45} />
            <path d={paths.viirs} fill="var(--viirs)" opacity={0.3} />
            <path d={paths.harm} fill="none" stroke="var(--harmonized)" strokeWidth={1.25} />
            {/* played region */}
            <rect x={0} y={0} width={xs(index)} height={h} fill="var(--bg)" opacity={0.0} />
            <g transform={`translate(${xs(index)},0)`}>
              <line y1={-6} y2={h + 2} stroke="var(--text)" strokeWidth={1.5} />
              <circle cy={-6} r={5} fill="var(--text)" />
              <circle cy={-6} r={9} fill="var(--text)" opacity={0.15} />
            </g>
          </svg>
        )}
      </div>
      <div className="hidden flex-col gap-1 sm:flex">
        {[1, 2, 4].map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onSpeed(s)}
            className={cn("h-5 rounded-md px-1.5 tabular-nums text-[12px] transition", speed === s ? "bg-text text-bg" : "text-faint hover:text-text")}
            aria-label={`${t("speed")} ${s}×`}
          >
            {s}×
          </button>
        ))}
      </div>
    </div>
  );
}
