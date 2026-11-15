"use client";

import { useLocale, useTranslations } from "next-intl";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { cn } from "@/lib/cn";
import { fmtDate, fmtNum, type AppLocale } from "@/lib/format";
import type { MonthToDate, MonthTotals } from "@/lib/types";

type Verdict = "record" | "above" | "normal" | "below" | "unusual" | "quiet";

export function monthVerdict(m: MonthTotals): Verdict {
  if (m.ratio === null) return m.value > 0 ? "unusual" : "quiet";
  if (m.ratio >= 1.5 && m.rank <= 3) return "record";
  if (m.ratio >= 1.5) return "above";
  if (m.ratio <= 0.67) return "below";
  return "normal";
}

const TONE: Record<Verdict, string> = {
  record: "text-[var(--risk-extreme)]",
  above: "text-[var(--risk-high)]",
  unusual: "text-[var(--risk-high)]",
  normal: "text-text",
  below: "text-[var(--risk-low)]",
  quiet: "text-text",
};

/** 0.15× stays 0.15×, not 0.1×; 2.8× keeps one decimal. */
const fmtRatio = (r: number, locale: AppLocale) => fmtNum(r, locale, r < 1 ? 2 : 1);

/** Bars against "the usual = 1×", capped so a raw 10× still fits. */
const CAP = 4;

/** "Is this month normal here?" The month so far against the same weeks of
 *  every year since 2001, on ODLAR's record, with what the raw record would say. */
export function MonthPanel({ m, className }: { m: MonthToDate; className?: string }) {
  const t = useTranslations("month");
  const locale = useLocale() as AppLocale;
  const verdict = monthVerdict(m);
  const monthName = fmtDate(`${m.month}-01`, locale, { month: "long" });
  const range = `${fmtDate(m.start, locale, { day: "numeric", month: "short" })} – ${fmtDate(m.end, locale, { day: "numeric", month: "short" })}`;
  const raw = m.raw;
  return (
    <Panel className={cn("p-5 sm:p-6", className)}>
      <PanelHeader eyebrow={t("eyebrow", { month: monthName })} title={<span className={TONE[verdict]}>{t(`verdict.${verdict}`)}</span>} />
      <p className="mt-1 text-[12.5px] text-faint">{t("weeks", { range })}</p>

      {m.ratio !== null ? (
        <div className="mt-5 space-y-3" role="img" aria-label={t("aria", { ratio: fmtRatio(m.ratio, locale), raw: raw?.ratio != null ? fmtRatio(raw.ratio, locale) : "–" })}>
          <Bar label={t("odlar")} ratio={m.ratio} tone="bg-text" strong locale={locale} />
          {raw?.ratio != null && <Bar label={t("raw")} ratio={raw.ratio} tone="bg-[var(--text-faint)]" locale={locale} />}
          <div className="grid grid-cols-[64px_1fr_52px] gap-2.5 text-[11px] text-faint">
            <span />
            <span className="relative h-4">
              <span className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: `${(1 / CAP) * 100}%` }}>{t("usual")}</span>
            </span>
          </div>
        </div>
      ) : null}

      <dl className="mt-3 grid grid-cols-3 gap-3 border-t border-line pt-4 text-[13px]">
        <div>
          <dt className="text-faint">{t("thisMonth")}</dt>
          <dd className="font-display tabular mt-0.5 text-[1.25rem]">{fmtNum(m.value, locale, m.value < 10 ? 1 : 0)}</dd>
        </div>
        <div>
          <dt className="text-faint">{t("median")}</dt>
          <dd className="font-display tabular mt-0.5 text-[1.25rem]">{fmtNum(m.median, locale, m.median < 10 ? 1 : 0)}</dd>
        </div>
        <div>
          <dt className="text-faint">{t("rankLabel")}</dt>
          <dd className="font-display tabular mt-0.5 text-[1.25rem]">{t("rank", { rank: m.rank, n: m.n_years })}</dd>
        </div>
      </dl>

      {raw && raw.ratio != null && m.ratio != null && Math.abs(raw.ratio - m.ratio) >= 0.5 && (
        <p className="mt-4 rounded-md bg-bg-sunken/70 px-3 py-2.5 text-[12.5px] leading-snug text-dim ring-1 ring-line">
          {t("rawNote", { raw: fmtRatio(raw.ratio, locale), ours: fmtRatio(m.ratio, locale) })}
        </p>
      )}
    </Panel>
  );
}

function Bar({ label, ratio, tone, strong, locale }: { label: string; ratio: number; tone: string; strong?: boolean; locale: AppLocale }) {
  const w = Math.min(ratio, CAP) / CAP;
  return (
    <div className="grid grid-cols-[64px_1fr_52px] items-center gap-2.5">
      <span className={cn("text-[12.5px]", strong ? "font-medium text-text" : "text-faint")}>{label}</span>
      <div className="relative h-3 rounded-full bg-bg-sunken ring-1 ring-line">
        <span className={cn("absolute inset-y-0 left-0 rounded-full", tone)} style={{ width: `${Math.max(w * 100, 1.5)}%` }} />
        <span className="absolute inset-y-[-3px] w-px bg-text/60" style={{ left: `${(1 / CAP) * 100}%` }} aria-hidden />
      </div>
      <span className={cn("tabular text-right text-[13px]", strong ? "font-medium" : "text-faint")}>
        {ratio > CAP ? "› " : ""}
        {fmtRatio(ratio, locale)}×
      </span>
    </div>
  );
}
