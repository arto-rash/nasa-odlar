"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { startTransition, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { isStaleBuildError, reloadOnce } from "@/lib/stale-build";

export default function ErrorPage({ error, reset }: { error: Error; reset: () => void }) {
  const t = useTranslations("errors");
  const tc = useTranslations("common");
  const router = useRouter();
  // a page from an older build: a fresh load fixes it, so do that instead of asking
  useEffect(() => {
    if (isStaleBuildError(error)) reloadOnce();
  }, [error]);
  // fetch the page again from the server, then re-render it
  const retry = () =>
    startTransition(() => {
      router.refresh();
      reset();
    });
  return (
    <main className="grid min-h-dvh place-items-center px-5 text-center">
      <div className="max-w-[440px]">
        <h1 className="font-display text-[2rem]">{t("genericTitle")}</h1>
        <p className="mt-2 text-dim">{t("genericLead")}</p>
        <div className="mt-8 flex justify-center gap-2">
          <Button variant="primary" onClick={retry}>
            {tc("retry")}
          </Button>
          <Button variant="outline" onClick={() => window.location.reload()}>{t("reload")}</Button>
        </div>
      </div>
    </main>
  );
}
