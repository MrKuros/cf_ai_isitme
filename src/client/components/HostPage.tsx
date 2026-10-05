import { useEffect, useState } from "react";
import {
  ArrowRightIcon,
  CircleNotchIcon,
  TagIcon,
  WarningIcon
} from "@phosphor-icons/react";
import type { HostHistory, Report } from "../../shared/types";
import { isPublicHostParam } from "../../lib/guard";
import { failWindows } from "../format";
import Sparkline from "./Sparkline";
import {
  CopyButton,
  CrowdSummary,
  PageShell,
  SectionLabel,
  VERDICTS,
  VerdictBadge,
  VerdictDot,
  headlineOf,
  relTime,
  toneOf,
  useNow
} from "./ui";

function stamp(at: number): string {
  return new Date(at).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

/**
 * /h/:host — public per-host page. Read-only over GET /api/host/:host plus one
 * best-effort GET /api/report/:host/:id for the crowd heatmap; it never starts a
 * check (R19), so it is safe to link from a badge.
 */
export default function HostPage({ host }: { host: string }) {
  const [history, setHistory] = useState<HostHistory | null | undefined>();
  const [report, setReport] = useState<Report | null>(null);
  const now = useNow(true, 30_000);
  const publicHost = isPublicHostParam(host);

  useEffect(() => {
    document.title = `${host} · IsItMe`;
    if (!publicHost) return;
    let alive = true;
    fetch(`/api/host/${encodeURIComponent(host)}`)
      .then((res) => (res.ok ? (res.json() as Promise<HostHistory>) : null))
      .catch(() => null)
      .then((h) => alive && setHistory(h));
    return () => {
      alive = false;
    };
  }, [host, publicHost]);

  // The crowd heatmap lives on the latest report, not in HostHistory. Best effort.
  const reportId = history?.latest?.reportId;
  useEffect(() => {
    if (!reportId) return;
    let alive = true;
    fetch(
      `/api/report/${encodeURIComponent(host)}/${encodeURIComponent(reportId)}`
    )
      .then((res) => (res.ok ? (res.json() as Promise<Report>) : null))
      .catch(() => null)
      .then((r) => alive && setReport(r));
    return () => {
      alive = false;
    };
  }, [host, reportId]);

  const checkNow = (
    <a
      href={`/?q=${encodeURIComponent(host)}`}
      className="inline-flex items-center gap-1.5 rounded-lg bg-kumo-contrast px-3 py-1.5 text-sm font-medium text-kumo-inverse hover:opacity-90"
    >
      Check it now <ArrowRightIcon size={14} />
    </a>
  );

  if (!publicHost) {
    return (
      <PageShell>
        <div className="rounded-2xl border border-kumo-line bg-kumo-base p-6">
          <p className="font-medium text-kumo-default">
            <span className="font-mono break-all">{host}</span> is not a public
            site, so there is nothing to show here.
          </p>
        </div>
      </PageShell>
    );
  }
  if (history === undefined) {
    return (
      <PageShell>
        <div className="flex items-center gap-2 py-16 text-sm text-kumo-subtle">
          <CircleNotchIcon size={16} className="animate-spin" /> Loading {host}…
        </div>
      </PageShell>
    );
  }
  if (history === null) {
    return (
      <PageShell>
        <div className="flex items-start gap-3 rounded-2xl border border-kumo-line bg-kumo-base p-6">
          <WarningIcon size={20} className="mt-0.5 text-kumo-warning" />
          <div>
            <p className="font-medium text-kumo-default">
              Couldn't load the history for {host}.
            </p>
            <p className="mt-1 text-sm text-kumo-subtle">
              Try again in a minute, or run a fresh check.
            </p>
            <div className="mt-3">{checkNow}</div>
          </div>
        </div>
      </PageShell>
    );
  }

  const latest = history.latest;
  const windows = failWindows(history.samples);

  return (
    <PageShell>
      <article
        className={`${toneOf(latest?.verdict)} card-accent overflow-hidden rounded-2xl border border-kumo-line bg-kumo-base shadow-sm`}
      >
        <div className="space-y-5 p-5 sm:p-7">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h1 className="font-mono text-lg font-semibold break-all text-kumo-default">
              {host}
            </h1>
            {latest && <VerdictBadge verdict={latest.verdict} />}
          </div>
          {latest ? (
            <>
              <p className="tone-text text-3xl leading-tight font-semibold tracking-tight">
                {headlineOf(latest.verdict, false)}
              </p>
              <p className="text-sm text-kumo-subtle">
                Last checked {relTime(latest.at, now)} ·{" "}
                <a
                  href={`/r/${encodeURIComponent(host)}/${encodeURIComponent(latest.reportId)}`}
                  className="text-kumo-link"
                >
                  full report
                </a>
              </p>
            </>
          ) : (
            <p className="text-[15px] text-kumo-default">
              Nobody has checked {host} in the last 24 hours.
            </p>
          )}

          <Sparkline host={host} />

          <div className="flex flex-wrap gap-2">
            {checkNow}
            <CopyButton
              icon={TagIcon}
              label="Status badge"
              text={`![isitme](${location.origin}/badge/${host}.svg)`}
            />
          </div>
        </div>
      </article>

      <section className="space-y-3 rounded-2xl border border-kumo-line bg-kumo-base p-5 sm:px-7">
        <SectionLabel>Failing windows · last 24h</SectionLabel>
        {windows.length === 0 ? (
          <p className="text-sm text-kumo-subtle">
            {history.samples.length
              ? `No failing checks in the last ${history.samples.length} check${history.samples.length === 1 ? "" : "s"}.`
              : "No checks recorded in the last 24 hours."}
          </p>
        ) : (
          <ul className="divide-y divide-kumo-line">
            {windows.map((w) => (
              <li
                key={w.from}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm"
              >
                {/* the label below already names the verdict */}
                <span aria-hidden="true" className="flex">
                  <VerdictDot verdict={w.verdict} />
                </span>
                <span className="font-mono text-[13px] text-kumo-default">
                  {stamp(w.from)}
                  {w.to !== w.from && ` → ${stamp(w.to)}`}
                </span>
                <span className="text-kumo-default">
                  {VERDICTS[w.verdict].label}
                </span>
                <span className="ml-auto text-xs text-kumo-subtle">
                  {w.count} failing check{w.count === 1 ? "" : "s"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {report?.evidence.crowd?.total ? (
        <section className="space-y-3 rounded-2xl border border-kumo-line bg-kumo-base p-5 sm:px-7">
          <SectionLabel>Crowd · at the last check</SectionLabel>
          <div className="text-sm text-kumo-default">
            <CrowdSummary crowd={report.evidence.crowd} />
          </div>
        </section>
      ) : null}
    </PageShell>
  );
}
