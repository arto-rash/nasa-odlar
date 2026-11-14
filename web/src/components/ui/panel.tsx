import { cn } from "@/lib/cn";

export function Panel({
  className,
  children,
  as: As = "section",
  ...rest
}: React.HTMLAttributes<HTMLElement> & { as?: "section" | "div" | "article" | "aside" }) {
  return (
    <As className={cn("glass relative rounded-[var(--radius-panel)]", className)} {...rest}>
      {children}
    </As>
  );
}

export function PanelHeader({
  eyebrow,
  title,
  aside,
  className,
}: {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  aside?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("flex flex-wrap items-end justify-between gap-3", className)}>
      <div className="min-w-0">
        {eyebrow && <p className="mb-1 text-[13px] text-faint">{eyebrow}</p>}
        <h2 className="font-display text-[1.3rem] leading-tight text-text">{title}</h2>
      </div>
      {aside}
    </header>
  );
}

export function Eyebrow({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={cn("text-[14px] font-medium text-dim", className)}>{children}</p>
  );
}
