"use client";

import { useLocale, useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { useTransition } from "react";
import { usePathname, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/cn";

export function LocaleSwitch({ className }: { className?: string }) {
  const locale = useLocale();
  const t = useTranslations("nav");
  const router = useRouter();
  const pathname = usePathname();
  const params = useParams();
  const [pending, start] = useTransition();
  return (
    <div
      role="radiogroup"
      aria-label={t("language")}
      className={cn("flex items-center text-[14px]", pending && "opacity-70", className)}
    >
      {(["az", "en"] as const).map((l, i) => (
        <button
          key={l}
          role="radio"
          aria-checked={locale === l}
          onClick={() =>
            start(() => {
              // @ts-expect-error -- pathname + params always form a valid route here
              router.replace({ pathname, params }, { locale: l, scroll: false });
            })
          }
          className={cn(
            "h-9 px-1.5 uppercase transition-colors",
            i === 0 && "after:ml-3 after:text-line-strong after:content-['/']",
            locale === l ? "font-semibold text-text" : "text-faint hover:text-text",
          )}
        >
          {l}
        </button>
      ))}
    </div>
  );
}
