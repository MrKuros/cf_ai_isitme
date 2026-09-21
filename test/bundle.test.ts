import { describe, expect, it } from "vitest";
import { supportBundle } from "../src/lib/bundle";
import type { Report } from "../src/shared/types";

const at = Date.UTC(2026, 8, 21, 12, 0, 0);
const report = {
  id: "abc123",
  host: "example.com",
  url: "https://example.com/",
  createdAt: at,
  trigger: "chat",
  evidence: {
    target: {
      input: "example.com",
      url: "https://example.com/",
      host: "example.com",
      isIpLiteral: false
    },
    user: {
      asn: 7922,
      asOrganization: "Comcast",
      country: "US",
      city: "Springfield",
      colo: "ORD"
    },
    dns: {
      ok: true,
      rcode: 0,
      addresses: ["93.184.216.34"],
      cnames: [],
      ad: false,
      ms: 12
    },
    dnsAlt: {
      ok: false,
      rcode: 2,
      addresses: [],
      cnames: [],
      ad: false,
      ms: 30
    },
    edge: { ok: true, status: 200, ms: 80, colo: "ORD" },
    regions: [
      {
        region: "weur",
        ok: false,
        ms: 10000,
        errorClass: "timeout",
        colo: "FRA"
      },
      {
        region: "apac",
        ok: false,
        ms: 0,
        noData: true,
        error: "probe unavailable"
      }
    ],
    radar: {
      skipped: true,
      skipReason: "no token",
      outages: [],
      anomalies: [],
      bgp: [],
      errors: []
    },
    crowd: null,
    browser: null,
    provider: { id: "fastly", name: "Fastly", via: ["header"] },
    startedAt: at
  },
  classification: {
    verdict: "DOWN_REGIONAL",
    confidence: 0.8,
    signals: ["weur timed out"]
  },
  explanation: "",
  extraChecks: [
    {
      id: "x1",
      at,
      user: { asn: 3320, asOrganization: "Deutsche Telekom", country: "DE" },
      browser: {
        at,
        reachable: false,
        method: "fetch-no-cors",
        online: true,
        controlReachable: true,
        dns: null
      }
    }
  ]
} satisfies Report;

describe("supportBundle (N5)", () => {
  const text = supportBundle(report, "https://isitme.example");

  it("has UTC time, target, ASN and verdict", () => {
    expect(text).toContain("2026-09-21T12:00:00.000Z");
    expect(text).toContain("https://example.com/");
    expect(text).toContain("AS7922 (Comcast), US");
    expect(text).toContain("DOWN_REGIONAL");
    expect(text).toContain("80%");
  });

  it("never includes city", () => {
    expect(text).not.toContain("Springfield");
  });

  it("lists every vantage", () => {
    expect(text).toContain("DNS (Google DoH): FAIL, rcode 2");
    expect(text).toContain("Cloudflare edge: ok, HTTP 200, colo ORD");
    expect(text).toContain("Region weur: FAIL, error class timeout, colo FRA");
    expect(text).toContain("Region apac: no data");
    expect(text).toContain("Radar: skipped (no token)");
    expect(text).toContain("Provider: Fastly");
  });

  it("labels visitor checks and links the report", () => {
    expect(text).toContain(
      "self-reported by a visitor on AS3320 (Deutsche Telekom)"
    );
    expect(text).toContain(
      "Full report: https://isitme.example/r/example.com/abc123"
    );
  });
});
