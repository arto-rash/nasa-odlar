"use client";

import { CloudRain, Sun, Wind } from "lucide-react";
import { motion } from "motion/react";
import { useLocale, useTranslations } from "next-intl";
import { cn } from "@/lib/cn";
import { fmtNum, weekdayShort, type AppLocale } from "@/lib/format";
import type { RiskDetail } from "@/lib/types";
import { useWindText, WindArrow } from "@/components/ui/wind";

function dangerColor(d: number) {
  if (d >= 85) return "var(--risk-extreme)";
  if (d >= 70) return "var(--risk-very_high)";
  if (d >= 50) return "var(--risk-high)";
  if (d >= 30) return "var(--risk-moderate)";
  return "var(--risk-low)";
}

export function DailyStrip({ days, compact }: { days: RiskDetail["daily"]; compact?: boolean }) {
  const t = useTranslations("risk");
  const tw = useTranslations("wind");
  const windText = useWindText();
  const locale = useLocale() as AppLocale;
  return (
    <div className={cn("grid gap-1.5", compact ? "grid-cols-7" : "grid-cols-4 sm:grid-cols-7")}>
      {days.slice(0, 7).map((d, i) => (
        <motion.div
          key={d.date}
          initial={{ opacity: 0, y: 8 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: i * 0.04, duration: 0.5 }}
          className="flex flex-col items-center gap-1.5 rounded-lg bg-bg-sunken/60 px-1 py-2.5 ring-1 ring-line"
          title={[`${t("danger")}: ${fmtNum(d.danger, locale)}`,
            d.wind_from != null ? tw("day", { speed: fmtNum(d.wind, locale, 1), gust: fmtNum(d.gust ?? d.wind, locale, 0), dir: windText(d.wind_from) }) : null]
            .filter(Boolean).join("\n")}
        >
          <span className="text-[12px] font-semibold text-faint">{weekdayShort(d.date, locale)}</span>
          {d.precip >= 2 ? <CloudRain className="size-4 text-viirs" /> : d.wind >= 5 ? <Wind className="size-4 text-dim" /> : <Sun className="size-4 text-ember-200" />}
          <span className="tabular-nums text-[13px] tabular">{fmtNum(d.tmax, locale)}°</span>
          <span className="relative h-10 w-1.5 overflow-hidden rounded-full bg-line" aria-hidden>
            <motion.span
              className="absolute inset-x-0 bottom-0 rounded-full"
              style={{ background: dangerColor(d.danger) }}
              initial={{ height: 0 }}
              whileInView={{ height: `${Math.max(6, d.danger)}%` }}
              viewport={{ once: true }}
              transition={{ delay: 0.2 + i * 0.05, duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
            />
          </span>
          {!compact && <span className="tabular-nums text-[12px] text-faint">{d.precip >= 0.5 ? `${fmtNum(d.precip, locale)} mm` : `${fmtNum(d.rh, locale)}%`}</span>}
          {d.wind_from != null && (
            <span className={cn("flex items-center gap-0.5 tabular-nums text-[11.5px]", (d.gust ?? 0) >= 12 ? "text-ember-300" : "text-faint")}>
              <WindArrow from={d.wind_from} className="size-3.5" />
              {!compact && d.gust != null && fmtNum(d.gust, locale, 0)}
            </span>
          )}
        </motion.div>
      ))}
    </div>
  );
}
