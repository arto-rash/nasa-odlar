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
  const timeline = await api<TimelinePoint[]>("/timeline");
  // Open on the current week (the latest in the record) unless a link names one.
  const latest = timeline[timeline.length - 1].week;
  const initialWeek = w && timeline.some((p) => p.week === w) ? w : latest;
  return <ExploreClient timeline={timeline} initialWeek={initialWeek} />;
}
