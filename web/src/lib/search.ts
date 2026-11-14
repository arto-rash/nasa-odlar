/** Fold Azerbaijani/Latin diacritics so "seki" finds "Şəki" and "Qabala" finds "Qəbələ". */
export function fold(s: string): string {
  return s
    .toLocaleLowerCase("az")
    .replace(/ə/g, "e")
    .replace(/ı/g, "i")
    .replace(/i̇/g, "i")
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

export function matchScore(query: string, ...fields: string[]): number {
  const q = fold(query.trim());
  if (!q) return 1;
  let best = 0;
  for (const f of fields) {
    const v = fold(f);
    if (v === q) best = Math.max(best, 1);
    else if (v.startsWith(q)) best = Math.max(best, 0.9);
    else if (v.split(/[\s-]+/).some((w) => w.startsWith(q))) best = Math.max(best, 0.75);
    else if (v.includes(q)) best = Math.max(best, 0.5);
  }
  return best;
}
