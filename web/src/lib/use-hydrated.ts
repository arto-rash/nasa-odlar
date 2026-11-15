"use client";

import { useSyncExternalStore } from "react";

const noop = () => () => {};

/** true on the client after hydration, false during SSR, without an effect. */
export function useHydrated() {
  return useSyncExternalStore(noop, () => true, () => false);
}
