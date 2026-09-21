import { describe, expect, it } from "vitest";
import {
  MAX_EXTRA_CHECKS,
  canSubstitute,
  confirmSick,
  mergeExtraCheck
} from "../src/lib/target-rules";
import { clientIp } from "../src/lib/net";
import type { ExtraCheck, RegionProbe } from "../src/shared/types";

const SEP = String.fromCharCode(0);

describe("TargetDO budget stand-ins", () => {
  it("same kind and same expect only", () => {
    expect(canSubstitute("edge:https://a.com/x", "edge:https://a.com/y")).toBe(
      true
    );
    expect(
      canSubstitute("edge:https://a.com/x", "regions:https://a.com/y")
    ).toBe(false);
    expect(
      canSubstitute(`edge:https://a.com/x${SEP}Sign in`, "edge:https://a.com/y")
    ).toBe(false);
    expect(
      canSubstitute("edge:https://a.com/x", `edge:https://a.com/y${SEP}Sign in`)
    ).toBe(false);
  });

  it("never a result carrying a redirect refusal", () => {
    expect(
      canSubstitute("edge:https://a.com/x", "edge:https://a.com/y", {
        ok: false,
        refused: "10.0.0.1: private"
      })
    ).toBe(false);
    expect(
      canSubstitute("regions:https://a.com/x", "regions:https://a.com/y", [
        { ok: true },
        { ok: false, refused: "x" }
      ])
    ).toBe(false);
  });
});

describe("R6 region-sick needs healthy peers", () => {
  const r = (
    region: RegionProbe["region"],
    ok: boolean,
    sick = false
  ): RegionProbe => ({ region, ok, ms: 1, ...(sick && { vantageSick: true }) });

  it("keeps vantageSick when >= 3 other regions are ok", () => {
    const ps = [
      r("wnam", false, true),
      r("enam", true),
      r("weur", true),
      r("apac", true)
    ];
    expect(confirmSick(ps)[0].vantageSick).toBe(true);
  });

  it("drops it in a wide outage, but keeps a no-connectivity result excluded", () => {
    const dead: RegionProbe = { ...r("oc", false, true), noData: true };
    const out = confirmSick([
      r("wnam", false, true),
      r("enam", false, true),
      r("weur", true),
      dead
    ]);
    expect(out[0].vantageSick).toBeUndefined();
    expect(out[1].vantageSick).toBeUndefined();
    expect(out[3]).toMatchObject({ noData: true, vantageSick: true });
  });
});

describe("extra checks: one per voter, capped", () => {
  const c = (voter: string, id = voter): ExtraCheck => ({
    id,
    at: 1,
    user: {},
    browser: null,
    voter
  });

  it("a re-check replaces the voter's own entry", () => {
    const out = mergeExtraCheck([c("a"), c("b")], c("a", "a2"))!;
    expect(out.map((x) => x.id)).toEqual(["b", "a2"]);
  });

  it("refuses new entries when full instead of evicting old ones", () => {
    const full = Array.from({ length: MAX_EXTRA_CHECKS }, (_, i) => c(`v${i}`));
    expect(mergeExtraCheck(full, c("new"))).toBeNull();
    expect(mergeExtraCheck(full, c("v3", "again"))).toHaveLength(
      MAX_EXTRA_CHECKS
    );
  });
});

describe("clientIp keys", () => {
  const req = (ip: string) =>
    new Request("https://x/", { headers: { "cf-connecting-ip": ip } });

  it("two IPv6 addresses in the same /64 share a key", () => {
    expect(clientIp(req("2001:db8:1:2::1"))).toBe(
      clientIp(req("2001:db8:1:2:ffff:0:0:9"))
    );
    expect(clientIp(req("2001:db8:1:2::1"))).toBe("2001:db8:1:2::/64");
    expect(clientIp(req("2001:db8:1:3::1"))).not.toBe(
      clientIp(req("2001:db8:1:2::1"))
    );
  });

  it("IPv4 is unchanged", () => {
    expect(clientIp(req("203.0.113.9"))).toBe("203.0.113.9");
  });
});
