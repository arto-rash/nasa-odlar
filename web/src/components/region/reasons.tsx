import type { useTranslations } from "next-intl";
import { fmtNum, type AppLocale } from "@/lib/format";
import type { AnomalyReason } from "@/lib/types";

export function reasonText(t: ReturnType<typeof useTranslations>, r: AnomalyReason, locale: AppLocale) {
  const ratio = ["high_total", "low_total", "intense_peak"].includes(r.code);
  return t(r.code, { value: ratio ? fmtNum(r.value, locale, r.value < 10 ? 1 : 0) : fmtNum(Math.abs(r.value), locale) });
}
