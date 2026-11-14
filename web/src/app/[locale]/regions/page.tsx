import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Footer } from "@/components/layout/footer";
import { PageHeader } from "@/components/layout/page-header";
import { RegionsIndex } from "@/components/regions/regions-index";
import { api } from "@/lib/upstream";
import type { Region } from "@/lib/types";

export const revalidate = 600;

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "regions" });
  return { title: t("title"), description: t("lead") };
}

export default async function RegionsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("regions");
  const [countries, initial] = await Promise.all([
    api<Region[]>("/regions?level=country"),
    api<Region[]>("/regions?country=az"),
  ]);
  return (
    <main>
      <PageHeader title={t("title")} lead={t("lead")} />
      <RegionsIndex countries={countries} initial={initial} />
      <Footer />
    </main>
  );
}
