"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellOff, BellRing, CheckCheck, Flame, Loader2, LogOut, Mail, MessageSquare, Plus, Radar, Smartphone, Trash2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { DriverList } from "@/components/region/drivers";
import { Button } from "@/components/ui/button";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { Link, useRouter } from "@/i18n/navigation";
import { http, HttpError } from "@/lib/client";
import { cn } from "@/lib/cn";
import { fmtDate, fmtPct, regionName, type AppLocale } from "@/lib/format";
import { RegionCombobox } from "@/components/ui/region-combobox";
import { useAuth } from "@/lib/store";
import { useHydrated } from "@/lib/use-hydrated";
import type { Alert, Channel, RiskLevel, Subscription } from "@/lib/types";

const THRESHOLDS: Exclude<RiskLevel, "low">[] = ["moderate", "high", "very_high", "extreme"];
const CHANNELS: { id: Channel; icon: React.ComponentType<{ className?: string }>; live: boolean }[] = [
  { id: "in_app", icon: BellRing, live: true },
  { id: "email", icon: Mail, live: true },
  { id: "sms", icon: MessageSquare, live: false },
  { id: "push", icon: Smartphone, live: false },
];

export function AlertsClient() {
  const t = useTranslations("alerts");
  const ta = useTranslations("auth");
  const token = useAuth((s) => s.token);
  const user = useAuth((s) => s.user);
  const clear = useAuth((s) => s.clear);
  const router = useRouter();
  const qc = useQueryClient();
  const ready = useHydrated();
  useEffect(() => {
    if (ready && !token) router.replace(`/login?next=/alerts${window.location.search}`);
  }, [ready, token, router]);

  const alerts = useQuery({ queryKey: ["alerts", token], queryFn: () => http<{ data: Alert[] }>("/alerts"), enabled: Boolean(token) });
  const subs = useQuery({ queryKey: ["subs", token], queryFn: () => http<{ data: Subscription[] }>("/subscriptions"), enabled: Boolean(token) });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["alerts"] });
    qc.invalidateQueries({ queryKey: ["alerts-unread"] });
  };
  const evaluate = useMutation({
    mutationFn: () => http<{ created: Alert[]; checked: number }>("/alerts/evaluate", { method: "POST" }),
    onSuccess: (r) => {
      toast.success(t("evaluated", { count: r.created.length }));
      refresh();
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const readAll = useMutation({ mutationFn: () => http("/alerts/read-all", { method: "POST" }), onSuccess: refresh });

  if (!ready || !token) return <div className="skeleton mx-auto mt-32 h-96 max-w-[1240px]" />;
  if (alerts.error instanceof HttpError && alerts.error.status === 501)
    return <p className="mx-auto mt-40 max-w-[600px] px-5 text-center text-dim">{t("gatewayMissing")}</p>;

  const list = alerts.data?.data ?? [];
  return (
    <div className="mx-auto max-w-[1240px] px-5 pb-10 pt-28 sm:px-8 sm:pt-36">
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div>
          <h1 className="font-display text-[clamp(2.6rem,6vw,4.4rem)] leading-none">{t("title")}</h1>
          <p className="mt-4 max-w-[60ch] text-dim">{t("lead")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="ember" onClick={() => evaluate.mutate()} disabled={evaluate.isPending}>
            {evaluate.isPending ? <Loader2 className="size-4 animate-spin" /> : <Radar className="size-4" />}
            {t("evaluate")}
          </Button>
          <Button variant="outline" onClick={() => readAll.mutate()} disabled={!list.some((a) => !a.read_at)}>
            <CheckCheck className="size-4" /> {t("markAll")}
          </Button>
        </div>
      </div>

      <div className="mt-10 grid gap-5 lg:grid-cols-[1.35fr_1fr]">
        <section aria-label={t("title")}>
          {alerts.isLoading ? (
            <div className="space-y-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="skeleton h-28" />
              ))}
            </div>
          ) : list.length === 0 ? (
            <Panel className="grid place-items-center px-6 py-16 text-center">
              <BellOff className="size-8 text-faint" />
              <p className="font-display mt-4 text-[1.5rem]">{t("empty")}</p>
              <p className="mt-2 text-dim">{t("emptyLead")}</p>
            </Panel>
          ) : (
            <ul className="space-y-3">
              <AnimatePresence initial={false}>
                {list.map((a) => (
                  <AlertCard key={a.id} alert={a} onRead={refresh} />
                ))}
              </AnimatePresence>
            </ul>
          )}
        </section>
        <div className="space-y-5">
          <SubscriptionsPanel subs={subs.data?.data ?? []} onChange={() => subs.refetch()} />
          <PreviewsPanel subs={subs.data?.data ?? []} />
          <Panel className="flex items-center justify-between p-5">
            <div className="min-w-0">
              <p className="truncate font-medium">{user?.name}</p>
              <p className="truncate text-[13px] text-faint">{user?.email}</p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                await http("/auth/logout", { method: "POST" }).catch(() => null);
                clear();
                router.push("/");
              }}
            >
              <LogOut className="size-4" /> {ta("logout")}
            </Button>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function AlertCard({ alert: a, onRead }: { alert: Alert; onRead: () => void }) {
  const t = useTranslations("alerts");
  const tl = useTranslations("levels");
  const locale = useLocale() as AppLocale;
  const read = useMutation({ mutationFn: () => http(`/alerts/${a.id}/read`, { method: "POST" }), onSuccess: onRead });
  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className={cn("glass relative overflow-hidden rounded-lg p-5", !a.read_at && "ring-1 ring-ember-500/40")}
      onMouseEnter={() => !a.read_at && !read.isPending && read.mutate()}
    >
      <span className="absolute inset-y-0 left-0 w-1" style={{ background: `var(--risk-${a.level})` }} />
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-lg" style={{ background: `color-mix(in oklab, var(--risk-${a.level}) 18%, transparent)`, color: `var(--risk-${a.level})` }}>
            <Flame className="size-5" />
          </span>
          <div>
            <p className="font-medium">{t("alertTitle", { region: regionName(a.region, locale), level: tl(a.level).toLowerCase() })}</p>
            <p className="tabular-nums text-[12.5px] text-faint">
              {fmtDate(a.as_of, locale, { day: "numeric", month: "long", year: "numeric" })} · {fmtPct(a.probability, locale)}
            </p>
          </div>
        </div>
        {!a.read_at && <span className="mt-1 size-2 shrink-0 rounded-full bg-ember-400" />}
      </div>
      {a.drivers?.length > 0 && <DriverList drivers={a.drivers.slice(0, 3)} className="mt-4" />}
      <div className="mt-4 flex flex-wrap gap-1.5">
        {a.channels.map((c) => (
          <span key={c.channel} className={cn("rounded-md px-2.5 py-1 text-[12.5px] ring-1", c.status === "not_available" ? "text-faint ring-line" : "text-dim ring-line-strong")}>
            {t(c.channel)} · {t(`channelStatus.${c.status}` as "channelStatus.sent")}
          </span>
        ))}
      </div>
    </motion.li>
  );
}

function SubscriptionsPanel({ subs, onChange }: { subs: Subscription[]; onChange: () => void }) {
  const t = useTranslations("alerts");
  const tl = useTranslations("levels");
  const locale = useLocale() as AppLocale;
  const params = useSearchParams();
  const [adding, setAdding] = useState(Boolean(params.get("add")));
  const [slug, setSlug] = useState(params.get("add") ?? "");
  const [pickedName, setPickedName] = useState("");
  const [threshold, setThreshold] = useState<Exclude<RiskLevel, "low">>("high");
  const [channels, setChannels] = useState<Channel[]>(["in_app", "email"]);
  const create = useMutation({
    mutationFn: () => http<Subscription>("/subscriptions", { method: "POST", json: { region_slug: slug, threshold, channels } }),
    onSuccess: () => {
      setAdding(false);
      onChange();
    },
    onError: (e) => {
      const b = e instanceof HttpError ? (e.body as { errors?: Record<string, string[]> }) : undefined;
      toast.error(Object.values(b?.errors ?? {})[0]?.[0] ?? (e as Error).message);
    },
  });
  const update = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Partial<Subscription> }) => http(`/subscriptions/${id}`, { method: "PATCH", json: body }),
    onSuccess: onChange,
  });
  const remove = useMutation({ mutationFn: (id: number) => http(`/subscriptions/${id}`, { method: "DELETE" }), onSuccess: onChange });
  const toggle = (list: Channel[], c: Channel) => (list.includes(c) ? list.filter((x) => x !== c) : [...list, c]);

  return (
    <Panel className="p-5 sm:p-6">
      <PanelHeader
        eyebrow={t("subscriptions")}
        title={`${subs.length}`}
        aside={
          !adding && (
            <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
              <Plus className="size-3.5" /> {t("addSub")}
            </Button>
          )
        }
      />
      <AnimatePresence initial={false}>
        {adding && (
          <motion.form
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate();
            }}
          >
            <div className="mt-4 space-y-3 rounded-lg bg-bg-sunken/60 p-4 ring-1 ring-line">
              <RegionCombobox value={slug || null} valueLabel={pickedName || undefined} onChange={(v, r) => { setSlug(v); setPickedName(regionName(r, locale)); }} leavesOnly placeholder="—" />
              <ThresholdPicker value={threshold} onChange={setThreshold} />
              <ChannelPicker value={channels} onToggle={(c) => setChannels((l) => toggle(l, c))} />
              <div className="flex gap-2">
                <Button type="submit" variant="ember" size="sm" disabled={!slug || create.isPending}>
                  {create.isPending && <Loader2 className="size-3.5 animate-spin" />}
                  {t("addSub")}
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setAdding(false)}>
                  ✕
                </Button>
              </div>
            </div>
          </motion.form>
        )}
      </AnimatePresence>
      <ul className="mt-4 space-y-3">
        {subs.map((s) => (
          <li key={s.id} className={cn("rounded-lg p-4 ring-1 ring-line transition", s.active ? "bg-panel" : "bg-panel/40 opacity-70")}>
            <div className="flex items-center justify-between gap-2">
              <Link href={`/region/${s.region.slug}`} className="truncate font-medium hover:underline">
                {regionName(s.region, locale)}
              </Link>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => update.mutate({ id: s.id, body: { active: !s.active } })}
                  className="rounded-md px-2.5 py-1 text-[12.5px] text-dim ring-1 ring-line hover:text-text"
                >
                  {s.active ? t("active") : t("paused")}
                </button>
                <button onClick={() => remove.mutate(s.id)} aria-label={t("remove")} className="grid size-7 place-items-center rounded-full text-faint hover:bg-panel-hover hover:text-risk-extreme">
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px] text-faint">
              {t("threshold")}:
              <select
                value={s.threshold}
                onChange={(e) => update.mutate({ id: s.id, body: { threshold: e.target.value as Subscription["threshold"] } })}
                className="h-7 rounded-md bg-bg-sunken px-2 text-[13px] text-text ring-1 ring-line outline-none"
              >
                {THRESHOLDS.map((l) => (
                  <option key={l} value={l}>
                    ≥ {tl(l)}
                  </option>
                ))}
              </select>
            </div>
            <div className="mt-3">
              <ChannelPicker value={s.channels} onToggle={(c) => update.mutate({ id: s.id, body: { channels: toggle(s.channels, c) } })} />
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function ThresholdPicker({ value, onChange }: { value: Exclude<RiskLevel, "low">; onChange: (v: Exclude<RiskLevel, "low">) => void }) {
  const tl = useTranslations("levels");
  return (
    <div className="grid grid-cols-4 gap-1.5">
      {THRESHOLDS.map((l) => (
        <button
          type="button"
          key={l}
          onClick={() => onChange(l)}
          aria-pressed={value === l}
          className={cn("rounded-md px-1 py-2 text-[12.5px] ring-1 transition", value === l ? "text-text ring-2" : "text-faint ring-line")}
          style={value === l ? { boxShadow: `inset 0 0 0 2px var(--risk-${l})`, background: `color-mix(in oklab, var(--risk-${l}) 14%, transparent)` } : undefined}
        >
          ≥ {tl(l)}
        </button>
      ))}
    </div>
  );
}

function ChannelPicker({ value, onToggle }: { value: Channel[]; onToggle: (c: Channel) => void }) {
  const t = useTranslations("alerts");
  return (
    <div className="flex flex-wrap gap-1.5">
      {CHANNELS.map(({ id, icon: Icon, live }) => (
        <button
          type="button"
          key={id}
          disabled={!live}
          onClick={() => onToggle(id)}
          aria-pressed={value.includes(id)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] ring-1 transition disabled:cursor-not-allowed",
            value.includes(id) && live ? "bg-text text-bg ring-text" : "text-dim ring-line hover:ring-line-strong",
            !live && "opacity-50",
          )}
        >
          <Icon className="size-3.5" />
          {t(id)}
          {!live && <span className="text-[12px] text-faint">· {t("soon")}</span>}
        </button>
      ))}
    </div>
  );
}

function PreviewsPanel({ subs }: { subs: Subscription[] }) {
  const t = useTranslations("alerts");
  const tl = useTranslations("levels");
  const locale = useLocale() as AppLocale;
  const region = subs[0] ? regionName(subs[0].region, locale) : locale === "az" ? "Sabirabad rayonu" : "Sabirabad District";
  return (
    <Panel className="p-5 sm:p-6">
      <PanelHeader eyebrow={t("previews")} title={<span className="text-[0.95rem] text-dim">{t("previewsLead")}</span>} />
      <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
        <div className="rounded-lg bg-bg-sunken p-3 ring-1 ring-line-strong">
          <p className="pb-2 text-center tabular-nums text-[12px] text-faint">SMS · 112</p>
          <div className="max-w-[90%] rounded-lg rounded-bl-md bg-panel-hover px-3.5 py-2.5 text-[13px] leading-snug">
            {t("smsText", { region, level: tl("high").toLowerCase() })}
          </div>
        </div>
        <div className="rounded-lg bg-bg-sunken p-3 ring-1 ring-line-strong">
          <p className="pb-2 text-center tabular-nums text-[12px] text-faint">09:41</p>
          <div className="flex gap-2.5 rounded-lg bg-white/10 p-3">
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-ember text-white">
              <Flame className="size-4" />
            </span>
            <div className="min-w-0 text-[13px] leading-snug text-white">
              <p className="font-semibold">ODLAR</p>
              <p className="text-white/80">{t("alertTitle", { region, level: tl("high").toLowerCase() })}</p>
            </div>
          </div>
        </div>
      </div>
    </Panel>
  );
}
