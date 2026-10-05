// Pure daily-digest decision + wording (P3). The agent supplies the rows; this never reads state.
import { uptime } from "./uptime";
import type { DigestSummary, Evidence, Verdict } from "../shared/types";

export interface DigestWatchInput {
  watchId: string;
  host: string;
  /** The watch's runs in the window, newest first (the rows `getUptime` reads). */
  rows: Array<{ verdict: Verdict; evidence?: Evidence }>;
  /** Confirmed down alerts in the window. */
  incidents: number;
}

const pct = (u: number | null) =>
  u === null ? "n/a" : `${(u * 100).toFixed(u > 0.9995 ? 0 : 1)}%`;

/** Mean edge response time over the window, or null when no run measured one. */
function meanMs(rows: DigestWatchInput["rows"]): number | null {
  const ms = rows
    .map((r) => r.evidence?.edge?.ms)
    .filter((n): n is number => typeof n === "number");
  return ms.length ? ms.reduce((a, b) => a + b, 0) / ms.length : null;
}

/**
 * One digest over a device's watches, or null when there is nothing to report
 * (no watch had a run in the window). Never probes, never decides an alert.
 */
export function buildDigest(
  inputs: DigestWatchInput[],
  at: number,
  hours = 24
): { summary: DigestSummary; text: string } | null {
  const active = inputs.filter((w) => w.rows.length > 0);
  if (!active.length) return null;

  const summary: DigestSummary = {
    at,
    hours,
    watches: active.map((w) => ({
      watchId: w.watchId,
      host: w.host,
      verdict: w.rows[0].verdict,
      incidents: w.incidents,
      uptime: uptime(w.rows, w.watchId, hours / 24).uptime
    }))
  };

  const slowest = active
    .map((w) => ({ host: w.host, ms: meanMs(w.rows) }))
    .filter((x): x is { host: string; ms: number } => x.ms !== null)
    .sort((a, b) => b.ms - a.ms)[0];

  const text = [
    `IsItMe digest: ${summary.watches.length} site${summary.watches.length === 1 ? "" : "s"}, last ${hours}h`,
    ...summary.watches.map(
      (w) =>
        `- ${w.host}: uptime ${pct(w.uptime)}, ${w.incidents} incident${w.incidents === 1 ? "" : "s"}, now ${w.verdict}`
    ),
    ...(slowest && active.length > 1
      ? [`Slowest: ${slowest.host} (${Math.round(slowest.ms)}ms average)`]
      : [])
  ].join("\n");

  return { summary, text };
}
