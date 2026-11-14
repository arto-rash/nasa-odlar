import { Eyebrow } from "@/components/ui/panel";
import { SplitReveal } from "@/components/ui/reveal";

export function PageHeader({ eyebrow, title, lead, children }: { eyebrow?: string; title: string; lead?: string; children?: React.ReactNode }) {
  return (
    <header className="relative overflow-hidden pb-10 pt-28 sm:pt-36">
      <div className="relative mx-auto max-w-[1240px] px-5 sm:px-8">
        {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
        <SplitReveal as="h1" text={title} className="font-display mt-4 text-[clamp(2.6rem,6vw,5rem)] leading-[1.05]" />
        {lead && <p className="mt-5 max-w-[62ch] text-[clamp(1rem,1.4vw,1.15rem)] leading-relaxed text-dim">{lead}</p>}
        {children}
      </div>
    </header>
  );
}
