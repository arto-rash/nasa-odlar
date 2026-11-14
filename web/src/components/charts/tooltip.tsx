"use client";

import { AnimatePresence, motion } from "motion/react";

export function ChartTooltip({
  x, y, show, children, width, align = "auto",
}: {
  x: number;
  y: number;
  show: boolean;
  children: React.ReactNode;
  width: number;
  align?: "auto" | "left" | "right";
}) {
  const right = align === "right" || (align === "auto" && x > width * 0.62);
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1, x: right ? x - 14 : x + 14, y }}
          exit={{ opacity: 0, scale: 0.96 }}
          transition={{ type: "spring", stiffness: 600, damping: 42, opacity: { duration: 0.12 } }}
          className="pointer-events-none absolute left-0 top-0 z-20 min-w-[150px] rounded-md border border-line-strong bg-panel-solid/95 px-3 py-2 text-[13px] shadow-2xl"
          style={{ translateX: right ? "-100%" : 0, translateY: "-50%" }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function TipRow({ color, label, value, dashed }: { color?: string; label: React.ReactNode; value: React.ReactNode; dashed?: boolean }) {
  return (
    <div className="flex items-center gap-2 py-0.5">
      {color && (
        <span
          className="h-0.5 w-3 shrink-0 rounded-full"
          style={dashed ? { backgroundImage: `linear-gradient(90deg, ${color} 50%, transparent 50%)`, backgroundSize: "4px 2px" } : { background: color }}
        />
      )}
      <span className="flex-1 text-dim">{label}</span>
      <span className="tabular tabular-nums text-text">{value}</span>
    </div>
  );
}
