"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as Tooltip from "@radix-ui/react-tooltip";
import { useState, type ReactNode } from "react";
import { Toaster } from "sonner";
import { DataWarmup } from "./data-warmup";
import { SmoothScroll } from "./smooth-scroll";

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 5 * 60_000, refetchOnWindowFocus: false, retry: 1 } },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <Tooltip.Provider delayDuration={120} skipDelayDuration={300}>
        <SmoothScroll />
        <DataWarmup />
        {children}
        <Toaster
          position="bottom-center"
          toastOptions={{
            className: "!bg-panel-solid !text-text !border-line-strong !rounded-2xl !font-sans",
          }}
        />
      </Tooltip.Provider>
    </QueryClientProvider>
  );
}
