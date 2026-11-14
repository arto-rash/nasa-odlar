import { interpolateRgbBasis } from "d3-interpolate";
import type { RiskLevel } from "./types";

export const RISK_COLOR: Record<RiskLevel, string> = {
  low: "var(--risk-low)",
  moderate: "var(--risk-moderate)",
  high: "var(--risk-high)",
  very_high: "var(--risk-very_high)",
  extreme: "var(--risk-extreme)",
};

// Literal hex values for canvas/WebGL, where CSS variables are not available.
export const RISK_HEX: Record<RiskLevel, string> = {
  low: "#7fb38a",
  moderate: "#e3c35b",
  high: "#f39a45",
  very_high: "#eb5a3c",
  extreme: "#e0213f",
};

export const SENSOR_HEX = { modis: "#e9b44c", viirs: "#62d9e0", harmonized: "#ff7a3d" };
/** Same sensors, darkened to stay readable on the light basemap (matches --modis/--viirs in light mode). */
export const SENSOR_HEX_LIGHT = { modis: "#b07a10", viirs: "#0f8a93", harmonized: "#d9481c" };

/** Fire heat ramp: soot → crimson → ember → white-hot. */
const HEAT_DARK = ["#1b1411", "#3d1218", "#7a1526", "#c22b2a", "#f0592a", "#ff9a3d", "#ffd07a", "#fff3d6"];
const HEAT_LIGHT = ["#efe6da", "#f3c9a6", "#ef9a6a", "#e2623c", "#c93a25", "#9c1f25", "#621222", "#2e0a12"];

export const heatDark = interpolateRgbBasis(HEAT_DARK);
export const heatLight = interpolateRgbBasis(HEAT_LIGHT);

export function heat(t: number, theme: "dark" | "light" = "dark"): string {
  const v = Math.max(0, Math.min(1, t));
  return theme === "dark" ? heatDark(v) : heatLight(v);
}

/** Perceptual scaling for zero-heavy counts: sqrt relative to a robust maximum. */
export function heatScale(values: number[]): (v: number) => number {
  const sorted = values.filter((v) => v > 0).sort((a, b) => a - b);
  const p98 = sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.98))] : 1;
  const max = Math.max(p98, 1e-6);
  return (v) => (v <= 0 ? 0 : Math.min(1, Math.sqrt(v / max)));
}
