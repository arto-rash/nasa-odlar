import { defineRouting } from "next-intl/routing";

// English at the bare address (odlar.app/explore); Azerbaijani under /az. The
// site always opens in English: no guessing from the browser or an old cookie.
export const routing = defineRouting({
  locales: ["en", "az"],
  defaultLocale: "en",
  localePrefix: "as-needed",
  localeDetection: false,
});

export type Locale = (typeof routing.locales)[number];
