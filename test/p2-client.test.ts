import { describe, expect, it } from "vitest";
import {
  authNsOk,
  authNsText,
  baselineY,
  lagLine,
  muteLabel,
  rdapExpiry,
  uptimeLabel
} from "../src/client/components/p2format";

const MIN = 60_000;
const DAY = 86_400_000;

describe("lagLine (N10)", () => {
  it("reports the vendor lag in minutes", () => {
    expect(lagLine({ firstFailureAt: MIN, vendorAckAt: 35 * MIN })).toBe(
      "Vendor acknowledged 34 min after our probes first failed"
    );
  });
  it("handles an ack before our first failure and a missing ack", () => {
    expect(lagLine({ firstFailureAt: 11 * MIN, vendorAckAt: MIN })).toMatch(
      /10 min before/
    );
    expect(lagLine({ firstFailureAt: MIN }, 6 * MIN)).toMatch(
      /5 min ago; the vendor hasn't acknowledged/
    );
    expect(
      lagLine({ firstFailureAt: MIN, vendorAckAt: MIN + 3 * 3600_000 })
    ).toMatch(/3 h after/);
  });
  it("is null without data", () => {
    expect(lagLine(null)).toBeNull();
    expect(lagLine(undefined)).toBeNull();
  });
});

describe("muteLabel", () => {
  it("is null when unmuted or expired", () => {
    expect(muteLabel(undefined, 1000)).toBeNull();
    expect(muteLabel(999, 1000)).toBeNull();
  });
  it("labels an active mute", () => {
    const now = new Date(2026, 0, 1, 9, 0).getTime();
    expect(muteLabel(now + 60 * MIN, now)).toMatch(/^muted until /);
    expect(muteLabel(now + 2 * DAY, now)).toMatch(/Jan/);
  });
});

describe("uptimeLabel", () => {
  const base = { watchId: "w", days: 7, runs: 10, upRuns: 9, excluded: 0 };
  it("formats uptime and excluded runs", () => {
    expect(uptimeLabel({ ...base, uptime: 1 })).toBe("100% up · 7d");
    expect(uptimeLabel({ ...base, uptime: 0.9985 })).toBe("99.85% up · 7d");
    expect(uptimeLabel({ ...base, uptime: 0.9, excluded: 2 })).toBe(
      "90.0% up · 7d (2 excluded)"
    );
  });
  it("hides when there are no counted runs", () => {
    expect(uptimeLabel({ ...base, uptime: null })).toBeNull();
    expect(uptimeLabel(null)).toBeNull();
  });
});

describe("baselineY", () => {
  it("scales like the sparkline and clamps off-scale values", () => {
    expect(baselineY(50, 100, 36)).toBe(18);
    expect(baselineY(500, 100, 36)).toBe(0);
    expect(baselineY(0, 100, 36)).toBe(36);
  });
});

describe("rdapExpiry", () => {
  const now = Date.parse("2026-09-21T00:00:00Z");
  it("explains expired and upcoming registrations", () => {
    expect(rdapExpiry("2026-09-18T00:00:00Z", now)).toEqual({
      expired: true,
      text: "registration expired 3 days ago"
    });
    expect(rdapExpiry("2026-09-22T00:00:00Z", now)).toEqual({
      expired: false,
      text: "registration expires in 1 day"
    });
  });
  it("is null without a parseable date", () => {
    expect(rdapExpiry(undefined, now)).toBeNull();
    expect(rdapExpiry("soon", now)).toBeNull();
  });
});

describe("authNs rows", () => {
  it("labels no-data rows and ignores them for health", () => {
    const cf = { ns: "a.ns.cloudflare.com", addresses: [], noData: true };
    expect(authNsOk([cf])).toBeNull();
    expect(authNsText(cf)).toMatch(/^no data/);
    expect(
      authNsOk([cf, { ns: "ns1.x", rcode: 0, addresses: ["1.2.3.4"] }])
    ).toBe(true);
    expect(authNsOk([{ ns: "ns1.x", rcode: 2, addresses: [] }])).toBe(false);
    expect(authNsText({ ns: "ns1.x", rcode: 2, addresses: [] })).toBe(
      "rcode 2"
    );
  });
});
