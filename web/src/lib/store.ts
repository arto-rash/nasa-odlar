"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { HOME_COOKIE } from "./home-cookie";
import type { User } from "./types";

interface AuthState {
  token: string | null;
  user: User | null;
  setSession: (token: string, user: User) => void;
  setUser: (user: User) => void;
  clear: () => void;
}

export const useAuth = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      setSession: (token, user) => set({ token, user }),
      setUser: (user) => set({ user }),
      clear: () => set({ token: null, user: null }),
    }),
    { name: "odlar-auth" },
  ),
);

interface UiState {
  paletteOpen: boolean;
  setPalette: (open: boolean) => void;
  homeRegion: string | null;
  setHomeRegion: (slug: string | null) => void;
}

/** Mirrors the home region into a cookie so /simple can server-render the right view. */
function writeHomeCookie(slug: string | null) {
  if (typeof document === "undefined") return;
  document.cookie = slug
    ? `${HOME_COOKIE}=${encodeURIComponent(slug)}; path=/; max-age=31536000; samesite=lax`
    : `${HOME_COOKIE}=; path=/; max-age=0; samesite=lax`;
}

export const useUi = create<UiState>()(
  persist(
    (set) => ({
      paletteOpen: false,
      setPalette: (paletteOpen) => set({ paletteOpen }),
      homeRegion: null,
      setHomeRegion: (homeRegion) => {
        writeHomeCookie(homeRegion);
        set({ homeRegion });
      },
    }),
    {
      name: "odlar-ui",
      partialize: (s) => ({ homeRegion: s.homeRegion }),
      onRehydrateStorage: () => (s) => writeHomeCookie(s?.homeRegion ?? null),
    },
  ),
);
