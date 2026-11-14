"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { http } from "./client";
import type { Region } from "./types";

/** Every region with its annual series. Only for small sets: use the filtered hooks below. */
export function useRegions() {
  return useQuery({ queryKey: ["regions"], queryFn: () => http<Region[]>("/regions"), staleTime: 30 * 60_000 });
}

function useDebounced<T>(value: T, ms = 200): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

/**
 * Regions matching a search, ranked by the server (name starts with the query
 * first). With an empty query: the countries, so pickers have something to show.
 * The world has ~25,000 regions, too many to load and filter in the browser.
 */
export function useRegionSearch(q: string, limit = 20) {
  const term = useDebounced(q.trim());
  return useQuery({
    queryKey: ["regions-search", term, limit],
    queryFn: () =>
      http<Region[]>(term ? `/regions?q=${encodeURIComponent(term)}&limit=${limit}&lite=true` : `/regions?level=country&lite=true`),
    placeholderData: keepPreviousData,
    staleTime: 10 * 60_000,
  });
}

/** The regions of one country (or every region under a parent region). */
export function useCountryRegions(country: string | null, lite = false) {
  return useQuery({
    queryKey: ["regions-country", country, lite],
    enabled: !!country,
    queryFn: () => http<Region[]>(`/regions?country=${country}${lite ? "&lite=true" : ""}`),
    placeholderData: keepPreviousData,
    staleTime: 10 * 60_000,
  });
}
