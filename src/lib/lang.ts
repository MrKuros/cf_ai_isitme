// Language selection for explanations. See docs/CONTRACTS.md.

/**
 * Languages the explainer is allowed to answer in (BCP-47 primary tags).
 * Display names come from `Intl.DisplayNames`, so there is no label map.
 */
export const LANGS: readonly string[] = [
  "en",
  "es",
  "pt",
  "fr",
  "de",
  "it",
  "nl",
  "pl",
  "tr",
  "ru",
  "uk",
  "ar",
  "hi",
  "bn",
  "id",
  "vi",
  "th",
  "ja",
  "ko",
  "zh"
];

const ALLOWED = new Set(LANGS);

/**
 * Highest-weighted allowlisted language in an `Accept-Language` header.
 * Returns a primary subtag ("pt" for "pt-BR"), and "en" for anything unknown.
 */
export function pickLang(acceptLanguage?: string): string {
  if (!acceptLanguage) return "en";
  const ranked = acceptLanguage
    .split(",")
    .map((part, order) => {
      const [tag, ...params] = part.split(";");
      const qp = params
        .map((p) => /^\s*q\s*=\s*([0-9.]+)\s*$/i.exec(p))
        .find((m) => m !== null);
      const q = qp ? Number(qp[1]) : 1;
      return { tag: tag.trim().toLowerCase(), q, order };
    })
    .filter((t) => t.tag !== "" && Number.isFinite(t.q) && t.q > 0)
    .sort((a, b) => b.q - a.q || a.order - b.order);
  for (const { tag } of ranked) {
    const primary = tag.split("-")[0];
    if (ALLOWED.has(primary)) return primary;
  }
  return "en";
}
