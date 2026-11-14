import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { RegionReport } from "@/components/region/report";
import { SITE_URL } from "@/lib/site";
import { api, ApiError } from "@/lib/upstream";
import type { AnnualSeries, CalendarPayload, ForecastPayload, RegionDetail } from "@/lib/types";

export const revalidate = 600;

type Props = { params: Promise<{ locale: string; slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  try {
    const [r, t] = await Promise.all([api<RegionDetail>(`/regions/${slug}`), getTranslations({ locale, namespace: "report" })]);
    return { title: `${t("title")}: ${locale === "az" ? r.name_az : r.name_en}`, robots: { index: false } };
  } catch {
    return {};
  }
}

async function load(slug: string) {
  try {
    return await Promise.all([
      api<RegionDetail>(`/regions/${slug}`),
      api<CalendarPayload>(`/regions/${slug}/calendar`),
      api<AnnualSeries>(`/regions/${slug}/series/annual`),
      api<ForecastPayload>(`/regions/${slug}/forecast`).catch(() => null),
    ]);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }
}

export default async function ReportPage({ params }: Props) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const [region, cal, annual, forecast] = await load(slug);
  const site = SITE_URL;
  return <RegionReport region={region} cal={cal} annual={annual} forecast={forecast} url={`${site}/${locale}/region/${slug}`} />;
}
