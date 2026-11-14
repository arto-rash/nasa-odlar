"use client";

import { animate, useMotionValue, useReducedMotion } from "motion/react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { RISK_COLOR } from "@/lib/colors";
import { fmtPct, type AppLocale } from "@/lib/format";
import { RISK_LEVELS, type RiskLevel } from "@/lib/types";

const CUTS = [0, 0.2, 0.4, 0.6, 0.8, 1];

/** Semicircular gauge; the needle springs to the calibrated probability. */
export function RiskDial({ probability, level, size = 300 }: { probability: number; level: RiskLevel; size?: number }) {
  const t = useTranslations("levels");
  const locale = useLocale() as AppLocale;
  const reduce = useReducedMotion();
  const w = size;
  const h = size * 0.62;
  const cx = w / 2;
  const cy = h - 10;
  const r = w / 2 - 18;
  const p = useMotionValue(reduce ? probability : 0);
  const [animated, setAnimated] = useState(0);
  useEffect(() => {
    if (reduce) return;
    const c = animate(p, probability, { type: "spring", stiffness: 60, damping: 11, mass: 1.2, onUpdate: setAnimated });
    return () => c.stop();
  }, [probability, p, reduce]);
  const shown = reduce ? probability : animated;
  const pt = (frac: number, rr: number) => {
    const a = Math.PI * (1 - frac);
    return [cx + rr * Math.cos(a), cy - rr * Math.sin(a)];
  };
  const seg = (a: number, b: number, rr: number) => {
    const [x0, y0] = pt(a, rr);
    const [x1, y1] = pt(b, rr);
    return `M${x0},${y0}A${rr},${rr} 0 0 1 ${x1},${y1}`;
  };
  return (
    <div className="relative" style={{ width: w }}>
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="overflow-visible" role="img" aria-label={`${t(level)} ${fmtPct(probability, locale)}`}>
        <defs>
          <filter id="dial-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="6" />
          </filter>
        </defs>
        {RISK_LEVELS.map((lv, i) => (
          <path key={lv} d={seg(CUTS[i] + 0.006, CUTS[i + 1] - 0.006, r)} stroke={RISK_COLOR[lv]} strokeWidth={14} fill="none" strokeLinecap="butt" opacity={lv === level ? 1 : 0.28} style={{ transition: "opacity 600ms" }} />
        ))}
        <path d={seg(CUTS[RISK_LEVELS.indexOf(level)] + 0.006, CUTS[RISK_LEVELS.indexOf(level) + 1] - 0.006, r)} stroke={RISK_COLOR[level]} strokeWidth={14} fill="none" filter="url(#dial-glow)" opacity={0.65} />
        {Array.from({ length: 21 }, (_, i) => {
          const [x0, y0] = pt(i / 20, r - 14);
          const [x1, y1] = pt(i / 20, r - (i % 5 === 0 ? 24 : 19));
          return <line key={i} x1={x0} y1={y0} x2={x1} y2={y1} stroke="var(--line-strong)" strokeWidth={i % 5 === 0 ? 1.5 : 1} />;
        })}
        <g transform={`rotate(${-90 + Math.max(0, Math.min(1, shown)) * 180} ${cx} ${cy})`}>
          <path d={`M${cx - 4},${cy} L${cx},${cy - r + 26} L${cx + 4},${cy} Z`} fill="var(--text)" />
        </g>
        <circle cx={cx} cy={cy} r={9} fill="var(--bg)" stroke="var(--text)" strokeWidth={2} />
      </svg>
      <div className="-mt-1 text-center">
        <p className="font-display tabular text-[2.6rem] leading-none" style={{ color: RISK_COLOR[level] }}>
          {fmtPct(shown, locale)}
        </p>
        <p className="mt-1 text-[13px] font-semibold text-dim">{t(level)}</p>
      </div>
    </div>
  );
}
