"use client";

import { Search } from "lucide-react";
import { useLocale } from "next-intl";
import { useId, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { regionName, type AppLocale } from "@/lib/format";
import { useRegionSearch } from "@/lib/queries";
import type { RegionRef } from "@/lib/types";
import { RegionPlace } from "@/components/ui/region-place";

/**
 * Pick a region by typing its name: the server returns the best matches, so this
 * works for the whole world (~25,000 regions), unlike a <select> listing them all.
 */
export function RegionCombobox({
  value, valueLabel, onChange, placeholder, className, leavesOnly = false,
}: {
  value: string | null;
  valueLabel?: string;
  onChange: (slug: string, region: RegionRef) => void;
  placeholder?: string;
  className?: string;
  leavesOnly?: boolean;
}) {
  const locale = useLocale() as AppLocale;
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const { data } = useRegionSearch(q, 30);
  const items = (data ?? []).filter((r) => !leavesOnly || r.level !== "country").slice(0, 20);

  const pick = (r: RegionRef) => {
    onChange(r.slug, r);
    setQ("");
    setOpen(false);
    input.current?.blur();
  };

  return (
    <div className={cn("relative", className)}>
      <label className="flex h-10 items-center gap-2 rounded-md bg-panel px-3 ring-1 ring-line-strong focus-within:ring-ember-400">
        <Search className="size-3.5 shrink-0 text-faint" aria-hidden />
        <input
          ref={input}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          value={open ? q : (valueLabel ?? value ?? "")}
          placeholder={placeholder}
          onFocus={() => {
            setOpen(true);
            setActive(0);
          }}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") setActive((i) => Math.min(i + 1, items.length - 1));
            else if (e.key === "ArrowUp") setActive((i) => Math.max(i - 1, 0));
            else if (e.key === "Enter" && items[active]) {
              e.preventDefault();
              pick(items[active]);
            } else if (e.key === "Escape") setOpen(false);
          }}
          className="w-full min-w-0 bg-transparent text-[14px] text-text outline-none placeholder:text-faint"
        />
      </label>
      {open && items.length > 0 && (
        <ul id={listId} role="listbox" className="absolute z-30 mt-1 max-h-72 w-full min-w-[240px] overflow-auto rounded-md bg-panel py-1 shadow-lg ring-1 ring-line-strong">
          {items.map((r, i) => (
            <li
              key={r.slug}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(r);
              }}
              onMouseEnter={() => setActive(i)}
              className={cn("flex cursor-pointer items-baseline justify-between gap-3 px-3 py-1.5 text-[13.5px]", i === active && "bg-bg-sunken")}
            >
              <span className="min-w-0">
                <span className="block truncate">{regionName(r, locale)}</span>
                <RegionPlace r={r} className="text-[11.5px]" />
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
