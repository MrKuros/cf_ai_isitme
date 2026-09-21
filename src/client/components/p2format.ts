import type { Evidence, UptimeStats } from "../../shared/types";

function span(ms: number): string {
  const min = Math.round(Math.abs(ms) / 60_000);
  if (min < 120) return `${min} min`;
  const h = Math.round(min / 60);
  return h < 48 ? `${h} h` : `${Math.round(h / 24)} days`;
}

/** N10 lag ledger line, or null when there is nothing to say. */
export function lagLine(
  lag: Evidence["statusLag"],
  now = Date.now()
): string | null {
  if (!lag?.firstFailureAt) return null;
  if (lag.vendorAckAt === undefined) {
    return `Our probes first failed ${span(now - lag.firstFailureAt)} ago; the vendor hasn't acknowledged it yet`;
  }
  const d = lag.vendorAckAt - lag.firstFailureAt;
  if (Math.abs(d) < 60_000) {
    return "Vendor acknowledged it within a minute of our probes first failing";
  }
  return `Vendor acknowledged ${span(d)} ${d > 0 ? "after" : "before"} our probes first failed`;
}

/** "muted until 14:30" (date added when not today), or null once expired. */
export function muteLabel(
  mutedUntil: number | undefined,
  now = Date.now()
): string | null {
  if (!mutedUntil || mutedUntil <= now) return null;
  const at = new Date(mutedUntil);
  const time = at.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit"
  });
  return new Date(now).toDateString() === at.toDateString()
    ? `muted until ${time}`
    : `muted until ${at.toLocaleDateString([], { month: "short", day: "numeric" })} ${time}`;
}

export function uptimeLabel(s: UptimeStats | null | undefined): string | null {
  if (!s || s.uptime === null) return null;
  const pct = s.uptime * 100;
  const shown =
    pct === 100 ? "100" : pct >= 99 ? pct.toFixed(2) : pct.toFixed(1);
  return `${shown}% up · ${s.days}d${s.excluded ? ` (${s.excluded} excluded)` : ""}`;
}

/** Y of the baseline in the sparkline box, clamped so an off-scale baseline sits on the edge. */
export function baselineY(ms: number, max: number, h: number): number {
  return +Math.min(h, Math.max(0, h - (ms / Math.max(1, max)) * h)).toFixed(1);
}

/** RDAP expiry in words, or null without a parseable date. */
export function rdapExpiry(
  expiresAt: string | undefined,
  now = Date.now()
): { expired: boolean; text: string } | null {
  const t = expiresAt ? Date.parse(expiresAt) : NaN;
  if (Number.isNaN(t)) return null;
  const days = Math.round(Math.abs(t - now) / 86_400_000);
  const n = days === 1 ? "1 day" : `${days} days`;
  return t <= now
    ? {
        expired: true,
        text: days
          ? `registration expired ${n} ago`
          : "registration expired today"
      }
    : {
        expired: false,
        text: days
          ? `registration expires in ${n}`
          : "registration expires today"
      };
}

type AuthNs = NonNullable<Evidence["authNs"]>[number];

/** Nameservers row health: null when none answered (all noData). */
export function authNsOk(rows: AuthNs[]): boolean | null {
  const answered = rows.filter((r) => !r.noData);
  if (!answered.length) return null;
  return answered.every((r) => (r.rcode ?? 0) === 0 && r.addresses.length > 0);
}

export function authNsText(r: AuthNs): string {
  if (r.noData)
    return "no data (Cloudflare-hosted nameservers can't be queried from Workers)";
  if (r.rcode) return `rcode ${r.rcode}`;
  return r.addresses.length ? r.addresses.slice(0, 3).join(", ") : "no records";
}
