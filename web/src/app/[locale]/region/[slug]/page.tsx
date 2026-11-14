import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Footer } from "@/components/layout/footer";
import { RegionHero } from "@/components/region/region-hero";
import {
  AnomaliesPanel, CalendarSection, ChildrenPanel, ExportBar, HistoryPanel, NormalYearPanel, NowPanel, RiskPanel, SeasonPanel,
} from "@/components/region/region-panels";
import { api, ApiError } from "@/lib/upstream";
import type { AnnualSeries, CalendarPayload, ForecastPayload, Region, RegionDetail, RiskDetail } from "@/lib/types";
import { AheadPanel } from "@/components/region/ahead-panel";
import { RegionFires } from "@/components/region/region-fires";
import { MonthPanel } from "@/components/region/month-panel";

export const revalidate = 600;

type Props = { params: Promise<{ locale: string; slug: string }> };

async function load(slug: string) {
  try {
    return await Promise.all([
      api<RegionDetail>(`/regions/${slug}`),
      api<CalendarPayload>(`/regions/${slug}/calendar`),
      api<AnnualSeries>(`/regions/${slug}/series/annual`),
      api<RiskDetail>(`/regions/${slug}/risk`),
      api<Region[]>(`/regions?parent=${slug}`),
      // the page still works without it (a region with no outlook, or an API not yet updated)
      api<ForecastPayload>(`/regions/${slug}/forecast`).catch(() => null),
    ]);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  try {
    const [r, t] = await Promise.all([api<RegionDetail>(`/regions/${slug}`), getTranslations({ locale, namespace: "region" })]);
    const name = locale === "az" ? r.name_az : r.name_en;
    return { title: name, description: t("metaDescription", { name }) };
  } catch {
    return {};
  }
}

export default async function RegionPage({ params }: Props) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const [region, cal, annual, risk, children, forecast] = await load(slug);
  return (
    <main>
      <RegionHero region={region} />
      <div className="mx-auto mt-10 grid max-w-[1240px] gap-5 px-5 sm:px-8 lg:grid-cols-[1.55fr_1fr]">
        <CalendarSection cal={cal} forecast={forecast} />
        <div className="grid content-start gap-5">
          {cal.month && <MonthPanel m={cal.month} />}
          <RiskPanel risk={risk} slug={slug} />
          <NowPanel region={region} />
        </div>
        {forecast && (
          <div className="lg:col-span-2">
            <AheadPanel f={forecast} />
          </div>
        )}
        <div className="lg:col-span-2 empty:hidden">
          <RegionFires slug={slug} />
        </div>
        <div className="lg:col-span-2 grid gap-5 lg:grid-cols-[1fr_1.55fr]">
          <SeasonPanel cal={cal} />
          <NormalYearPanel cal={cal} />
        </div>
        <div className="lg:col-span-2">
          <HistoryPanel annual={annual} breaks={region.stats.break} />
        </div>
        <div className="lg:col-span-2">
          <AnomaliesPanel cal={cal} />
        </div>
        {children.length > 0 && (
          <div className="lg:col-span-2">
            <ChildrenPanel items={children} />
          </div>
        )}
        <div className="lg:col-span-2 pt-2">
          <ExportBar slug={slug} />
        </div>
      </div>
      <Footer />
    </main>
  );
}
