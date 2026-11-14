import type { RegionRef } from "./types";

export type AppLocale = "az" | "en";

// Formatting is done by hand rather than with Intl: browsers ship incomplete
// Azerbaijani locale data, which would make server and client output differ.
function group(intPart: string, sep: string) {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
}

export function fmtNum(v: number | null | undefined, locale: AppLocale, digits = 0): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  const neg = v < 0 && Math.abs(v).toFixed(digits) !== (0).toFixed(digits);
  const [i, d] = Math.abs(v).toFixed(digits).split(".");
  const out = locale === "az" ? group(i, "\u00a0") + (d ? "," + d : "") : group(i, ",") + (d ? "." + d : "");
  return (neg ? "−" : "") + out;
}

export function fmtCompact(v: number | null | undefined, locale: AppLocale): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  const a = Math.abs(v);
  if (a >= 1e6) return fmtNum(v / 1e6, locale, a >= 1e7 ? 0 : 1) + (locale === "az" ? " mln" : "M");
  if (a >= 1e4) return fmtNum(v / 1e3, locale, 0) + (locale === "az" ? " min" : "k");
  if (a >= 1e3) return fmtNum(v / 1e3, locale, 1) + (locale === "az" ? " min" : "k");
  return fmtNum(v, locale, a < 10 && a % 1 ? 1 : 0);
}

export function fmtPct(v: number | null | undefined, locale: AppLocale, digits = 0, signed = false): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  const n = fmtNum(v * 100, locale, digits);
  const sign = signed && v * 100 >= 0.5 * 10 ** -digits ? "+" : "";
  return locale === "az" ? `${sign}${n}%` : `${sign}${n}%`;
}

export function fmtDate(iso: string, locale: AppLocale, opts: { day?: unknown; month?: "long" | "short"; year?: unknown; weekday?: "short" | "long" } = { day: "numeric", month: "long" }) {
  const d = new Date(iso.length === 10 ? iso + "T12:00:00Z" : iso);
  const day = d.getUTCDate();
  const m = d.getUTCMonth();
  const month = opts.month === "short" ? monthShort(m, locale) : opts.month ? monthLong(m, locale) : "";
  const year = opts.year ? ` ${d.getUTCFullYear()}` : "";
  const wd = opts.weekday ? WEEKDAYS[locale][d.getUTCDay()] + (locale === "az" ? ", " : ", ") : "";
  if (!opts.day) return `${month}${year}`.trim();
  return locale === "az" ? `${wd}${day} ${month.toLowerCase()}${year}` : `${wd}${day} ${month}${year}`;
}

const WEEKDAYS: Record<AppLocale, string[]> = {
  az: ["B.", "B.e.", "Ç.a.", "Ç.", "C.a.", "C.", "Ş."],
  en: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
};

export function weekdayShort(iso: string, locale: AppLocale) {
  return WEEKDAYS[locale][new Date(iso + "T12:00:00Z").getUTCDay()];
}

export function regionName(r: Pick<RegionRef, "name_en" | "name_az"> | undefined | null, locale: AppLocale): string {
  if (!r) return "";
  return locale === "az" ? r.name_az : r.name_en;
}

export function countryLabel(r: Pick<RegionRef, "country" | "country_name_en" | "country_name_az">, locale: AppLocale): string {
  return (locale === "az" ? r.country_name_az : r.country_name_en) ?? r.country.toUpperCase();
}

/** The place fields of any region-like object (risk items use `level` for the risk level, never "country"). */
export interface Placed {
  country?: string;
  level?: string;
  country_name_en?: string;
  country_name_az?: string;
  state_name_en?: string;
  state_name_az?: string;
}

/** Where a region is, for the small line under its name: "Michigan · United States",
 *  or just the country; empty for a country itself. */
export function placeLabel(r: Placed | undefined | null, locale: AppLocale): string {
  if (!r?.country || r.level === "country") return "";
  const country = (locale === "az" ? r.country_name_az : r.country_name_en) ?? r.country.toUpperCase();
  const state = locale === "az" ? r.state_name_az : r.state_name_en;
  return state ? `${state} · ${country}` : country;
}

/** Short name without "District"/"rayonu" suffix, for tight UI. */
export function shortName(r: Pick<RegionRef, "name_en" | "name_az"> | undefined | null, locale: AppLocale): string {
  return regionName(r, locale).replace(/ (District|rayonu)$/u, "");
}

const MONTHS: Record<AppLocale, string[]> = {
  az: ["Yan", "Fev", "Mar", "Apr", "May", "İyn", "İyl", "Avq", "Sen", "Okt", "Noy", "Dek"],
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
};
const MONTHS_LONG: Record<AppLocale, string[]> = {
  az: ["yanvar", "fevral", "mart", "aprel", "may", "iyun", "iyul", "avqust", "sentyabr", "oktyabr", "noyabr", "dekabr"],
  en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
};

export const monthShort = (m: number, l: AppLocale) => MONTHS[l][m];
export const monthLong = (m: number, l: AppLocale) => MONTHS_LONG[l][m];

/** Calendar week bin (0..51) → approximate date in a non-leap year. */
export function weekToDate(week: number): Date {
  return new Date(Date.UTC(2025, 0, 1 + week * 7 + 3));
}

/** "early July" style label for a calendar-week bin. */
export function weekLabel(week: number | null | undefined, l: AppLocale): string {
  if (week === null || week === undefined) return "—";
  const d = weekToDate(week);
  const day = d.getUTCDate();
  const m = d.getUTCMonth();
  const part =
    l === "az"
      ? day <= 10 ? "əvvəli" : day <= 20 ? "ortası" : "sonu"
      : day <= 10 ? "early" : day <= 20 ? "mid" : "late";
  return l === "az" ? `${monthLong(m, l)} ${part}` : `${part} ${monthLong(m, l)}`;
}

export function weekRange(start: number | null, end: number | null, l: AppLocale): string {
  if (start === null || end === null) return "—";
  return `${weekLabel(start, l)} – ${weekLabel(end, l)}`;
}

/** Month index (0..11) of a week bin, for axis ticks. */
export const weekMonth = (w: number) => weekToDate(w).getUTCMonth();
