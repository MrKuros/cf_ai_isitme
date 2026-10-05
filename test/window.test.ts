import { describe, expect, it } from "vitest";
import { hit, prune, type Window } from "../src/lib/window";

const LIMIT = 3;
const PERIOD = 60_000;

describe("rate-limit window", () => {
  it("allows up to the limit, then refuses", () => {
    let w: Window | undefined;
    const results = [0, 1, 2, 3, 4].map((i) => {
      const r = hit(w, 1000 + i, LIMIT, PERIOD);
      w = r.next;
      return r.ok;
    });
    expect(results).toEqual([true, true, true, false, false]);
  });

  it("starts a new window once the period has passed", () => {
    const first = hit(undefined, 0, LIMIT, PERIOD);
    const blocked = hit({ start: 0, count: LIMIT }, 30_000, LIMIT, PERIOD);
    const after = hit({ start: 0, count: LIMIT }, PERIOD, LIMIT, PERIOD);
    expect(first.ok).toBe(true);
    expect(blocked.ok).toBe(false);
    expect(after.ok).toBe(true);
    expect(after.next.count).toBe(1);
  });

  it("reports when the caller may retry", () => {
    const r = hit({ start: 0, count: LIMIT }, 15_000, LIMIT, PERIOD);
    expect(r.ok).toBe(false);
    expect(r.retryAfter).toBe(45);
  });

  it("prunes only expired windows", () => {
    const windows = new Map<string, Window>([
      ["old", { start: 0, count: 9 }],
      ["live", { start: 50_000, count: 1 }]
    ]);
    prune(windows, PERIOD + 1, PERIOD);
    expect([...windows.keys()]).toEqual(["live"]);
  });
});
