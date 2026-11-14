// Pure geometry for the radial Fire Clock — unit tested.

export const WEEKS = 52;
export const TAU = Math.PI * 2;

export interface ClockLayout {
  cx: number;
  cy: number;
  inner: number;
  outer: number;
  ring: number;
  nYears: number;
}

export function clockLayout(size: number, nYears: number, innerFrac = 0.3, pad = 46): ClockLayout {
  const outer = Math.max(10, size / 2 - pad);
  const inner = outer * innerFrac;
  return { cx: size / 2, cy: size / 2, inner, outer, ring: (outer - inner) / Math.max(nYears, 1), nYears };
}

/** Angle (radians, clockwise from 12 o'clock) of the start of a week bin. */
export const weekAngle = (w: number) => (w / WEEKS) * TAU;

/** Radii for a year ring; oldest year innermost. */
export function ringRadii(L: ClockLayout, yearIndex: number): [number, number] {
  const r0 = L.inner + yearIndex * L.ring;
  return [r0, r0 + L.ring];
}

/** Cartesian point for a clock angle (0 = up, clockwise) and radius. */
export function polar(L: ClockLayout, angle: number, r: number): [number, number] {
  return [L.cx + r * Math.sin(angle), L.cy - r * Math.cos(angle)];
}

/** Inverse: which (yearIndex, week) is under a pointer, or null. */
export function hitTest(L: ClockLayout, x: number, y: number): { yearIndex: number; week: number } | null {
  const dx = x - L.cx;
  const dy = y - L.cy;
  const r = Math.hypot(dx, dy);
  if (r < L.inner || r >= L.outer) return null;
  let a = Math.atan2(dx, -dy);
  if (a < 0) a += TAU;
  const week = Math.min(WEEKS - 1, Math.floor((a / TAU) * WEEKS));
  const yearIndex = Math.min(L.nYears - 1, Math.floor((r - L.inner) / L.ring));
  return { yearIndex, week };
}

/** SVG path for an annular sector (cell) between radii and angles. */
export function sectorPath(L: ClockLayout, r0: number, r1: number, a0: number, a1: number): string {
  const [x0, y0] = polar(L, a0, r1);
  const [x1, y1] = polar(L, a1, r1);
  const [x2, y2] = polar(L, a1, r0);
  const [x3, y3] = polar(L, a0, r0);
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const f = (n: number) => n.toFixed(2);
  return `M${f(x0)},${f(y0)}A${f(r1)},${f(r1)} 0 ${large} 1 ${f(x1)},${f(y1)}L${f(x2)},${f(y2)}A${f(r0)},${f(r0)} 0 ${large} 0 ${f(x3)},${f(y3)}Z`;
}

/** Arc path along a radius between two angles (for window bands outside the clock). */
export function arcPath(L: ClockLayout, r: number, a0: number, a1: number): string {
  const [x0, y0] = polar(L, a0, r);
  const [x1, y1] = polar(L, a1, r);
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M${x0.toFixed(2)},${y0.toFixed(2)}A${r},${r} 0 ${large} 1 ${x1.toFixed(2)},${y1.toFixed(2)}`;
}

/** Inclusive week window [start, end] that may wrap past week 51 → angles. */
export function windowAngles(start: number, end: number): [number, number] {
  const a0 = weekAngle(start);
  let a1 = weekAngle(end + 1);
  if (a1 <= a0) a1 += TAU;
  return [a0, a1];
}
