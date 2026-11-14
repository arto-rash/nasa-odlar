import { cn } from "@/lib/cn";

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={cn("size-7", className)} aria-hidden>
      <path
        d="M20 3.5c2.2 6.6 10.4 11 10.4 20.6a10.4 10.4 0 0 1-20.8 0c0-5.2 3-8.2 5.2-10.4 0 3.7 1.5 5.9 3.7 6.7-1.5-6 0-11.9 1.5-16.9z"
        fill="var(--ember-500)"
      />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <LogoMark />
      <span className="font-display text-[1.3rem]">ODLAR</span>
    </span>
  );
}
