import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowClockwiseIcon,
  CheckCircleIcon,
  CircleNotchIcon,
  XCircleIcon
} from "@phosphor-icons/react";
import {
  BROWSER_UNTESTABLE,
  type BrowserProbe,
  type ExtraCheck,
  type NetInfo,
  type Report
} from "../../shared/types";
import { classify } from "../../lib/classify";
import { isPublicHostParam } from "../../lib/guard";
import { runBrowserProbe } from "../probe";
import {
  PageShell,
  SectionLabel,
  VerdictBadge,
  envFacts,
  netLabel,
  relTime
} from "./ui";

type Send = "idle" | "sending" | "sent" | "failed";

function Fact({
  label,
  children
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <dt className="text-kumo-subtle">{label}</dt>
      <dd className="min-w-0 font-mono text-[13px] break-words text-kumo-default">
        {children}
      </dd>
    </>
  );
}

/** Visitor runs the browser probe, then POST /api/extra-check { host, reportId: refId, browser }. */
export default function CheckPage({
  host,
  refId
}: {
  host: string;
  refId?: string;
}) {
  const [probe, setProbe] = useState<BrowserProbe | null>(null);
  const [send, setSend] = useState<Send>("idle");
  const [report, setReport] = useState<Report | null | undefined>(undefined);
  const [visitor, setVisitor] = useState<NetInfo | null>(null);
  const started = useRef(false);
  const sent = useRef(false);

  // The page URL is attacker-chosen: never let it aim the visitor's browser at a LAN/internal URL.
  const publicHost = useMemo(() => isPublicHostParam(host), [host]);
  // Probe the exact URL the report checked (scheme, port, path), not a guess.
  const targetUrl = report?.url ?? `https://${host}`;
  const run = useCallback(async () => {
    if (!publicHost) return;
    setProbe(null);
    const p = await runBrowserProbe(targetUrl);
    setProbe(p);
    if (!refId || sent.current || p.error === BROWSER_UNTESTABLE) return;
    sent.current = true;
    setSend("sending");
    try {
      const res = await fetch("/api/extra-check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ host, reportId: refId, browser: p })
      });
      setSend(res.ok ? "sent" : "failed");
      if (res.ok) {
        const { check } = (await res.json()) as { check: ExtraCheck };
        setVisitor(check.user);
      }
    } catch {
      setSend("failed");
    }
  }, [host, refId, targetUrl, publicHost]);

  // N6: the visitor's own verdict: same classifier, their network + browser in place of the requester's.
  const mine = useMemo(
    () =>
      report && visitor && probe && probe.error !== BROWSER_UNTESTABLE
        ? classify({ ...report.evidence, browser: probe, user: visitor })
        : null,
    [report, visitor, probe]
  );

  useEffect(() => {
    document.title = `Can you reach ${host}? · IsItMe`;
    if (!refId) return;
    fetch(
      `/api/report/${encodeURIComponent(host)}/${encodeURIComponent(refId)}`
    )
      .then((res) => (res.ok ? (res.json() as Promise<Report>) : null))
      .then(setReport)
      .catch(() => setReport(null));
  }, [host, refId]);

  // With a ref, wait for the report (or its absence) so the probe uses the report's URL.
  useEffect(() => {
    if (started.current || (refId && report === undefined)) return;
    started.current = true;
    void run();
  }, [refId, report, run]);

  const untestable = probe?.error === BROWSER_UNTESTABLE;

  const edgeVerdict = report?.classification.verdict;
  const edgeUp =
    edgeVerdict === "HEALTHY" ||
    edgeVerdict === "SLOW" ||
    edgeVerdict === "BLOCKED" ||
    edgeVerdict === "LIKELY_YOUR_NETWORK" ||
    edgeVerdict === "ISP_OUTAGE";

  return (
    <PageShell>
      <div className="space-y-2">
        <SectionLabel>Check from your side</SectionLabel>
        <h1 className="text-3xl font-semibold tracking-tight text-kumo-default">
          Can you reach <span className="font-mono break-words">{host}</span>?
        </h1>
        <p className="text-sm text-kumo-subtle">
          {refId
            ? "Someone asked you to run this. Your browser tries the site, and the result goes back to their report."
            : "Your browser tries the site directly, from your own network."}
        </p>
      </div>

      <section
        className={`${probe && !untestable ? (probe.reachable ? "tone-good" : "tone-bad") : "tone-idle"} card-accent overflow-hidden rounded-2xl border border-kumo-line bg-kumo-base shadow-sm`}
        aria-live="polite"
      >
        <div className="space-y-5 p-5 sm:p-7">
          {!publicHost ? (
            <p className="text-lg text-kumo-default">
              <span className="font-mono break-words">{host}</span> is not a
              public site, so your browser won't test it.
            </p>
          ) : !probe ? (
            <div className="flex items-center gap-3 text-lg text-kumo-default">
              <CircleNotchIcon
                size={22}
                className="animate-spin text-kumo-brand"
              />
              <span className="scan-text">Testing from your browser…</span>
            </div>
          ) : untestable ? (
            <p className="text-lg text-kumo-default">
              Your browser can't test{" "}
              <span className="font-mono break-words">{targetUrl}</span> from
              this secure page: browsers block plain http:// requests here.
            </p>
          ) : (
            <>
              <div className="flex items-center gap-3">
                {probe.reachable ? (
                  <CheckCircleIcon
                    size={30}
                    weight="fill"
                    className="tone-text shrink-0"
                  />
                ) : (
                  <XCircleIcon
                    size={30}
                    weight="fill"
                    className="tone-text shrink-0"
                  />
                )}
                <p className="text-2xl font-semibold tracking-tight text-kumo-default">
                  {probe.reachable
                    ? `Your browser could reach ${host}`
                    : `Your browser couldn't reach ${host}`}
                </p>
              </div>
              <dl className="grid grid-cols-[8rem_1fr] gap-x-4 gap-y-1.5 text-sm">
                <Fact label="Time">
                  {probe.ms !== undefined ? `${probe.ms}ms` : "—"}
                </Fact>
                <Fact label="Method">
                  {probe.method === "fetch-no-cors"
                    ? "no-cors fetch"
                    : probe.method === "image"
                      ? "favicon image"
                      : "none worked"}
                </Fact>
                {probe.error && !probe.reachable && (
                  <Fact label="Error">{probe.error}</Fact>
                )}
                <Fact label="DNS (DoH)">
                  {probe.dns
                    ? probe.dns.ok
                      ? probe.dns.addresses.slice(0, 3).join(", ")
                      : `failed (rcode ${probe.dns.rcode})`
                    : "—"}
                </Fact>
                {probe.env && envFacts(probe.env).length > 0 && (
                  <Fact label="Your network">
                    {envFacts(probe.env).join(" · ")}
                  </Fact>
                )}
                <Fact label="Internet">
                  {!probe.online
                    ? "browser says offline"
                    : probe.controlReachable
                      ? "working (cloudflare.com reachable)"
                      : "cloudflare.com also unreachable"}
                </Fact>
              </dl>
              <p className="text-xs text-kumo-subtle">
                Reachability and timing only: browsers hide the status code of
                cross-site requests.
              </p>
            </>
          )}
        </div>
      </section>

      {refId && (
        <section className="space-y-3 rounded-2xl border border-kumo-line bg-kumo-base p-5 sm:px-7">
          <SectionLabel>Compared with the original report</SectionLabel>
          {report && edgeVerdict ? (
            <>
              <p className="flex flex-wrap items-center gap-2 text-sm text-kumo-default">
                Checked {relTime(report.createdAt)} from{" "}
                {netLabel(report.evidence.user)}:
                <VerdictBadge
                  verdict={edgeVerdict}
                  subtype={report.classification.subtype}
                  confidence={report.classification.confidence}
                />
              </p>
              {mine && (
                <p className="flex flex-wrap items-center gap-2 text-sm text-kumo-default">
                  Your result, from {netLabel(visitor)}:
                  <VerdictBadge
                    verdict={mine.verdict}
                    subtype={mine.subtype}
                    confidence={mine.confidence}
                  />
                </p>
              )}
              {probe && !untestable && (
                <p className="text-[15px] text-kumo-default">
                  {edgeVerdict === "TLS_ERROR"
                    ? "The server is up but its certificate is invalid; browsers refuse it, so failing here is expected until the owner fixes it."
                    : edgeVerdict === "DNS_FAILURE" && probe.reachable
                      ? "Your resolver still finds it (cached or different DNS); others may not."
                      : edgeVerdict === "INCONCLUSIVE"
                        ? `Our servers couldn't tell. ${probe.reachable ? "Your browser can reach it, which is a good sign." : "Your browser can't reach it either."}`
                        : edgeVerdict === "PARTIAL"
                          ? `The site answers but looks broken. ${probe.reachable ? "Your browser reaches it too; check whether the page works for you." : "Your browser couldn't reach it."}`
                          : probe.reachable && !edgeUp
                            ? "You can reach it, so it's back up, or the problem is limited to some networks."
                            : probe.reachable
                              ? `It works for you too. ${edgeVerdict === "LIKELY_YOUR_NETWORK" || edgeVerdict === "ISP_OUTAGE" ? "The problem is likely on the requester's side." : "Nothing looks wrong."}`
                              : edgeUp
                                ? "Cloudflare's edge could reach it, but you can't: the problem is likely on your network."
                                : "You can't reach it either, which matches the report: the site itself looks down."}
                </p>
              )}
            </>
          ) : (
            <p className="text-sm text-kumo-subtle">
              {report === null
                ? "The original report couldn't be found."
                : "Loading the original report…"}
            </p>
          )}
          <p className="text-xs text-kumo-subtle">
            {send === "sending" && "Sending your result…"}
            {send === "sent" &&
              "Your result was added to the report. Only your network (ISP, country) is shared, never your IP."}
            {send === "failed" &&
              "Couldn't send your result. The report may have expired."}
          </p>
        </section>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void run()}
          disabled={!probe}
          className="inline-flex items-center gap-1.5 rounded-lg border border-kumo-line bg-kumo-base px-3 py-1.5 text-sm text-kumo-default hover:bg-kumo-tint disabled:opacity-50"
        >
          <ArrowClockwiseIcon size={14} /> Test again
        </button>
        <a
          href={`/?q=${encodeURIComponent(host)}`}
          className="inline-flex items-center gap-1.5 rounded-lg bg-kumo-contrast px-3 py-1.5 text-sm font-medium text-kumo-inverse hover:opacity-90"
        >
          Full diagnosis from 5 regions
        </a>
      </div>
    </PageShell>
  );
}
