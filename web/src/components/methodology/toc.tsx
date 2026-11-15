"use client";

import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";

export function Toc({ items, title }: { items: { id: string; label: string }[]; title: string }) {
  const [active, setActive] = useState(items[0]?.id);
  useEffect(() => {
    const obs = new IntersectionObserver(
      (entries) => {
        const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (vis[0]) setActive(vis[0].target.id);
      },
      { rootMargin: "-20% 0px -65% 0px" },
    );
    items.forEach((i) => {
      const el = document.getElementById(i.id);
      if (el) obs.observe(el);
    });
    return () => obs.disconnect();
  }, [items]);
  return (
    <nav aria-label={title} className="sticky top-28 hidden self-start lg:block">
      <p className="mb-3 text-[12.5px] font-semibold text-faint">{title}</p>
      <ul className="relative space-y-0.5 border-l border-line">
        {items.map((i) => (
          <li key={i.id} className="relative">
            {active === i.id && <motion.span layoutId="toc" className="absolute -left-px top-0 h-full w-0.5 bg-ember-400" transition={{ type: "spring", stiffness: 400, damping: 34 }} />}
            <a href={`#${i.id}`} className={cn("block py-1.5 pl-4 text-[13px] transition-colors", active === i.id ? "text-text" : "text-faint hover:text-dim")}>
              {i.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
