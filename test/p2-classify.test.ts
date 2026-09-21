import { describe, expect, it } from "vitest";
import { classify } from "../src/lib/classify";
import { compactEvidence, fallbackExplanation } from "../src/lib/explain";
import { REGIONS } from "../src/shared/types";
import type { DnsResult, Evidence } from "../src/shared/types";

const DAY = 86_400_000;
const NOW = Date.parse("2026-09-21T12:00:00Z");
const dnsOk: DnsResult = {
  ok: true,
  rcode: 0,
  addresses: ["93.184.216.34"],
  cnames: [],
  ad: false,
  ms: 12,
};
const nx: DnsResult = { ...dnsOk, ok: false, rcode: 3, addresses: [] };
const servfail: DnsResult = { ...dnsOk, ok: false, rcode: 2, addresses: [] };

function ev(over: Partial<Evidence> = {}): Evidence {
  return {
    target: {
      input: "example.com",
      url: "https://example.com/",
      host: "example.com",
      isIpLiteral: false,
    },
    user: {},
    dns: dnsOk,
    edge: { ok: true, status: 200, ms: 140, colo: "FRA" },
    regions: REGIONS.map((region) => ({
      region,
      ok: true,
      status: 200,
      ms: 200,
    })),
    radar: null,
    crowd: null,
    browser: null,
    startedAt: NOW,
    ...over,
  };
}
const dnsDown = (over: Partial<Evidence> = {}) =>
  ev({
    dns: nx,
    dnsAlt: { ...nx, resolver: "google" },
    edge: null,
    regions: [],
    ...over,
  });

describe("N9 SLOW vs baseline", () => {
  const baseline = { colo: "FRA", medianMs: 210, samples: 50 };
  const edge = (ms: number) => ({ ok: true, status: 200, ms, colo: "FRA" });

  it("no baseline keeps the 3000ms rule", () => {
    expect(classify(ev({ edge: edge(2999) })).verdict).toBe("HEALTHY");
    expect(classify(ev({ edge: edge(3000) })).verdict).toBe("SLOW");
  });

  it("fast baseline never lowers the threshold below 3000ms", () => {
    expect(classify(ev({ edge: edge(2000), baseline })).verdict).toBe(
      "HEALTHY",
    );
  });

  it("slow baseline raises the threshold to 3x the median", () => {
    const b = { ...baseline, medianMs: 1500 };
    expect(classify(ev({ edge: edge(4000), baseline: b })).verdict).toBe(
      "HEALTHY",
    );
    expect(classify(ev({ edge: edge(4500), baseline: b })).verdict).toBe(
      "SLOW",
    );
  });

  it("names the ratio, colo and usual time", () => {
    const c = classify(
      ev({ edge: edge(798), baseline: { ...baseline, medianMs: 210 } }),
    );
    expect(c.verdict).toBe("HEALTHY");
    const s = classify(ev({ edge: edge(3990), baseline }));
    expect(s.verdict).toBe("SLOW");
    expect(s.signals).toContain(
      "19.0x slower than usual from FRA (normally 210ms)",
    );
    const t = classify(
      ev({ edge: edge(5700), baseline: { ...baseline, medianMs: 1500 } }),
    );
    expect(t.signals[0]).toBe(
      "3.8x slower than usual from FRA (normally 1500ms)",
    );
    expect(t.factors?.[0].label).toBe("Responses took 4500ms+");
  });
});

describe("RDAP expiry signal", () => {
  it("expired registration adds a signal and a next step, verdict unchanged", () => {
    const plain = classify(dnsDown());
    const c = classify(
      dnsDown({
        rdap: { expiresAt: new Date(NOW - 3 * DAY - 1000).toISOString() },
      }),
    );
    expect(c.verdict).toBe(plain.verdict);
    expect(c.subtype).toBe("nxdomain");
    expect(c.confidence).toBe(plain.confidence);
    expect(c.signals[0]).toBe("The domain registration expired 3 days ago");
    expect(c.hints).toContain("The owner must renew the domain");
    expect(fallbackExplanation(c)).toContain("The owner must renew the domain");
  });

  it("future or missing expiry adds nothing", () => {
    for (const rdap of [
      { expiresAt: new Date(NOW + DAY).toISOString() },
      { expiresAt: "garbage" },
      {},
      null,
    ]) {
      const c = classify(dnsDown({ rdap }));
      expect(c.signals.join(" ")).not.toMatch(/registration expired/);
      expect(c.hints).toBeUndefined();
    }
  });

  it("never applies outside DNS_FAILURE", () => {
    const c = classify(
      ev({ rdap: { expiresAt: new Date(NOW - DAY).toISOString() } }),
    );
    expect(c.verdict).toBe("HEALTHY");
    expect(c.signals.join(" ")).not.toMatch(/registration/);
  });
});

describe("authoritative NS signal", () => {
  const down = (authNs: Evidence["authNs"]) =>
    classify(
      dnsDown({
        dns: servfail,
        dnsAlt: { ...servfail, resolver: "google" },
        authNs,
      }),
    );

  it("own nameservers answer while resolvers fail", () => {
    const c = down([
      { ns: "ns1.example.com", rcode: 0, addresses: ["93.184.216.34"] },
      { ns: "ns2.example.com", rcode: 2, addresses: [] },
    ]);
    expect(c.verdict).toBe("DNS_FAILURE");
    expect(c.signals).toContain(
      "The domain's own nameservers answer, so this looks like a resolver-side or DNSSEC problem",
    );
  });

  it("every answering nameserver fails or refuses", () => {
    const c = down([
      { ns: "ns1.example.com", rcode: 5, addresses: [] },
      { ns: "ns2.example.com", rcode: 0, addresses: [] },
      { ns: "ns3.example.com", addresses: [], noData: true },
    ]);
    expect(c.signals).toContain("The domain's nameservers are failing");
  });

  it("only noData entries", () => {
    const c = down([{ ns: "ns1.example.com", addresses: [], noData: true }]);
    expect(c.signals).toContain(
      "Couldn't query the nameservers directly (no data)",
    );
  });

  it("silent when resolvers are fine or authNs is missing", () => {
    const ok = classify(
      ev({ authNs: [{ ns: "ns1", rcode: 5, addresses: [] }] }),
    );
    expect(ok.signals.join(" ")).not.toMatch(/nameservers/);
    expect(down(null).signals.join(" ")).not.toMatch(/nameservers/);
    expect(down([]).signals.join(" ")).not.toMatch(/nameservers/);
  });

  it("one resolver failing while the other resolves still reports", () => {
    const c = classify(
      ev({
        dns: servfail,
        dnsAlt: { ...dnsOk, resolver: "google" },
        authNs: [{ ns: "ns1", rcode: 0, addresses: ["1.2.3.4"] }],
      }),
    );
    expect(c.verdict).not.toBe("DNS_FAILURE");
    expect(c.signals.join(" ")).toMatch(/own nameservers answer/);
  });
});

describe("N10 status lag signal", () => {
  const line =
    /The vendor acknowledged the incident \d+ min after our probes first failed/;

  it("reports minutes between first failure and vendor ack", () => {
    const c = classify(
      ev({
        statusLag: {
          firstFailureAt: NOW - 3600_000,
          vendorAckAt: NOW - 3600_000 + 34 * 60_000,
        },
      }),
    );
    expect(c.signals).toContain(
      "The vendor acknowledged the incident 34 min after our probes first failed",
    );
    expect(c.verdict).toBe("HEALTHY");
  });

  it("silent without an ack, or when the vendor acked first", () => {
    expect(
      classify(ev({ statusLag: { firstFailureAt: NOW } })).signals.join("\n"),
    ).not.toMatch(line);
    expect(
      classify(
        ev({ statusLag: { firstFailureAt: NOW, vendorAckAt: NOW - 60_000 } }),
      ).signals.join("\n"),
    ).not.toMatch(line);
  });
});

describe("explain: P2 fields", () => {
  it("passes the new fields through, registrar capped", () => {
    const out = compactEvidence(
      ev({
        baseline: { colo: "FRA", medianMs: 210, samples: 40 },
        rdap: { expiresAt: "2026-09-18T00:00:00Z", registrar: "x".repeat(200) },
        authNs: [{ ns: "ns1.example.com", rcode: 0, addresses: ["1.2.3.4"] }],
        statusLag: { firstFailureAt: 1, vendorAckAt: 2 },
      }),
      { verdict: "HEALTHY", confidence: 0.9, signals: [] },
    );
    expect(out).toContain('"medianMs":210');
    expect(out).toContain('"ns":"ns1.example.com"');
    expect(out).toContain('"vendorAckAt":2');
    expect(out).toContain(`"registrar":"${"x".repeat(80)}"`);
    expect(out).not.toContain("x".repeat(81));
  });
});
