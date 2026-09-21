import { describe, expect, it } from "vitest";
import { DAY_MS, expireBefore } from "../src/lib/retention";
import { REPORT_TTL_DAYS } from "../src/shared/types";

describe("R17 report retention cutoff", () => {
  const now = Date.UTC(2026, 8, 21);
  const expired = (createdAt: number) => createdAt < expireBefore(now);

  it("keeps reports for 30 days", () => {
    expect(REPORT_TTL_DAYS).toBe(30);
    expect(expireBefore(now)).toBe(now - 30 * DAY_MS);
  });

  it("a report older than 30 days is expired, a 29-day-old one is not", () => {
    expect(expired(now - 31 * DAY_MS)).toBe(true);
    expect(expired(now - 30 * DAY_MS - 1)).toBe(true);
    expect(expired(now - 30 * DAY_MS)).toBe(false);
    expect(expired(now - 29 * DAY_MS)).toBe(false);
  });
});
