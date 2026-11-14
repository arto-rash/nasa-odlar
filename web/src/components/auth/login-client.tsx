"use client";

import { useMutation } from "@tanstack/react-query";
import { Loader2, UserRound } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { FireClock } from "@/components/charts/fire-clock";
import { Wordmark } from "@/components/layout/logo";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { useRouter } from "@/i18n/navigation";
import { http, HttpError } from "@/lib/client";
import { useAuth } from "@/lib/store";
import type { CalendarPayload, User } from "@/lib/types";
import { rich } from "@/lib/rich";

export function LoginClient({ cal }: { cal: CalendarPayload | null }) {
  const t = useTranslations("auth");
  const locale = useLocale();
  const router = useRouter();
  const next = useSearchParams().get("next") ?? "/alerts";
  const setSession = useAuth((s) => s.setSession);
  const [mode, setMode] = useState<"login" | "register">("login");
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [errors, setErrors] = useState<Record<string, string[]>>({});

  const auth = useMutation({
    mutationFn: (body: Record<string, string>) =>
      http<{ token: string; user: User }>(mode === "login" || body.demo ? "/auth/login" : "/auth/register", { method: "POST", json: body }),
    onSuccess: (r) => {
      setSession(r.token, r.user);
      router.push(next);
    },
    onError: (e) => {
      const body = e instanceof HttpError ? (e.body as { errors?: Record<string, string[]>; message?: string }) : undefined;
      setErrors(body?.errors ?? { email: [body?.message ?? (e as Error).message ?? t("error")] });
    },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});
    auth.mutate(mode === "login" ? { email: form.email, password: form.password } : { ...form, locale });
  };

  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <div className="relative hidden overflow-hidden bg-bg-sunken lg:block">
        {cal && (
          <div className="absolute inset-0 flex items-center justify-center p-16 opacity-90">
            <FireClock years={cal.years} matrix={cal.matrix} season={cal.season} anomalies={cal.anomalies} current={cal.current} className="w-full max-w-[560px]" />
          </div>
        )}
        <div className="absolute inset-x-0 bottom-0 p-12">
          <p className="font-display max-w-[16ch] text-[2.6rem] leading-[1.02]">{t.rich("visualTitle", rich)}</p>
          <p className="mt-3 max-w-[40ch] text-dim">{t("visualLead")}</p>
        </div>
      </div>
      <div className="flex items-center justify-center px-5 pb-16 pt-28">
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }} className="w-full max-w-[400px]">
          <Wordmark />
          <Segmented
            className="mt-8"
            label={t("login")}
            value={mode}
            onChange={(m) => {
              setMode(m);
              setErrors({});
            }}
            options={[
              { value: "login", label: t("login") },
              { value: "register", label: t("register") },
            ]}
          />
          <form onSubmit={submit} className="mt-7 space-y-4" noValidate>
            <AnimatePresence initial={false}>
              {mode === "register" && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                  <Input label={t("name")} value={form.name} onChange={(v) => setForm({ ...form, name: v })} error={errors.name?.[0]} autoComplete="name" />
                </motion.div>
              )}
            </AnimatePresence>
            <Input label={t("email")} type="email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} error={errors.email?.[0]} autoComplete="email" />
            <Input
              label={t("password")}
              type="password"
              value={form.password}
              onChange={(v) => setForm({ ...form, password: v })}
              error={errors.password?.[0]}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
            />
            <Button type="submit" variant="primary" size="lg" className="w-full" disabled={auth.isPending}>
              {auth.isPending && <Loader2 className="size-4 animate-spin" />}
              {mode === "login" ? t("submitLogin") : t("submitRegister")}
            </Button>
          </form>
          <div className="my-6 flex items-center gap-3 text-[12.5px] text-faint">
            <span className="h-px flex-1 bg-line" />
            ODLAR
            <span className="h-px flex-1 bg-line" />
          </div>
          <Button
            variant="outline"
            size="lg"
            className="w-full"
            onClick={() => {
              setErrors({});
              auth.mutate({ email: "demo@odlar.az", password: "odlar-demo-2026", demo: "1" });
            }}
          >
            <UserRound className="size-4 text-dim" /> {t("demo")}
          </Button>
        </motion.div>
      </div>
    </div>
  );
}

function Input({ label, value, onChange, error, type = "text", autoComplete }: { label: string; value: string; onChange: (v: string) => void; error?: string; type?: string; autoComplete?: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] text-dim">{label}</span>
      <input
        type={type}
        value={value}
        autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={Boolean(error)}
        className="h-12 w-full rounded-lg bg-panel px-4 text-[15px] ring-1 ring-line-strong outline-none transition focus:ring-2 focus:ring-ember-400 aria-[invalid=true]:ring-risk-extreme"
      />
      {error && <span className="mt-1.5 block text-[13px] text-risk-extreme">{error}</span>}
    </label>
  );
}
