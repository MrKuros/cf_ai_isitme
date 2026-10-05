import { afterEach, describe, expect, it, vi } from "vitest";
import { gatherRadar } from "../src/lib/radar";

/** Stubs the Radar API: one `{ success, result }` body per path fragment. */
function stubRadar(bodies: Record<string, unknown>) {
  vi.stubGlobal("fetch", async (url: string) => {
    const key = Object.keys(bodies).find((k) => String(url).includes(k));
    return Response.json({ success: !!key, result: key ? bodies[key] : null });
  });
}

const env = { RADAR_TOKEN: "t" } as Pick<Env, "RADAR_TOKEN">;

afterEach(() => vi.unstubAllGlobals());

describe("gatherRadar BGP timestamps", () => {
  // Verified against the live API: hijack/leak timestamps carry no timezone, while outage and
  // anomaly dates do. Parsed as local time they shift classify()'s `recent()` window by the
  // host's UTC offset, which drops every BGP event east of UTC.
  it("pins the offset-less hijack and leak timestamps to UTC", async () => {
    stubRadar({
      "entities/asns/ip": { asn: { asn: 396982, name: "GOOGLE-CLOUD" } },
      "bgp/hijacks/events": {
        events: [
          {
            id: 166789,
            min_hijack_ts: "2026-10-05T12:39:18.727",
            max_hijack_ts: "2026-10-05T13:18:31.162",
            confidence_score: 8,
            hijacker_asn: 3356,
            victim_asns: [396982],
            prefixes: ["8.236.0.0/15"]
          }
        ]
      },
      "bgp/leaks/events": {
        events: [
          {
            id: 42,
            min_ts: "2026-10-05T12:33:16",
            max_ts: "2026-10-05T12:55:00",
            finished: true,
            leak_asn: 64500,
            leak_seg: [174]
          }
        ]
      }
    });

    const r = await gatherRadar(env, { targetIp: "8.236.0.1" });
    expect(r.targetAsn).toBe(396982);
    expect(r.bgp.map((e) => [e.startedAt, e.endedAt])).toEqual([
      ["2026-10-05T12:39:18.727Z", "2026-10-05T13:18:31.162Z"],
      ["2026-10-05T12:33:16Z", "2026-10-05T12:55:00Z"]
    ]);
    // Same instant whatever the host's timezone, which is the whole point.
    for (const e of r.bgp)
      expect(Number.isNaN(Date.parse(e.startedAt))).toBe(false);
    expect(Date.parse(r.bgp[0].startedAt)).toBe(
      Date.UTC(2026, 9, 5, 12, 39, 18, 727)
    );
  });

  it("leaves a timestamp that already carries an offset alone", async () => {
    stubRadar({
      "entities/asns/ip": { asn: { asn: 1 } },
      "bgp/hijacks/events": {
        events: [{ id: 1, min_hijack_ts: "2026-10-05T12:00:00Z" }]
      },
      "bgp/leaks/events": {
        events: [{ id: 2, min_ts: "2026-10-05T11:00:00+05:30" }]
      }
    });

    const r = await gatherRadar(env, { targetIp: "1.1.1.2" });
    expect(r.bgp.map((e) => e.startedAt)).toEqual([
      "2026-10-05T12:00:00Z",
      "2026-10-05T11:00:00+05:30"
    ]);
  });
});
