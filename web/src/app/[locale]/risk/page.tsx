import type { FeatureCollection } from "geojson";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { RiskClient } from "@/components/risk/risk-client";
import { api } from "@/lib/upstream";
import type { Overview, RiskMapItem } from "@/lib/types";

export const revalidate = 600;

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "risk" });
  return { title: t("title"), description: t("lead") };
}

export default async function RiskPage({
  params, searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ r?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { r } = await searchParams;
  const [items, regions, overview] = await Promise.all([
    api<RiskMapItem[]>("/risk"),
    api<FeatureCollection>("/regions/geojson"),
    api<Overview>("/overview"),
  ]);
  return <RiskClient items={items} regions={regions} asOf={overview.meta.data_end} initial={r ?? null} />;
}
