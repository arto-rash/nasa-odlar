"use client";

import { cn } from "@/lib/cn";

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
  size = "md",
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: React.ReactNode; color?: string }[];
  className?: string;
  size?: "sm" | "md";
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cn("inline-flex divide-x divide-line-strong overflow-hidden rounded-md ring-1 ring-inset ring-line-strong", className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={cn(
              "flex items-center gap-2 whitespace-nowrap font-medium transition-colors",
              size === "sm" ? "h-8 px-3 text-[13.5px]" : "h-9 px-3.5 text-[14px]",
              active ? "bg-text text-bg" : "text-dim hover:bg-panel-hover hover:text-text",
            )}
          >
            {o.color && <span className="h-0.5 w-3" style={{ background: o.color }} />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
