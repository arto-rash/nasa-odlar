import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { DataClient } from "@/components/data/data-client";
import { Footer } from "@/components/layout/footer";
import { PageHeader } from "@/components/layout/page-header";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "data" });
  return { title: t("title"), description: t("lead") };
}

export default async function DataPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("data");
  const base = process.env.NEXT_PUBLIC_PUBLIC_API_URL ?? `${process.env.NEXT_PUBLIC_SITE_URL ?? ""}/api/v1`;
  return (
    <main>
      <PageHeader title={t("title")} lead={t("lead")} />
      <DataClient apiBase={base} />
      <Footer />
    </main>
  );
}
