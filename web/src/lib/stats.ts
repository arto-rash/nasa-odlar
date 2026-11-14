/** Theil–Sen slope and intercept (median of pairwise slopes). */
export function theilSen(xs: number[], ys: number[]): { slope: number; intercept: number } {
  const slopes: number[] = [];
  for (let i = 0; i < xs.length; i++)
    for (let j = i + 1; j < xs.length; j++) if (xs[j] !== xs[i]) slopes.push((ys[j] - ys[i]) / (xs[j] - xs[i]));
  const med = (a: number[]) => {
    if (!a.length) return 0;
    const s = [...a].sort((p, q) => p - q);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  const slope = med(slopes);
  const intercept = med(ys.map((y, i) => y - slope * xs[i]));
  return { slope, intercept };
}

export function pctPerDecade(xs: number[], ys: number[]): number {
  const { slope } = theilSen(xs, ys);
  const mean = ys.reduce((s, v) => s + v, 0) / Math.max(ys.length, 1);
  return mean ? (slope * 10) / mean : 0;
}
