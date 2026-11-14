"use client";

import { forwardRef } from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "ember" | "ghost" | "outline";

const styles: Record<Variant, string> = {
  primary: "bg-text text-bg hover:bg-text/90",
  ember: "bg-ember text-white hover:brightness-90",
  ghost: "text-dim hover:text-text hover:bg-panel-hover",
  outline: "text-text ring-1 ring-inset ring-line-strong hover:bg-panel-hover",
};

export const Button = forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" | "lg" }
>(function Button({ className, variant = "primary", size = "md", ...rest }, ref) {
  return (
    <button
      ref={ref}
      className={cn(
        "inline-flex select-none items-center justify-center gap-2 rounded-md text-center font-semibold leading-tight transition-colors duration-150 disabled:pointer-events-none disabled:opacity-50",
        size === "sm" && "min-h-8 px-3 py-1 text-[13px]",
        size === "md" && "min-h-10 px-4 py-2 text-[14px]",
        size === "lg" && "min-h-12 px-5 py-2 text-[15px]",
        styles[variant],
        className,
      )}
      {...rest}
    />
  );
});

/** Kept for call sites; no longer animates. */
export function Magnetic({ children, className }: { children: React.ReactNode; strength?: number; className?: string }) {
  return <div className={cn("inline-block", className)}>{children}</div>;
}
