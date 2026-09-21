import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  baselineOf,
  failingStreakStart,
  statusLagOf,
  TRENDS_LIST_SQL,
  TRENDS_SCHEMA
} from "../src/lib/history";
import type { StatusPageInfo } from "../src/shared/types";

describe("N9 per-colo baseline", () => {
  it("null below 10 samples", () => {
    expect(baselineOf("FRA", Array(9).fill(200))).toBeNull();
  });
  it("median of >= 10 samples", () => {
    const ms = [100, 110, 120, 130, 140, 150, 160, 170, 180, 9000];
    expect(baselineOf("FRA", ms)).toEqual({
      colo: "FRA",
      medianMs: 145,
      samples: 10
    });
  });
});

describe("N10 status lag", () => {
  // newest first
  const samples = [
    { at: 500, ok: false },
    { at: 400, ok: false },
    { at: 300, ok: true },
    { at: 200, ok: false }
  ];
  const page = (createdAt?: string): StatusPageInfo => ({
    url: "u",
    source: "statuspage",
    indicator: "major",
    incidents: createdAt
      ? [{ name: "x", status: "investigating", createdAt }]
      : [],
    componentsDown: [],
    fetchedAt: 0
  });

  it("streak start is the earliest sample of the current failing run", () => {
    expect(failingStreakStart(samples)).toBe(400);
    expect(failingStreakStart([{ at: 1, ok: true }])).toBeNull();
    expect(failingStreakStart([])).toBeNull();
  });
  it("the in-progress failing run extends or starts the streak", () => {
    expect(failingStreakStart(samples, 600)).toBe(400);
    expect(failingStreakStart([{ at: 1, ok: true }], 600)).toBe(600);
  });
  it("vendorAckAt from the unresolved incident; null without one", () => {
    const iso = "2026-09-21T10:00:00Z";
    expect(statusLagOf(samples, page(iso))).toEqual({
      firstFailureAt: 400,
      vendorAckAt: Date.parse(iso)
    });
    expect(statusLagOf(samples, page())).toBeNull();
    expect(statusLagOf(samples, null)).toBeNull();
    expect(statusLagOf(samples, page("garbage"))).toEqual({
      firstFailureAt: 400
    });
  });
});

describe("N12 trends privacy + ranking", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(TRENDS_SCHEMA);
  const ins = db.prepare(
    "INSERT INTO trends (host, verdict, provider, asn, at) VALUES (?, ?, ?, ?, ?)"
  );
  // a.com: 4 ASNs, b.com: 3, c.com: 2 ASNs (many rows), d.com: 3 ASNs but stale
  for (const asn of [1, 2, 3, 4])
    ins.run("a.com", "DOWN_GLOBAL", "Fastly", asn, 1000 + asn);
  ins.run("a.com", "DNS_FAILURE", null, 1, 2000);
  for (const asn of [1, 2, 3]) ins.run("b.com", "SLOW", null, asn, 1500);
  for (let i = 0; i < 10; i++)
    ins.run("c.com", "DOWN_GLOBAL", null, i % 2, 1500);
  for (const asn of [1, 2, 3]) ins.run("d.com", "DOWN_GLOBAL", null, asn, 10);
  const rows = db.prepare(TRENDS_LIST_SQL).all(100) as Array<
    Record<string, unknown>
  >;

  it("hides hosts under 3 distinct ASNs and outside the window", () => {
    expect(rows.map((r) => r.host)).toEqual(["a.com", "b.com"]);
  });
  it("ranks by distinct ASNs with the newest verdict", () => {
    expect(rows[0]).toMatchObject({
      asns: 4,
      verdict: "DNS_FAILURE",
      last_at: 2000
    });
  });
});
