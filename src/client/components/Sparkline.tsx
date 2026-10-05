import { useEffect, useState } from "react";
import type { Evidence, HostHistory } from "../../shared/types";
import { sparkline } from "../format";
import { baselineY } from "./p2format";

const W = 240;
const H = 36;

/** 24h edge response time for a host (GET /api/host/:host). Red ticks = failing samples; dashed line = usual latency (N9). */
export default function Sparkline({
  host,
  baseline
}: {
  host: string;
  baseline?: Evidence["baseline"];
}) {
  const [history, setHistory] = useState<HostHistory | null | undefined>();

  useEffect(() => {
    let alive = true;
    fetch(`/api/host/${encodeURIComponent(host)}`)
      .then((res) => (res.ok ? (res.json() as Promise<HostHistory>) : null))
      .catch(() => null)
      .then((h) => alive && setHistory(h));
    return () => {
      alive = false;
    };
  }, [host]);

  if (history === undefined) return null;
  const s = sparkline(history?.samples ?? [], W, H);
  const count = history?.samples.length ?? 0;
  // A handful of samples crowd into one spike at the right edge of a 24h axis.
  const empty = count < 3 || (!s.points && !s.ticks.length);

  return (
    <div className="flex items-center gap-3">
      <span className="font-mono text-[11px] tracking-wider text-kumo-subtle uppercase">
        24h
      </span>
      {empty ? (
        <span className="text-xs text-kumo-inactive">
          {count
            ? `${count} check${count === 1 ? "" : "s"} so far; chart appears after 3`
            : "no history yet"}
        </span>
      ) : (
        <>
          <svg
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            className="h-9 w-full max-w-60 text-kumo-subtle"
            aria-hidden="true"
          >
            {s.ticks.map((x, i) => (
              <line
                key={i}
                x1={x}
                x2={x}
                y1={0}
                y2={H}
                stroke="var(--tone-bad)"
                strokeWidth={1.5}
              />
            ))}
            {baseline && s.points && (
              <line
                x1={0}
                x2={W}
                y1={baselineY(baseline.medianMs, s.max, H)}
                y2={baselineY(baseline.medianMs, s.max, H)}
                stroke="currentColor"
                strokeWidth={1}
                strokeDasharray="3 3"
                vectorEffect="non-scaling-stroke"
                opacity={0.6}
              >
                <title>
                  usual from {baseline.colo}: {baseline.medianMs}ms
                </title>
              </line>
            )}
            {s.points.includes(" ") ? (
              <polyline
                points={s.points}
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
                vectorEffect="non-scaling-stroke"
                strokeLinejoin="round"
              />
            ) : (
              s.points && (
                <circle
                  cx={s.points.split(",")[0]}
                  cy={s.points.split(",")[1]}
                  r={2}
                  fill="currentColor"
                />
              )
            )}
          </svg>
          <span className="sr-only">
            Edge response time over 24 hours, {s.ticks.length} failing{" "}
            {s.ticks.length === 1 ? "check" : "checks"}
          </span>
          {s.points && (
            <span className="shrink-0 font-mono text-[11px] text-kumo-subtle">
              max {s.max}ms
              {baseline && (
                <span title={`median of ${baseline.samples} samples`}>
                  {" "}
                  · usual {baseline.medianMs}ms
                </span>
              )}
            </span>
          )}
        </>
      )}
    </div>
  );
}
