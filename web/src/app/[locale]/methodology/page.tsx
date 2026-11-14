import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Footer } from "@/components/layout/footer";
import { PageHeader } from "@/components/layout/page-header";
import { Reliability } from "@/components/methodology/reliability";
import { Toc } from "@/components/methodology/toc";
import { fmtNum, fmtPct, type AppLocale } from "@/lib/format";
import { api } from "@/lib/upstream";
import type { ModelReport, Overview, Skill } from "@/lib/types";

export const revalidate = 600;

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "methodology" });
  return { title: t("title"), description: t("lead") };
}

const FEATURE_LABEL: Record<string, { az: string; en: string }> = {
  clim_next7: { az: "Növbəti həftənin norması", en: "Climatology of the coming week" },
  clim_p75_next7: { az: "Hədd (75-ci persentil)", en: "Threshold (75th percentile)" },
  clim_next30: { az: "Növbəti 30 günün norması", en: "Climatology, next 30 days" },
  lag7: { az: "Son 7 günün aktivliyi", en: "Activity, last 7 days" },
  lag14: { az: "Son 14 gün", en: "Activity, last 14 days" },
  lag30: { az: "Son 30 gün", en: "Activity, last 30 days" },
  lag90: { az: "Son 90 gün", en: "Activity, last 90 days" },
  anom7: { az: "7 günlük anomaliya", en: "7-day anomaly" },
  anom30: { az: "30 günlük anomaliya", en: "30-day anomaly" },
  ytd_ratio: { az: "İlin əvvəlindən / norma", en: "Year-to-date vs normal" },
  days_since_fire: { az: "Son yanğından bəri günlər", en: "Days since last fire" },
  days_since_rain: { az: "Son yağışdan bəri günlər", en: "Days since rain" },
  fc_precip: { az: "Proqnoz: yağıntı", en: "Forecast precipitation" },
  fc_dry_days: { az: "Proqnoz: quru günlər", en: "Forecast dry days" },
  fc_tmax: { az: "Proqnoz: maks. temperatur", en: "Forecast max temperature" },
  fc_rh_min: { az: "Proqnoz: min. rütubət", en: "Forecast min humidity" },
  fc_wind_max: { az: "Proqnoz: külək", en: "Forecast wind" },
  fc_vpd_max: { az: "Proqnoz: VPD", en: "Forecast VPD" },
  doy_sin: { az: "İlin günü (sin)", en: "Day of year (sin)" },
  doy_cos: { az: "İlin günü (cos)", en: "Day of year (cos)" },
};

export default async function MethodologyPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const l = locale as AppLocale;
  const t = await getTranslations("methodology");
  const [overview, skill, report] = await Promise.all([
    api<Overview>("/overview"),
    api<Skill>("/harmonization/skill"),
    api<ModelReport>("/model/report"),
  ]);
  const h = report.harmonized.overall;
  const r = report.raw.overall;
  const az = l === "az";
  const P = (v: number, d = 1, s = true) => fmtPct(v, l, d, s);
  const N = (v: number, d = 2) => fmtNum(v, l, d);

  const sections = az ? AZ : EN;
  const toc = sections.map((s) => ({ id: s.id, label: s.title }));
  const vars = {
    bias: P(skill.bias), rawBias: P(skill.raw_modis_bias, 0), cov: P(skill.annual_interval_coverage, 0, false),
    wcov: P(skill.weekly_interval_coverage, 0, false), rho: N(skill.annual_spearman), years: skill.n_years,
    truth: overview.synthetic_truth ? P(overview.synthetic_truth.bias) : "—", auc: N(h.roc_auc), aucRaw: N(r.roc_auc),
    base: N(h.base_roc_auc), bss: N(h.brier_skill), bssRaw: N(r.brier_skill), pr: N(h.pr_auc), prRaw: N(r.pr_auc), prBase: N(h.base_pr_auc),
    nboot: overview.meta.n_boot,
  };
  const fill = (s: string) => s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k as keyof typeof vars] ?? `{${k}}`));

  return (
    <main>
      <PageHeader title={t("title")} lead={t("lead")} />
      <div className="mx-auto grid max-w-[1240px] gap-12 px-5 sm:px-8 lg:grid-cols-[220px_minmax(0,1fr)]">
        <Toc items={toc} title={t("toc")} />
        <article className="max-w-[760px] space-y-16 pb-10">
          {sections.map((s) => (
            <section key={s.id} id={s.id} className="scroll-mt-28">
              <h2 className="font-display text-[2rem] leading-tight">{s.title}</h2>
              <div className="mt-5 space-y-4 text-[16px] leading-[1.75] text-dim [&_b]:font-medium [&_b]:text-text [&_code]:rounded [&_code]:bg-bg-sunken [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:tabular-nums [&_code]:text-[13px] [&_code]:text-ember-200">
                {s.body.map((p, i) =>
                  p.startsWith("- ") ? (
                    <ul key={i} className="list-disc space-y-1.5 pl-5 marker:text-ember-400">
                      {p.split("\n").map((li, j) => (
                        <li key={j} dangerouslySetInnerHTML={{ __html: fill(li.replace(/^- /, "")) }} />
                      ))}
                    </ul>
                  ) : (
                    <p key={i} dangerouslySetInnerHTML={{ __html: fill(p) }} />
                  ),
                )}
              </div>
              {s.id === "validation" && (
                <div className="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-lg bg-line ring-1 ring-line sm:grid-cols-4">
                  {[
                    [az ? "Xəta" : "Bias", vars.bias],
                    [az ? "Xam MODIS" : "Raw MODIS", vars.rawBias],
                    [az ? "İllik əhatə" : "Annual coverage", vars.cov],
                    [az ? "Sıra korr." : "Rank corr.", vars.rho],
                  ].map(([k, v]) => (
                    <div key={k} className="bg-bg p-4">
                      <p className="text-[12px] font-semibold text-faint">{k}</p>
                      <p className="font-display mt-1 text-[1.6rem] text-ember">{v}</p>
                    </div>
                  ))}
                </div>
              )}
              {s.id === "risk" && (
                <div className="mt-8 grid gap-8 md:grid-cols-[1fr_1fr]">
                  <div className="overflow-hidden rounded-lg ring-1 ring-line">
                    <table className="w-full text-[13px]">
                      <thead className="bg-bg-sunken text-left text-[12.5px] text-faint">
                        <tr>
                          <th className="px-3 py-2.5"></th>
                          <th className="px-3 py-2.5">{az ? "Harmonizə" : "Harmonized"}</th>
                          <th className="px-3 py-2.5">{az ? "Xam" : "Raw"}</th>
                          <th className="px-3 py-2.5">{az ? "Klimat." : "Climatology"}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line tabular-nums">
                        <tr><td className="px-3 py-2 font-sans text-dim">ROC-AUC</td><td className="px-3 py-2 text-ember-200">{vars.auc}</td><td className="px-3 py-2">{vars.aucRaw}</td><td className="px-3 py-2 text-faint">{vars.base}</td></tr>
                        <tr><td className="px-3 py-2 font-sans text-dim">PR-AUC</td><td className="px-3 py-2 text-ember-200">{vars.pr}</td><td className="px-3 py-2">{vars.prRaw}</td><td className="px-3 py-2 text-faint">{vars.prBase}</td></tr>
                        <tr><td className="px-3 py-2 font-sans text-dim">Brier skill</td><td className="px-3 py-2 text-ember-200">{vars.bss}</td><td className="px-3 py-2 text-risk-extreme">{vars.bssRaw}</td><td className="px-3 py-2 text-faint">0</td></tr>
                      </tbody>
                    </table>
                  </div>
                  <Reliability
                    model={report.harmonized.reliability}
                    base={report.harmonized.reliability_base}
                    labels={{ model: "ODLAR", base: az ? "Klimatologiya" : "Climatology", predicted: az ? "proqnoz" : "predicted", observed: az ? "müşahidə" : "observed" }}
                  />
                  <div className="md:col-span-2">
                    <p className="mb-3 text-[12.5px] font-semibold text-faint">{az ? "Əlamətlərin töhfəsi (gain)" : "Feature importance (gain)"}</p>
                    <ul className="space-y-1.5">
                      {report.importance.slice(0, 10).map((f) => (
                        <li key={f.feature} className="grid grid-cols-[minmax(0,220px)_1fr_48px] items-center gap-3 text-[13px]">
                          <span className="truncate text-dim">{FEATURE_LABEL[f.feature]?.[l] ?? f.feature}</span>
                          <span className="h-1.5 overflow-hidden rounded-full bg-line">
                            <span className="block h-full rounded-full bg-ember" style={{ width: `${(f.gain / report.importance[0].gain) * 100}%` }} />
                          </span>
                          <span className="text-right tabular-nums text-faint">{fmtPct(f.gain, l, 0)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
            </section>
          ))}
        </article>
      </div>
      <Footer />
    </main>
  );
}

type Section = { id: string; title: string; body: string[] };

const EN: Section[] = [
  { id: "data", title: "Data sources", body: [
    "- <b>NASA FIRMS active fires</b>: MODIS Collection 6.1 (Terra from Nov 2000, Aqua from Jul 2002, 1 km) and VIIRS 375 m (Suomi NPP from Jan 2012, NOAA-20 from 2018, NOAA-21 from 2024). Science-quality archives are used where available, near-real-time for recent months.\n- <b>NASA POWER</b> daily temperature, humidity, wind and corrected precipitation at every region centroid, 2000 to today, topped up with Open-Meteo analysis for the last days.\n- <b>Open-Meteo</b> 7-day forecasts for the short-term risk.\n- <b>Vegetation (NDVI)</b>: MODIS MOD13 via the ORNL DAAC service when enabled; otherwise a seasonal climatology, which the app labels as such.\n- <b>Administrative units</b>: Azerbaijan's 66 districts and 12 cities, plus the provinces of Georgia and Armenia. The unit list follows geoBoundaries; the borders come from <b>OpenStreetMap</b>, the same data the basemap draws.",
  ] },
  { id: "qc", title: "Quality control", body: [
    "Detections with low confidence (MODIS &lt; 30, VIIRS “low”) are dropped. Only FIRMS type 0 (presumed vegetation fire) is kept. Near-real-time products carry no type flag, so persistent static heat sources such as the Absheron and Sangachal gas flares are found empirically: a ~1 km cell that is hot in more than 20% of all months is excluded.",
  ] },
  { id: "harmonize", title: "Harmonization", body: [
    "The reference scale is the <b>single-satellite VIIRS S-NPP</b> record: consistent from 2012, and the scale every later sensor can be tied to. For each district and season (winter, spring, summer, autumn), weekly MODIS counts are paired with S-NPP counts over the overlap years.",
    "- <b>Two-part model.</b> Weeks with MODIS detections are mapped with an empirical <b>quantile mapping</b> <code>T(x) = F_viirs⁻¹(F_modis(x))</code>, fitted on fire weeks only. Weeks MODIS saw as empty go to a logistic <b>zero-inflation</b> model that estimates how much VIIRS-scale activity such a week typically holds, from the season and the activity in neighbouring weeks and in the country.\n- <b>Conditional bias correction.</b> Quantile mapping preserves distributions but, with noisy pairs, under-maps small weeks. A factor per MODIS-size bin, <code>E[y|bin] / E[T(x)|bin]</code>, makes sums of weeks unbiased.\n- <b>Hierarchical fallback.</b> Districts with too few fire weeks borrow the pooled country map for that season.\n- <b>Eras.</b> Before Aqua (Jul 2002) only Terra flew, so that era gets its own map, fitted on Terra-only counts.",
    "From 2012 the harmonized record <i>is</i> the S-NPP record. Calibration never reconstructs individual fires MODIS missed. It estimates how much activity there was, with an honest interval.",
  ] },
  { id: "uncertainty", title: "Uncertainty", body: [
    "Uncertainty comes from a <b>predictive block bootstrap</b> ({nboot} replicates). Overlap years are resampled with replacement (years as blocks, to keep within-year dependence), every map is refitted, and each replicate draws observation noise: multiplicative residuals from the same MODIS-size bin, Bernoulli × empirical magnitude for empty weeks, and a shared <b>year effect</b> per district and year, because errors within a year do not cancel. Intervals for any aggregate (annual totals, countries, seasons) are percentiles of summed replicate draws, never sums of weekly bounds.",
  ] },
  { id: "validation", title: "Validation", body: [
    "<b>Leave-one-year-out.</b> Each overlap year in turn is removed from calibration, its MODIS weeks are harmonized, and the result is compared with what S-NPP actually recorded. Over {years} held-out years, the harmonized totals are off by <b>{bias}</b> overall, where raw MODIS undercounts by <b>{rawBias}</b>. Annual 90% intervals contain the truth {cov} of the time (weekly: {wcov}).",
  ] },
  { id: "calendar", title: "Fire calendar", body: [
    "- <b>Climatology</b>: for every calendar week, the mean, median and 10/25/75/90th percentiles over all complete years.\n- <b>Season</b> on a circular year that starts at the quietest four weeks, so seasons crossing New Year still work. Onset is the week 10% of the annual activity has occurred, end is 90%.\n- <b>Critical windows</b>: contiguous weeks above the 75th percentile of the smoothed climatology, ranked by their share of annual activity. <b>Peaks</b> come from prominence-based peak finding, which also tells us when a region has two seasons (spring field burning and summer stubble burning).\n- <b>Unusual years</b>: robust z-scores (median/MAD) of annual total, peak intensity, onset and end. A year is flagged only if it is both statistically unusual (|z| ≥ 2) and practically so (at least 1.5× or ≤ 1/1.5× the median, or a shift of 2 or more weeks).",
  ] },
  { id: "risk", title: "Risk model", body: [
    "<b>Target.</b> Will harmonized activity in the next 7 days exceed the 75th percentile of what is normal for this district and week? <b>Features</b> include recent activity (7–90 days) and anomalies, climatology, observed weather (dry spell, VPD, wind, rain over 7 and 30 days), the 7-day forecast, vegetation, season and terrain. Training uses the observed weather as a perfect-prognosis forecast, and inference uses Open-Meteo.",
    "<b>Model.</b> A LightGBM classifier and a Tweedie regressor for expected counts. Probabilities are <b>cross-fit calibrated</b> with isotonic regression on out-of-fold predictions grouped by year, so one unusual year can't distort the calibration. <b>Explanations</b> are exact TreeSHAP contributions, grouped into named drivers.",
    "<b>Evaluation</b> uses rolling-origin cross-validation: train on every year before Y, then test on Y, for the last six years. Against a climatology baseline, ODLAR reaches ROC-AUC <b>{auc}</b> (climatology {base}) and a Brier skill of <b>{bss}</b>. <b>The same model trained on the raw, unharmonized record scores a Brier skill of {bssRaw}</b>: the sensor jump teaches it the wrong baseline. Harmonization is what makes the AI usable.",
    "<b>Season outlook.</b> Quantile LightGBM (10th, 50th and 90th percentiles) for the next 13 weeks of activity, compared against the climatological range.",
  ] },
  { id: "limits", title: "Limitations", body: [
    "- Detection counts are not burned area; a large fire produces many pixels.\n- The calibration assumes the relationship between MODIS and VIIRS during 2012 onward also held before. Leave-one-year-out shows how well this holds, but conditions that never occurred in the overlap are extrapolated.\n- Small districts have few fire weeks and lean on the country-level map; their intervals are wider.\n- Without an Earthdata/ORNL NDVI pull, vegetation is a seasonal climatology.\n- Alerts are a working prototype (in-app and email). SMS and push delivery are design-only.",
  ] },
  { id: "continuity", title: "After Suomi NPP (since 2 Nov 2026)", body: [
    "Suomi NPP stopped sending fire data on <b>2 November 2026</b>. From that day the record continues on the S-NPP scale from <b>NOAA-20</b>, which carries the same VIIRS instrument: for every district and season, S-NPP detections per NOAA-20 detection are learnt from the two years both flew, borrowing the country's ratio where a district has few fires. Bridged weeks carry their own 80% range.",
    "<b>Tested</b> by hiding S-NPP's real record for July 2025 – October 2026 and rebuilding it from NOAA-20: worldwide totals came out <b>5.6% low</b> (Caucasus 2.9% low), half the batches within 7%, and the 80% range held the real week 89% of the time. NOAA-21 is not used for the bridge: it is only partly in the FIRMS archive before 2026, and counting it would add a new jump.",
  ] },
  { id: "stack", title: "System", body: [
    "Python (pandas, GeoPandas, SciPy, scikit-learn, LightGBM) for the pipeline, FastAPI for analytics, Laravel with PostgreSQL/PostGIS for users, regions, subscriptions and alerts, and Next.js + MapLibre for this interface. For one region (the South Caucasus) the full pipeline, from raw detections to models, runs in about eight minutes and is covered by property-based and ground-truth tests.",
  ] },
];

const AZ: Section[] = [
  { id: "data", title: "Məlumat mənbələri", body: [
    "- <b>NASA FIRMS aktiv yanğınlar</b>: MODIS Collection 6.1 (Terra 2000-ci ilin noyabrından, Aqua 2002-ci ilin iyulundan, 1 km) və VIIRS 375 m (Suomi NPP 2012-ci ilin yanvarından, NOAA-20 2018-dən, NOAA-21 2024-dən). Elmi keyfiyyətli arxiv mövcud olan dövr üçün, son aylar üçün isə operativ məlumat istifadə olunur.\n- <b>NASA POWER</b>: hər bölgənin mərkəzi üçün gündəlik temperatur, rütubət, külək və düzəldilmiş yağıntı, 2000-ci ildən bu günə; son günlər Open-Meteo analizi ilə tamamlanır.\n- <b>Open-Meteo</b>: qısamüddətli risk üçün 7 günlük proqnoz.\n- <b>Bitki örtüyü (NDVI)</b>: aktivləşdirildikdə ORNL DAAC vasitəsilə MODIS MOD13; əks halda mövsümi klimatologiya, interfeysdə də belə qeyd olunur.\n- <b>İnzibati vahidlər</b>: Azərbaycanın 66 rayonu və 12 şəhəri, Gürcüstan və Ermənistanın regionları. Vahidlərin siyahısı geoBoundaries-dən, sərhədlər isə xəritə altlığının da istifadə etdiyi <b>OpenStreetMap</b>-dən götürülüb.",
  ] },
  { id: "qc", title: "Keyfiyyətə nəzarət", body: [
    "Etibarlılığı aşağı olan aşkarlamalar (MODIS &lt; 30, VIIRS «low») çıxarılır, yalnız FIRMS tip 0 (ehtimal olunan bitki örtüyü yanğını) saxlanılır. Operativ məhsullarda tip göstəricisi olmadığı üçün Abşeron və Səngəçal qaz məşəlləri kimi daimi istilik mənbələri empirik yolla tapılır: bütün ayların 20%-dən çoxunda «isti» olan ~1 km-lik xana xaric edilir.",
  ] },
  { id: "harmonize", title: "Harmonizasiya", body: [
    "İstinad miqyası <b>tək peykli VIIRS S-NPP</b> qeydidir: 2012-dən ardıcıldır və sonrakı bütün sensorları ona bağlamaq olar. Hər rayon və mövsüm (qış, yaz, yay, payız) üçün ortaq illər ərzində həftəlik MODIS sayları S-NPP sayları ilə cütləşdirilir.",
    "- <b>İkihissəli model.</b> MODIS-in yanğın gördüyü həftələr empirik <b>kvantil uyğunlaşdırması</b> ilə köçürülür: <code>T(x) = F_viirs⁻¹(F_modis(x))</code>, yalnız yanğın həftələri üzərində qurulur. MODIS-in «boş» gördüyü həftələr logistik <b>sıfır-inflyasiya</b> modelinə gedir. Bu model belə bir həftədə VIIRS miqyasında adətən nə qədər aktivlik olduğunu mövsümə, qonşu həftələrə və ölkə üzrə aktivliyə görə qiymətləndirir.\n- <b>Şərti xəta düzəlişi.</b> Kvantil uyğunlaşdırması paylanmanı qoruyur, amma səs-küylü cütlərdə kiçik həftələri azaldır. MODIS ölçü intervalı üzrə <code>E[y|bin] / E[T(x)|bin]</code> əmsalı həftələrin cəmini xətasız edir.\n- <b>İyerarxik ehtiyat.</b> Yanğın həftəsi az olan rayonlar həmin mövsüm üçün ölkə üzrə ümumi xəritədən istifadə edir.\n- <b>Dövrlər.</b> Aqua-dan əvvəl (2002-ci ilin iyulu) yalnız Terra uçurdu, ona görə bu dövr yalnız Terra sayları üzərində qurulan ayrıca xəritə ilə işlənir.",
    "2012-dən sonra harmonizə edilmiş qeyd elə S-NPP qeydinin özüdür. Kalibrasiya MODIS-in görmədiyi ayrı-ayrı yanğınları bərpa etmir: nə qədər aktivlik olduğunu dürüst intervalla qiymətləndirir.",
  ] },
  { id: "uncertainty", title: "Qeyri-müəyyənlik", body: [
    "Qeyri-müəyyənlik <b>proqnozlaşdırıcı blok-bootstrap</b> ilə hesablanır ({nboot} təkrar). Ortaq illər əvəz edilməklə yenidən seçilir (il daxilindəki asılılığı saxlamaq üçün illər blok kimi), bütün xəritələr yenidən qurulur və hər təkrarda müşahidə səs-küyü əlavə olunur: eyni MODIS ölçü intervalından multiplikativ qalıqlar, boş həftələr üçün Bernoulli × empirik böyüklük, həmçinin hər rayon və il üçün ortaq <b>il effekti</b>, çünki bir il daxilindəki xətalar bir-birini sıfırlamır. İstənilən cəmin (illik, ölkə, mövsüm) intervalı həftəlik sərhədlərin cəmi deyil, təkrarların cəminin persentilləridir.",
  ] },
  { id: "validation", title: "Yoxlama", body: [
    "<b>Hər ili kənarda saxla.</b> Ortaq illərin hər biri növbə ilə kalibrasiyadan çıxarılır, onun MODIS həftələri harmonizə edilir və nəticə S-NPP-nin faktiki qeydi ilə müqayisə olunur. {years} yoxlama ili üzrə harmonizə edilmiş cəmlərin ümumi xətası <b>{bias}</b> təşkil edir, xam MODIS isə <b>{rawBias}</b> az sayır. İllik 90% intervallar həqiqəti halların {cov}-ində əhatə edir (həftəlik: {wcov}).",
  ] },
  { id: "calendar", title: "Yanğın təqvimi", body: [
    "- <b>Klimatologiya</b>: hər təqvim həftəsi üçün bütün tam illər üzrə orta, median və 10/25/75/90-cı persentillər.\n- <b>Mövsüm</b>: ən sakit dörd həftədən başlayan dairəvi il üzərində hesablanır, ona görə Yeni ili keçən mövsümlər də düzgün işlənir. Başlanğıc illik aktivliyin 10%-inin, son isə 90%-inin baş verdiyi həftədir.\n- <b>Kritik pəncərələr</b>: hamarlanmış klimatologiyanın 75-ci persentilindən yuxarı olan ardıcıl həftələr, illik aktivlikdəki paylarına görə sıralanır. <b>Zirvələr</b> qabarıqlığa əsaslanan axtarışla tapılır; bu, bölgədə iki mövsümün (yaz tarla yandırması və yay küləş yandırması) olub-olmadığını da göstərir.\n- <b>Qeyri-adi illər</b>: illik cəm, pik intensivliyi, başlanğıc və son üçün robust z-dəyərləri (median/MAD). İl yalnız həm statistik (|z| ≥ 2), həm də praktik baxımdan qeyri-adi olduqda qeyd edilir: medianın ən azı 1,5 qatı və ya ≤ 1/1,5 qatı, yaxud 2 və daha çox həftəlik sürüşmə.",
  ] },
  { id: "risk", title: "Risk modeli", body: [
    "<b>Hədəf.</b> Növbəti 7 gündə harmonizə edilmiş aktivlik bu rayon və həftə üçün normanın 75-ci persentilini keçəcəkmi? <b>Əlamətlər</b>: son aktivlik (7–90 gün) və anomaliyalar, klimatologiya, müşahidə olunan hava (quraq dövr, VPD, külək, 7 və 30 günlük yağıntı), 7 günlük proqnoz, bitki örtüyü, mövsüm və relyef. Təlimdə müşahidə olunan hava «mükəmməl proqnoz» kimi, istifadədə isə Open-Meteo proqnozu işlədilir.",
    "<b>Model.</b> LightGBM təsnifatçısı və gözlənilən say üçün Tweedie reqressoru. Ehtimallar illər üzrə qruplaşdırılmış çarpaz proqnozlar üzərində izotonik reqressiya ilə <b>çarpaz kalibrlənir</b>, beləliklə bir qeyri-adi il kalibrasiyanı poza bilməz. <b>İzahlar</b> dəqiq TreeSHAP töhfələridir və adlandırılmış amillər üzrə qruplaşdırılır.",
    "<b>Qiymətləndirmə</b> sürüşən başlanğıclı çarpaz yoxlama ilə aparılır: Y ilindən əvvəlki bütün illər üzərində öyrənib Y ilində yoxlayırıq, son altı il üçün. Klimatologiya ilə müqayisədə ODLAR-ın ROC-AUC dəyəri <b>{auc}</b> (klimatologiya {base}), Brier bacarığı <b>{bss}</b> təşkil edir. <b>Eyni model xam, harmonizə edilməmiş qeydlə öyrədildikdə Brier bacarığı {bssRaw} olur</b>: sensor sıçrayışı ona yanlış bazis öyrədir. AI-ı istifadəyə yararlı edən məhz harmonizasiyadır.",
    "<b>Mövsüm baxışı.</b> Növbəti 13 həftənin aktivliyi üçün kvantil LightGBM (10, 50 və 90-cı persentillər), klimatoloji diapazonla müqayisədə.",
  ] },
  { id: "limits", title: "Məhdudiyyətlər", body: [
    "- Aşkarlamaların sayı yanmış sahə deyil: böyük yanğın çoxlu piksel yaradır.\n- Kalibrasiya 2012-dən sonrakı MODIS–VIIRS əlaqəsinin əvvəlki illərdə də eyni olduğunu fərz edir. «Hər ili kənarda saxla» yoxlaması bunun nə dərəcədə doğru olduğunu göstərir, ortaq dövrdə heç vaxt baş verməmiş şərait isə ekstrapolyasiya olunur.\n- Kiçik rayonlarda yanğın həftəsi azdır və onlar ölkə üzrə xəritəyə söykənir; intervalları daha genişdir.\n- Earthdata/ORNL NDVI yüklənmədikdə bitki örtüyü mövsümi klimatologiyadır.\n- Bildirişlər işlək prototipdir (tətbiqdə və e-poçtla). SMS və push yalnız dizayn səviyyəsindədir.",
  ] },
  { id: "continuity", title: "Suomi NPP-dən sonra (2 noyabr 2026-dan)", body: [
    "Suomi NPP <b>2 noyabr 2026</b>-cı ildə yanğın məlumatı göndərməyi dayandırdı. Həmin gündən qeyd S-NPP miqyasında eyni VIIRS cihazını daşıyan <b>NOAA-20</b> əsasında davam edir: hər rayon və mövsüm üçün NOAA-20-nin bir aşkarlamasına düşən S-NPP aşkarlamaları hər iki peykin birlikdə uçduğu iki ildən öyrənilir; az yanğını olan rayonlar ölkənin nisbətindən istifadə edir. Körpü ilə hesablanan həftələrin öz 80% aralığı var.",
    "<b>Yoxlama</b>: S-NPP-nin iyul 2025 – oktyabr 2026 real qeydi gizlədildi və NOAA-20-dən yenidən quruldu. Dünya üzrə cəmlər <b>5,6% az</b> çıxdı (Qafqaz 2,9% az), batch-lərin yarısı 7% daxilində, 80% aralıq isə real həftəni halların 89%-ində əhatə etdi. NOAA-21 körpüdə istifadə olunmur: 2026-dan əvvəl FIRMS arxivində qismən var və onu saymaq yeni sıçrayış yaradardı.",
  ] },
  { id: "stack", title: "Sistem", body: [
    "Boru xətti üçün Python (pandas, GeoPandas, SciPy, scikit-learn, LightGBM), analitika üçün FastAPI, istifadəçilər, bölgələr, abunəliklər və bildirişlər üçün PostgreSQL/PostGIS ilə Laravel, bu interfeys üçün isə Next.js və MapLibre. Bir bölgə (Cənubi Qafqaz) üçün xam aşkarlamalardan modellərə qədər bütün boru xətti təxminən səkkiz dəqiqəyə işləyir və xassə əsaslı, həmçinin həqiqət əsaslı testlərlə yoxlanılır.",
  ] },
];
