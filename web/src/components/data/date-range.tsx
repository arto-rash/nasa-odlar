"use client";

import * as Popover from "@radix-ui/react-popover";
import { CalendarRange, ChevronLeft, ChevronRight } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { fmtDate, type AppLocale } from "@/lib/format";

const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const parse = (s: string) => new Date(s + "T00:00:00Z");
export const addDays = (s: string, n: number) => iso(new Date(parse(s).getTime() + n * DAY));
export const daysBetween = (a: string, b: string) => Math.round((parse(b).getTime() - parse(a).getTime()) / DAY);
export const RECORD_START = "2000-11-01";

/** A date range picked in one go: quick picks, or a start and an end day on a
 *  calendar that stays open until "Done" (the browser's own picker closed after
 *  every click). ``maxDays`` keeps the range within what the API accepts. */
export function DateRange({ from, to, latest, maxDays, allowRecord, onChange }: {
  from: string;
  to: string;
  /** the newest day with data */
  latest: string;
  maxDays?: number;
  /** offer "the whole record" */
  allowRecord?: boolean;
  onChange: (from: string, to: string) => void;
}) {
  const t = useTranslations("range");
  const locale = useLocale() as AppLocale;
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() => to.slice(0, 7)); // YYYY-MM shown
  const [pending, setPending] = useState<string | null>(null); // a start picked, waiting for the end

  const presets = [
    { key: "d30", from: addDays(latest, -29) },
    { key: "m3", from: addDays(latest, -91) },
    ...(!maxDays || maxDays > 366 ? [{ key: "m12", from: addDays(latest, -364) }, { key: "year", from: `${latest.slice(0, 4)}-01-01` }] : []),
    ...(allowRecord ? [{ key: "all", from: RECORD_START }] : []),
  ];
  const clamp = (a: string, b: string): [string, string] => {
    let [s, e] = a <= b ? [a, b] : [b, a];
    if (s < RECORD_START) s = RECORD_START;
    if (e > latest) e = latest;
    if (maxDays && daysBetween(s, e) + 1 > maxDays) s = addDays(e, -(maxDays - 1));
    return [s, e];
  };
  const pickDay = (d: string) => {
    if (!pending) {
      setPending(d);
      onChange(...clamp(d, d));
    } else {
      onChange(...clamp(pending, d));
      setPending(null);
    }
  };

  const [y, m] = view.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const lead = (first.getUTCDay() + 6) % 7; // Monday first
  const len = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells = [...Array(lead).fill(null), ...Array.from({ length: len }, (_, i) => iso(new Date(Date.UTC(y, m - 1, i + 1))))];
  const shift = (n: number) => setView(iso(new Date(Date.UTC(y, m - 1 + n, 1))).slice(0, 7));
  const years = Array.from({ length: Number(latest.slice(0, 4)) - 1999 }, (_, i) => 2000 + i);
  const weekdays = Array.from({ length: 7 }, (_, i) => fmtDate(iso(new Date(Date.UTC(2024, 0, 1 + i))), locale, { weekday: "short" }));
  const label = `${fmtDate(from, locale, { day: "numeric", month: "short", year: from.slice(0, 4) !== to.slice(0, 4) ? "numeric" : undefined })} – ${fmtDate(to, locale, { day: "numeric", month: "short", year: "numeric" })}`;

  return (
    <Popover.Root open={open} onOpenChange={(o) => { setOpen(o); setPending(null); if (o) setView(to.slice(0, 7)); }}>
      <Popover.Trigger asChild>
        <button type="button" className="flex h-11 w-full items-center gap-2.5 rounded-lg bg-bg-sunken px-3 text-left tabular-nums text-[13.5px] ring-1 ring-line hover:ring-line-strong">
          <CalendarRange className="size-4 shrink-0 text-faint" />
          <span className="truncate">{label}</span>
          <span className="ml-auto shrink-0 text-[12px] text-faint">{t("days", { count: daysBetween(from, to) + 1 })}</span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={6} className="z-[80] w-[min(92vw,560px)] rounded-xl bg-panel-solid p-4 shadow-2xl ring-1 ring-line-strong">
          <div className="grid gap-4 sm:grid-cols-[150px_1fr]">
            <div className="flex flex-wrap gap-1.5 sm:flex-col">
              {presets.map((p) => {
                const [s, e] = clamp(p.from, latest);
                const on = s === from && e === to;
                return (
                  <button key={p.key} type="button" onClick={() => { onChange(s, e); setPending(null); setView(e.slice(0, 7)); }}
                    className={cn("rounded-md px-3 py-2 text-left text-[13px] transition", on ? "bg-text font-medium text-bg" : "text-dim hover:bg-panel-hover hover:text-text")}>
                    {t(p.key)}
                  </button>
                );
              })}
              {maxDays && <p className="mt-1 px-1 text-[11.5px] leading-snug text-faint sm:mt-2">{t("max", { count: maxDays })}</p>}
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <button type="button" onClick={() => shift(-1)} aria-label={t("prev")} className="grid size-8 place-items-center rounded-md text-dim hover:bg-panel-hover"><ChevronLeft className="size-4" /></button>
                <select aria-label={t("month")} value={m} onChange={(e) => setView(`${y}-${String(e.target.value).padStart(2, "0")}`)}
                  className="h-8 flex-1 rounded-md bg-bg-sunken px-2 text-[13px] ring-1 ring-line [color-scheme:dark]">
                  {Array.from({ length: 12 }, (_, i) => <option key={i} value={i + 1}>{fmtDate(iso(new Date(Date.UTC(2024, i, 1))), locale, { month: "long" })}</option>)}
                </select>
                <select aria-label={t("year_")} value={y} onChange={(e) => setView(`${e.target.value}-${String(m).padStart(2, "0")}`)}
                  className="h-8 w-[84px] rounded-md bg-bg-sunken px-2 tabular-nums text-[13px] ring-1 ring-line [color-scheme:dark]">
                  {years.map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
                <button type="button" onClick={() => shift(1)} aria-label={t("next")} className="grid size-8 place-items-center rounded-md text-dim hover:bg-panel-hover"><ChevronRight className="size-4" /></button>
              </div>
              <div className="mt-3 grid grid-cols-7 gap-y-1 text-center">
                {weekdays.map((w) => <span key={w} className="pb-1 text-[11px] text-faint">{w}</span>)}
                {cells.map((d, i) => {
                  if (!d) return <span key={`x${i}`} />;
                  const out = d < RECORD_START || d > latest;
                  const edge = d === from || d === to;
                  const inside = d > from && d < to;
                  return (
                    <button key={d} type="button" disabled={out} onClick={() => pickDay(d)}
                      className={cn("h-8 tabular-nums text-[13px] transition",
                        out ? "text-faint/40" : edge ? "rounded-md bg-ember font-semibold text-white" : inside ? "bg-ember/15 text-text" : "rounded-md text-dim hover:bg-panel-hover hover:text-text")}>
                      {Number(d.slice(8))}
                    </button>
                  );
                })}
              </div>
              <div className="mt-3 flex items-center justify-between gap-3">
                <p className="text-[12px] text-faint">{pending ? t("pickEnd") : t("pickStart")}</p>
                <Popover.Close asChild>
                  <button type="button" className="rounded-md bg-text px-4 py-1.5 text-[13px] font-medium text-bg">{t("done")}</button>
                </Popover.Close>
              </div>
            </div>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
