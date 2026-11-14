import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { SimpleClient } from "@/components/simple/simple-client";
import { HOME_COOKIE } from "@/lib/home-cookie";
import type { RegionDetail, RiskDetail } from "@/lib/types";
import { api } from "@/lib/upstream";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "simple" });
  return { title: t("title") };
}

export default async function SimplePage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ r?: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [{ r }, jar] = await Promise.all([searchParams, cookies()]);
  const saved = jar.get(HOME_COOKIE)?.value;
  const slug = r ?? saved;
  // a known district renders complete on the server; on any upstream error the client fetches instead
  const prefetched = slug
    ? await Promise.all([api<RegionDetail>(`/regions/${slug}`), api<RiskDetail>(`/regions/${slug}/risk`)])
        .then(([region, risk]) => ({ slug, region, risk }))
        .catch(() => undefined)
    : undefined;
  return (
    <main className="min-h-dvh">
      <SimpleClient initial={r} saved={saved} prefetched={prefetched} />
    </main>
  );
}
