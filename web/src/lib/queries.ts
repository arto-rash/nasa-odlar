"use client";

import { useQuery } from "@tanstack/react-query";
import { http } from "./client";
import type { Region } from "./types";

export function useRegions() {
  return useQuery({ queryKey: ["regions"], queryFn: () => http<Region[]>("/regions"), staleTime: 30 * 60_000 });
}
