"use client";

import { scaleLinear } from "d3-scale";
import { line } from "d3-shape";
import { motion } from "motion/react";
import type { ModelEval } from "@/lib/types";
import { useSize } from "@/lib/use-size";

export function Reliability({ model, base, labels }: { model: ModelEval["reliability"]; base: ModelEval["reliability"]; labels: { model: string; base: string; predicted: string; observed: string } }) {
  const [ref, { width }] = useSize<HTMLDivElement>();
  const size = Math.min(width, 360);
  const m = 36;
  const s = scaleLinear().domain([0, 1]).range([m, size - 10]);
  const y = scaleLinear().domain([0, 1]).range([size - m, 10]);
  const path = (d: ModelEval["reliability"]) => line<(typeof d)[number]>().x((p) => s(p.predicted)).y((p) => y(p.observed))(d) ?? "";
  return (
    <div ref={ref}>
      {size > 0 && (
        <svg width={size} height={size} role="img" aria-label="Reliability diagram">
          {[0, 0.25, 0.5, 0.75, 1].map((v) => (
            <g key={v}>
              <line x1={s(0)} x2={s(1)} y1={y(v)} y2={y(v)} stroke="var(--line)" />
              <text x={m - 6} y={y(v)} textAnchor="end" dominantBaseline="middle" className="fill-faint tabular-nums text-[12px]">{v}</text>
              <text x={s(v)} y={size - m + 14} textAnchor="middle" className="fill-faint tabular-nums text-[12px]">{v}</text>
            </g>
          ))}
          <line x1={s(0)} y1={y(0)} x2={s(1)} y2={y(1)} stroke="var(--line-strong)" strokeDasharray="4 4" />
          <path d={path(base)} fill="none" stroke="var(--text-faint)" strokeWidth={1.5} />
          <motion.path d={path(model)} fill="none" stroke="var(--harmonized)" strokeWidth={2.5} initial={{ pathLength: 0 }} whileInView={{ pathLength: 1 }} viewport={{ once: true }} transition={{ duration: 1.4 }} />
          {model.map((p) => (
            <circle key={p.bin} cx={s(p.predicted)} cy={y(p.observed)} r={Math.max(2.5, Math.min(7, Math.sqrt(p.n) / 12))} fill="var(--harmonized)" fillOpacity={0.6} />
          ))}
          <text x={s(1)} y={size - 4} textAnchor="end" className="fill-faint text-[12px]">{labels.predicted}</text>
          <text x={m} y={8} className="fill-faint text-[12px]">{labels.observed}</text>
        </svg>
      )}
      <div className="mt-2 flex gap-4 text-[13px] text-dim">
        <span className="inline-flex items-center gap-2"><span className="h-0.5 w-4 bg-harmonized" />{labels.model}</span>
        <span className="inline-flex items-center gap-2"><span className="h-0.5 w-4 bg-faint" />{labels.base}</span>
      </div>
    </div>
  );
}
