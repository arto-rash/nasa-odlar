"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  const t = useTranslations("errors");
  const tc = useTranslations("common");
  return (
    <main className="grid min-h-dvh place-items-center px-5 text-center">
      <div className="max-w-[440px]">
        <h1 className="font-display text-[2rem]">{t("genericTitle")}</h1>
        <p className="mt-2 text-dim">{t("genericLead")}</p>
        <Button variant="primary" className="mt-8" onClick={reset}>
          {tc("retry")}
        </Button>
      </div>
    </main>
  );
}
