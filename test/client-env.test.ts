import { describe, expect, it } from "vitest";
import { parseTrace, tzMismatch } from "../src/client/probe";
import {
  sparkline,
  statusContradicts,
  visitorsByAsn
} from "../src/client/format";

const TRACE = `fl=123f45
h=example.com
ip=203.0.113.9
ts=1726900000.1
visit_scheme=https
uag=Mozilla/5.0
colo=FRA
loc=DE
tls=TLSv1.3
warp=on
gateway=off
`;

describe("parseTrace (N4)", () => {
  it("reads warp, gateway and loc, never the ip", () => {
    expect(parseTrace(TRACE)).toEqual({
      trace: { warp: "on", gateway: "off", loc: "DE" },
      blocked: false
    });
  });
  it("a non-trace body (captive portal) is blocked", () => {
    expect(parseTrace("<html><body>Sign in to Wi-Fi</body></html>")).toEqual({
      blocked: true
    });
  });
});

describe("tzMismatch (N4)", () => {
  it("flags a country/timezone disagreement", () => {
    expect(tzMismatch("DE", "America/New_York")).toBe(true);
  });
  it("matching or unknown pairs are not a mismatch", () => {
    expect(tzMismatch("DE", "Europe/Berlin")).toBeUndefined();
    expect(tzMismatch("US", "America/Los_Angeles")).toBeUndefined();
    expect(tzMismatch("ZZ", "Europe/Berlin")).toBeUndefined();
    expect(tzMismatch("DE", "UTC")).toBeUndefined();
    expect(tzMismatch(undefined, "Europe/Berlin")).toBeUndefined();
  });
});

describe("statusContradicts", () => {
  it("all clear while probes fail, or major while probes pass", () => {
    expect(statusContradicts("none", false)).toBe(true);
    expect(statusContradicts("major", true)).toBe(true);
    expect(statusContradicts("minor", false)).toBe(false);
    expect(statusContradicts("none", true)).toBe(false);
    expect(statusContradicts("none", null)).toBe(false);
  });
});

describe("visitorsByAsn (N6)", () => {
  it("groups reachable/total per ASN and skips missing browser results", () => {
    const rows = visitorsByAsn([
      {
        user: { asn: 7922, asOrganization: "Comcast" },
        browser: { reachable: true }
      },
      { user: { asn: 7922 }, browser: { reachable: false } },
      { user: { asn: 3320 }, browser: { reachable: true } },
      { user: { asn: 3320 }, browser: null }
    ]);
    expect(rows).toEqual([
      { asn: 7922, asName: "Comcast", reachable: 1, total: 2 },
      { asn: 3320, asName: undefined, reachable: 1, total: 1 }
    ]);
  });
});

describe("sparkline", () => {
  it("scales the last 24h and ticks failures", () => {
    const now = 86_400_000 * 2;
    const s = sparkline(
      [
        { at: now - 86_400_000 * 2, ok: true, ms: 999 },
        { at: now - 43_200_000, ok: true, ms: 100 },
        { at: now - 21_600_000, ok: false },
        { at: now, ok: true, ms: 50 }
      ],
      100,
      20,
      now
    );
    expect(s.max).toBe(100);
    expect(s.points).toBe("50,0 100,10");
    expect(s.ticks).toEqual([75]);
  });
});
