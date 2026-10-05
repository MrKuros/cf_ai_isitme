import { afterEach, describe, expect, it, vi } from "vitest";
import { classify } from "../src/lib/classify";
import { GLOBALPING_API, gatherGlobalping } from "../src/lib/globalping";
import type {
  DnsResult,
  Evidence,
  GlobalpingEvidence,
  ProbeResult,
  RegionProbe,
  Target
} from "../src/shared/types";
import { REGIONS } from "../src/shared/types";

afterEach(() => vi.unstubAllGlobals());

const target: Target = {
  input: "example.com",
  url: "https://example.com/",
  host: "example.com",
  isIpLiteral: false
};

const entry = (continent: string, code: number | null, ms: number | null) => ({
  probe: {
    continent,
    country: "US",
    city: "Buffalo",
    asn: 36352,
    network: "HostPapa"
  },
  result: {
    status: code === null ? "failed" : "finished",
    statusCode: code,
    rawOutput:
      code === null ? "queryA ENOTFOUND example.com\nmore" : `HTTP/1.1 ${code}`,
    timings: { total: ms }
  }
});

/** POST returns an id; every GET returns `body`. */
function stubApi(body: unknown, pollStatus = 200) {
  const f = vi.fn(async (url: string, init?: RequestInit) =>
    init?.method === "POST"
      ? Response.json({ id: "m1", probesCount: 3 }, { status: 202 })
      : pollStatus === 200
        ? Response.json(body)
        : new Response("", { status: pollStatus })
  );
  vi.stubGlobal("fetch", f);
  return f;
}

describe("gatherGlobalping", () => {
  it("maps a finished http measurement", async () => {
    const f = stubApi({
      id: "m1",
      status: "finished",
      results: [
        entry("NA", 200, 51),
        entry("EU", 200, 111.4),
        entry("AS", 503, 20),
        entry("SA", null, null)
      ]
    });
    const g = await gatherGlobalping(target);

    expect(g.skipped).toBe(false);
    expect(g.measurementId).toBe("m1");
    expect(g.errors).toEqual([]);
    expect(g.probes.map((p) => p.ok)).toEqual([true, true, false, false]);
    expect(g.probes[0]).toEqual({
      continent: "NA",
      country: "US",
      city: "Buffalo",
      asn: 36352,
      network: "HostPapa",
      ok: true,
      ms: 51,
      status: 200
    });
    // 5xx answered, so it still carries a status; the failed probe carries one line of output.
    expect(g.probes[1].ms).toBe(111);
    expect(g.probes[2].status).toBe(503);
    expect(g.probes[3]).toEqual({
      continent: "SA",
      country: "US",
      city: "Buffalo",
      asn: 36352,
      network: "HostPapa",
      ok: false,
      error: "queryA ENOTFOUND example.com"
    });

    const [url, init] = f.mock.calls[0];
    expect(url).toBe(GLOBALPING_API);
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({
      type: "http",
      target: "example.com",
      limit: 5,
      measurementOptions: {
        protocol: "HTTPS",
        request: { method: "GET", path: "/" }
      }
    });
    expect(body.locations).toHaveLength(5);
    expect(f.mock.calls[1][0]).toBe(`${GLOBALPING_API}/m1`);
  });

  it("keeps at most `limit` probes and trims their location text", async () => {
    const long = "x".repeat(300);
    stubApi({
      id: "m1",
      status: "finished",
      results: [
        ...Array.from({ length: 40 }, () => entry("NA", 200, 10)),
        { probe: { continent: long, country: long, city: long }, result: {} }
      ]
    });
    const g = await gatherGlobalping(target, { limit: 2 });
    expect(g.probes).toHaveLength(2);

    stubApi({
      id: "m1",
      status: "finished",
      results: [{ probe: { continent: long, country: long, city: long } }]
    });
    const trimmed = (await gatherGlobalping(target)).probes[0];
    expect(trimmed.continent).toHaveLength(120);
    expect(trimmed.country).toHaveLength(120);
    expect(trimmed.city).toHaveLength(120);
  });

  it("skips when rate-limited", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 429 }))
    );
    expect(await gatherGlobalping(target)).toEqual({
      skipped: true,
      skipReason: "rate limited",
      probes: [],
      errors: ["rate limited"]
    });
  });

  it("skips when the measurement never finishes inside the budget", async () => {
    stubApi({ id: "m1", status: "in-progress", results: [] });
    const g = await gatherGlobalping(target, { timeoutMs: 1200 });
    expect(g.skipped).toBe(true);
    expect(g.errors).toContain("timed out waiting for probes");
  });

  it("skips on malformed JSON, a bad poll, and an empty result set", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("not json", { status: 200 }))
    );
    const bad = await gatherGlobalping(target);
    expect(bad.skipped).toBe(true);
    expect(bad.errors).toHaveLength(1);

    stubApi(null, 503);
    expect((await gatherGlobalping(target)).errors).toEqual(["poll HTTP 503"]);

    stubApi({ id: "m1", status: "finished", results: [] });
    expect((await gatherGlobalping(target)).skipReason).toBe(
      "no probe answered"
    );
  });

  it("adds traceroute hops from a second measurement on the same probes", async () => {
    let post = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === "POST") {
          const body = JSON.parse(String(init.body));
          post++;
          if (post === 2) expect(body.locations).toBe("m1");
          return Response.json({ id: "m1" }, { status: 202 });
        }
        return Response.json(
          post === 1
            ? { id: "m1", status: "finished", results: [entry("NA", 200, 10)] }
            : {
                id: "m1",
                status: "finished",
                results: [
                  {
                    probe: { continent: "NA" },
                    result: {
                      status: "finished",
                      hops: [
                        {
                          resolvedAddress: "10.0.0.1",
                          resolvedHostname: "gw",
                          timings: [{ rtt: 0.38 }]
                        },
                        {
                          resolvedAddress: null,
                          resolvedHostname: null,
                          timings: []
                        }
                      ]
                    }
                  }
                ]
              }
        );
      })
    );
    const g = await gatherGlobalping(target, { traceroute: true });
    expect(g.probes[0].hops).toEqual([
      { hop: 1, host: "gw", ms: 0.4 },
      { hop: 2 }
    ]);
  });

  it("degrades silently when only the traceroute fails", async () => {
    let post = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === "POST") {
          post++;
          return post === 1
            ? Response.json({ id: "m1" }, { status: 202 })
            : new Response("", { status: 429 });
        }
        return Response.json({
          id: "m1",
          status: "finished",
          results: [entry("NA", 200, 10)]
        });
      })
    );
    const g = await gatherGlobalping(target, { traceroute: true });
    expect(g.skipped).toBe(false);
    expect(g.probes[0].hops).toBeUndefined();
    expect(g.errors).toEqual(["rate limited"]);
  });
});

// ── THE RULE: globalping never changes a verdict (docs/CONTRACTS.md, Wave P3) ──

const dnsOk: DnsResult = {
  ok: true,
  rcode: 0,
  addresses: ["93.184.216.34"],
  cnames: [],
  ad: false,
  ms: 12
};
const probe = (ok: boolean): ProbeResult =>
  ok
    ? { ok, status: 200, ms: 143, colo: "SJC" }
    : { ok, ms: 8000, errorClass: "timeout", error: "timed out" };

const gp = (ok: boolean): GlobalpingEvidence => ({
  skipped: false,
  probes: ["NA", "EU", "AS"].map((continent) => ({
    continent,
    ok,
    ...(ok ? { ms: 50, status: 200 } : { error: "timed out" })
  })),
  measurementId: "m1",
  errors: []
});

function ev(okProbes: boolean, globalping: Evidence["globalping"]): Evidence {
  return {
    target,
    user: { asn: 9829, country: "IN", colo: "BOM" },
    dns: dnsOk,
    dnsAlt: dnsOk,
    edge: probe(okProbes),
    regions: REGIONS.map((region): RegionProbe => ({
      region,
      ...probe(okProbes)
    })),
    radar: null,
    crowd: null,
    browser: null,
    globalping,
    startedAt: 1
  };
}

describe("classify ignores globalping", () => {
  for (const okProbes of [true, false]) {
    it(`${okProbes ? "healthy" : "failing"} evidence: same verdict, confidence and factors`, () => {
      const none = classify(ev(okProbes, null));
      for (const g of [gp(true), gp(false), { ...gp(true), skipped: true }]) {
        const c = classify(ev(okProbes, g));
        expect(c.verdict).toBe(none.verdict);
        expect(c.confidence).toBe(none.confidence);
        expect(c.factors).toEqual(none.factors);
        expect(c.subtype).toBe(none.subtype);
      }
    });
  }
});

describe("classify describes globalping", () => {
  it("adds one signals line, and none when skipped or absent", () => {
    expect(classify(ev(false, gp(false))).signals).toContain(
      "3 of 3 outside probes couldn't reach it"
    );
    expect(classify(ev(false, gp(true))).signals).toContain(
      "All 3 outside probes reached it"
    );
    // A site that blocks the probe networks while answering our edge: the line must not
    // read as if it contradicted the verdict.
    const healthy = classify(ev(true, gp(false)));
    expect(healthy.verdict).toBe("HEALTHY");
    expect(healthy.signals).toContain(
      "3 of 3 outside probes couldn't reach it"
    );
    for (const g of [null, { ...gp(true), skipped: true }]) {
      expect(
        classify(ev(false, g)).signals.some((s) => s.includes("outside probes"))
      ).toBe(false);
    }
  });
});
