"use client";

import { useQuery } from "@tanstack/react-query";
import { Check, Copy, Download, Loader2 } from "lucide-react";
import { motion } from "motion/react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { addDays, DateRange, daysBetween } from "./date-range";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { RegionCombobox } from "@/components/ui/region-combobox";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { Segmented } from "@/components/ui/segmented";
import { http } from "@/lib/client";
import { regionName, type AppLocale } from "@/lib/format";
import type { RegionRef } from "@/lib/types";

type Kind = "weekly" | "annual" | "hotspots";
type Fmt = "csv" | "json" | "geojson";

const ENDPOINTS = [
  ["GET", "/overview", "Headline numbers, metadata, top risk"],
  ["GET", "/regions", "All regions with current risk and annual series"],
  ["GET", "/regions/geojson", "Region polygons with risk + density properties"],
  ["GET", "/regions/locate?lat=40.4&lon=49.8", "Region containing a point"],
  ["GET", "/regions/{slug}", "Region detail, season, trend, anomalies"],
  ["GET", "/regions/{slug}/series/weekly", "Weekly raw + harmonized series with 90% bands"],
  ["GET", "/regions/{slug}/series/annual", "Annual totals and Theil–Sen trends"],
  ["GET", "/regions/{slug}/calendar", "Fire calendar: matrix, climatology, season, anomalies"],
  ["GET", "/regions/{slug}/risk", "7-day risk, drivers, daily fire weather, outlook"],
  ["GET", "/hotspots?start=2025-08-01&end=2025-08-07", "Fire detections (≤ 92 days)"],
  ["POST", "/aoi/summary", "Calendar for any GeoJSON polygon"],
  ["GET", "/harmonization/skill", "Validation metrics and transfer functions"],
  ["GET", "/model/report", "Risk model evaluation and feature importance"],
  ["GET", "/export/{slug}?kind=weekly&format=csv", "File export"],
];

const HOTSPOT_DAYS = 92;

export function DataClient({ apiBase }: { apiBase: string }) {
  const t = useTranslations("data");
  const locale = useLocale() as AppLocale;
  const [slug, setSlug] = useState("az");
  const { data: picked } = useQuery({ queryKey: ["region", slug], queryFn: () => http<RegionRef>(`/regions/${slug}`) });
  const [kind, setKind] = useState<Kind>("weekly");
  const [fmt, setFmt] = useState<Fmt>("csv");
  // the newest full day (the record runs through yesterday); weekly opens on the
  // last 12 months, detections on the last 30 days (the API takes up to 92)
  const [latest] = useState(() => new Date(Date.now() - 86_400_000).toISOString().slice(0, 10));
  const [from, setFrom] = useState(() => addDays(latest, -364));
  const [to, setTo] = useState(latest);
  const [busy, setBusy] = useState(false);
  const formats: Fmt[] = kind === "hotspots" ? ["csv", "json", "geojson"] : ["csv", "json"];
  const url = `/api/v1/export/${slug}?kind=${kind}&format=${formats.includes(fmt) ? fmt : "csv"}${kind !== "annual" ? `&start=${from}&end=${to}` : ""}`;

  const download = async () => {
    setBusy(true);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? res.statusText);
      const blob = await res.blob();
      const name = res.headers.get("content-disposition")?.match(/filename="(.+)"/)?.[1] ?? `odlar_${slug}_${kind}.${fmt}`;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      toast.error(String((e as Error).message));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto grid max-w-[1240px] gap-5 px-5 sm:px-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
      <Panel className="h-fit p-5 sm:p-7 lg:sticky lg:top-24">
        <PanelHeader eyebrow={t("builder")} title={t("title")} />
        <div className="mt-6 space-y-5">
          <Field label={t("region")}>
            <RegionCombobox value={slug} valueLabel={picked ? regionName(picked, locale) : undefined} onChange={(v) => setSlug(v)} />
          </Field>
          <Field label={t("kind")}>
            <Segmented
              label={t("kind")}
              value={kind}
              onChange={(k) => {
                setKind(k);
                if (k !== "hotspots" && fmt === "geojson") setFmt("csv");
                if (k === "hotspots" && daysBetween(from, to) + 1 > HOTSPOT_DAYS) {
                  setFrom(addDays(to, -29));
                }
              }}
              options={[
                { value: "weekly", label: t("kindWeekly") },
                { value: "annual", label: t("kindAnnual") },
                { value: "hotspots", label: t("kindHotspots") },
              ]}
            />
          </Field>
          <Field label={t("format")}>
            <Segmented label={t("format")} value={fmt} onChange={setFmt} options={formats.map((f) => ({ value: f, label: f.toUpperCase() }))} />
          </Field>
          {kind !== "annual" && (
            <Field label={t("period")}>
              <DateRange from={from} to={to} latest={latest} maxDays={kind === "hotspots" ? HOTSPOT_DAYS : undefined} allowRecord={kind === "weekly"}
                onChange={(a, b) => { setFrom(a); setTo(b); }} />
            </Field>
          )}
          <Button variant="ember" size="lg" className="w-full" onClick={download} disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
            {busy ? t("preparing") : t("download")}
          </Button>
          <code className="block truncate rounded-md bg-bg-sunken px-3 py-2 font-mono text-[12.5px] text-faint">{url.replace("/api/v1", apiBase)}</code>
        </div>
      </Panel>
      <div className="space-y-5">
        <Panel className="p-5 sm:p-7">
          <PanelHeader eyebrow={t("api")} title={<span className="text-[1rem] text-dim">{t("apiLead")}</span>} />
          <ul className="mt-5 divide-y divide-line">
            {ENDPOINTS.map(([m, p, d], i) => (
              <motion.li key={p} initial={{ opacity: 0, x: 8 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.025 }} className="group flex items-center gap-3 py-2.5">
                <span className={`w-12 shrink-0 rounded-md px-1.5 py-0.5 text-center tabular-nums text-[12px] font-semibold ${m === "GET" ? "bg-viirs/10 text-viirs" : "bg-ember-500/15 text-ember-300"}`}>{m}</span>
                <div className="min-w-0 flex-1">
                  <code className="block truncate font-mono text-[13px] text-text">{p}</code>
                  <p className="truncate text-[13px] text-faint">{d}</p>
                </div>
                <CopyButton text={`curl ${apiBase}${p}`} />
              </motion.li>
            ))}
          </ul>
        </Panel>
        <Panel className="p-5 sm:p-7">
          <PanelHeader eyebrow={t("license")} title="CC BY 4.0" />
          <p className="mt-3 text-[14px] leading-relaxed text-dim">{t("licenseText")}</p>
        </Panel>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-2 block text-[12.5px] font-semibold text-faint">{label}</span>
      {children}
    </label>
  );
}

function CopyButton({ text }: { text: string }) {
  const t = useTranslations("common");
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      aria-label={t("copy")}
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
      className="grid size-8 shrink-0 place-items-center rounded-lg text-faint opacity-60 transition hover:bg-panel-hover hover:text-text group-hover:opacity-100"
    >
      {done ? <Check className="size-3.5 text-risk-low" /> : <Copy className="size-3.5" />}
    </button>
  );
}
