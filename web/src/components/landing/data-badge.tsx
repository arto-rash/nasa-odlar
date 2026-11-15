"use client";

import * as Tooltip from "@radix-ui/react-tooltip";
import { useTranslations } from "next-intl";

/** Where the record comes from: NASA FIRMS, every satellite. */
export function DataBadge() {
  const t = useTranslations("common");
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <button
          type="button"
          className="text-[14px] text-dim underline decoration-dotted decoration-1 underline-offset-4 hover:text-text"
        >
          {t("realBadge")}
        </button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content sideOffset={6} className="z-[80] max-w-[300px] rounded-md border border-line-strong bg-panel-solid px-3 py-2 text-[13px] leading-relaxed text-dim shadow-lg">
          NASA FIRMS MODIS C6.1 · VIIRS 375 m
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
