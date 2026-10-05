import { useEffect, useState } from "react";
import {
  ArrowRightIcon,
  CircleNotchIcon,
  ClockIcon,
  LinkIcon,
  PaperPlaneTiltIcon,
  WarningIcon
} from "@phosphor-icons/react";
import { REPORT_TTL_DAYS, type Report } from "../../shared/types";
import Sparkline from "./Sparkline";
import { lagLine } from "./p2format";
import {
  ClassificationExtras,
  CopyButton,
  EvidenceGrid,
  ExtraChecks,
  Markdown,
  PageShell,
  ReportTools,
  SelfSuspectBanner,
  SectionLabel,
  TRIGGER_LABEL,
  VERDICTS,
  VerdictBadge,
  VisitorTable,
  headlineOf,
  netLabel,
  toneOf
} from "./ui";

type Load =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ok"; report: Report };

/** Public read-only report: GET /api/report/:host/:id. */
export default function ReportPage({ host, id }: { host: string; id: string }) {
  const [load, setLoad] = useState<Load>({ kind: "loading" });

  useEffect(() => {
    let alive = true;
    fetch(`/api/report/${encodeURIComponent(host)}/${encodeURIComponent(id)}`)
      .then(async (res) => {
        if (res.ok)
          return { kind: "ok", report: (await res.json()) as Report } as const;
        const message =
          res.status === 410
            ? `This report expired (reports are kept ${REPORT_TTL_DAYS} days).`
            : res.status === 404
              ? "This report doesn't exist."
              : res.status === 429
                ? "Too many requests. Try again in a minute."
                : `Couldn't load the report (HTTP ${res.status}).`;
        return { kind: "error", message } as const;
      })
      .catch(
        () =>
          ({
            kind: "error",
            message: "Network error loading the report."
          }) as const
      )
      .then((l) => alive && setLoad(l));
    return () => {
      alive = false;
    };
  }, [host, id]);

  useEffect(() => {
    if (load.kind === "ok") {
      document.title = `${host}: ${VERDICTS[load.report.classification.verdict].label} · IsItMe`;
    }
  }, [load, host]);

  if (load.kind === "loading") {
    return (
      <PageShell>
        <div className="flex items-center gap-2 py-16 text-sm text-kumo-subtle">
          <CircleNotchIcon size={16} className="animate-spin" /> Loading report…
        </div>
      </PageShell>
    );
  }
  if (load.kind === "error") {
    return (
      <PageShell>
        <div className="flex items-start gap-3 rounded-2xl border border-kumo-line bg-kumo-base p-6">
          <WarningIcon size={20} className="mt-0.5 text-kumo-warning" />
          <div>
            <p className="font-medium text-kumo-default">{load.message}</p>
            <a
              href={`/?q=${encodeURIComponent(host)}`}
              className="mt-2 inline-block text-sm text-kumo-link"
            >
              Run a fresh check on {host} →
            </a>
          </div>
        </div>
      </PageShell>
    );
  }

  const r = load.report;
  const { verdict, subtype, confidence, signals } = r.classification;
  const created = new Date(r.createdAt);
  const lag = lagLine(r.evidence.statusLag, r.createdAt);

  return (
    <PageShell>
      <article
        className={`${toneOf(verdict)} card-accent overflow-hidden rounded-2xl border border-kumo-line bg-kumo-base shadow-sm`}
      >
        <div className="space-y-5 p-5 sm:p-7">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h1 className="font-mono text-lg font-semibold text-kumo-default break-all">
              {r.host}
            </h1>
            <VerdictBadge
              verdict={verdict}
              subtype={subtype}
              confidence={confidence}
            />
            <a
              href={`/h/${encodeURIComponent(r.host)}`}
              className="text-sm text-kumo-link"
            >
              24h history
            </a>
          </div>
          <SelfSuspectBanner reasons={r.classification.selfSuspect} />
          <p className="tone-text text-3xl leading-tight font-semibold tracking-tight">
            {headlineOf(verdict, !!r.evidence.browser?.reachable)}
          </p>
          <p className="text-sm text-kumo-subtle">
            Checked{" "}
            <time dateTime={created.toISOString()}>
              {created.toLocaleString()}
            </time>{" "}
            via {TRIGGER_LABEL[r.trigger]} · requester on{" "}
            {netLabel(r.evidence.user)}
          </p>

          {signals.length > 0 && (
            <ul
              className={
                verdict === "INCONCLUSIVE"
                  ? "space-y-1.5 rounded-xl bg-kumo-elevated px-4 py-3"
                  : "space-y-1.5"
              }
            >
              {verdict === "INCONCLUSIVE" && (
                <li className="text-xs text-kumo-subtle">
                  What we saw, so you can judge:
                </li>
              )}
              {signals.map((s, i) => (
                <li
                  key={i}
                  className="flex gap-2.5 text-[15px] text-kumo-default"
                >
                  <span className="tone-dot mt-2 size-1.5 shrink-0 rounded-full" />
                  {s}
                </li>
              ))}
            </ul>
          )}

          <ClassificationExtras c={r.classification} />

          {lag && (
            <p className="flex items-center gap-2 text-sm text-kumo-subtle">
              <ClockIcon size={14} className="shrink-0" />
              {lag}
            </p>
          )}

          <Sparkline host={r.host} baseline={r.evidence.baseline} />

          {r.explanation && (
            <div className="rounded-xl bg-kumo-elevated px-4 py-3 text-[15px] leading-relaxed">
              <Markdown>{r.explanation}</Markdown>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <CopyButton
              primary
              icon={LinkIcon}
              label="Copy link"
              text={location.href}
            />
            <CopyButton
              icon={PaperPlaneTiltIcon}
              label="Copy check link"
              text={`${location.origin}/c/${r.host}?ref=${r.id}`}
            />
            <ReportTools report={r} />
          </div>
        </div>
      </article>

      <section className="rounded-2xl border border-kumo-line bg-kumo-base p-5 sm:px-7">
        <SectionLabel>Evidence</SectionLabel>
        <div className="mt-2">
          <EvidenceGrid evidence={r.evidence} verdict={verdict} />
        </div>
      </section>

      {r.extraChecks.length > 0 && (
        <section className="rounded-2xl border border-kumo-line bg-kumo-base p-5 sm:px-7">
          <div className="space-y-5">
            <VisitorTable checks={r.extraChecks} />
            <ExtraChecks checks={r.extraChecks} />
          </div>
        </section>
      )}

      <a
        href={`/c/${r.host}?ref=${r.id}`}
        className="group flex items-center justify-between gap-4 rounded-2xl border border-dashed border-kumo-line bg-kumo-base p-5 hover:border-kumo-brand"
      >
        <div>
          <p className="font-medium text-kumo-default">
            Can you reach {r.host}?
          </p>
          <p className="text-sm text-kumo-subtle">
            Run the check from your own network and add your result to this
            report.
          </p>
        </div>
        <ArrowRightIcon
          size={18}
          className="shrink-0 text-kumo-subtle transition-transform group-hover:translate-x-0.5"
        />
      </a>
    </PageShell>
  );
}
