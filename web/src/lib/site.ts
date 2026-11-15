/** The public address of the site (links in reports, sitemap, metadata). */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://odlar.app").replace(/\/$/, "");

/** A page's path in a language: English has no prefix, Azerbaijani is under /az. */
export const localePath = (locale: string, path = ""): string => (locale === "az" ? `/az${path}` : path || "/");
