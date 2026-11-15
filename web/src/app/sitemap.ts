import type { MetadataRoute } from "next";
import { routing } from "@/i18n/routing";
import { localePath, SITE_URL } from "@/lib/site";

// The public pages, each in both languages (region pages are reached from these).
const PAGES = ["", "/explore", "/risk", "/regions", "/compare", "/simple", "/methodology", "/data", "/region/az"];

export default function sitemap(): MetadataRoute.Sitemap {
  return PAGES.flatMap((path) =>
    routing.locales.map((locale) => ({
      url: `${SITE_URL}${localePath(locale, path)}`,
      changeFrequency: path === "" || path === "/risk" ? ("daily" as const) : ("weekly" as const),
      priority: path === "" ? 1 : 0.7,
      alternates: { languages: Object.fromEntries(routing.locales.map((l) => [l, `${SITE_URL}${localePath(l, path)}`])) },
    })),
  );
}
