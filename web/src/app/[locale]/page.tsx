import { setRequestLocale } from "next-intl/server";
import { Footer } from "@/components/layout/footer";
import { Hero } from "@/components/landing/hero";
import { Audiences, ClockTeaser, Numbers, Pipeline, RiskNow, WhyNow } from "@/components/landing/sections";
import { SplitStory } from "@/components/landing/split-story";
import { api } from "@/lib/upstream";
import type { CalendarPayload, Overview } from "@/lib/types";

export const revalidate = 600;

export default async function Home({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [overview, cal] = await Promise.all([api<Overview>("/overview"), api<CalendarPayload>("/regions/az/calendar")]);
  const endYear = new Date(overview.meta.data_end).getUTCFullYear();
  return (
    <main>
      <Hero overview={overview} />
      <SplitStory pilot={overview.pilot} endYear={endYear} />
      <Numbers overview={overview} />
      <ClockTeaser cal={cal} />
      <RiskNow overview={overview} />
      <Audiences />
      <Pipeline />
      <WhyNow />
      <Footer />
    </main>
  );
}
