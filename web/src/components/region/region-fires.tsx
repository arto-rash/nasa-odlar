"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { FireFacts } from "@/components/explore/fires";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { Link } from "@/i18n/navigation";
import { http } from "@/lib/client";
import { fmtDate, type AppLocale } from "@/lib/format";
import type { FireEvent } from "@/lib/types";

/** The region's fires of the last two weeks, each a link to it on the map. */
export function RegionFires({ slug }: { slug: string }) {
  const t = useTranslations("fires");
  const locale = useLocale() as AppLocale;
  const { data } = useQuery({
    queryKey: ["events-region", slug],
    queryFn: () => http<{ total: number; events: FireEvent[] }>(`/events?region=${slug}&limit=6`),
    staleTime: 10 * 60_000,
  });
  if (!data || data.total === 0) return null;
  return (
    <Panel className="p-5 sm:p-6">
      <PanelHeader eyebrow={t("regionTitle")} title={t("count", { count: data.total })} />
      <ul className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {data.events.map((e) => (
          <li key={e.id}>
            <Link
              href={`/explore?fire=${e.id}`}
              className="block rounded-lg bg-bg-sunken/60 px-4 py-3 ring-1 ring-line transition hover:bg-panel-hover"
            >
              <span className="flex items-center justify-between gap-2 text-[13.5px] font-medium">
                <span>
                  {fmtDate(e.first_seen, locale, { day: "numeric", month: "short" })}
                  {e.last_seen !== e.first_seen && <> – {fmtDate(e.last_seen, locale, { day: "numeric", month: "short" })}</>}
                </span>
                {e.active ? (
                  <span className="inline-flex items-center gap-1.5 text-[12px] text-ember-300">
                    <span className="size-1.5 animate-pulse rounded-full bg-ember-400" /> {t("burning")}
                  </span>
                ) : (
                  <ArrowRight className="size-3.5 text-faint" />
                )}
              </span>
              <FireFacts e={e} className="mt-1" />
            </Link>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[12px] leading-snug text-faint">{t("note")}</p>
    </Panel>
  );
}
