"use client";

import { scaleLinear } from "d3-scale";
import { area, curveMonotoneX, line } from "d3-shape";
import { ChevronDown, Pause, Play } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useRef } from "react";
import { cn } from "@/lib/cn";
import { fmtDate, type AppLocale } from "@/lib/format";
import type { TimelinePoint } from "@/lib/types";
import { useSize } from "@/lib/use-size";

export function Timeline({
  points, index, onIndex, playing, onPlay, speed, onSpeed, open = true, onOpen, future = 0,
}: {
  points: TimelinePoint[];
  /** the last ``future`` points are forecast weeks: drawn as their own end section */
  future?: number;
  index: number;
  onIndex: (i: number) => void;
  playing: boolean;
  onPlay: (p: boolean) => void;
  speed: number;
  onSpeed: (s: number) => void;
  /** folded: just play, the date and a button to unfold (phones start folded) */
  open?: boolean;
  onOpen?: (open: boolean) => void;
}) {
  const t = useTranslations("explore");
  const locale = useLocale() as AppLocale;
  const [ref, { width }] = useSize<HTMLDivElement>();
  const h = width > 0 && width < 420 ? 44 : 64; // shorter chart on phones
  const dragging = useRef(false);
  // The forecast weeks get a fixed share of the width, so a few weeks after 25
  // years of record are still easy to find and grab.
  const past = points.length - future;
  const xs = useMemo(() => {
    const w = Math.max(width, 1);
    return future > 0
      ? scaleLinear().domain([0, Math.max(past - 1, 1), Math.max(points.length - 1, 2)]).range([0, w * 0.86, w]).clamp(true)
      : scaleLinear().domain([0, Math.max(points.length - 1, 1)]).range([0, w]);
  }, [points.length, past, future, width]);
  const max = useMemo(() => Math.max(...points.map((p) => Math.max(p.viirs, p.harmonized, p.modis)), 1), [points]);
  const ys = scaleLinear().domain([0, Math.sqrt(max)]).range([h, 4]);
  const fold = onOpen && (
    <button
      type="button"
      onClick={() => onOpen(!open)}
      aria-expanded={open}
      aria-label={t(open ? "hidePanel" : "showPanel", { name: t("timeline") })}
      className="grid size-8 shrink-0 place-items-center rounded-full text-dim transition hover:bg-panel-hover hover:text-text"
    >
      <ChevronDown className={cn("size-4 transition-transform", !open && "rotate-180")} />
    </button>
  );
  const y = (v: number) => ys(Math.sqrt(Math.max(v, 0)));
  const paths = useMemo(() => {
    const idx = points.slice(0, past).map((_, i) => i);
    const a = (k: keyof TimelinePoint) =>
      area<number>().x((i) => xs(i)).y0(h).y1((i) => y(points[i][k] as number)).curve(curveMonotoneX)(idx) ?? "";
    return {
      viirs: a("viirs"),
      modis: a("modis"),
      harm: line<number>().x((i) => xs(i)).y((i) => y(points[i].harmonized)).curve(curveMonotoneX)(idx) ?? "",
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, xs, h, past]);
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
  const inFuture = future > 0 && index >= past;
  const play = (
    <button
      type="button"
      onClick={() => onPlay(!playing)}
      aria-label={playing ? t("pause") : t("play")}
      className="grid size-10 shrink-0 place-items-center rounded-full bg-text text-bg transition hover:scale-105 active:scale-95 sm:size-12"
    >
      {playing ? <Pause className="size-4 sm:size-5" /> : <Play className="ml-0.5 size-4 sm:size-5" />}
    </button>
  );
  const date = (
    <div className="shrink-0">
      <p className={cn("text-[12px] font-semibold", inFuture ? "text-ember-300" : "text-faint")}>{inFuture ? t("forecastChip") : t("weekShort")}</p>
      <p className="font-display tabular text-[1rem] leading-tight sm:text-[1.15rem]">
        {cur ? fmtDate(cur.week, locale, { day: "numeric", month: "short", year: "numeric" }) : "–"}
      </p>
    </div>
  );

  if (!open) {
    return (
      <div className="glass inline-flex items-center gap-3 rounded-lg p-2 pr-2">
        {play}
        {date}
        {fold}
      </div>
    );
  }

  return (
    <div className="glass flex items-center gap-2.5 rounded-lg p-2 pr-2 sm:gap-4 sm:p-2.5 sm:pr-3">
      {play}
      <div className="hidden w-[118px] sm:block">{date}</div>
      <div
        ref={ref}
        role="slider"
        tabIndex={0}
        aria-label={t("timelineAria")}
        aria-valuemin={0}
        aria-valuemax={points.length - 1}
        aria-valuenow={index}
        aria-valuetext={cur?.week}
        className="relative min-w-0 flex-1 cursor-ew-resize touch-none select-none outline-none"
        style={{ height: h }}
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
            {years.filter((d) => d.y % (width < 420 ? 10 : width < 640 ? 5 : 2) === 0).map((d) => (
              <g key={d.y}>
                <line x1={xs(d.i)} x2={xs(d.i)} y1={0} y2={h} stroke="var(--line)" />
                <text x={xs(d.i) + 3} y={10} className="fill-faint tabular-nums text-[12px]">
                  {d.y}
                </text>
              </g>
            ))}
            {future > 0 && (
              <g>
                <defs>
                  <pattern id="tl-future" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                    <line x1="0" y1="0" x2="0" y2="6" stroke="var(--ember-400)" strokeWidth="1.5" opacity={0.35} />
                  </pattern>
                </defs>
                <rect x={xs(past - 0.5)} y={0} width={Math.max(0, width - xs(past - 0.5))} height={h} fill="url(#tl-future)" rx={4} />
                <line x1={xs(past - 0.5)} x2={xs(past - 0.5)} y1={0} y2={h} stroke="var(--ember-400)" strokeDasharray="3 3" />
                <text x={xs(past - 0.5) + 4} y={10} className="fill-ember-300 text-[11px] font-semibold">{t("forecastChip")}</text>
              </g>
            )}
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
      {fold}
    </div>
  );
}
