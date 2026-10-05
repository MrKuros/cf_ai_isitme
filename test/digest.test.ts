import { describe, expect, it } from "vitest";
import { buildDigest, type DigestWatchInput } from "../src/lib/digest";
import type { Evidence, Verdict } from "../src/shared/types";

const ev = (ms?: number, ok = true) =>
  ({ edge: { ok, ms }, regions: [] }) as unknown as Evidence;

const w = (
  host: string,
  verdicts: Array<[Verdict, number?]>,
  incidents = 0
): DigestWatchInput => ({
  watchId: host.slice(0, 2),
  host,
  rows: verdicts.map(([verdict, ms]) => ({
    verdict,
    evidence: ev(ms, verdict === "HEALTHY")
  })),
  incidents
});

describe("buildDigest", () => {
  it("returns null when there is nothing to report", () => {
    expect(buildDigest([], 1000)).toBeNull();
    expect(buildDigest([w("a.com", [])], 1000)).toBeNull();
  });

  it("summarizes uptime, incidents and the newest verdict per watch", () => {
    const built = buildDigest(
      [
        w(
          "a.com",
          [
            ["HEALTHY", 100],
            ["DOWN_GLOBAL", 100],
            ["HEALTHY", 100],
            ["HEALTHY", 100]
          ],
          1
        ),
        w("b.com", [["HEALTHY", 900]])
      ],
      5000
    );
    expect(built).not.toBeNull();
    expect(built!.summary).toEqual({
      at: 5000,
      hours: 24,
      watches: [
        {
          watchId: "a.",
          host: "a.com",
          verdict: "HEALTHY",
          incidents: 1,
          uptime: 0.75
        },
        {
          watchId: "b.",
          host: "b.com",
          verdict: "HEALTHY",
          incidents: 0,
          uptime: 1
        }
      ]
    });
    expect(built!.text).toContain(
      "a.com: uptime 75.0%, 1 incident, now HEALTHY"
    );
    expect(built!.text).toContain(
      "b.com: uptime 100%, 0 incidents, now HEALTHY"
    );
    // Slowest is the mean edge time, so b.com (900ms) beats a.com (100ms).
    expect(built!.text).toContain("Slowest: b.com (900ms average)");
  });

  it("excludes user-side runs from the ratio, like getUptime", () => {
    const built = buildDigest(
      [w("a.com", [["LIKELY_YOUR_NETWORK"], ["HEALTHY"]])],
      1
    );
    expect(built!.summary.watches[0].uptime).toBe(1);
    expect(built!.text).not.toContain("Slowest:");
  });

  it("reports no data when every run was excluded", () => {
    const built = buildDigest([w("a.com", [["INCONCLUSIVE"]])], 1);
    expect(built!.summary.watches[0].uptime).toBeNull();
    expect(built!.text).toContain("a.com: uptime n/a");
  });
});
