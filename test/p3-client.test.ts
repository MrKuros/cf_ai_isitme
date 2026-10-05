import { describe, expect, it } from "vitest";
import type { Verdict } from "../src/shared/types";
import {
  duplicateErrorIds,
  failWindows,
  globalpingLabel
} from "../src/client/format";

const MIN = 60_000;
const s = (
  at: number,
  ok: boolean,
  verdict: Verdict = ok ? "HEALTHY" : "DOWN_GLOBAL"
) => ({ at: at * MIN, ok, verdict });

describe("failWindows", () => {
  it("groups consecutive failures, newest first", () => {
    const w = failWindows([
      s(1, true),
      s(2, false),
      s(3, false),
      s(4, true),
      s(5, false)
    ]);
    expect(w).toEqual([
      { from: 5 * MIN, to: 5 * MIN, count: 1, verdict: "DOWN_GLOBAL" },
      { from: 2 * MIN, to: 3 * MIN, count: 2, verdict: "DOWN_GLOBAL" }
    ]);
  });
  it("sorts first and keeps the first failing verdict of a run", () => {
    expect(
      failWindows([s(3, false, "DOWN_REGIONAL"), s(2, false, "DNS_FAILURE")])
    ).toEqual([
      { from: 2 * MIN, to: 3 * MIN, count: 2, verdict: "DNS_FAILURE" }
    ]);
  });
  it("is empty without failures", () => {
    expect(failWindows([])).toEqual([]);
    expect(failWindows([s(1, true), s(2, true)])).toEqual([]);
  });
});

describe("globalpingLabel", () => {
  it("uses whatever the probe reported", () => {
    expect(
      globalpingLabel({
        city: "Frankfurt",
        country: "DE",
        asn: 3320,
        network: "Deutsche Telekom"
      })
    ).toBe("Frankfurt, DE · Deutsche Telekom");
    expect(globalpingLabel({ continent: "AS", asn: 4134 })).toBe("AS · AS4134");
    expect(globalpingLabel({})).toBe("unknown location");
  });
});

describe("duplicateErrorIds", () => {
  const err = (toolCallId: string, errorText: string, type = "tool-diagnose") =>
    ({ type, toolCallId, errorText, state: "output-error" }) as const;

  it("keeps the first of each repeated failure", () => {
    const dupes = duplicateErrorIds([
      err("1", "boom"),
      err("2", "boom"),
      err("3", "boom"),
      err("4", "other"),
      err("5", "boom", "tool-watch")
    ]);
    expect([...dupes]).toEqual(["2", "3"]);
  });
  it("ignores parts that did not error", () => {
    expect(
      duplicateErrorIds([
        { type: "tool-watch", toolCallId: "a", state: "output-available" },
        { type: "tool-watch", toolCallId: "b", state: "output-available" },
        { type: "text" }
      ]).size
    ).toBe(0);
  });
});
