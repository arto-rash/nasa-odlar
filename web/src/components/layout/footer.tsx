import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Wordmark } from "./logo";

export function Footer() {
  const t = useTranslations("footer");
  const tn = useTranslations("nav");
  return (
    <footer className="relative mt-24 border-t border-line">
      <div className="mx-auto grid max-w-[1240px] gap-10 px-5 py-14 sm:px-8 md:grid-cols-[1.2fr_1fr_1fr]">
        <div>
          <Wordmark />
          <p className="mt-4 max-w-[36ch] text-[14px] leading-relaxed text-dim">{t("tagline")}</p>
          <p className="mt-6 text-[13px] text-faint">{t("challenge")}</p>
        </div>
        <nav className="grid grid-cols-2 gap-2 text-[14px]">
          {(["explore", "regions", "risk", "compare", "methodology", "data", "simple"] as const).map((k) => (
            <Link key={k} href={`/${k}`} className="text-dim transition hover:text-text">
              {tn(k)}
            </Link>
          ))}
        </nav>
        <div>
          <p className="text-[12.5px] font-semibold text-faint">{t("sources")}</p>
          <p className="mt-3 text-[13px] leading-relaxed text-dim">{t("credits")}</p>
          <p className="mt-6 text-[13px] leading-relaxed text-faint">{t("disclaimer")}</p>
        </div>
      </div>
    </footer>
  );
}
