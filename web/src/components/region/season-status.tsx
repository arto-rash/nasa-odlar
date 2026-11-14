"use client";

import { CalendarClock, Flame } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { seasonStatus } from "@/lib/calendar-cells";
import { cn } from "@/lib/cn";
import { fmtNum, weekLabel, type AppLocale } from "@/lib/format";
import type { CurrentStatus, SeasonProfile } from "@/lib/types";

/** One line on where the region is in its usual fire season, right now. */
export function SeasonStatusChip({ season, current, className }: { season?: SeasonProfile | null; current?: CurrentStatus | null; className?: string }) {
  const t = useTranslations("region");
  const locale = useLocale() as AppLocale;
  const s = seasonStatus(season, current);
  if (s.kind === "none") return null;
  const hot = s.kind === "peak" || s.kind === "in";
  const text =
    s.kind === "peak" ? t("seasonPeak")
    : s.kind === "in" ? t("seasonIn", { weeks: s.weeksLeft })
    : s.kind === "soon" ? t("seasonSoon", { weeks: s.weeks })
    : t("seasonLater", { when: weekLabel(s.startWeek, locale) });
  const ratio = (s.kind === "peak" || s.kind === "in") && s.ratio != null && (s.ratio >= 1.5 || s.ratio <= 0.67) ? s.ratio : null;
  const Icon = hot ? Flame : CalendarClock;
  return (
    <p
      className={cn(
        "inline-flex max-w-full items-start gap-2 rounded-2xl px-3.5 py-1.5 text-[13.5px] leading-snug ring-1",
        hot ? "bg-ember-500/10 text-text ring-ember-400/40" : s.kind === "soon" ? "text-text ring-line-strong" : "text-dim ring-line",
        className,
      )}
    >
      <Icon className={cn("mt-px size-4 shrink-0", hot || s.kind === "soon" ? "text-ember-400" : "text-faint")} aria-hidden />
      <span>
        <span className="font-medium">{text}</span>
        {ratio != null && <span className="tabular-nums text-dim"> · {t("seasonRatio", { ratio: fmtNum(ratio, locale, 1) })}</span>}
      </span>
    </p>
  );
}
