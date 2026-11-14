import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ExploreClient } from "@/components/explore/explore-client";
import { api } from "@/lib/upstream";
import type { TimelinePoint } from "@/lib/types";

export const revalidate = 600;

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "explore" });
  return { title: t("title") };
}

export default async function ExplorePage({
  params, searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ w?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { w } = await searchParams;
  const [timeline, grid] = await Promise.all([
    api<TimelinePoint[]>("/timeline"),
    api<{ cells: [number, number, number][] }>("/grid"),
  ]);
  // Default to the busiest week of the last complete year — the most telling first frame.
  const lastYear = +timeline[timeline.length - 1].week.slice(0, 4) - 1;
  const peak = timeline
    .filter((p) => +p.week.slice(0, 4) === lastYear)
    .reduce((a, b) => (b.viirs > a.viirs ? b : a), timeline[timeline.length - 1]);
  const initialWeek = w && timeline.some((p) => p.week === w) ? w : peak.week;
  return <ExploreClient timeline={timeline} cells={grid.cells} initialWeek={initialWeek} />;
}
