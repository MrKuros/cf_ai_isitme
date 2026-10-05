import { useEffect, useState } from "react";
import {
  CaretDownIcon,
  CheckIcon,
  CircleIcon,
  CircleNotchIcon,
  LinkIcon,
  MinusIcon,
  PaperPlaneTiltIcon,
  WarningIcon,
  XIcon
} from "@phosphor-icons/react";
import {
  STEP_ORDER,
  type BrowserProbe,
  type CheckOutcome,
  type ExtraCheck,
  type Report,
  type RunState,
  type StepName,
  type StepState
} from "../../shared/types";
import Sparkline from "./Sparkline";
import {
  ClassificationExtras,
  CopyButton,
  EvidenceGrid,
  ExtraChecks,
  Markdown,
  ReportTools,
  SelfSuspectBanner,
  VerdictBadge,
  headlineOf,
  browserLine,
  toneOf,
  useNow
} from "./ui";

const STEP_LABEL: Record<StepName, string> = {
  dns: "DNS lookup",
  edge: "Cloudflare edge",
  regions: "5 regions",
  globalping: "Outside probes",
  radar: "Cloudflare Radar",
  provider: "Hosting provider",
  status: "Status page",
  browser: "Your browser",
  crowd: "Crowd reports",
  classify: "Verdict",
  explain: "Explanation"
};

function StepIcon({ status }: { status: StepState["status"] }) {
  return (
    <>
      <StepGlyph status={status} />
      <span className="sr-only">{status}</span>
    </>
  );
}

function StepGlyph({ status }: { status: StepState["status"] }) {
  switch (status) {
    case "running":
      return (
        <CircleNotchIcon size={14} className="animate-spin text-kumo-brand" />
      );
    case "done":
      return (
        <CheckIcon size={14} weight="bold" className="text-kumo-success" />
      );
    case "error":
      return <XIcon size={14} weight="bold" className="text-kumo-danger" />;
    case "skipped":
      return <MinusIcon size={14} className="text-kumo-inactive" />;
    default:
      return <CircleIcon size={14} className="text-kumo-inactive" />;
  }
}

function Steps({ run }: { run: RunState }) {
  return (
    <ol className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
      {STEP_ORDER.map((name) => {
        const s = run.steps[name];
        if (!s) return null;
        const ms =
          s.startedAt && s.finishedAt ? s.finishedAt - s.startedAt : undefined;
        return (
          <li
            key={name}
            className={`flex min-w-0 items-start gap-2 py-1 text-sm ${
              s.status === "pending" || s.status === "skipped"
                ? "text-kumo-inactive"
                : "text-kumo-default"
            }`}
          >
            <span className="mt-0.5 shrink-0">
              <StepIcon status={s.status} />
            </span>
            <span className="min-w-0">
              <span className="font-medium">{STEP_LABEL[name]}</span>
              {ms !== undefined && s.status !== "skipped" && (
                <span className="ml-1.5 font-mono text-[11px] text-kumo-subtle">
                  {ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`}
                </span>
              )}
              {(s.summary || s.error) && (
                <span
                  className={
                    s.error
                      ? "block text-xs break-words text-kumo-danger"
                      : "block truncate text-xs text-kumo-subtle"
                  }
                  title={s.error ?? s.summary}
                >
                  {s.error ?? s.summary}
                </span>
              )}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** Live step card for one run (looked up by toolCallId), then the verdict. */
export default function DiagnosisCard({
  run,
  outcome,
  getReport,
  liveChecks = [],
  localProbe
}: {
  run: RunState | undefined;
  outcome?: CheckOutcome;
  getReport?: (id: string) => Promise<Report | null>;
  liveChecks?: ExtraCheck[];
  /** This tab's own browser probe for the run: shown even when the run fails (R18). */
  localProbe?: BrowserProbe;
}) {
  const ok = outcome?.ok ? outcome : undefined;
  const host = run?.host ?? outcome?.host;
  const runId = run?.id ?? outcome?.runId;
  const verdict = ok?.verdict ?? run?.verdict;
  const confidence = ok?.confidence ?? run?.confidence;
  // The run outlives the tool call (a wait timeout isn't a failure), so it decides the state when present.
  const running = run ? run.status === "running" : !outcome;
  const failed = run ? run.status === "error" : outcome?.ok === false;
  const now = useNow(running);

  const [report, setReport] = useState<Report | null>(null);
  const [showEvidence, setShowEvidence] = useState(false);
  const [showSteps, setShowSteps] = useState(false);
  const done = !!verdict && !running;

  useEffect(() => {
    if (!done || !runId || !getReport) return;
    let alive = true;
    getReport(runId)
      .then((r) => alive && setReport(r))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [done, runId, getReport]);

  if (!run && !outcome) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-kumo-line bg-kumo-base px-4 py-3 text-sm text-kumo-subtle">
        <CircleNotchIcon size={14} className="animate-spin" />
        Starting diagnosis…
      </div>
    );
  }

  const elapsed = run
    ? ((run.finishedAt ?? now) - run.startedAt) / 1000
    : undefined;
  const signals = ok?.signals ?? report?.classification.signals ?? [];
  const explanation = ok?.explanation || report?.explanation || "";
  const reportPath =
    ok?.reportPath ?? (host && runId ? `/r/${host}/${runId}` : undefined);
  const checks = [
    ...(report?.extraChecks ?? []),
    ...liveChecks.filter((c) => !report?.extraChecks.some((e) => e.id === c.id))
  ];
  const errorText = run
    ? run.error
    : outcome?.ok === false
      ? outcome.error
      : undefined;

  return (
    <article
      className={`${toneOf(done ? verdict : undefined)} card-accent overflow-hidden rounded-2xl border border-kumo-line bg-kumo-base shadow-sm`}
      aria-busy={running}
    >
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 pt-4 sm:px-5">
        <span className="truncate font-mono text-sm font-semibold text-kumo-default">
          {host ?? "unknown site"}
        </span>
        {elapsed !== undefined && (
          <span className="font-mono text-[11px] text-kumo-subtle">
            {elapsed.toFixed(1)}s
          </span>
        )}
        <span className="ml-auto">
          {done && verdict ? (
            <VerdictBadge
              verdict={verdict}
              subtype={report?.classification.subtype}
              confidence={confidence}
            />
          ) : failed ? (
            <span className="text-xs font-medium text-kumo-danger">Failed</span>
          ) : (
            <span className="flex items-center gap-1.5 text-xs text-kumo-brand">
              <CircleNotchIcon size={12} className="animate-spin" />
              Diagnosing
            </span>
          )}
        </span>
      </header>

      <div className="space-y-4 px-4 pt-2 pb-4 sm:px-5">
        <h3
          aria-live="polite"
          className="text-xl leading-snug font-semibold tracking-tight text-kumo-default"
        >
          {done && verdict ? (
            <span className="tone-text">
              {headlineOf(
                verdict,
                report?.evidence.browser?.reachable ??
                  localProbe?.reachable ??
                  false
              )}
            </span>
          ) : failed ? (
            "Couldn't finish the check."
          ) : (
            <span className="scan-text">Checking from every side…</span>
          )}
        </h3>

        {failed && errorText && (
          <p className="flex items-start gap-2 rounded-lg bg-kumo-danger-tint px-3 py-2 text-sm text-kumo-danger">
            <WarningIcon size={16} className="mt-0.5 shrink-0" />
            {errorText}
          </p>
        )}

        {failed && localProbe && (
          <p className="text-sm text-kumo-default">
            {localProbe.reachable
              ? "Your browser could reach it"
              : "Your browser could not reach it"}
            <span className="block text-xs text-kumo-subtle">
              {browserLine(localProbe)}
            </span>
          </p>
        )}

        {done && report && (
          <SelfSuspectBanner reasons={report.classification.selfSuspect} />
        )}

        {run && (!done || showSteps) && <Steps run={run} />}

        {done && signals.length > 0 && (
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
                className={`flex gap-2.5 text-kumo-default ${verdict === "INCONCLUSIVE" ? "text-[15px]" : "text-sm"}`}
              >
                <span className="tone-dot mt-[7px] size-1.5 shrink-0 rounded-full" />
                {s}
              </li>
            ))}
          </ul>
        )}

        {done && report && <ClassificationExtras c={report.classification} />}

        {done && host && (
          <Sparkline host={host} baseline={report?.evidence.baseline} />
        )}

        {done && explanation && (
          <div className="rounded-xl bg-kumo-elevated px-4 py-3 text-[15px] leading-relaxed">
            <Markdown>{explanation}</Markdown>
          </div>
        )}

        {done && showEvidence && report && (
          <div className="rounded-xl border border-kumo-line px-3">
            <EvidenceGrid
              evidence={report.evidence}
              verdict={report.classification.verdict}
            />
          </div>
        )}

        {done && <ExtraChecks checks={checks} />}

        {done && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {reportPath && (
              <CopyButton
                primary
                icon={LinkIcon}
                label="Copy share link"
                text={location.origin + reportPath}
              />
            )}
            {host && runId && (
              <CopyButton
                icon={PaperPlaneTiltIcon}
                label="Send check link"
                text={`${location.origin}/c/${host}?ref=${runId}`}
              />
            )}
            {report && <ReportTools report={report} />}
            <span className="ml-auto flex gap-1">
              {run && (
                <ToggleLink
                  open={showSteps}
                  onClick={() => setShowSteps(!showSteps)}
                >
                  Steps
                </ToggleLink>
              )}
              {report && (
                <ToggleLink
                  open={showEvidence}
                  onClick={() => setShowEvidence(!showEvidence)}
                >
                  Evidence
                </ToggleLink>
              )}
            </span>
          </div>
        )}
      </div>
      {running && <div className="scan-bar h-0.5" />}
    </article>
  );
}

function ToggleLink({
  open,
  onClick,
  children
}: {
  open: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-kumo-subtle hover:bg-kumo-tint hover:text-kumo-default"
    >
      {children}
      <CaretDownIcon
        size={12}
        className={`transition-transform ${open ? "rotate-180" : ""}`}
      />
    </button>
  );
}
