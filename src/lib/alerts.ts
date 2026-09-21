// Pure watch alerting (R8): confirm, hysteresis, one incident at a time.
import {
  MAX_WATCHES,
  VERDICT_CLASS,
  type Verdict,
  type Watch
} from "../shared/types";

export interface WatchDecision {
  /** Updated copy (lastVerdict, pending fields, openIncidentId). The caller sets lastCheckedAt/lastReportId. */
  watch: Watch;
  /** Create an Alert and send the webhook. */
  alert?: {
    kind: "down" | "recovered";
    from?: Verdict;
    to: Verdict;
    incidentId: string;
  };
  /** Schedule a confirm checkWatch in 60 s. */
  confirm: boolean;
  /** Same-class move while an incident is open: update that alert's `to` in place, no webhook. */
  incidentUpdate?: { incidentId: string; to: Verdict };
}

const clearPending = (w: Watch): Watch => ({
  ...w,
  pendingVerdict: undefined,
  pendingCount: undefined
});

/** One counter does both confirm-before-down and recovery hysteresis: 2 consecutive runs of the new class. */
export function decideWatch(
  watch: Watch,
  verdict: Verdict,
  newId: () => string
): WatchDecision {
  const cls = VERDICT_CLASS[verdict];
  if (!watch.lastVerdict) {
    return {
      watch: cls === "none" ? watch : { ...watch, lastVerdict: verdict },
      confirm: false
    };
  }
  if (cls === "none") return { watch: clearPending(watch), confirm: false };

  const stable = VERDICT_CLASS[watch.lastVerdict];
  if (cls === stable) {
    const incidentUpdate =
      verdict !== watch.lastVerdict && watch.openIncidentId
        ? { incidentId: watch.openIncidentId, to: verdict }
        : undefined;
    return {
      watch: { ...clearPending(watch), lastVerdict: verdict },
      confirm: false,
      incidentUpdate
    };
  }

  const same =
    watch.pendingVerdict && VERDICT_CLASS[watch.pendingVerdict] === cls;
  const pendingCount = (same ? (watch.pendingCount ?? 0) : 0) + 1;
  if (pendingCount < 2) {
    return {
      watch: { ...watch, pendingVerdict: verdict, pendingCount },
      confirm: true
    };
  }

  const from = watch.lastVerdict;
  const next: Watch = { ...clearPending(watch), lastVerdict: verdict };
  if (cls === "down") {
    const incidentId = newId();
    return {
      watch: { ...next, openIncidentId: incidentId },
      alert: { kind: "down", from, to: verdict, incidentId },
      confirm: false
    };
  }
  // A watch that started down has no open incident; the recovery gets a fresh id.
  const incidentId = watch.openIncidentId ?? newId();
  return {
    watch: { ...next, openIncidentId: undefined },
    alert: { kind: "recovered", from, to: verdict, incidentId },
    confirm: false
  };
}

/** Error text, or null when a watch for `host` may be added (re-watching a host replaces it). */
export function canAddWatch(watches: Watch[], host: string): string | null {
  return watches.length >= MAX_WATCHES && !watches.some((w) => w.host === host)
    ? `watch limit reached (${MAX_WATCHES})`
    : null;
}

export const MAX_MUTE_MINUTES = 7 * 24 * 60;

/** False while the watch is muted: state still advances, but no alert, webhook or email. */
export function shouldNotify(watch: Watch, now: number): boolean {
  return !(watch.mutedUntil && now < watch.mutedUntil);
}

/**
 * Whether this decision's alert goes out, plus the watch to persist. A down alert dropped by a mute
 * marks the incident silent, and its recovery stays silent too (no lone "back up" for an outage
 * the user never heard about).
 */
export function notifyFor(
  prev: Watch,
  d: WatchDecision,
  now: number
): { notify: boolean; watch: Watch } {
  const notify = shouldNotify(prev, now);
  if (d.alert?.kind === "down" && !notify)
    return { notify, watch: { ...d.watch, silentIncident: true } };
  if (d.alert?.kind === "recovered" && prev.silentIncident)
    return { notify: false, watch: { ...d.watch, silentIncident: undefined } };
  return { notify, watch: d.watch };
}

/** A watch whose device hasn't connected in this long is removed at its next run. */
export const WATCH_IDLE_MS = 7 * 24 * 60 * 60_000;

/** New mutedUntil for `minutes` from now; 0 clears it. Capped at 7 days. */
export function muteUntil(minutes: number, now: number): number | undefined {
  const m = Math.min(Math.max(0, Math.floor(minutes)), MAX_MUTE_MINUTES);
  return m ? now + m * 60_000 : undefined;
}

/** Minimal text/plain RFC 5322 message. Header values are stripped of CR/LF (header injection). */
export function alertEmailRaw(
  from: string,
  to: string,
  subject: string,
  body: string,
  now = new Date()
): string {
  const h = (s: string) => s.replace(/[\r\n]+/g, " ");
  return [
    `From: IsItMe <${h(from)}>`,
    `To: <${h(to)}>`,
    `Subject: ${h(subject)}`,
    `Date: ${now.toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@${h(from.split("@")[1] ?? "isitme")}>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    body.replace(/\r?\n/g, "\r\n")
  ].join("\r\n");
}
