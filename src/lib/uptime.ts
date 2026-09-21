// Pure per-watch uptime (parity: SLA reports), excluding runs we can't blame on the site (R6).
import {
  VERDICT_CLASS,
  type Evidence,
  type UptimeStats,
  type Verdict
} from "../shared/types";

/** A down run whose every failing server vantage was itself broken (noData / vantageSick). */
export function vantageCaused(verdict: Verdict, evidence?: Evidence): boolean {
  if (VERDICT_CLASS[verdict] !== "down" || !evidence) return false;
  const failing = [evidence.edge, ...(evidence.regions ?? [])].filter(
    (p) => p && !p.ok
  );
  return (
    failing.length > 0 && failing.every((p) => p!.noData || p!.vantageSick)
  );
}

export function uptime(
  rows: Array<{ verdict: Verdict; evidence?: Evidence }>,
  watchId: string,
  days: number
): UptimeStats {
  let upRuns = 0;
  let excluded = 0;
  for (const { verdict, evidence } of rows) {
    const cls = VERDICT_CLASS[verdict];
    if (cls === "none" || vantageCaused(verdict, evidence)) excluded++;
    else if (cls === "up") upRuns++;
  }
  const counted = rows.length - excluded;
  return {
    watchId,
    days,
    runs: rows.length,
    upRuns,
    excluded,
    uptime: counted ? upRuns / counted : null
  };
}
