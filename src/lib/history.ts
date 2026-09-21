// Pure helpers over TargetDO samples and TrendsDO rows (N9, N10, N12).
import type { Evidence, StatusPageInfo } from "../shared/types";

export const BASELINE_MIN_SAMPLES = 10;
export const TRENDS_WINDOW_MS = 60 * 60 * 1000;
export const TRENDS_MIN_ASNS = 3;

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** N9: median edge ms for one colo; null below BASELINE_MIN_SAMPLES. */
export function baselineOf(
  colo: string,
  ms: number[]
): NonNullable<Evidence["baseline"]> | null {
  return ms.length < BASELINE_MIN_SAMPLES
    ? null
    : { colo, medianMs: Math.round(median(ms)), samples: ms.length };
}

/**
 * N10: start of the current consecutive failing streak (samples newest first).
 * `failingNowAt` counts the in-progress run as the newest failing sample.
 */
export function failingStreakStart(
  samples: Array<{ at: number; ok: boolean }>,
  failingNowAt?: number
): number | null {
  let start = failingNowAt ?? null;
  if (failingNowAt === undefined && samples[0]?.ok !== false) return null;
  for (const s of samples) {
    if (s.ok) break;
    start = s.at;
  }
  return start;
}

/** N10: first probe failure vs the earliest unresolved vendor incident; null without an incident or a failure. */
export function statusLagOf(
  samples: Array<{ at: number; ok: boolean }>,
  statusPage: StatusPageInfo | null,
  failingNowAt?: number
): Evidence["statusLag"] {
  if (!statusPage?.incidents.length) return null;
  const firstFailureAt = failingStreakStart(samples, failingNowAt);
  if (firstFailureAt === null) return null;
  const acks = statusPage.incidents
    .map((i) => Date.parse(i.createdAt))
    .filter((t) => !Number.isNaN(t));
  return {
    firstFailureAt,
    ...(acks.length && { vendorAckAt: Math.min(...acks) })
  };
}

export const TRENDS_SCHEMA = `CREATE TABLE IF NOT EXISTS trends (
  host TEXT, verdict TEXT, provider TEXT, asn INTEGER, at INTEGER
)`;

/**
 * N12 privacy rule: only hosts reported from >= TRENDS_MIN_ASNS distinct ASNs.
 * ponytail: relies on SQLite's bare-column-with-MAX rule for the newest verdict/provider.
 */
export const TRENDS_LIST_SQL = `SELECT host, verdict, provider, MAX(at) AS last_at, COUNT(DISTINCT asn) AS asns
  FROM trends WHERE at >= ?
  GROUP BY host HAVING asns >= ${TRENDS_MIN_ASNS}
  ORDER BY asns DESC, last_at DESC LIMIT 20`;
