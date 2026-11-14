import type { Metadata, Viewport } from "next";
import { Geologica } from "next/font/google";
import { notFound } from "next/navigation";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ViewTransition } from "react";
import { routing } from "@/i18n/routing";
import { SITE_URL } from "@/lib/site";
import { Providers } from "@/components/layout/providers";
import { SiteNav } from "@/components/layout/site-nav";
import { CommandPalette } from "@/components/layout/command-palette";
import { InlineScript } from "@/components/layout/inline-script";
import "../globals.css";

// One family throughout: Geologica has Azerbaijani ə/Ə, tabular figures, and a "sharpness" axis
// that cuts the headline corners like flame tips.
const geologica = Geologica({ subsets: ["latin", "latin-ext"], variable: "--font-geologica", axes: ["SHRP"], display: "swap" });

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "meta" });
  return {
    metadataBase: new URL(SITE_URL),
    title: { default: t("title"), template: `%s · ODLAR` },
    description: t("description"),
    openGraph: { title: t("title"), description: t("description"), type: "website", locale },
    alternates: { languages: { az: "/az", en: "/en" } },
    icons: { icon: "/icon.svg" },
  };
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#111213" },
    { media: "(prefers-color-scheme: light)", color: "#f6f5f2" },
  ],
  width: "device-width",
  initialScale: 1,
};

// Applies the saved theme before first paint so there is no light/dark flash.
const THEME_SCRIPT = `try{var t=localStorage.getItem('odlar-theme');document.documentElement.dataset.theme=t==='light'||t==='dark'?t:'dark'}catch(e){document.documentElement.dataset.theme='dark'}`;

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  return (
    <html
      lang={locale}
      data-theme="dark"
      suppressHydrationWarning
      className={geologica.variable}
    >
      <head>
        <InlineScript html={THEME_SCRIPT} />
      </head>
      <body className="min-h-dvh">
        <NextIntlClientProvider>
          <Providers>
            <SiteNav />
            <CommandPalette />
            <ViewTransition name="page">
              <div id="main">{children}</div>
            </ViewTransition>
          </Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
