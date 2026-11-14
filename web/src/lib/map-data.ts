import type { FeatureCollection } from "geojson";
import { http } from "@/lib/client";
import type { HotspotPoint } from "@/components/map/layers";

/*
 * The heavy map data, as query options shared by the map and the warm-up that
 * starts on entering the site. Whatever the warm-up loaded, the map finds ready.
 */

export const AFTERGLOW_WEEKS = 3;
const FIRST_YEAR = 2000;
const PACK_VERSION = 1; // raise when the files are rebuilt with another layout or sample

export function regionsViewQuery(zoom: number | undefined, bbox: string | null | undefined) {
  return {
    queryKey: ["regions-view", zoom, bbox],
    queryFn: () => http<FeatureCollection>(`/regions/geojson?zoom=${zoom}${bbox ? `&bbox=${bbox}` : ""}`),
    staleTime: 10 * 60_000,
  };
}

/** A year of sampled real detections (odlar.week_packs describes the layout). */
export type WeekPack = {
  rate: number;
  weeks: Map<string, { offset: number; count: number }>;
  lon: Int16Array;
  lat: Int16Array;
  meta: Uint8Array;
};

export function parsePack(buf: ArrayBuffer): WeekPack {
  const head = new DataView(buf);
  const rate = head.getUint32(0, true);
  const nWeeks = head.getUint32(4, true);
  const n = head.getUint32(8, true);
  const weeks: WeekPack["weeks"] = new Map();
  let offset = 0;
  for (let i = 0; i < nWeeks; i++) {
    const day = head.getUint32(12 + i * 8, true);
    const count = head.getUint32(16 + i * 8, true);
    weeks.set(new Date(day * 86400000).toISOString().slice(0, 10), { offset, count });
    offset += count;
  }
  const start = 12 + nWeeks * 8;
  return {
    rate, weeks,
    lon: new Int16Array(buf, start, n),
    lat: new Int16Array(buf, start + n * 2, n),
    meta: new Uint8Array(buf, start + n * 4, n),
  };
}

/** The world file is a sample; the home file has every detection of the area Explore opens on. */
export type PackArea = "world" | "home";
const HOME: readonly number[] = [33, 35, 58, 46]; // west, south, east, north; same box as odlar.week_packs

/** Which file can draw a view: "w,s,e,n", or null for the whole world. */
export function packAreaFor(bbox: string | null): PackArea | null {
  if (bbox === null) return "world";
  const [w, s, e, n] = bbox.split(",").map(Number);
  return w >= HOME[0] && s >= HOME[1] && e <= HOME[2] && n <= HOME[3] ? "home" : null;
}

export function weekPackQuery(year: number, area: PackArea = "world") {
  return {
    queryKey: ["week-pack", area, year],
    queryFn: async ({ signal }: { signal?: AbortSignal }) => {
      const res = await fetch(`/api/v1/week-pack/${area === "home" ? "home/" : ""}${year}?v=${PACK_VERSION}`, { signal });
      if (!res.ok) throw new Error(`week pack ${year}: ${res.status}`);
      return parsePack(await res.arrayBuffer());
    },
    staleTime: Infinity,
    gcTime: Infinity,
  };
}

const DAY = 86400000;
const addDays = (week: string, n: number) => new Date(new Date(week + "T00:00:00Z").getTime() + n * DAY).toISOString().slice(0, 10);

/** The years a week's map needs, afterglow included. */
export function yearsFor(week: string): number[] {
  const first = +addDays(week, -7 * AFTERGLOW_WEEKS).slice(0, 4);
  const last = +addDays(week, 6).slice(0, 4);
  const years: number[] = [];
  for (let y = first; y <= last; y++) years.push(y);
  return years;
}

/** The week's detections and the three before it, as the map draws them. */
export function packPoints(packs: WeekPack[], week: string): HotspotPoint[] {
  const out: HotspotPoint[] = [];
  for (let age = 0; age <= AFTERGLOW_WEEKS; age++) {
    const monday = addDays(week, -7 * age);
    for (const p of packs) {
      const w = p.weeks.get(monday); // a week across New Year sits in both files
      if (!w) continue;
      for (let i = w.offset; i < w.offset + w.count; i++) {
        const m = p.meta[i];
        out.push({ lon: p.lon[i] / 100, lat: p.lat[i] / 100, sensor: m & 128 ? "V" : "M", frp: Math.expm1((m & 127) / 16), age });
      }
    }
  }
  return out;
}

/** Newest years first, so the timeline's usual range is ready soonest. */
export function warmYears(all: boolean): number[] {
  const now = new Date().getUTCFullYear();
  const years: number[] = [];
  for (let y = now; y >= (all ? FIRST_YEAR : now - 1); y--) years.push(y);
  return years;
}
