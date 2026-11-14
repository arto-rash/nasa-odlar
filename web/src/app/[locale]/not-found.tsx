import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { rich } from "@/lib/rich";

export default function NotFound() {
  const t = useTranslations("errors");
  return (
    <main className="grid min-h-dvh place-items-center px-5 text-center">
      <div>
        <p className="font-display text-[clamp(6rem,22vw,14rem)] leading-none text-ember opacity-90">404</p>
        <h1 className="font-display mt-2 text-[2rem]">{t.rich("notFoundTitle", rich)}</h1>
        <p className="mt-2 text-dim">{t("notFoundLead")}</p>
        <Link href="/" className="mt-8 inline-block">
          <Button variant="primary">{t("home")}</Button>
        </Link>
      </div>
    </main>
  );
}
