import { useEffect, useState, type ReactNode } from "react";
import {
  BellIcon,
  ClockCounterClockwiseIcon,
  DownloadSimpleIcon,
  EyeIcon,
  GlobeHemisphereWestIcon,
  XIcon
} from "@phosphor-icons/react";
import type { AgentState, UptimeStats, Watch } from "../../shared/types";
import { muteLabel, uptimeLabel } from "./p2format";
import {
  SectionLabel,
  VERDICTS,
  VerdictDot,
  relTime,
  toneOf,
  useNow
} from "./ui";

function Section({
  icon,
  title,
  extra,
  children
}: {
  icon: ReactNode;
  title: string;
  extra?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-kumo-subtle">{icon}</span>
        <SectionLabel>{title}</SectionLabel>
        <span className="ml-auto">{extra}</span>
      </div>
      {children}
    </section>
  );
}

const MUTE_OPTIONS = [
  { value: "60", label: "Mute 1h" },
  { value: "480", label: "Mute 8h" },
  { value: "1440", label: "Mute 24h" }
];

function MuteMenu({
  w,
  muted,
  onMute
}: {
  w: Watch;
  muted: boolean;
  onMute: (watchId: string, minutes: number | null) => void;
}) {
  return (
    <select
      value=""
      aria-label={`Mute alerts for ${w.host}`}
      title="Mute alerts"
      onChange={(e) => {
        const v = e.target.value;
        if (v) onMute(w.id, v === "off" ? null : Number(v));
      }}
      className="max-w-16 rounded-md bg-transparent py-0.5 text-xs text-kumo-subtle opacity-60 hover:bg-kumo-tint group-hover:opacity-100 focus-visible:opacity-100"
    >
      <option value="">{muted ? "Muted" : "Mute"}</option>
      {MUTE_OPTIONS.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
      {muted && <option value="off">Unmute</option>}
    </select>
  );
}

/** 7-day uptime; refetched after each check. Hidden when unavailable. */
function Uptime({
  watchId,
  checkedAt,
  getUptime
}: {
  watchId: string;
  checkedAt?: number;
  getUptime: (watchId: string) => Promise<UptimeStats | null>;
}) {
  const [stats, setStats] = useState<UptimeStats | null>(null);
  useEffect(() => {
    let alive = true;
    getUptime(watchId)
      .catch(() => null)
      .then((s) => alive && setStats(s));
    return () => {
      alive = false;
    };
  }, [watchId, checkedAt, getUptime]);
  const label = uptimeLabel(stats);
  return label ? (
    <div
      className="text-xs text-kumo-subtle"
      title="Runs caused by our own vantage problems are excluded"
    >
      {label}
    </div>
  ) : null;
}

function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="text-xs leading-relaxed text-kumo-inactive">{children}</p>
  );
}

export default function Sidebar({
  state,
  onUnwatch,
  onMarkAlertsRead,
  onExport,
  onMute,
  getUptime
}: {
  state: AgentState | undefined;
  onUnwatch: (watchId: string) => void;
  onMute: (watchId: string, minutes: number | null) => void;
  getUptime: (watchId: string) => Promise<UptimeStats | null>;
  onMarkAlertsRead: () => void;
  onExport: () => void;
}) {
  const now = useNow(true, 30_000);
  const user = state?.user;
  const unread = state?.alerts.filter((a) => !a.read).length ?? 0;

  return (
    <aside className="space-y-7 p-5">
      <Section
        icon={<GlobeHemisphereWestIcon size={14} />}
        title="Your network"
      >
        {user ? (
          <dl className="grid grid-cols-[4.5rem_1fr] gap-x-3 gap-y-1.5 text-sm">
            <dt className="text-kumo-subtle">ISP</dt>
            <dd
              className="min-w-0 truncate text-kumo-default"
              title={user.asOrganization}
            >
              {user.asOrganization ?? "Unknown"}
            </dd>
            <dt className="text-kumo-subtle">ASN</dt>
            <dd className="font-mono text-[13px] text-kumo-default">
              {user.asn ? `AS${user.asn}` : "—"}
            </dd>
            <dt className="text-kumo-subtle">Location</dt>
            <dd className="min-w-0 truncate text-kumo-default">
              {[user.city, user.country].filter(Boolean).join(", ") || "—"}
            </dd>
            <dt className="text-kumo-subtle">Edge</dt>
            <dd className="font-mono text-[13px] text-kumo-default">
              {user.colo ?? "—"}
            </dd>
          </dl>
        ) : (
          <Empty>
            Connecting… (local dev has no network info; it fills in once
            deployed.)
          </Empty>
        )}
      </Section>

      <Section
        icon={<BellIcon size={14} />}
        title="Alerts"
        extra={
          unread > 0 && (
            <button
              type="button"
              onClick={onMarkAlertsRead}
              className="rounded-md px-1.5 py-0.5 text-xs text-kumo-link hover:bg-kumo-tint"
            >
              Mark {unread} read
            </button>
          )
        }
      >
        {state?.alerts.length ? (
          <ul className="space-y-1">
            {state.alerts.slice(0, 8).map((a) => (
              <li key={a.id}>
                <a
                  href={`/r/${a.host}/${a.reportId}`}
                  className={`block rounded-lg px-2.5 py-2 hover:bg-kumo-tint ${
                    a.read ? "" : "bg-kumo-warning-tint"
                  }`}
                >
                  <div className="flex items-center gap-2 text-sm">
                    <span
                      className={`${a.kind === "recovered" ? "tone-good" : a.kind === "down" ? "tone-bad" : toneOf(a.to)} tone-dot inline-block size-2 shrink-0 rounded-full`}
                    />
                    <span className="truncate font-mono text-[13px] text-kumo-default">
                      {a.host}
                    </span>
                    <span className="ml-auto shrink-0 text-[11px] text-kumo-subtle">
                      {relTime(a.at, now)}
                    </span>
                  </div>
                  <div className="mt-0.5 truncate pl-4 text-xs text-kumo-subtle">
                    {a.kind && (
                      <span
                        className={`${a.kind === "recovered" ? "tone-good" : "tone-bad"} tone-text font-medium`}
                      >
                        {a.kind === "recovered" ? "back up" : "down"} ·{" "}
                      </span>
                    )}
                    {a.from ? `${VERDICTS[a.from].label} → ` : ""}
                    {VERDICTS[a.to].label}
                    {a.webhook === "failed" && " · webhook failed"}
                  </div>
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>
            You'll get an alert here when a watched site changes state.
          </Empty>
        )}
      </Section>

      <Section icon={<EyeIcon size={14} />} title="Watches">
        {state?.watches.length ? (
          <ul className="space-y-1">
            {state.watches.map((w) => {
              const muted = muteLabel(w.mutedUntil, now);
              return (
                <li
                  key={w.id}
                  className="group flex items-center gap-2 rounded-lg px-2.5 py-2 hover:bg-kumo-tint"
                >
                  <VerdictDot verdict={w.lastVerdict} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate font-mono text-[13px] text-kumo-default">
                        {w.host}
                      </span>
                      {w.openIncidentId && (
                        <span className="tone-bad tone-soft tone-text shrink-0 rounded px-1 text-[10px] font-medium">
                          incident open
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-kumo-subtle">
                      every {w.intervalMinutes}m ·{" "}
                      {relTime(w.lastCheckedAt, now)}
                      {w.webhookUrl ? " · webhook" : ""}
                      {w.until === "recovered" ? " · until recovered" : ""}
                    </div>
                    {w.expect && (
                      <div
                        className="truncate text-xs text-kumo-subtle"
                        title={w.expect}
                      >
                        expects "{w.expect}"
                      </div>
                    )}
                    <Uptime
                      watchId={w.id}
                      checkedAt={w.lastCheckedAt}
                      getUptime={getUptime}
                    />
                    {muted && (
                      <div className="truncate text-xs text-kumo-warning">
                        {muted}
                      </div>
                    )}
                    {w.pendingVerdict && (
                      <div className="truncate text-xs text-kumo-warning">
                        confirming {VERDICTS[w.pendingVerdict].label}…
                      </div>
                    )}
                  </div>
                  <MuteMenu w={w} muted={!!muted} onMute={onMute} />
                  <button
                    type="button"
                    onClick={() => onUnwatch(w.id)}
                    aria-label={`Stop watching ${w.host}`}
                    title="Stop watching"
                    className="rounded-md p-1 text-kumo-subtle opacity-60 hover:bg-kumo-danger-tint hover:text-kumo-danger group-hover:opacity-100 focus-visible:opacity-100"
                  >
                    <XIcon size={14} />
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <Empty>Try "watch example.com every 5 minutes".</Empty>
        )}
      </Section>

      <Section
        icon={<ClockCounterClockwiseIcon size={14} />}
        title="Recent reports"
      >
        {state?.history.length ? (
          <ul className="space-y-0.5">
            {state.history.slice(0, 12).map((h) => (
              <li key={h.id}>
                <a
                  href={`/r/${h.host}/${h.id}`}
                  className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm hover:bg-kumo-tint"
                  title={`${VERDICTS[h.verdict].label} · ${Math.round(h.confidence * 100)}%`}
                >
                  <VerdictDot verdict={h.verdict} />
                  <span className="truncate font-mono text-[13px] text-kumo-default">
                    {h.host}
                  </span>
                  <span className="ml-auto shrink-0 text-[11px] text-kumo-subtle">
                    {relTime(h.createdAt, now)}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>Every check becomes a shareable report.</Empty>
        )}
      </Section>

      <button
        type="button"
        onClick={onExport}
        className="inline-flex items-center gap-1.5 rounded-lg border border-kumo-line px-3 py-1.5 text-xs text-kumo-subtle hover:bg-kumo-tint hover:text-kumo-default"
      >
        <DownloadSimpleIcon size={14} /> Export my data
      </button>
    </aside>
  );
}
