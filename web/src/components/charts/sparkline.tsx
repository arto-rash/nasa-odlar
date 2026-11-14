import { area, curveMonotoneX, line } from "d3-shape";
import { scaleLinear } from "d3-scale";

export function Sparkline({ values, width = 120, height = 32, color = "var(--harmonized)", splitAt }: { values: number[]; width?: number; height?: number; color?: string; splitAt?: number }) {
  if (!values.length) return null;
  const xs = scaleLinear().domain([0, values.length - 1]).range([1, width - 1]);
  const ys = scaleLinear().domain([0, Math.max(...values, 1)]).range([height - 2, 2]);
  const idx = values.map((_, i) => i);
  const d = line<number>().x(xs).y((i) => ys(values[i])).curve(curveMonotoneX)(idx) ?? "";
  const a = area<number>().x(xs).y0(height).y1((i) => ys(values[i])).curve(curveMonotoneX)(idx) ?? "";
  const gid = `sp-${Math.round(values.reduce((s, v) => s + v, 0))}-${values.length}`;
  return (
    <svg width={width} height={height} className="block overflow-visible" aria-hidden>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity={0.35} />
          <stop offset="1" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={a} fill={`url(#${gid})`} />
      <path d={d} fill="none" stroke={color} strokeWidth={1.5} />
      {splitAt !== undefined && <line x1={xs(splitAt)} x2={xs(splitAt)} y1={0} y2={height} stroke="var(--line-strong)" strokeDasharray="2 2" />}
    </svg>
  );
}
