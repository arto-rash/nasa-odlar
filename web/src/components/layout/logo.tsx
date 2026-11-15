import { cn } from "@/lib/cn";

/* The ODLAR logo (flame towers on a ring of light), as separated from the artwork:
 * the glowing version for the dark theme, the solid one with dark lettering for the
 * light theme. Both are in the page; the theme's CSS shows one (no flash on load,
 * since the theme is set on <html> before paint). Source files: the brand pack. */

/* eslint-disable @next/next/no-img-element -- tiny fixed-size brand images, served as they are */

/** Mark and name side by side: the header, footer, login and report. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex h-8 items-center", className)}>
      <img src="/brand/odlar-horizontal-dark.png" alt="ODLAR" width={751} height={144} className="hidden h-full w-auto dark:block" />
      <img src="/brand/odlar-horizontal-light.png" alt="ODLAR" width={756} height={144} className="block h-full w-auto dark:hidden" />
    </span>
  );
}

/** The flame towers alone, for tight spots. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex size-7 items-center justify-center", className)} aria-hidden>
      <img src="/brand/odlar-mark-dark.png" alt="" width={253} height={160} className="hidden max-h-full w-auto dark:block" />
      <img src="/brand/odlar-mark-light.png" alt="" width={258} height={160} className="block max-h-full w-auto dark:hidden" />
    </span>
  );
}
