"use client";

import { ChevronDown, Search } from "lucide-react";
import { useId, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { matchScore } from "@/lib/search";

export interface CountryOption {
  value: string;
  label: string;
  /** other names it should be found by (e.g. the name in the other language) */
  alt?: string;
}

/** A country picker you can type into: ~200 countries are too many to scroll a
 *  plain <select> through. Matches either language's name. */
export function CountryCombobox({
  value, options, onChange, ariaLabel, placeholder, className,
}: {
  value: string;
  options: CountryOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  placeholder?: string;
  className?: string;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const current = options.find((o) => o.value === value);
  const items = useMemo(
    () =>
      q.trim()
        ? options
            .map((o) => ({ o, s: matchScore(q, o.label, o.alt ?? "") }))
            .filter((x) => x.s > 0)
            .sort((a, b) => b.s - a.s)
            .map((x) => x.o)
        : options,
    [q, options],
  );

  const pick = (o: CountryOption) => {
    onChange(o.value);
    setQ("");
    setOpen(false);
    input.current?.blur();
  };

  return (
    <div className={cn("relative", className)}>
      <label className="flex h-9 items-center gap-2 rounded-md bg-bg-sunken px-3 ring-1 ring-line focus-within:ring-ember-400">
        <Search className="size-3.5 shrink-0 text-faint" aria-hidden />
        <input
          ref={input}
          role="combobox"
          aria-label={ariaLabel}
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          value={open ? q : (current?.label ?? "")}
          placeholder={open ? (current?.label ?? placeholder) : placeholder}
          onFocus={() => {
            setOpen(true);
            setQ("");
            setActive(Math.max(0, options.findIndex((o) => o.value === value)));
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
            } else if (e.key === "Escape") {
              setOpen(false);
              input.current?.blur();
            }
          }}
          className="w-full min-w-0 bg-transparent text-[13px] text-text outline-none placeholder:text-faint"
        />
        <ChevronDown className={cn("size-3.5 shrink-0 text-faint transition-transform", open && "rotate-180")} aria-hidden />
      </label>
      {open && (
        <ul id={listId} role="listbox" className="absolute z-40 mt-1 max-h-72 w-full min-w-[220px] overflow-auto rounded-md bg-panel py-1 shadow-lg ring-1 ring-line-strong">
          {items.length === 0 && <li className="px-3 py-2 text-[13px] text-faint">–</li>}
          {items.map((o, i) => (
            <li
              key={o.value}
              role="option"
              aria-selected={o.value === value}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(o);
              }}
              onMouseEnter={() => setActive(i)}
              className={cn(
                "cursor-pointer truncate px-3 py-1.5 text-[13.5px]",
                i === active && "bg-bg-sunken",
                o.value === value && "font-medium text-ember-400",
              )}
            >
              {o.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
