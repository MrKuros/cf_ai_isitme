import { describe, expect, it } from "vitest";
import {
  crowdBuckets,
  groupByColo,
  hostOf,
  probesOkOf,
  relTime,
  statusContradicts,
  visitorLabel
} from "../src/client/format";

describe("relTime (R2 d)", () => {
  it("returns never for a missing timestamp", () => {
    expect(relTime(undefined)).toBe("never");
    expect(relTime(0)).toBe("never");
  });
  it("recent is just now", () => {
    expect(relTime(Date.now() - 5_000)).toBe("just now");
    expect(relTime(1_000, 1_000 + 10 * 60_000)).toBe("10m ago");
  });
});

describe("crowdBuckets (R14 b)", () => {
  it("hides buckets under 3 samples", () => {
    const out = crowdBuckets([
      { asn: 1, total: 2, failing: 2 },
      { asn: 2, total: 3, failing: 1 }
    ]);
    expect(out.map((b) => b.asn)).toEqual([2]);
  });
});

describe("visitorLabel (R15)", () => {
  it("labels visitor checks as self-reported", () => {
    expect(visitorLabel({ asn: 7922, asOrganization: "Comcast" })).toBe(
      "self-reported by a visitor on AS7922 (Comcast)"
    );
    expect(visitorLabel({})).toBe(
      "self-reported by a visitor on an unknown network"
    );
  });
});

describe("groupByColo", () => {
  it("merges regions sharing a colo, keeps unknown colos apart", () => {
    const g = groupByColo([
      { region: "wnam", colo: "IAD" },
      { region: "enam", colo: "IAD" },
      { region: "weur" },
      { region: "apac" }
    ]);
    expect(g.map((x) => x.map((r) => r.region))).toEqual([
      ["wnam", "enam"],
      ["weur"],
      ["apac"]
    ]);
  });
});

it("hostOf", () => {
  expect(hostOf("https://www.a.com/x?y")).toBe("www.a.com");
  expect(hostOf("nope")).toBe("nope");
});

describe("status page vs reality (N2)", () => {
  it("probesOk follows the verdict, so a DOWN_REGIONAL behind an ok edge still contradicts 'all clear'", () => {
    expect(probesOkOf("DOWN_REGIONAL")).toBe(false);
    expect(statusContradicts("none", probesOkOf("DOWN_REGIONAL"))).toBe(true);
    expect(probesOkOf("HEALTHY")).toBe(true);
    expect(probesOkOf("LIKELY_YOUR_NETWORK")).toBe(true);
    expect(probesOkOf("TLS_ERROR")).toBe(false);
    expect(probesOkOf("INCONCLUSIVE")).toBeNull();
    expect(probesOkOf(undefined)).toBeNull();
  });
});
