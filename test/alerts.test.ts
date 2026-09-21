import { describe, expect, it } from "vitest";
import {
  alertEmailRaw,
  canAddWatch,
  decideWatch,
  MAX_MUTE_MINUTES,
  muteUntil,
  notifyFor,
  shouldNotify,
  type WatchDecision
} from "../src/lib/alerts";
import type { Verdict, Watch } from "../src/shared/types";

const base = (over: Partial<Watch> = {}): Watch => ({
  id: "w1",
  host: "example.com",
  url: "https://example.com/",
  intervalMinutes: 5,
  scheduleId: "s1",
  createdAt: 0,
  ...over
});

/** Feeds verdicts in order; returns every decision. */
function run(start: Watch, verdicts: Verdict[]): WatchDecision[] {
  let w = start;
  let n = 0;
  return verdicts.map((v) => {
    const d = decideWatch(w, v, () => `inc-${++n}`);
    w = d.watch;
    return d;
  });
}
const alerts = (ds: WatchDecision[]) =>
  ds.flatMap((d) => (d.alert ? [d.alert] : []));

describe("decideWatch (R8)", () => {
  it("first run sets the baseline, no alert", () => {
    const [d] = run(base(), ["DOWN_GLOBAL"]);
    expect(d.watch.lastVerdict).toBe("DOWN_GLOBAL");
    expect(d.alert).toBeUndefined();
    expect(run(base(), ["INCONCLUSIVE"])[0].watch.lastVerdict).toBeUndefined();
  });

  it("a) HEALTHY -> DOWN -> HEALTHY on the confirm run: 0 alerts", () => {
    const ds = run(base({ lastVerdict: "HEALTHY" }), [
      "DOWN_GLOBAL",
      "HEALTHY"
    ]);
    expect(ds[0].confirm).toBe(true);
    expect(alerts(ds)).toEqual([]);
    expect(ds[1].watch.pendingCount).toBeUndefined();
    expect(ds[1].watch.lastVerdict).toBe("HEALTHY");
  });

  it("b) HEALTHY -> DOWN -> DOWN: 1 down alert opening an incident", () => {
    const ds = run(base({ lastVerdict: "HEALTHY" }), [
      "DOWN_GLOBAL",
      "DOWN_GLOBAL"
    ]);
    expect(alerts(ds)).toEqual([
      { kind: "down", from: "HEALTHY", to: "DOWN_GLOBAL", incidentId: "inc-1" }
    ]);
    expect(ds[1].watch.openIncidentId).toBe("inc-1");
    expect(ds[1].watch.lastVerdict).toBe("DOWN_GLOBAL");
    expect(ds[1].confirm).toBe(false);
  });

  it("any two consecutive down verdicts confirm, even of different kinds", () => {
    const ds = run(base({ lastVerdict: "HEALTHY" }), [
      "DNS_FAILURE",
      "DOWN_GLOBAL"
    ]);
    expect(alerts(ds)).toHaveLength(1);
  });

  it("c) DOWN -> HEALTHY -> DOWN: no recovery alert", () => {
    const ds = run(
      base({ lastVerdict: "DOWN_GLOBAL", openIncidentId: "old" }),
      ["HEALTHY", "DOWN_GLOBAL"]
    );
    expect(alerts(ds)).toEqual([]);
    expect(ds[1].watch.openIncidentId).toBe("old");
  });

  it("recovery needs 2 consecutive up runs and closes the incident", () => {
    const ds = run(
      base({ lastVerdict: "DOWN_GLOBAL", openIncidentId: "old" }),
      ["HEALTHY", "SLOW"]
    );
    expect(ds[0].confirm).toBe(true);
    expect(alerts(ds)).toEqual([
      { kind: "recovered", from: "DOWN_GLOBAL", to: "SLOW", incidentId: "old" }
    ]);
    expect(ds[1].watch.openIncidentId).toBeUndefined();
  });

  it("d) open DOWN_REGIONAL -> DOWN_GLOBAL: incident update, no new alert", () => {
    const [d] = run(
      base({ lastVerdict: "DOWN_REGIONAL", openIncidentId: "inc-x" }),
      ["DOWN_GLOBAL"]
    );
    expect(d.alert).toBeUndefined();
    expect(d.incidentUpdate).toEqual({
      incidentId: "inc-x",
      to: "DOWN_GLOBAL"
    });
    expect(d.watch.lastVerdict).toBe("DOWN_GLOBAL");
  });

  it("e) HEALTHY -> INCONCLUSIVE: 0 alerts, clears pending, keeps baseline", () => {
    const ds = run(base({ lastVerdict: "HEALTHY" }), [
      "DOWN_GLOBAL",
      "INCONCLUSIVE",
      "DOWN_GLOBAL"
    ]);
    expect(alerts(ds)).toEqual([]);
    expect(ds[1].watch.lastVerdict).toBe("HEALTHY");
    expect(ds[1].watch.pendingCount).toBeUndefined();
    expect(ds[2].confirm).toBe(true);
    expect(
      alerts(
        run(base({ lastVerdict: "HEALTHY" }), [
          "INCONCLUSIVE",
          "LIKELY_YOUR_NETWORK"
        ])
      )
    ).toEqual([]);
  });
});

describe("canAddWatch (R19)", () => {
  const ten = Array.from({ length: 10 }, (_, i) =>
    base({ id: `w${i}`, host: `site${i}.com` })
  );
  it("b) the 11th watch is refused", () => {
    expect(canAddWatch(ten, "new.com")).toBe("watch limit reached (10)");
  });
  it("replacing an existing host is allowed at the limit", () => {
    expect(canAddWatch(ten, "site3.com")).toBeNull();
  });
  it("under the limit is fine", () => {
    expect(canAddWatch(ten.slice(0, 9), "new.com")).toBeNull();
  });
});

describe("mute windows", () => {
  it("suppresses notification while now < mutedUntil, not after", () => {
    expect(shouldNotify(base(), 1000)).toBe(true);
    expect(shouldNotify(base({ mutedUntil: 2000 }), 1000)).toBe(false);
    expect(shouldNotify(base({ mutedUntil: 2000 }), 2000)).toBe(true);
  });

  it("muted watch still advances state but its alert must not be sent", () => {
    const muted = base({ lastVerdict: "HEALTHY", mutedUntil: 10_000 });
    const [first, second] = run(muted, ["DOWN_GLOBAL", "DOWN_GLOBAL"]);
    expect(first.confirm).toBe(true);
    expect(second.alert?.kind).toBe("down");
    expect(second.watch.lastVerdict).toBe("DOWN_GLOBAL");
    expect(shouldNotify(second.watch, 5000)).toBe(false);
  });

  it("a down alert dropped by a mute keeps its recovery silent after the mute ends", () => {
    let w = base({ lastVerdict: "HEALTHY", mutedUntil: 1000 });
    let n = 0;
    const step = (v: Verdict, now: number) => {
      const d = decideWatch(w, v, () => `inc-${++n}`);
      const m = notifyFor(w, d, now);
      w = m.watch;
      return { alert: d.alert, notify: m.notify };
    };
    step("DOWN_GLOBAL", 10);
    expect(step("DOWN_GLOBAL", 20)).toMatchObject({
      alert: { kind: "down" },
      notify: false
    });
    expect(w.silentIncident).toBe(true);
    step("HEALTHY", 2000);
    expect(step("HEALTHY", 2100)).toMatchObject({
      alert: { kind: "recovered" },
      notify: false
    });
    expect(w.silentIncident).toBeUndefined();
    // The next incident, unmuted, notifies normally.
    step("DOWN_GLOBAL", 3000);
    expect(step("DOWN_GLOBAL", 3100).notify).toBe(true);
  });

  it("a watch that started down still gets its recovery alert", () => {
    const w = base({
      lastVerdict: "DOWN_GLOBAL",
      pendingVerdict: "HEALTHY",
      pendingCount: 1
    });
    const d = decideWatch(w, "HEALTHY", () => "x");
    expect(notifyFor(w, d, 0)).toMatchObject({ notify: true });
  });

  it("muteUntil: 0 clears, caps at 7 days", () => {
    expect(muteUntil(0, 1000)).toBeUndefined();
    expect(muteUntil(30, 0)).toBe(30 * 60_000);
    expect(muteUntil(1e9, 0)).toBe(MAX_MUTE_MINUTES * 60_000);
    expect(muteUntil(-5, 0)).toBeUndefined();
  });
});

describe("alert email", () => {
  it("is text/plain and strips CR/LF from headers", () => {
    const raw = alertEmailRaw(
      "alerts@x.dev",
      "me@y.dev",
      "down\r\nBcc: evil@z.dev",
      "line1\nline2"
    );
    const [head, body] = raw.split("\r\n\r\n");
    expect(head).toContain("Content-Type: text/plain; charset=utf-8");
    expect(head).not.toMatch(/^Bcc:/m);
    expect(head).toContain("Subject: down Bcc: evil@z.dev");
    expect(body).toBe("line1\r\nline2");
  });
});
