"use client";

import * as Tooltip from "@radix-ui/react-tooltip";
import { Info } from "lucide-react";

export function InfoTip({ children, label = "Info" }: { children: React.ReactNode; label?: string }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <button type="button" aria-label={label} className="inline-grid size-5 place-items-center rounded-full text-faint transition hover:text-text">
          <Info className="size-3.5" />
        </button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          sideOffset={6}
          className="z-[80] max-w-[280px] rounded-md border border-line-strong bg-panel-solid px-3 py-2 text-[13px] leading-relaxed text-dim shadow-2xl"
        >
          {children}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
