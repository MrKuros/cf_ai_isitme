import { DurableObject } from "cloudflare:workers";
import { egressColo, guardUrl, httpProbe } from "../lib/probes";
import type { RegionHint, RegionProbe } from "../shared/types";

const CONTROL_URL = "https://www.google.com/generate_204";
const TALLY_MS = 5 * 60_000;

/** One per region: env.PROBE_DO.getByName(`probe-${region}`, { locationHint: region }). */
export class ProbeDO extends DurableObject<Env> {
  // ponytail: in-memory tally resets on eviction; TargetDO.regions drops the flag unless >= 3 other regions are ok
  private tally = new Map<string, { at: number; ok: boolean }>();

  async probe(
    url: string,
    region: RegionHint,
    checkId?: string,
    expect?: string
  ): Promise<RegionProbe> {
    const [r, colo, control] = await Promise.all([
      httpProbe(url, { hopGuard: guardUrl, checkId, expect }),
      egressColo(),
      fetch(CONTROL_URL, { signal: AbortSignal.timeout(5000) }).then(
        (res) => {
          res.body?.cancel().catch(() => {});
          return true;
        },
        () => false
      )
    ]);
    // Both controls dead and the target failed too: the vantage is broken, not the target (R6).
    if (!r.ok && colo === undefined && !control) {
      return {
        region,
        ok: false,
        ms: r.ms,
        noData: true,
        vantageSick: true,
        error: "probe location has no connectivity"
      };
    }

    const now = Date.now();
    this.tally.set(new URL(url).host, { at: now, ok: r.ok });
    for (const [h, v] of this.tally)
      if (now - v.at > TALLY_MS) this.tally.delete(h);
    const failing = [...this.tally.values()].filter((v) => !v.ok).length;
    const sick = !r.ok && this.tally.size >= 6 && failing * 2 > this.tally.size;
    return { ...r, colo, region, ...(sick && { vantageSick: true }) };
  }
}
