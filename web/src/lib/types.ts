// Shapes returned by the ODLAR API (Laravel gateway → FastAPI analytics).

export type RiskLevel = "low" | "moderate" | "high" | "very_high" | "extreme";
export const RISK_LEVELS: RiskLevel[] = ["low", "moderate", "high", "very_high", "extreme"];

export interface RegionRef {
  id: number;
  slug: string;
  name_en: string;
  name_az: string;
  country: string; // ISO 3166-1 alpha-2, lower case ("az", "ge", "tr", ...)
  /** The country's name. A big country's states are "country"-level parents too, so
   *  a country's own name comes from here, not from a region row. */
  country_name_en?: string;
  country_name_az?: string;
  /** For the local units of a split country: their state ("Michigan"). */
  state_name_en?: string;
  state_name_az?: string;
  level: "country" | "district" | "province";
  kind?: string;
  parent_id?: number | null;
  area_km2?: number;
  lat?: number;
  lon?: number;
}

export interface RiskSummary {
  probability: number;
  level: RiskLevel;
  expected7: number;
  max_level?: RiskLevel;
}

export interface Region extends RegionRef {
  risk: RiskSummary | null;
  annual?: number[];
  annual_mean?: number | null;
  density?: number | null;
  trend_pct?: number;
}

export interface Trend {
  slope: number;
  intercept: number | null;
  pct_per_decade: number;
  p_value: number;
  significant: boolean;
  slope_lo?: number;
  slope_hi?: number;
}

export interface Peak {
  week: number;
  value: number;
  prominence: number;
  share: number;
}

export interface Window {
  start: number;
  end: number;
  weeks: number;
  share: number;
}

export interface SeasonProfile {
  offset: number;
  start: number | null;
  end: number | null;
  length: number | null;
  peak_week: number | null;
  peaks: Peak[];
  critical: Window[];
  bimodal: boolean;
  annual_mean: number;
}

export interface AnomalyReason {
  code: "high_total" | "low_total" | "intense_peak" | "early_start" | "late_start" | "late_end" | "early_end";
  value: number;
}

export interface Anomaly {
  year: number;
  total: number;
  z_total: number;
  reasons: AnomalyReason[];
}

export interface CurrentStatus {
  as_of: string;
  year: number;
  woy: number;
  week_value: number;
  week_percentile: number | null;
  week_median: number | null;
  ytd: number;
  ytd_percentile: number | null;
  ytd_median: number | null;
  ytd_rank: number | null;
  n_years: number;
}

export interface RegionDetail extends Region {
  children: RegionRef[];
  parent?: RegionRef;
  stats: {
    annual_mean: number | null;
    annual_mean_raw_modis: number | null;
    annual_mean_raw_viirs: number | null;
    record_year: number | null;
    record_value: number | null;
    density: number | null;
    detections_total: number;
    trend: Trend;
    trend_naive: Trend;
  };
  season: SeasonProfile | null;
  current: CurrentStatus | null;
  anomalies: Anomaly[];
}

export interface Climatology {
  mean: number[];
  median: number[];
  p10: number[];
  p25: number[];
  p75: number[];
  p90: number[];
  smooth: number[];
}

export interface YearMetric {
  year: number;
  total: number;
  peak_value: number;
  peak_week: number | null;
  start: number | null;
  end: number | null;
  z_total: number;
  anomalous: boolean;
  ratio_total: number | null;
}

export interface CalendarPayload {
  region: RegionRef;
  years: number[];
  matrix: number[][];
  raw_matrix?: number[][];
  climatology: Climatology;
  season: SeasonProfile;
  year_metrics: YearMetric[];
  anomalies: Anomaly[];
  current: CurrentStatus;
  coverage?: Coverage;
}

/** When the record has observations (global): weeks are Mondays, `end` is the data end. */
export interface Coverage {
  start: string;
  end: string;
  viirs_start: string | null;
  gaps: { week: string; level: "none" | "reduced" }[];
}

export interface WeeklyPoint {
  week: string;
  modis: number;
  viirs: number;
  viirs_n: number;
  naive: number;
  harmonized: number;
  lo: number;
  hi: number;
  method: "terra" | "terra_aqua" | "viirs_snpp";
}

export interface AnnualPoint {
  year: number;
  harmonized: number;
  lo: number;
  hi: number;
  modis: number;
  viirs: number;
  viirs_n: number;
  naive: number;
  partial: boolean;
}

export interface AnnualSeries {
  years: AnnualPoint[];
  trend: { harmonized: Trend; naive: Trend; modis: Trend };
}

export type DriverCode =
  | "dry_spell" | "no_rain_ahead" | "dry_month" | "wind" | "heat" | "low_humidity" | "high_vpd"
  | "seasonal_peak" | "recent_fires" | "active_season" | "vegetation";

export interface Driver {
  code: DriverCode;
  impact: number;
  direction: "up" | "down";
  value: number | null;
}

export interface RiskDetail {
  region: RegionRef;
  as_of: string;
  forecast_source: string;
  short: {
    probability: number;
    level: RiskLevel;
    expected7: number;
    threshold7: number | null;
    normal7: number | null;
    recent7: number | null;
    drivers: Driver[];
    hotspots?: { slug: string; probability: number; level: RiskLevel }[];
  };
  daily: { date: string; danger: number; tmax: number; rh: number; wind: number; precip: number }[];
  outlook: {
    weeks: number;
    q10: number;
    q50: number;
    q90: number;
    normal: number;
    normal_p10: number;
    normal_p90: number;
    signal: "above" | "below" | "normal";
  };
  history: { date: string; probability: number; actual7: number | null; threshold7: number; fires: number }[];
}

/** One week on the forecast timeline: the outlook (13 weeks) or, after it, the usual year. */
export interface ForecastWeek {
  week: string; // Monday
  woy: number;
  kind: "outlook" | "typical";
  q10: number | null;
  q50: number | null;
  q90: number | null;
  normal: number;
  normal_p10: number;
  normal_p90: number;
}

export interface ForecastPayload {
  region: RegionRef;
  as_of: string;
  forecast_source: string | null;
  days: RiskDetail["daily"];
  week: RiskDetail["short"];
  outlook: RiskDetail["outlook"];
  weeks: ForecastWeek[];
  season: { start: string | null; peak: string | null; end: string | null };
  reliability: {
    week_auc: number | null;
    week_auc_season: number | null;
    outlook_coverage80: number | null;
    outlook_coverage80_season: number | null;
    outlook_skill: number | null;
    test_years: number;
  };
}

/** A fire of the last two weeks: detections grouped by place and day. */
export interface FireEvent {
  id: string;
  lat: number;
  lon: number;
  bbox: [number, number, number, number];
  first_seen: string;
  last_seen: string;
  days: number;
  detections: number;
  modis: number;
  viirs: number;
  frp_max: number | null;
  frp_sum: number | null;
  active: boolean;
  /** the region holding most of its detections */
  region: { slug: string; name_en: string; name_az: string; country: string; country_name_en?: string; country_name_az?: string; state_name_en?: string; state_name_az?: string } | null;
}

export interface FireEventDetail extends FireEvent {
  per_day: { date: string; modis: number; viirs: number }[];
  points: [lon: number, lat: number, sensor: "M" | "V", frp: number, date: string][];
}

/** Expected and usual detections per region for one week ahead. */
export interface ForecastMap {
  week: string;
  values: [id: number, expected: number, usual: number, areaKm2: number][];
}

export interface RiskMapItem {
  id: number;
  slug: string;
  name_en: string;
  name_az: string;
  country: string;
  country_name_en?: string;
  country_name_az?: string;
  state_name_en?: string;
  state_name_az?: string;
  probability: number;
  level: RiskLevel;
  expected7: number;
  driver: DriverCode | null;
}

export interface Overview {
  meta: Meta;
  pilot: { year: number; harmonized: number; lo: number; hi: number; modis: number; viirs: number; naive: number }[];
  skill: {
    bias: number;
    raw_modis_bias: number;
    annual_spearman: number;
    weekly_interval_coverage: number;
    annual_interval_coverage: number;
    annual_median_rel_error: number;
    n_years: number;
  };
  synthetic_truth: { bias: number; weekly_coverage: number } | null;
  model: { harmonized: ModelScore; raw: ModelScore };
  risk_top: RiskMapItem[];
  risk_counts: Partial<Record<RiskLevel, number>>;
  n_regions: number;
  countries?: string[];
  country_names?: Record<string, { en: string; az: string }>;
}

export interface Meta {
  source: "synthetic" | "firms";
  weather_source: string;
  forecast_source: string;
  ndvi_source: string;
  data_start: string;
  data_end: string;
  built_at: string;
  n_hotspots: number;
  n_boot: number;
  overlap_start: string;
  by_satellite: Record<string, number>;
}

export interface ModelScore {
  roc_auc: number;
  pr_auc: number;
  brier: number;
  brier_skill: number;
  base_roc_auc: number;
  base_pr_auc: number;
  base_brier: number;
  event_rate: number;
  n: number;
}

export interface ModelReport {
  harmonized: ModelEval;
  raw: ModelEval;
  importance: { feature: string; gain: number }[];
}

export interface ModelEval {
  overall: ModelScore;
  by_year: (ModelScore & { year: number })[];
  reliability: { bin: number; predicted: number; observed: number; n: number }[];
  reliability_base: { bin: number; predicted: number; observed: number; n: number }[];
  outlook: { pinball_skill: number | null; coverage80: number | null; coverage80_clim: number | null };
}

export interface Skill {
  n_years: number;
  n_region_weeks: number;
  bias: number;
  raw_modis_bias: number;
  weekly_mae: number;
  weekly_spearman: number;
  annual_spearman: number;
  annual_median_rel_error: number;
  weekly_interval_coverage: number;
  annual_interval_coverage: number;
  by_year: { year: number; obs_total: number; pred_total: number; modis_total: number; bias: number }[];
  synthetic_truth?: { bias: number; weekly_coverage: number; by_year: { year: number; harmonized: number; viirs_cf: number }[] };
  transfer?: { region_id: number; season: string; source: string; q: number; modis: number; viirs: number }[];
  loyo_annual?: { year: number; obs: number; pred: number; modis: number; lo?: number; hi?: number }[];
}

export interface TimelinePoint {
  week: string;
  /** a week ahead (Explore's forecast section), with no detections */
  forecast?: boolean;
  modis: number;
  viirs: number;
  harmonized: number;
  lo: number;
  hi: number;
}

export interface HotspotResponse {
  total: number;
  truncated: boolean;
  columns: string[];
  /** Set when detections are summed per grid cell: each point is a cell centre,
   *  its fifth value the detection count (not FRP) and its date the week's Monday. */
  cell_deg?: number;
  /** More detections matched than ``limit``: ``points`` is a random sample of them. */
  sampled?: boolean;
  points: [number, number, "M" | "V", string, number, string][];
}

export interface AoiSummary {
  area_km2: number;
  detections: number;
  regions: string[];
  by_year: { year: number; modis?: number; viirs?: number }[];
  calendar: Omit<CalendarPayload, "region">;
}

// Laravel-only resources
export interface User {
  id: number;
  name: string;
  email: string;
  locale: "az" | "en";
  telegram_linked?: boolean;
  /** the server has a Telegram bot configured */
  telegram_available?: boolean;
  created_at: string;
}

export type Channel = "in_app" | "email" | "sms" | "push" | "telegram";

export interface Subscription {
  id: number;
  region: RegionRef;
  threshold: Exclude<RiskLevel, "low">;
  channels: Channel[];
  active: boolean;
  created_at: string;
}

export interface Alert {
  id: number;
  region: Pick<RegionRef, "slug" | "name_en" | "name_az">;
  level: RiskLevel;
  probability: number;
  threshold: RiskLevel;
  as_of: string;
  drivers: Driver[];
  read_at: string | null;
  created_at: string;
  channels: { channel: Channel; status: string }[];
}
