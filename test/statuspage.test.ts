import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchStatusPage,
  parseStatuspage,
  statusPageUrl
} from "../src/lib/statuspage";

const SUMMARY = {
  page: { id: "x", name: "GitHub", url: "https://www.githubstatus.com" },
  status: { indicator: "minor", description: "Partially Degraded Service" },
  components: [
    { id: "1", name: "Git Operations", status: "operational" },
    { id: "2", name: "Actions", status: "degraded_performance" },
    { id: "3", name: "Pages", status: "major_outage" }
  ],
  incidents: [
    {
      name: "Actions delays",
      status: "investigating",
      impact: "minor",
      created_at: "2026-09-21T10:00:00Z"
    },
    { name: "Old one", status: "resolved", created_at: "2026-09-20T10:00:00Z" }
  ],
  scheduled_maintenances: []
};

afterEach(() => vi.unstubAllGlobals());

describe("N2 status page discovery", () => {
  it("curated apex match, subdomains included", () => {
    expect(statusPageUrl("github.com")).toEqual({
      url: "https://www.githubstatus.com/api/v2/summary.json",
      source: "curated"
    });
    expect(statusPageUrl("gist.github.com")?.source).toBe("curated");
    expect(statusPageUrl("cloudflare.com")?.url).toBe(
      "https://www.cloudflarestatus.com/api/v2/summary.json"
    );
  });

  it("falls back to status.<apex>", () => {
    expect(statusPageUrl("www.example.org")).toEqual({
      url: "https://status.example.org/api/v2/summary.json",
      source: "statuspage"
    });
  });

  it("no candidate for IPs and single labels", () => {
    expect(statusPageUrl("93.184.216.34")).toBeNull();
    // status.<shared suffix> belongs to some tenant, never the platform
    expect(statusPageUrl("x.pages.dev")).toBeNull();
    expect(statusPageUrl("my-site.netlify.app")).toBeNull();
    expect(statusPageUrl("localhost")).toBeNull();
    expect(statusPageUrl("[::1]")).toBeNull();
  });
});

describe("N2 status page parse", () => {
  it("maps a summary.json fixture", () => {
    expect(parseStatuspage(SUMMARY, "u", "curated", 5)).toEqual({
      url: "u",
      source: "curated",
      indicator: "minor",
      description: "Partially Degraded Service",
      incidents: [
        {
          name: "Actions delays",
          status: "investigating",
          impact: "minor",
          createdAt: "2026-09-21T10:00:00Z"
        }
      ],
      componentsDown: ["Actions", "Pages"],
      fetchedAt: 5
    });
  });

  it("under_maintenance components are not counted as down", () => {
    const j = {
      ...SUMMARY,
      components: [{ name: "Lisbon", status: "under_maintenance" }]
    };
    expect(parseStatuspage(j, "u", "curated", 0)?.componentsDown).toEqual([]);
  });

  it("unknown indicator -> unknown", () => {
    const j = { ...SUMMARY, status: { indicator: "weird" } };
    expect(parseStatuspage(j, "u", "curated", 0)?.indicator).toBe("unknown");
  });

  it.each([
    null,
    "html",
    { status: "ok" },
    { status: { indicator: "none" }, incidents: [] },
    { status: { indicator: 1 }, incidents: [], components: [] }
  ])("invalid shape %j -> null", (j) => {
    expect(parseStatuspage(j, "u", "statuspage", 0)).toBeNull();
  });

  it("caps incidents at 5 and components at 10", () => {
    const j = {
      status: { indicator: "major" },
      incidents: Array.from({ length: 8 }, (_, i) => ({
        name: `i${i}`,
        status: "identified",
        created_at: ""
      })),
      components: Array.from({ length: 15 }, (_, i) => ({
        name: `c${i}`,
        status: "partial_outage"
      }))
    };
    const p = parseStatuspage(j, "u", "statuspage", 0)!;
    expect(p.incidents).toHaveLength(5);
    expect(p.componentsDown).toHaveLength(10);
  });
});

describe("N2 fetchStatusPage", () => {
  const doh = () =>
    Response.json({
      Status: 0,
      Answer: [{ name: "x", type: 1, TTL: 60, data: "185.199.108.153" }]
    });

  it("fetches, parses, and uses manual redirects", async () => {
    const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const u = String(input);
      if (u.includes("dns")) return doh();
      expect(init?.redirect).toBe("manual");
      return Response.json(SUMMARY);
    });
    vi.stubGlobal("fetch", fn);
    const p = await fetchStatusPage(
      "https://www.githubstatus.com/api/v2/summary.json",
      "curated"
    );
    expect(p?.indicator).toBe("minor");
  });

  it("HTML, redirects, bad JSON, network errors -> null, never throws", async () => {
    for (const r of [
      () => new Response("<html>status</html>", { status: 200 }),
      () =>
        new Response(null, { status: 301, headers: { location: "https://x" } }),
      () => new Response("{", { status: 200 }),
      () => new Response("nope", { status: 404 }),
      () => {
        throw new TypeError("fetch failed");
      }
    ]) {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL) =>
          String(input).includes("dns") ? doh() : r()
        )
      );
      expect(
        await fetchStatusPage(
          "https://status.example.org/api/v2/summary.json",
          "statuspage"
        )
      ).toBeNull();
    }
  });

  it("body over 256 KB -> null", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        String(input).includes("dns")
          ? doh()
          : new Response(`{"x":"${"a".repeat(300_000)}"}`)
      )
    );
    expect(
      await fetchStatusPage(
        "https://status.example.org/api/v2/summary.json",
        "statuspage"
      )
    ).toBeNull();
  });

  it("SSRF guard refuses private targets without fetching them", async () => {
    const fn = vi.fn(async (input: RequestInfo | URL) =>
      String(input).includes("dns")
        ? Response.json({
            Status: 0,
            Answer: [{ name: "x", type: 1, TTL: 60, data: "10.0.0.1" }]
          })
        : Response.json(SUMMARY)
    );
    vi.stubGlobal("fetch", fn);
    expect(
      await fetchStatusPage(
        "https://status.evil.test/api/v2/summary.json",
        "statuspage"
      )
    ).toBeNull();
    expect(fn.mock.calls.every(([u]) => String(u).includes("dns"))).toBe(true);
  });
});
