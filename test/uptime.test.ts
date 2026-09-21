import { describe, expect, it } from "vitest";
import { uptime, vantageCaused } from "../src/lib/uptime";
import type { Evidence, ProbeResult, RegionProbe } from "../src/shared/types";

const probe = (over: Partial<ProbeResult> = {}): ProbeResult => ({
  ok: true,
  ms: 50,
  ...over
});
const ev = (edge: ProbeResult | null, regions: Partial<RegionProbe>[] = []) =>
  ({
    edge,
    regions: regions.map((r) => ({ ...probe(), region: "weur", ...r }))
  }) as unknown as Evidence;

describe("uptime (parity: SLA, R6 exclusions)", () => {
  it("counts up and down runs", () => {
    const s = uptime(
      [
        { verdict: "HEALTHY" },
        { verdict: "SLOW" },
        { verdict: "DOWN_GLOBAL", evidence: ev(probe({ ok: false })) },
        { verdict: "BLOCKED" }
      ],
      "w1",
      7
    );
    expect(s).toEqual({
      watchId: "w1",
      days: 7,
      runs: 4,
      upRuns: 3,
      excluded: 0,
      uptime: 0.75
    });
  });

  it("excludes none-class verdicts", () => {
    const s = uptime(
      [
        { verdict: "HEALTHY" },
        { verdict: "INCONCLUSIVE" },
        { verdict: "LIKELY_YOUR_NETWORK" },
        { verdict: "ISP_OUTAGE" }
      ],
      "w1",
      7
    );
    expect(s.excluded).toBe(3);
    expect(s.uptime).toBe(1);
  });

  it("excludes down runs where every failing vantage was noData/vantageSick", () => {
    const sick = ev(probe({ ok: false, noData: true }), [
      { ok: false, vantageSick: true, noData: true },
      { ok: true }
    ]);
    expect(vantageCaused("DOWN_REGIONAL", sick)).toBe(true);
    const s = uptime(
      [{ verdict: "HEALTHY" }, { verdict: "DOWN_REGIONAL", evidence: sick }],
      "w1",
      1
    );
    expect(s).toMatchObject({ runs: 2, excluded: 1, upRuns: 1, uptime: 1 });
  });

  it("keeps down runs with at least one real failing vantage", () => {
    const mixed = ev(probe({ ok: false }), [{ ok: false, vantageSick: true }]);
    expect(vantageCaused("DOWN_GLOBAL", mixed)).toBe(false);
    expect(
      uptime([{ verdict: "DOWN_GLOBAL", evidence: mixed }], "w", 7).uptime
    ).toBe(0);
  });

  it("keeps DNS failures with no failing HTTP vantage, and runs without evidence", () => {
    expect(vantageCaused("DNS_FAILURE", ev(null))).toBe(false);
    expect(vantageCaused("DOWN_GLOBAL")).toBe(false);
  });

  it("never excludes up runs, even with sick vantages", () => {
    expect(
      vantageCaused("HEALTHY", ev(probe({ ok: false, noData: true })))
    ).toBe(false);
  });

  it("null uptime with no counted runs", () => {
    expect(uptime([], "w", 7).uptime).toBeNull();
    expect(uptime([{ verdict: "INCONCLUSIVE" }], "w", 7).uptime).toBeNull();
  });
});
