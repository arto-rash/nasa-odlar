import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { CompareClient } from "@/components/compare/compare-client";
import { Footer } from "@/components/layout/footer";
import { PageHeader } from "@/components/layout/page-header";
import { api } from "@/lib/upstream";
import type { AnnualSeries, Skill } from "@/lib/types";

export const revalidate = 600;

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "compare" });
  return { title: t("title"), description: t("lead") };
}

export default async function ComparePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("compare");
  const [annual, skill] = await Promise.all([api<AnnualSeries>("/regions/az/series/annual"), api<Skill>("/harmonization/skill?region=az")]);
  return (
    <main>
      <PageHeader title={t("title")} lead={t("lead")} />
      <CompareClient initial="az" initialAnnual={annual} initialSkill={skill} />
      <Footer />
    </main>
  );
}
