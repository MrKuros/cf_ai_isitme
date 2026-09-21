import { describe, expect, it } from "vitest";
import { badgeSvg } from "../src/lib/badge";
import type { Verdict } from "../src/shared/types";

const now = Date.UTC(2026, 0, 1);

describe("badgeSvg (R19 a, N11)", () => {
  it("no cached result -> unknown", () => {
    const svg = badgeSvg(null, now);
    expect(svg).toContain("unknown");
    expect(svg.startsWith("<svg")).toBe(true);
  });

  it("shows verdict and age", () => {
    const svg = badgeSvg(
      { verdict: "DOWN_GLOBAL", at: now - 5 * 60_000, reportId: "r" },
      now
    );
    expect(svg).toContain("down 5m ago");
    expect(svg).toContain("#e5534b");
  });

  it("older than 24h -> unknown", () => {
    const svg = badgeSvg(
      { verdict: "HEALTHY", at: now - 25 * 3600_000, reportId: "r" },
      now
    );
    expect(svg).toContain("unknown");
    expect(svg).not.toContain("ago");
  });

  it("never emits untrusted markup", () => {
    const svg = badgeSvg(
      { verdict: "<script>&" as Verdict, at: now, reportId: "r" },
      now
    );
    expect(svg).not.toContain("<script");
    expect(svg).toContain("unknown");
    expect(
      badgeSvg({ verdict: "BLOCKED", at: now, reportId: "r" }, now)
    ).toContain("up (bot wall) 0m ago");
  });
});
