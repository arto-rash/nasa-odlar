"use client";

import { CloudRain, Droplets, Flame, Gauge, Leaf, Sun, ThermometerSun, TrendingUp, Wind, CalendarRange, CloudOff } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { cn } from "@/lib/cn";
import { fmtNum, type AppLocale } from "@/lib/format";
import type { Driver, DriverCode } from "@/lib/types";

const ICON: Record<DriverCode, React.ComponentType<{ className?: string }>> = {
  dry_spell: Sun,
  no_rain_ahead: CloudOff,
  dry_month: Droplets,
  wind: Wind,
  heat: ThermometerSun,
  low_humidity: Droplets,
  high_vpd: Gauge,
  seasonal_peak: CalendarRange,
  recent_fires: Flame,
  active_season: TrendingUp,
  vegetation: Leaf,
};

export function driverText(t: ReturnType<typeof useTranslations>, d: Pick<Driver, "code" | "direction" | "value">, locale: AppLocale) {
  const digits = d.code === "wind" ? 1 : 0;
  return t(`${d.code}.${d.direction}`, { value: d.value == null ? "–" : fmtNum(Math.abs(d.value), locale, digits) });
}

export function DriverLine({ code, className }: { code: DriverCode; className?: string }) {
  const t = useTranslations("drivers");
  const locale = useLocale() as AppLocale;
  return <p className={className}>{driverText(t, { code, direction: "up", value: null }, locale).replace(/\s*\(–.*?\)/, "")}</p>;
}

export function DriverList({ drivers, className }: { drivers: Driver[]; className?: string }) {
  const t = useTranslations("drivers");
  const locale = useLocale() as AppLocale;
  return (
    <ul className={cn("divide-y divide-line border-y border-line", className)}>
      {drivers.map((d) => {
        const Icon = d.direction === "down" && d.code === "no_rain_ahead" ? CloudRain : ICON[d.code] ?? Flame;
        const up = d.direction === "up";
        return (
          <li key={d.code + d.direction} className="flex items-start gap-3 py-3">
            <Icon className={cn("mt-0.5 size-[18px] shrink-0", up ? "text-ember-400" : "text-viirs")} aria-hidden />
            <span className="min-w-0 flex-1 text-[14.5px] leading-snug">{driverText(t, d, locale)}</span>
            <span className={cn("shrink-0 text-[13px] font-semibold", up ? "text-ember-300" : "text-viirs")}>{up ? "↑" : "↓"}</span>
          </li>
        );
      })}
    </ul>
  );
}
