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
  searchParams: Promise<{ w?: string; r?: string; fire?: string; sat?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { w, r, fire, sat } = await searchParams;
  const timeline = await api<TimelinePoint[]>("/timeline");
  // Open on the current week (the latest in the record) unless a link names one.
  const latest = timeline[timeline.length - 1].week;
  const initialWeek = w && timeline.some((p) => p.week === w) ? w : latest;
  // a link from a region's calendar names the region too: it opens selected and in view
  const initialRegion = r && /^[a-z0-9-]{1,100}$/.test(r) ? r : null;
  // a fire from a region page or a shared link opens with the fires layer on
  const initialFire = fire && /^-?\d+\.\d+_-?\d+\.\d+_\d{8}$/.test(fire) ? fire : null;
  // ?sat=1 opens on the satellite view (shareable, like the week and the fire)
  return <ExploreClient timeline={timeline} initialWeek={initialWeek} initialRegion={initialRegion} initialFire={initialFire} initialSatellite={sat === "1"} />;
}
