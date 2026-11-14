import { useTranslations } from "next-intl";
import { cn } from "@/lib/cn";
import type { RiskLevel } from "@/lib/types";

// Fixed across themes so dark ink always reads on them (all ≥ 6:1 with #141414).
const TAG: Record<RiskLevel, string> = {
  low: "#86b991",
  moderate: "#e3c35b",
  high: "#f39a45",
  very_high: "#ef6a4c",
  extreme: "#f4667a",
};

/** Solid level label, like a weather-service warning tag. */
export function RiskBadge({ level, className }: { level: RiskLevel; className?: string; pulse?: boolean }) {
  const t = useTranslations("levels");
  return (
    <span
      className={cn("inline-flex items-center rounded-[3px] px-1.5 py-0.5 text-[13px] font-semibold leading-tight text-[#141414]", className)}
      style={{ background: TAG[level] }}
    >
      {t(level)}
    </span>
  );
}
