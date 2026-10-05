import {
  AgentWorkflow,
  type AgentWorkflowEvent,
  type AgentWorkflowStep
} from "agents/workflows";
import type { WorkflowStepConfig } from "cloudflare:workers";
import type { UserAgent } from "../agents/user-agent";
import { classify } from "../lib/classify";
import { authoritativeNs } from "../lib/dns-tcp";
import { registrableDomain } from "../lib/dns-wire";
import { explain } from "../lib/explain";
import { assertSafeTarget, GuardError, normalizeTarget } from "../lib/guard";
import { median } from "../lib/history";
import { rdapLookup } from "../lib/rdap";
import { publicNetInfo } from "../lib/net";
import { fingerprint } from "../lib/provider";
import {
  BROWSER_UNTESTABLE,
  type BrowserProbe,
  type Classification,
  type CrowdCheck,
  type CrowdStats,
  type DiagnoseParams,
  type DiagnoseProgress,
  type DiagnoseResult,
  type DnsResult,
  type Evidence,
  type GlobalpingEvidence,
  type ProbeResult,
  type ProviderInfo,
  type ProviderStats,
  type RadarEvidence,
  type RegionProbe,
  type Report,
  type StepName,
  type StatusPageInfo,
  type StepState,
  VERDICT_CLASS
} from "../shared/types";

const PROBE_CFG = {
  retries: { limit: 2, delay: "1 second", backoff: "exponential" },
  timeout: "30 seconds"
} satisfies WorkflowStepConfig;

/** 8 s probe + 15 s retry + redirect hops. */
const HTTP_CFG = {
  ...PROBE_CFG,
  timeout: "60 seconds"
} satisfies WorkflowStepConfig;

/** Local, fast steps: fail fast instead of the 5-retry / 10-minute defaults. */
const QUICK_CFG = {
  retries: { limit: 1, delay: 500 },
  timeout: "5 seconds"
} satisfies WorkflowStepConfig;

/** Two DoH hops + a 4 s TCP query per NS; a connect error is data (noData), not a retry. */
const AUTHNS_CFG = {
  retries: { limit: 1, delay: "1 second" },
  timeout: "20 seconds"
} satisfies WorkflowStepConfig;

/** Corroboration only: one attempt; `gatherGlobalping` keeps its own ~8 s budget. */
const GLOBALPING_CFG = {
  retries: { limit: 0, delay: "1 second" },
  timeout: "15 seconds"
} satisfies WorkflowStepConfig;

const EXPLAIN_CFG = {
  retries: { limit: 1, delay: "2 seconds" },
  timeout: "45 seconds"
} satisfies WorkflowStepConfig;

const RCODES: Record<number, string> = {
  [-1]: "lookup failed",
  1: "FORMERR",
  2: "SERVFAIL",
  3: "NXDOMAIN",
  5: "REFUSED"
};

const RESOLVER_IP = { cloudflare: "1.1.1.1", google: "8.8.8.8" };

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

function probeSummary(r: ProbeResult): string {
  const via = r.colo ? ` via ${r.colo}` : "";
  if (r.status !== undefined)
    return `HTTP ${r.status} in ${Math.round(r.ms)}ms${via}`;
  return `${r.errorClass ?? "failed"} after ${Math.round(r.ms)}ms${via}`;
}

function dnsSummary(
  a: DnsResult,
  b: DnsResult
): Pick<StepState, "status" | "summary" | "error"> {
  const ip = (d: DnsResult) => RESOLVER_IP[d.resolver ?? "cloudflare"];
  const code = (d: DnsResult) =>
    d.dnssecFailed
      ? "DNSSEC failure"
      : d.rcode === 0
        ? "no records"
        : (RCODES[d.rcode] ?? `rcode ${d.rcode}`);
  const found = (d: DnsResult) =>
    `${d.addresses[0]}${d.addresses.length > 1 ? ` +${d.addresses.length - 1}` : ""} in ${Math.round(d.ms)}ms`;
  if (a.ok && b.ok) {
    const agree = a.addresses.some((x) => b.addresses.includes(x));
    return {
      status: "done",
      summary: `${found(a)} (${ip(a)} and ${ip(b)} ${agree ? "agree" : "both resolve"})`
    };
  }
  if (a.ok || b.ok) {
    const [good, bad] = a.ok ? [a, b] : [b, a];
    return {
      status: "done",
      summary: `${ip(bad)} ${code(bad)}, ${ip(good)} ok: ${found(good)}`
    };
  }
  return {
    status: "error",
    summary: `${ip(a)} ${code(a)}, ${ip(b)} ${code(b)}`,
    error: a.error ?? b.error ?? code(a)
  };
}

export class DiagnoseWorkflow extends AgentWorkflow<
  UserAgent,
  DiagnoseParams,
  DiagnoseProgress
> {
  async run(
    event: AgentWorkflowEvent<DiagnoseParams>,
    step: AgentWorkflowStep
  ) {
    const {
      runId,
      target,
      user,
      trigger,
      ownerId,
      wantsBrowser,
      previousVerdict,
      voter,
      expect,
      lang
    } = event.payload;
    const t = this.env.TARGET_DO.getByName(target.host);
    // Durable so a replayed run keeps the same start time.
    const startedAt = await step.do("start", QUICK_CFG, async () => Date.now());

    // Progress is best effort: a missed card update must never fail the run.
    const progress = (name: StepName, state: StepState) =>
      this.reportProgress({ step: name, state }).catch(() => {});
    const skip = (name: StepName, summary?: string) =>
      progress(name, { status: "skipped", finishedAt: Date.now(), summary });

    /** Runs one probe step; returns null (step marked error) if it still fails after retries. */
    const probeStep = async <T extends Rpc.Serializable<T>>(
      name: StepName,
      fn: () => Promise<T>,
      describe: (v: T) => Pick<StepState, "status" | "summary" | "error">,
      cfg: WorkflowStepConfig = PROBE_CFG
    ): Promise<T | null> => {
      const s = Date.now();
      await progress(name, { status: "running", startedAt: s });
      try {
        const v = await step.do(name, cfg, fn);
        await progress(name, {
          startedAt: s,
          finishedAt: Date.now(),
          ...describe(v)
        });
        return v;
      } catch (e) {
        await progress(name, {
          status: "error",
          startedAt: s,
          finishedAt: Date.now(),
          error: errMsg(e)
        });
        return null;
      }
    };

    // 1. dns (two resolvers) + SSRF guard
    let dns: DnsResult | null = null;
    let dnsAlt: DnsResult | null = null;
    if (target.isIpLiteral) {
      await skip("dns", "IP literal, no lookup");
    } else {
      const r = await probeStep<{ dns: DnsResult; dnsAlt: DnsResult }>(
        "dns",
        () => t.dns(target.host),
        (v) => dnsSummary(v.dns, v.dnsAlt)
      );
      // Fail closed: without a lookup we can't prove the host is public.
      if (!r) {
        await step.reportError(
          "dns lookup failed; cannot verify the target is safe"
        );
        return;
      }
      ({ dns, dnsAlt } = r);
    }
    try {
      assertSafeTarget(target, [
        ...(dns?.addresses ?? []),
        ...(dnsAlt?.addresses ?? [])
      ]);
    } catch (e) {
      if (!(e instanceof GuardError)) throw e;
      await progress("dns", {
        status: "error",
        finishedAt: Date.now(),
        error: `blocked: ${e.message}`
      });
      await step.reportError(`blocked: ${e.message}`);
      return;
    }
    // One failing resolver is a signal for classify, not a reason to skip the probes.
    const domainFailed = !!dns && !!dnsAlt && !dns.ok && !dnsAlt.ok;

    // 2-5. edge, regions, globalping, radar (skipped when the name doesn't resolve)
    let edge: ProbeResult | null = null;
    let regions: RegionProbe[] = [];
    let globalping: Evidence["globalping"] = null;
    let radar: Evidence["radar"] = null;
    if (domainFailed) {
      for (const s of ["edge", "regions", "globalping", "radar"] as const)
        await skip(s, "DNS failed");
    } else {
      // Independent probes: run them side by side so a timing-out target doesn't stack three timeouts.
      let regionsRes: RegionProbe[] | null;
      [edge, regionsRes, globalping, radar] = await Promise.all([
        probeStep<ProbeResult>(
          "edge",
          () => t.edge(target.url, expect),
          (r) => ({
            status: r.ok ? "done" : "error",
            summary: probeSummary(r),
            error: r.ok ? undefined : r.error
          }),
          HTTP_CFG
        ),
        probeStep<RegionProbe[]>(
          "regions",
          () => t.regions(target.url, expect),
          (rs) => {
            const answered = rs.filter((r) => !r.noData);
            if (!answered.length)
              return { status: "skipped", summary: "no region answered" };
            const ok = answered.filter((r) => r.ok);
            return {
              status: ok.length ? "done" : "error",
              summary: `${ok.length}/${answered.length} regions ok${ok.length ? `, median ${Math.round(median(ok.map((r) => r.ms)))}ms` : ""}`
            };
          },
          HTTP_CFG
        ),
        // Outside Cloudflare's network: corroboration only, never a verdict driver.
        probeStep<GlobalpingEvidence>(
          "globalping",
          () => t.globalping(target),
          (g) => {
            const ok = g.probes.filter((p) => p.ok).length;
            return g.skipped
              ? { status: "skipped", summary: g.skipReason ?? "unavailable" }
              : {
                  status: "done",
                  summary: `${ok}/${g.probes.length} outside probes ok`
                };
          },
          GLOBALPING_CFG
        ),
        probeStep<RadarEvidence>(
          "radar",
          () =>
            t.radar({
              targetIp:
                dns?.addresses[0] ??
                dnsAlt?.addresses[0] ??
                (target.isIpLiteral ? target.host : undefined),
              userAsn: user.asn,
              userCountry: user.country
            }),
          (r) =>
            r.skipped
              ? { status: "skipped", summary: r.skipReason ?? "unavailable" }
              : {
                  status: "done",
                  summary: `${r.outages.length} outages, ${r.anomalies.length} anomalies, ${r.bgp.length} BGP events${r.targetAsn ? ` (target AS${r.targetAsn})` : ""}`
                }
        )
      ]);
      regions = regionsRes ?? [];
    }

    // A redirect hop failed the SSRF guard and was never fetched (R5c).
    const refused = edge?.refused ?? regions.find((r) => r.refused)?.refused;
    if (refused) {
      await progress("edge", {
        status: "error",
        finishedAt: Date.now(),
        error: `blocked: ${refused}`
      });
      await step.reportError(`blocked: redirect to ${refused}`);
      return;
    }

    // Path 404s: is the site itself up? (R5e)
    let root: ProbeResult | null = null;
    if (
      edge &&
      (edge.status === 404 || edge.status === 410) &&
      new URL(target.url).pathname !== "/"
    ) {
      const rootUrl = new URL("/", target.url).toString();
      root = await step
        .do(
          "root",
          HTTP_CFG,
          async (): Promise<ProbeResult> => t.edge(rootUrl, undefined, true)
        )
        .catch(() => null);
    }

    // Apex failing at DNS/connect/TLS: try www. (or the apex for www.) once (R5f).
    let alt: Evidence["alt"] = null;
    const altHost = target.host.startsWith("www.")
      ? target.host.slice(4)
      : `www.${target.host}`;
    const altUrl = new URL(target.url);
    altUrl.hostname = altHost;
    const altTarget = target.isIpLiteral
      ? null
      : normalizeTarget(altUrl.toString());
    if (
      altTarget &&
      !("error" in altTarget) &&
      ((domainFailed && dns?.rcode === 3) ||
        ["dns", "connect", "tls"].includes(edge?.errorClass ?? ""))
    ) {
      alt = await step
        .do(
          "alt",
          HTTP_CFG,
          async (): Promise<NonNullable<Evidence["alt"]>> => {
            const a = this.env.TARGET_DO.getByName(altTarget.host);
            const r = await a.dns(altTarget.host);
            let probe: ProbeResult | null = null;
            try {
              if (r.dns.ok) {
                assertSafeTarget(altTarget, [
                  ...r.dns.addresses,
                  ...r.dnsAlt.addresses
                ]);
                probe = await a.edge(altTarget.url, undefined, true);
              }
            } catch (e) {
              if (!(e instanceof GuardError)) throw e;
            }
            return { host: altTarget.host, dns: r.dns, probe };
          }
        )
        .catch(() => null);
    }

    // provider (N1) + status pages (N2, R18): context only, never fail the run.
    let provider: ProviderInfo | null = null;
    let providerStats: ProviderStats | null = null;
    let statusPage: StatusPageInfo | null = null;
    let cfStatus: StatusPageInfo | null = null;
    if (domainFailed) {
      await skip("provider", "DNS failed");
      await skip("status", "DNS failed");
    } else {
      const answering = [edge, ...regions].filter(
        (p): p is ProbeResult => !!p && !p.noData
      );
      const serverOk =
        answering.filter((p) => p.ok).length * 2 >= answering.length;
      const [prov, stat] = await Promise.all([
        probeStep<{
          provider: ProviderInfo | null;
          stats: ProviderStats | null;
        }>(
          "provider",
          async () => {
            const p = fingerprint({
              cnames: [...(dns?.cnames ?? []), ...(dnsAlt?.cnames ?? [])],
              server: edge?.server,
              cfRay: edge?.cfRay,
              providerHeaders: edge?.providerHeaders,
              asn: radar?.targetAsn
            });
            if (!p) return { provider: null, stats: null };
            const d = this.env.PROVIDER_DO.getByName(p.id);
            if (answering.length)
              await d.record(target.host, serverOk, startedAt);
            return { provider: p, stats: await d.stats(target.host, 10) };
          },
          ({ provider: p, stats: s }) =>
            p && s
              ? {
                  status: "done",
                  summary: `${p.name} · ${s.otherFailing} of ${s.otherHosts} other sites failing`
                }
              : { status: "skipped", summary: "no provider fingerprint" },
          QUICK_CFG
        ),
        probeStep<{
          statusPage: StatusPageInfo | null;
          cfStatus: StatusPageInfo | null;
        }>(
          "status",
          async () => {
            const [statusPage, cfStatus] = await Promise.all([
              t.statusPage(target.host),
              this.env.TARGET_DO.getByName("cloudflare.com").cfStatus()
            ]);
            return { statusPage, cfStatus };
          },
          ({ statusPage: sp, cfStatus: cf }) => ({
            status: "done",
            summary:
              (sp
                ? `${sp.indicator}${sp.description ? `: ${sp.description}` : ""}`
                : "no status page found") +
              (cf && cf.indicator !== "none"
                ? ` · Cloudflare: ${cf.description ?? cf.indicator}`
                : "")
          })
        )
      ]);
      provider = prov?.provider ?? null;
      providerStats = prov?.stats ?? null;
      statusPage = stat?.statusPage ?? null;
      cfStatus = stat?.cfStatus ?? null;
    }

    // Explanation-only context (no progress card); a failed step is null.
    const dnsTrouble = !!dns && (!dns.ok || (!!dnsAlt && !dnsAlt.ok));
    const nxdomain = dns?.rcode === 3 || dnsAlt?.rcode === 3;
    const [authNs, rdap, baseline] = await Promise.all([
      dnsTrouble
        ? step
            .do("authns", AUTHNS_CFG, async () => authoritativeNs(target.host))
            .catch(() => null)
        : undefined,
      dnsTrouble && nxdomain
        ? step
            .do("rdap", PROBE_CFG, async () =>
              rdapLookup(registrableDomain(target.host))
            )
            .catch(() => null)
        : undefined,
      edge?.colo
        ? step
            .do(
              "baseline",
              QUICK_CFG,
              async (): Promise<Evidence["baseline"]> => t.baseline(edge.colo!)
            )
            .catch(() => null)
        : undefined
    ]);

    // 6. browser: the probe may land before or after we get here
    let browser: BrowserProbe | null = null;
    if (!wantsBrowser) {
      await skip("browser", "not requested");
    } else {
      const s = Date.now();
      await progress("browser", { status: "running", startedAt: s });
      try {
        browser = await step.do(
          "browser-read",
          QUICK_CFG,
          async (): Promise<BrowserProbe | null> =>
            this.agent.getBrowserProbe(runId)
        );
      } catch {
        browser = null;
      }
      if (!browser) {
        try {
          browser = (
            await step.waitForEvent<BrowserProbe>("browser-wait", {
              type: "browser-probe",
              timeout: "15 seconds"
            })
          ).payload as BrowserProbe;
        } catch {
          browser = null;
        }
      }
      // The browser couldn't test this target at all: missing evidence, not a failure.
      const untestable = browser?.error === BROWSER_UNTESTABLE;
      if (untestable) browser = null;
      await progress(
        "browser",
        browser
          ? {
              status: "done",
              startedAt: s,
              finishedAt: Date.now(),
              summary: browser.reachable
                ? `your browser could reach it${browser.ms !== undefined ? ` in ${Math.round(browser.ms)}ms` : ""}`
                : `your browser could not reach it${browser.controlReachable ? " (other sites work)" : ""}`
            }
          : {
              status: "skipped",
              startedAt: s,
              finishedAt: Date.now(),
              summary: untestable
                ? "your browser can't test http:// sites from this page"
                : "no result from your browser"
            }
      );
    }

    // 7. crowd: record this check, then read the window.
    // Only a browser row carries the user's network; an edge row is Cloudflare's vantage.
    const own: Omit<CrowdCheck, "at"> | null = browser
      ? {
          ok: browser.reachable,
          ms: browser.ms,
          source: "browser",
          asn: user.asn,
          asName: user.asOrganization,
          country: user.country,
          colo: user.colo,
          voter
        }
      : edge
        ? { ok: edge.ok, ms: edge.ms, source: "edge" }
        : domainFailed
          ? { ok: false, source: "edge" }
          : null;
    const crowd = await probeStep<CrowdStats>(
      "crowd",
      async () => {
        // ponytail: a retried step may record twice; harmless for 10-min aggregates
        if (own) await t.recordCheck({ at: startedAt, ...own });
        return t.crowdStats(10);
      },
      (c) => ({
        status: "done",
        summary: `${c.total} checks in ${c.windowMinutes} min, ${c.failing} failing`
      })
    );

    // 8. classify
    const evidence: Evidence = {
      target,
      user: publicNetInfo(user),
      dns,
      dnsAlt,
      edge,
      root,
      alt,
      regions,
      globalping,
      radar,
      crowd,
      browser,
      provider,
      providerStats,
      statusPage,
      cfStatus,
      ...(authNs !== undefined && { authNs }),
      ...(rdap !== undefined && { rdap }),
      ...(baseline !== undefined && { baseline }),
      ...(expect && { expect }),
      startedAt
    };
    const cs = Date.now();
    await progress("classify", { status: "running", startedAt: cs });
    const classification = await step.do(
      "classify",
      { retries: { limit: 0, delay: "1 second" }, timeout: "10 seconds" },
      async (): Promise<Classification> => classify(evidence)
    );
    await progress("classify", {
      status: "done",
      startedAt: cs,
      finishedAt: Date.now(),
      summary: `${classification.verdict} (${Math.round(classification.confidence * 100)}%)`
    });

    // N10: read after classify so the in-progress run can count as the newest failure.
    if (statusPage?.incidents.length) {
      const failing = VERDICT_CLASS[classification.verdict] === "down";
      evidence.statusLag = await step
        .do(
          "statuslag",
          QUICK_CFG,
          async (): Promise<Evidence["statusLag"]> =>
            t.statusLag(statusPage, failing ? startedAt : undefined)
        )
        .catch(() => null);
    }

    // 9. explain
    const explainSkipped =
      trigger === "watch" && classification.verdict === previousVerdict;
    let explanation = "";
    if (explainSkipped) {
      await skip("explain", "verdict unchanged");
    } else {
      explanation =
        (await probeStep<string>(
          "explain",
          () => explain(this.env, evidence, classification, { lang }),
          (text) =>
            text
              ? { status: "done", summary: "explained" }
              : { status: "error", error: "explanation unavailable" },
          EXPLAIN_CFG
        )) ?? "";
    }

    // 10. save + analytics, one durable step so neither repeats on replay
    const report = await step.do("save", PROBE_CFG, async () => {
      const finishedAt = Date.now();
      const r: Report = {
        id: runId,
        host: target.host,
        url: target.url,
        createdAt: startedAt,
        trigger,
        evidence: { ...evidence, finishedAt },
        classification,
        explanation,
        lang,
        extraChecks: []
      };
      await t.saveReport(r, ownerId);
      if (classification.verdict !== "HEALTHY") {
        // ponytail: a retried save step may record twice; harmless for 60-min distinct-ASN counts
        await this.env.TRENDS_DO.getByName("global")
          .record({
            host: target.host,
            verdict: classification.verdict,
            provider: provider?.name,
            asn: user.asn
          })
          .catch((e) => console.warn("trends record failed", errMsg(e)));
      }
      try {
        this.env.ANALYTICS.writeDataPoint({
          indexes: [target.host],
          blobs: [
            target.host,
            classification.verdict,
            trigger,
            user.country ?? "",
            user.colo ?? "",
            edge?.errorClass ?? ""
          ],
          doubles: [
            finishedAt - startedAt,
            dns?.ms ?? 0,
            edge?.ms ?? 0,
            classification.confidence
          ]
        });
      } catch (e) {
        console.warn("analytics write failed", errMsg(e));
      }
      return r;
    });

    await step.reportComplete<DiagnoseResult>({
      runId,
      report,
      explainSkipped
    });
  }
}
