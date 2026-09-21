import {
  VERDICT_CLASS,
  type Verdict,
  type VerdictSubtype
} from "../shared/types";

/** "never" for a missing timestamp: never compute a duration from undefined/0 (R2 d). */
export function relTime(at: number | undefined, now = Date.now()): string {
  if (!at) return "never";
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return new Date(at).toLocaleDateString();
}

export const SUBTYPE_LABEL: Record<VerdictSubtype, string> = {
  dnssec: "DNSSEC broken",
  nxdomain: "domain doesn't exist",
  parked: "parked domain",
  empty: "blank page",
  error_page: "error page",
  expect_missing: "expected text missing",
  path_not_found: "this page 404s",
  challenge: "bot challenge",
  waf: "firewall block",
  rate_limit: "rate limited",
  geo: "geo-blocked",
  origin: "origin server failing"
};

/** Crowd buckets shown in the UI: only >= 3 samples (R14). */
export const MIN_CROWD_SAMPLE = 3;

export function crowdBuckets<T extends { total: number }>(buckets: T[]): T[] {
  return buckets.filter((b) => b.total >= MIN_CROWD_SAMPLE);
}

/** R15: visitor checks are labelled as self-reported. */
export function visitorLabel(n: {
  asn?: number;
  asOrganization?: string;
}): string {
  const as = n.asn ? `AS${n.asn}` : "an unknown network";
  return `self-reported by a visitor on ${as}${n.asOrganization ? ` (${n.asOrganization})` : ""}`;
}

/** "https://a.com/x" -> "a.com"; keeps the raw string when it isn't a URL. */
export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** Groups regions that egressed from the same colo: [["wnam","enam"], "IAD"]. */
export function groupByColo<T extends { region: string; colo?: string }>(
  regions: T[]
): T[][] {
  const groups = new Map<string, T[]>();
  for (const r of regions) {
    const key = r.colo ?? `?${r.region}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return [...groups.values()];
}

/** Status page vs probes: "all clear" while our probes fail, or a major incident while they pass. */
/** N2: did our probes reach the site, as the verdict says (not the edge probe alone)? null = can't tell. */
export function probesOkOf(verdict: Verdict | undefined): boolean | null {
  if (!verdict || verdict === "INCONCLUSIVE") return null;
  // LIKELY_YOUR_NETWORK / ISP_OUTAGE: our servers reached it, the user's side failed.
  return VERDICT_CLASS[verdict] !== "down";
}

export function statusContradicts(
  indicator: string,
  probesOk: boolean | null
): boolean {
  if (probesOk === null) return false;
  return probesOk
    ? indicator === "major" || indicator === "critical"
    : indicator === "none";
}

/** N6: visitor checks grouped by ASN, reachable/total, biggest group first. */
export function visitorsByAsn(
  checks: Array<{
    user: { asn?: number; asOrganization?: string };
    browser: { reachable: boolean } | null;
  }>
): Array<{ asn?: number; asName?: string; reachable: number; total: number }> {
  const groups = new Map<
    string,
    { asn?: number; asName?: string; reachable: number; total: number }
  >();
  for (const c of checks) {
    if (!c.browser) continue;
    const key = String(c.user.asn ?? "?");
    const g = groups.get(key) ?? {
      asn: c.user.asn,
      asName: c.user.asOrganization,
      reachable: 0,
      total: 0
    };
    g.total++;
    if (c.browser.reachable) g.reachable++;
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => b.total - a.total);
}

/** Sparkline geometry: last 24h of samples scaled into a w x h box. Ticks mark failing samples. */
export function sparkline(
  samples: Array<{ at: number; ms?: number; ok: boolean }>,
  w: number,
  h: number,
  now = Date.now()
): { points: string; ticks: number[]; max: number } {
  const from = now - 86_400_000;
  const recent = samples
    .filter((s) => s.at >= from && s.at <= now)
    .sort((a, b) => a.at - b.at);
  const x = (at: number) => +(((at - from) / 86_400_000) * w).toFixed(1);
  const timed = recent.filter((s) => s.ok && s.ms !== undefined);
  const max = Math.max(1, ...timed.map((s) => s.ms!));
  return {
    points: timed
      .map((s) => `${x(s.at)},${+(h - (s.ms! / max) * h).toFixed(1)}`)
      .join(" "),
    ticks: recent.filter((s) => !s.ok).map((s) => x(s.at)),
    max
  };
}
