import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Suspense } from "react";
import { LoginClient } from "@/components/auth/login-client";
import { api } from "@/lib/upstream";
import type { CalendarPayload } from "@/lib/types";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "auth" });
  return { title: t("login") };
}

export default async function LoginPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const cal = await api<CalendarPayload>("/regions/az-sabirabad/calendar").catch(() => null);
  return (
    <main>
      <Suspense>
        <LoginClient cal={cal} />
      </Suspense>
    </main>
  );
}
