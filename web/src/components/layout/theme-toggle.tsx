"use client";

import { Moon, Sun } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";

export function useTheme(): ["dark" | "light", (t: "dark" | "light") => void] {
  const [theme, setThemeState] = useState<"dark" | "light">("dark");
  useEffect(() => {
    const read = () => setThemeState(document.documentElement.dataset.theme === "light" ? "light" : "dark");
    read();
    const obs = new MutationObserver(read);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);
  const setTheme = (t: "dark" | "light") => {
    const apply = () => {
      document.documentElement.dataset.theme = t;
      try {
        localStorage.setItem("odlar-theme", t);
      } catch {}
    };
    const doc = document as Document & { startViewTransition?: (cb: () => void) => void };
    if (doc.startViewTransition && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      doc.startViewTransition(apply);
    } else apply();
  };
  return [theme, setTheme];
}

export function ThemeToggle({ className }: { className?: string }) {
  const t = useTranslations("nav");
  const [theme, setTheme] = useTheme();
  const next = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      aria-label={t(next === "light" ? "themeLight" : "themeDark")}
      className={cn(
        "relative grid size-9 place-items-center rounded-full text-dim transition hover:bg-panel-hover hover:text-text",
        className,
      )}
    >
      <Sun className={cn("size-[18px] transition duration-500", theme === "dark" ? "scale-0 -rotate-90 opacity-0" : "scale-100")} />
      <Moon className={cn("absolute size-[18px] transition duration-500", theme === "dark" ? "scale-100" : "scale-0 rotate-90 opacity-0")} />
    </button>
  );
}
