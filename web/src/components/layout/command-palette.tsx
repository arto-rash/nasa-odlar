"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Command } from "cmdk";
import { ArrowRight, Flame, Languages, Map, MoonStar, Search } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "@/i18n/navigation";
import { RISK_COLOR } from "@/lib/colors";
import { regionName, type AppLocale } from "@/lib/format";
import { useRegions } from "@/lib/queries";
import { matchScore } from "@/lib/search";
import { useUi } from "@/lib/store";
import { useTheme } from "./theme-toggle";

const PAGES = ["explore", "regions", "risk", "compare", "methodology", "data", "simple", "alerts"] as const;

export function CommandPalette() {
  const t = useTranslations("palette");
  const tn = useTranslations("nav");
  const locale = useLocale() as AppLocale;
  const open = useUi((s) => s.paletteOpen);
  const setOpen = useUi((s) => s.setPalette);
  const router = useRouter();
  const pathname = usePathname();
  const [theme, setTheme] = useTheme();
  const [query, setQuery] = useState("");
  const { data: regions } = useRegions();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(!useUi.getState().paletteOpen);
      }
      if (e.key === "/" && !(e.target as HTMLElement)?.closest("input,textarea,[contenteditable]")) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setOpen]);


  const go = (href: string) => {
    setOpen(false);
    setQuery("");
    router.push(href);
  };

  const ranked = useMemo(() => {
    if (!regions) return [];
    return regions
      .map((r) => ({ r, s: matchScore(query, r.name_az, r.name_en, r.slug) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s || (a.r.level === "country" ? -1 : 1))
      .slice(0, query ? 12 : 8);
  }, [regions, query]);

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setQuery("");
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[70] bg-bg/60 data-[state=open]:animate-in" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed border border-line-strong bg-panel-solid shadow-2xl left-1/2 top-[12vh] z-[71] w-[min(640px,calc(100vw-24px))] -translate-x-1/2 overflow-hidden rounded-lg"
        >
          <Dialog.Title className="sr-only">{t("title")}</Dialog.Title>
          <Command shouldFilter={false} loop className="flex flex-col">
            <div className="flex items-center gap-3 border-b border-line px-5">
              <Search className="size-4 text-faint" />
              <Command.Input
                value={query}
                onValueChange={setQuery}
                placeholder={t("placeholder")}
                className="h-14 flex-1 bg-transparent text-[15px] outline-none placeholder:text-faint"
              />
              <kbd className="rounded border border-line-strong px-1.5 py-0.5 text-[12px] text-faint">Esc</kbd>
            </div>
            <Command.List className="max-h-[56vh] overflow-y-auto p-2 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:text-[13px] [&_[cmdk-group-heading]]:text-faint">
              <Command.Empty className="px-4 py-10 text-center text-sm text-dim">{t("empty")}</Command.Empty>
              {ranked.length > 0 && (
                <Command.Group heading={t("regions")}>
                  {ranked.map(({ r }) => (
                    <Item key={r.slug} value={`r-${r.slug}`} onSelect={() => go(`/region/${r.slug}`)}>
                      <span
                        className="size-2.5 shrink-0 rounded-full"
                        style={{ background: r.risk ? RISK_COLOR[r.risk.level] : "var(--line-strong)" }}
                      />
                      <span className="flex-1 truncate">{regionName(r, locale)}</span>
                      <span className="text-[12.5px] text-faint">
                        {r.level === "country" ? t("country") : r.country.toUpperCase()}
                      </span>
                    </Item>
                  ))}
                </Command.Group>
              )}
              <Command.Group heading={t("pages")}>
                {PAGES.filter((p) => matchScore(query, tn(p, { count: 0 })) > 0).map((p) => (
                  <Item key={p} value={`p-${p}`} onSelect={() => go(`/${p}`)}>
                    {p === "explore" ? <Map className="size-4 text-dim" /> : <Flame className="size-4 text-dim" />}
                    <span className="flex-1">{tn(p, { count: 0 })}</span>
                    <ArrowRight className="size-3.5 text-faint" />
                  </Item>
                ))}
              </Command.Group>
              <Command.Group heading={t("actions")}>
                <Item value="a-theme" onSelect={() => { setTheme(theme === "dark" ? "light" : "dark"); setOpen(false); }}>
                  <MoonStar className="size-4 text-dim" />
                  <span className="flex-1">{t("toggleTheme")}</span>
                </Item>
                <Item
                  value="a-lang"
                  onSelect={() => {
                    setOpen(false);
                    router.replace(pathname, { locale: locale === "az" ? "en" : "az" });
                  }}
                >
                  <Languages className="size-4 text-dim" />
                  <span className="flex-1">{t("switchLanguage")}</span>
                </Item>
              </Command.Group>
            </Command.List>
          </Command>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Item({ children, value, onSelect }: { children: React.ReactNode; value: string; onSelect: () => void }) {
  return (
    <Command.Item
      value={value}
      onSelect={onSelect}
      className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2.5 text-[14px] text-dim transition-colors data-[selected=true]:bg-panel-hover data-[selected=true]:text-text"
    >
      {children}
    </Command.Item>
  );
}
