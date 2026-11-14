"use client";

import { animate, useInView, useReducedMotion } from "motion/react";
import { useLocale } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { fmtNum, type AppLocale } from "@/lib/format";

/** Counts up to `value` the first time it scrolls into view. */
export function Ticker({
  value,
  digits = 0,
  duration = 1.6,
  prefix = "",
  suffix = "",
  format,
  className,
}: {
  value: number;
  digits?: number;
  duration?: number;
  prefix?: string;
  suffix?: string;
  format?: (v: number) => string;
  className?: string;
}) {
  const locale = useLocale() as AppLocale;
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-10% 0px" });
  const reduce = useReducedMotion();
  const [animated, setAnimated] = useState(0);
  useEffect(() => {
    if (!inView || reduce) return;
    const c = animate(0, value, { duration, ease: [0.16, 1, 0.3, 1], onUpdate: setAnimated });
    return () => c.stop();
  }, [inView, value, duration, reduce]);
  const display = reduce ? value : animated;
  return (
    <span ref={ref} className={className}>
      {prefix}
      {format ? format(display) : fmtNum(display, locale, digits)}
      {suffix}
    </span>
  );
}
