"use client";

import { useQuery } from "@tanstack/react-query";
import { Bell, Loader2, LocateFixed, Menu, Search, X } from "lucide-react";
import { motion, useMotionValueEvent, useScroll } from "motion/react";
import { useTranslations } from "next-intl";
import { useCallback, useState } from "react";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { http } from "@/lib/client";
import { cn } from "@/lib/cn";
import { useAuth, useUi } from "@/lib/store";
import { useNearMe } from "@/lib/use-near-me";
import { LocaleSwitch } from "./locale-switch";
import { Wordmark } from "./logo";
import { ThemeToggle } from "./theme-toggle";

const LINKS = [
  { href: "/explore", key: "explore" },
  { href: "/regions", key: "regions" },
  { href: "/risk", key: "risk" },
  { href: "/compare", key: "compare" },
  { href: "/methodology", key: "methodology" },
  { href: "/data", key: "data" },
] as const;

export function SiteNav() {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const setPalette = useUi((s) => s.setPalette);
  const [hidden, setHidden] = useState(false);
  // the menu is open for the page it was opened on; navigating closes it
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === pathname;
  const setOpen = (fn: (o: boolean) => boolean) => setOpenOn(fn(open) ? pathname : null);
  const { scrollY } = useScroll();

  useMotionValueEvent(scrollY, "change", (y) => {
    const prev = scrollY.getPrevious() ?? 0;
    setHidden(y > 240 && y > prev + 4);
    if (y < prev - 4) setHidden(false);
  });

  return (
    <>
      <motion.header
        initial={false}
        animate={{ y: hidden && !open ? -64 : 0 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        className="fixed inset-x-0 top-0 z-50 border-b border-line bg-bg print:hidden"
      >
        <nav aria-label={t("main")} className="mx-auto flex h-14 w-full max-w-[1240px] items-center gap-2 px-5 sm:px-8">
          <Link href="/" className="mr-4 shrink-0" aria-label="ODLAR">
            <Wordmark />
          </Link>
          <ul className="hidden h-full items-stretch gap-1 lg:flex">
            {LINKS.map((l) => {
              const active = pathname === l.href || pathname.startsWith(l.href + "/") || (l.href === "/regions" && pathname.startsWith("/region/"));
              return (
                <li key={l.href} className="flex">
                  <Link
                    href={l.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex items-center border-b-2 px-2.5 pt-0.5 text-[14.5px] transition-colors",
                      active ? "border-ember-500 font-semibold text-text" : "border-transparent text-dim hover:text-text",
                    )}
                  >
                    {t(l.key)}
                  </Link>
                </li>
              );
            })}
          </ul>
          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              onClick={() => setPalette(true)}
              className="hidden h-9 items-center gap-2 rounded-md px-2.5 text-[14px] text-dim transition-colors hover:bg-panel-hover hover:text-text md:flex"
            >
              <Search className="size-4" />
              <span>{t("search")}</span>
            </button>
            <NearMe />
            <AlertsBell />
            <ThemeToggle />
            <LocaleSwitch className="hidden sm:flex" />
            <Link
              href="/simple"
              className="ml-2 hidden h-9 items-center rounded-md bg-ember px-3.5 text-[14px] font-semibold text-white transition-colors hover:brightness-90 sm:flex"
            >
              {t("simple")}
            </Link>
            <button
              type="button"
              className="grid size-9 place-items-center rounded-md text-dim hover:text-text lg:hidden"
              aria-label={t(open ? "closeMenu" : "openMenu")}
              aria-expanded={open}
              onClick={() => setOpen((o) => !o)}
            >
              {open ? <X className="size-5" /> : <Menu className="size-5" />}
            </button>
          </div>
        </nav>
      </motion.header>

      {open && (
        <div className="fixed inset-0 top-14 z-40 overflow-y-auto bg-bg lg:hidden">
          <ul className="flex flex-col px-5 pt-2">
            {[...LINKS, { href: "/simple", key: "simple" } as const].map((l) => (
              <li key={l.href} className="border-b border-line">
                <Link href={l.href} className="font-display block py-4 text-[1.5rem] text-text">
                  {t(l.key)}
                </Link>
              </li>
            ))}
            <li className="mt-6 flex gap-3">
              <LocaleSwitch />
              <button onClick={() => setPalette(true)} className="flex items-center gap-2 rounded-md px-4 text-[15px] text-dim ring-1 ring-line-strong">
                <Search className="size-4" />
                {t("search")}
              </button>
            </li>
          </ul>
        </div>
      )}
    </>
  );
}

// Opens the region the device is in (explore and risk have their own, which keep you on the map).
function NearMe() {
  const tc = useTranslations("common");
  const router = useRouter();
  const pathname = usePathname();
  const { locate, locating } = useNearMe(useCallback((r) => router.push(`/region/${r.slug}`), [router]));
  if (pathname.startsWith("/explore") || pathname.startsWith("/risk") || pathname.startsWith("/simple")) return null;
  return (
    <button
      type="button"
      onClick={locate}
      disabled={locating}
      aria-label={tc("nearMeHint")}
      title={tc("nearMeHint")}
      className="grid size-9 place-items-center rounded-md text-dim transition-colors hover:bg-panel-hover hover:text-text disabled:opacity-70"
    >
      {locating ? <Loader2 className="size-[18px] animate-spin" /> : <LocateFixed className="size-[18px]" />}
    </button>
  );
}

function AlertsBell() {
  const t = useTranslations("nav");
  const token = useAuth((s) => s.token);
  const { data } = useQuery({
    queryKey: ["alerts-unread", token],
    queryFn: () => http<{ count: number }>("/alerts/unread-count"),
    enabled: Boolean(token),
    refetchInterval: 60_000,
  });
  const count = data?.count ?? 0;
  return (
    <Link
      href={token ? "/alerts" : "/login"}
      aria-label={t("alerts", { count })}
      className="relative grid size-9 place-items-center rounded-md text-dim transition-colors hover:bg-panel-hover hover:text-text"
    >
      <Bell className="size-[18px]" />
      {count > 0 && (
        <span className="absolute right-0.5 top-0.5 grid min-w-4 place-items-center rounded-full bg-ember px-1 text-[11px] font-bold leading-4 text-white">
          {count > 9 ? "9+" : count}
        </span>
      )}
    </Link>
  );
}
