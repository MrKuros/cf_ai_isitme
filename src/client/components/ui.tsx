import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import {
  CheckIcon,
  CopyIcon,
  FileTextIcon,
  ShieldWarningIcon,
  TagIcon,
  type Icon
} from "@phosphor-icons/react";
import type {
  BrowserEnv,
  BrowserProbe,
  Classification,
  CrowdBucket,
  Evidence,
  ExtraCheck,
  DnsResult,
  NetInfo,
  ProbeResult,
  Report,
  RunTrigger,
  StatusPageInfo,
  Verdict,
  VerdictSubtype
} from "../../shared/types";
import {
  SUBTYPE_LABEL,
  crowdBuckets,
  groupByColo,
  hostOf,
  probesOkOf,
  relTime,
  statusContradicts,
  visitorLabel,
  visitorsByAsn
} from "../format";
import { supportBundle } from "../../lib/bundle";
import { radarEvents } from "../../lib/classify";
import { authNsOk, authNsText, rdapExpiry } from "./p2format";

export { relTime, SUBTYPE_LABEL };

// ── Verdicts ─────────────────────────────────────────────────────────

type Tone = "good" | "warn" | "bad" | "you" | "dns" | "idle";

export const VERDICTS: Record<
  Verdict,
  { label: string; headline: string; tone: Tone }
> = {
  HEALTHY: {
    label: "Healthy",
    headline: "It's up. Not you, not them.",
    tone: "good"
  },
  SLOW: { label: "Slow", headline: "It's up, but slow.", tone: "warn" },
  DOWN_GLOBAL: {
    label: "Down everywhere",
    headline: "It's down from everywhere we checked.",
    tone: "bad"
  },
  DOWN_REGIONAL: {
    label: "Down in some regions",
    headline: "It's down in some parts of the world.",
    tone: "warn"
  },
  DNS_FAILURE: {
    label: "DNS failure",
    headline: "The name doesn't resolve.",
    tone: "dns"
  },
  LIKELY_YOUR_NETWORK: {
    label: "Likely your network",
    headline: "It's probably you.",
    tone: "you"
  },
  ISP_OUTAGE: {
    label: "ISP/regional outage",
    headline: "Looks like your ISP or regional network.",
    tone: "you"
  },
  UPSTREAM_OUTAGE: {
    label: "Upstream outage",
    headline: "Their network provider is having trouble.",
    tone: "bad"
  },
  BLOCKED: {
    label: "Blocks bots",
    headline: "It's up, but it blocks automated checks.",
    tone: "warn"
  },
  TLS_ERROR: {
    label: "Certificate error",
    headline: "It's up, but its certificate is broken.",
    tone: "bad"
  },
  PARTIAL: {
    label: "Partly broken",
    headline: "It answers, but the page looks broken.",
    tone: "warn"
  },
  INCONCLUSIVE: {
    label: "Inconclusive",
    headline: "We couldn't tell.",
    tone: "idle"
  }
};

/** "Not you" is only claimed when the user's own browser reached the site. */
export function headlineOf(v: Verdict, browserReached: boolean): string {
  return v === "HEALTHY" && !browserReached
    ? "It's up from everywhere we checked."
    : VERDICTS[v].headline;
}

export function toneOf(v: Verdict | undefined): string {
  return `tone-${v ? VERDICTS[v].tone : "idle"}`;
}

export function VerdictBadge({
  verdict,
  subtype,
  confidence,
  size = "sm"
}: {
  verdict: Verdict;
  subtype?: VerdictSubtype;
  confidence?: number;
  size?: "sm" | "lg";
}) {
  return (
    <span
      className={`${toneOf(verdict)} tone-soft tone-text inline-flex items-center gap-1.5 rounded-full font-medium whitespace-nowrap ${
        size === "lg" ? "px-3 py-1 text-sm" : "px-2 py-0.5 text-xs"
      }`}
    >
      <span className="tone-dot size-1.5 rounded-full" />
      {VERDICTS[verdict].label}
      {subtype && (
        <span className="font-normal opacity-75">
          · {SUBTYPE_LABEL[subtype]}
        </span>
      )}
      {confidence !== undefined && (
        <span className="font-mono opacity-75">
          {Math.round(confidence * 100)}%
        </span>
      )}
    </span>
  );
}

export function VerdictDot({ verdict }: { verdict?: Verdict }) {
  return (
    <span
      className={`${toneOf(verdict)} tone-dot inline-block size-2 shrink-0 rounded-full`}
      title={verdict ? VERDICTS[verdict].label : "Not checked yet"}
    >
      <span className="sr-only">
        {verdict ? VERDICTS[verdict].label : "Not checked yet"}
      </span>
    </span>
  );
}

// ── Small helpers ────────────────────────────────────────────────────

export function useNow(active: boolean, everyMs = 1000): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [active, everyMs]);
  return now;
}

export function netLabel(n: NetInfo | null | undefined): string {
  if (!n) return "unknown network";
  const parts = [
    n.asOrganization ?? (n.asn ? `AS${n.asn}` : undefined),
    n.city,
    n.country
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "unknown network";
}

export const TRIGGER_LABEL: Record<RunTrigger, string> = {
  chat: "chat",
  watch: "watch",
  api: "API",
  mcp: "MCP"
};

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function CopyButton({
  text,
  label,
  icon: IconCmp = CopyIcon,
  primary
}: {
  text: string;
  label: string;
  icon?: Icon;
  primary?: boolean;
}) {
  const [state, setState] = useState<"idle" | "ok" | "fail">("idle");
  useEffect(() => {
    if (state === "idle") return;
    const t = setTimeout(() => setState("idle"), 1800);
    return () => clearTimeout(t);
  }, [state]);
  return (
    <button
      type="button"
      onClick={async () => setState((await copyText(text)) ? "ok" : "fail")}
      title={text}
      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-kumo-brand ${
        primary
          ? "bg-kumo-contrast text-kumo-inverse hover:opacity-90"
          : "border border-kumo-line bg-kumo-base text-kumo-default hover:bg-kumo-tint"
      }`}
    >
      {state === "ok" ? (
        <CheckIcon size={14} weight="bold" />
      ) : (
        <IconCmp size={14} />
      )}
      {state === "ok" ? "Copied" : state === "fail" ? "Copy failed" : label}
    </button>
  );
}

// Streamdown is most of the bundle: load it on first use, plain text until then.
const LazyMarkdown = lazy(() => import("./markdown"));

export function Markdown(props: { children: string; animating?: boolean }) {
  return (
    <Suspense
      fallback={<p className="whitespace-pre-wrap">{props.children}</p>}
    >
      <LazyMarkdown {...props} />
    </Suspense>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="font-mono text-[11px] font-medium tracking-wider text-kumo-subtle uppercase">
      {children}
    </div>
  );
}

// ── Evidence ─────────────────────────────────────────────────────────

function Row({
  name,
  ok,
  children
}: {
  name: string;
  ok: boolean | null;
  children: ReactNode;
}) {
  const tone = ok === null ? "tone-idle" : ok ? "tone-good" : "tone-bad";
  return (
    <div className="grid grid-cols-[7.5rem_1fr] gap-3 py-2 text-sm sm:grid-cols-[9rem_1fr]">
      <div className="flex items-center gap-2 text-kumo-subtle">
        <span className={`${tone} tone-dot size-2 shrink-0 rounded-full`} />
        {name}
      </div>
      <div className="min-w-0 text-kumo-default">{children}</div>
    </div>
  );
}

const mono = "font-mono text-[13px]";

export function browserLine(b: BrowserProbe): string {
  if (!b.online) return "Browser reported it was offline";
  if (b.reachable) {
    return `Reachable in ${b.ms ?? "?"}ms (${b.method === "image" ? "favicon" : "no-cors fetch"})`;
  }
  return `Not reachable${b.error ? `: ${b.error}` : ""}${
    b.controlReachable ? "" : " · control site also unreachable"
  }`;
}

function resolverName(d: DnsResult, fallback: string): string {
  return d.resolver === "google"
    ? "8.8.8.8"
    : d.resolver === "cloudflare"
      ? "1.1.1.1"
      : fallback;
}

/** Both resolvers answered but disagree on success or share no address. */
function resolversDisagree(a: DnsResult | null, b: DnsResult | null): boolean {
  if (!a || !b) return false;
  if (a.ok !== b.ok) return true;
  return a.ok && !a.addresses.some((x) => b.addresses.includes(x));
}

function Chip({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span
      className={`tone-${tone} tone-soft tone-text inline-flex items-center rounded-md px-1.5 py-0.5 font-sans text-xs`}
    >
      {children}
    </span>
  );
}

function DnsLine({ d, name }: { d: DnsResult; name: string }) {
  return (
    <span className={`block ${mono}`}>
      <span className="text-kumo-subtle">{name} </span>
      {d.ok
        ? d.addresses.slice(0, 3).join(", ") +
          (d.addresses.length > 3 ? ` +${d.addresses.length - 3}` : "")
        : `rcode ${d.rcode}${d.error ? ` · ${d.error}` : ""}`}
      <span className="text-kumo-subtle">
        {" "}
        · {d.ms}ms{d.ad ? " · DNSSEC" : ""}
      </span>
      {d.dnssecFailed && (
        <span className="ml-1.5">
          <Chip tone="dns">DNSSEC validation failed</Chip>
        </span>
      )}
    </span>
  );
}

const FLAG_SUBTYPE = {
  empty: "empty",
  errorPage: "error_page",
  parked: "parked",
  expectMissing: "expect_missing"
} as const;

/** One HTTP probe: status, blocks, TLS/origin errors, page facts, redirect chain. */
function ProbeDetail({ p }: { p: ProbeResult }) {
  const flags = (Object.keys(FLAG_SUBTYPE) as (keyof typeof FLAG_SUBTYPE)[])
    .filter((k) => p.flags?.[k])
    .map((k) => SUBTYPE_LABEL[FLAG_SUBTYPE[k]]);
  return (
    <span className={mono}>
      {p.status ? `HTTP ${p.status}` : (p.errorClass ?? "failed")}
      <span className="text-kumo-subtle">
        {" "}
        · {p.ms}ms{p.colo ? ` from ${p.colo}` : ""}
        {p.retried ? " · after retry" : ""}
        {p.bytes !== undefined ? ` · ${p.bytes} bytes` : ""}
      </span>
      {(p.blocked || p.cdnOrigin || flags.length > 0) && (
        <span className="mt-1 flex flex-wrap gap-1">
          {p.blocked && <Chip tone="warn">{SUBTYPE_LABEL[p.blocked]}</Chip>}
          {p.cdnOrigin && (
            <Chip tone="bad">origin failing behind Cloudflare</Chip>
          )}
          {flags.map((f) => (
            <Chip key={f} tone="warn">
              {f}
            </Chip>
          ))}
        </span>
      )}
      {!p.ok && p.error && (
        <span
          className={`block text-xs ${p.errorClass === "tls" ? "text-kumo-danger" : "text-kumo-subtle"}`}
        >
          {p.errorClass === "tls" ? "TLS: " : ""}
          {p.error}
        </span>
      )}
      {p.title && (
        <span className="block truncate font-sans text-xs text-kumo-subtle">
          Title: {p.title}
        </span>
      )}
      {p.chain && p.chain.length > 1 ? (
        <span className="block text-xs break-words text-kumo-subtle">
          {p.chain.map((h) => `${hostOf(h.url)} (${h.status})`).join(" → ")}
        </span>
      ) : (
        p.redirectedTo && (
          <span className="block truncate text-xs text-kumo-subtle">
            → {p.redirectedTo}
          </span>
        )
      )}
      {p.refused && (
        <span className="block text-xs text-kumo-danger">
          Redirect refused: {p.refused}
        </span>
      )}
    </span>
  );
}

function RdapRow({ rdap }: { rdap: NonNullable<Evidence["rdap"]> }) {
  const exp = rdapExpiry(rdap.expiresAt);
  return (
    <Row name="Domain registration" ok={exp ? !exp.expired : null}>
      <span>
        {exp?.text ?? "No expiry date on record"}
        {rdap.registrar && (
          <span className="text-kumo-subtle"> · {rdap.registrar}</span>
        )}
        {rdap.status && rdap.status.length > 0 && (
          <span className={`block ${mono} text-kumo-subtle`}>
            {rdap.status.join(", ")}
          </span>
        )}
      </span>
    </Row>
  );
}

function dohStatus(d: DnsResult | null | undefined): string {
  return !d
    ? "not run"
    : d.ok
      ? "ok"
      : d.dnssecFailed
        ? "DNSSEC failed"
        : "failed";
}

export function EvidenceGrid({
  evidence,
  verdict
}: {
  evidence: Evidence;
  verdict?: Verdict;
}) {
  const { dns, edge, regions, radar, crowd, browser } = evidence;
  const rx = radarEvents(evidence);
  const dnsAlt = evidence.dnsAlt ?? null;
  const disagree = resolversDisagree(dns, dnsAlt);
  const shownAsn = crowd ? crowdBuckets(crowd.byAsn) : [];
  const shownCountry = crowd ? crowdBuckets(crowd.byCountry) : [];
  return (
    <div className="divide-y divide-kumo-line">
      <Row name="Your browser" ok={browser ? browser.reachable : null}>
        {browser ? (
          <span>
            {browserLine(browser)}
            {(browser.dns || browser.dnsAlt) && (
              <span className={`block ${mono} text-kumo-subtle`}>
                DoH 1.1.1.1: {dohStatus(browser.dns)} · 8.8.8.8:{" "}
                {dohStatus(browser.dnsAlt)}
              </span>
            )}
            {browser.env && envFacts(browser.env).length > 0 && (
              <span className="block text-xs text-kumo-subtle">
                {envFacts(browser.env).join(" · ")}
              </span>
            )}
            <span className="block text-xs text-kumo-subtle">
              Reachability and timing only: browsers hide status codes.
            </span>
          </span>
        ) : (
          <span className="text-kumo-subtle">Not measured</span>
        )}
      </Row>
      <Row name="DNS" ok={dns || dnsAlt ? !!dns?.ok || !!dnsAlt?.ok : null}>
        {dns || dnsAlt ? (
          <span>
            {dns && <DnsLine d={dns} name={resolverName(dns, "1.1.1.1")} />}
            {dnsAlt && (
              <DnsLine d={dnsAlt} name={resolverName(dnsAlt, "8.8.8.8")} />
            )}
            {disagree && (
              <span className="mt-1 block">
                <Chip tone="warn">resolvers disagree</Chip>
              </span>
            )}
          </span>
        ) : (
          <span className="text-kumo-subtle">
            {evidence.target.isIpLiteral ? "IP address, no lookup" : "Skipped"}
          </span>
        )}
      </Row>
      {evidence.authNs && evidence.authNs.length > 0 && (
        <Row name="Nameservers" ok={authNsOk(evidence.authNs)}>
          {evidence.authNs.map((n) => (
            <span key={`${n.ns}${n.ip ?? ""}`} className={`block ${mono}`}>
              <span className="text-kumo-subtle">
                {n.ns}
                {n.ip ? ` (${n.ip})` : ""}{" "}
              </span>
              <span
                className={n.noData ? "font-sans text-xs text-kumo-subtle" : ""}
              >
                {authNsText(n)}
              </span>
            </span>
          ))}
        </Row>
      )}
      {evidence.rdap && <RdapRow rdap={evidence.rdap} />}
      <Row name="Cloudflare edge" ok={edge ? edge.ok : null}>
        {edge ? (
          <ProbeDetail p={edge} />
        ) : (
          <span className="text-kumo-subtle">Skipped</span>
        )}
      </Row>
      {evidence.root && (
        <Row name="Site root" ok={evidence.root.ok}>
          <ProbeDetail p={evidence.root} />
        </Row>
      )}
      {evidence.alt && (
        <Row
          name={evidence.alt.host}
          ok={evidence.alt.probe?.ok ?? evidence.alt.dns?.ok ?? null}
        >
          {evidence.alt.dns && <DnsLine d={evidence.alt.dns} name="DNS" />}
          {evidence.alt.probe ? (
            <ProbeDetail p={evidence.alt.probe} />
          ) : (
            !evidence.alt.dns && (
              <span className="text-kumo-subtle">Not probed</span>
            )
          )}
        </Row>
      )}
      <Row
        name="Regions"
        ok={
          regions.some((r) => !r.noData)
            ? regions.every((r) => r.ok || r.noData)
            : null
        }
      >
        {regions.length ? (
          <RegionChips regions={regions} />
        ) : (
          <span className="text-kumo-subtle">Skipped</span>
        )}
      </Row>
      {evidence.provider && (
        <Row
          name="Hosting provider"
          ok={
            evidence.providerStats
              ? evidence.providerStats.otherFailing < 3
              : null
          }
        >
          <span>
            {evidence.provider.name}
            <span className="text-kumo-subtle">
              {" "}
              · via {evidence.provider.via.join(", ")}
            </span>
            {evidence.providerStats &&
              evidence.providerStats.otherHosts > 0 && (
                <span className="block text-xs text-kumo-subtle">
                  {evidence.providerStats.otherFailing} of{" "}
                  {evidence.providerStats.otherHosts} other{" "}
                  {evidence.provider.name} sites failing · last{" "}
                  {evidence.providerStats.windowMinutes} min
                </span>
              )}
          </span>
        </Row>
      )}
      {evidence.statusPage && (
        <StatusRow
          name="Status page"
          s={evidence.statusPage}
          probesOk={probesOkOf(verdict)}
        />
      )}
      {evidence.cfStatus && evidence.cfStatus.indicator !== "none" && (
        <StatusRow
          name="Cloudflare status"
          s={evidence.cfStatus}
          probesOk={null}
        />
      )}
      <Row
        name="Radar"
        ok={
          radar && !radar.skipped
            ? rx.outages.length + rx.anomalies.length + rx.strongBgp.length ===
              0
            : null
        }
      >
        {!radar || radar.skipped ? (
          <span className="text-kumo-subtle">
            Skipped{radar?.skipReason ? `: ${radar.skipReason}` : ""}
          </span>
        ) : (
          <span>
            {rx.outages.length + rx.anomalies.length === 0
              ? "No ongoing outages or anomalies"
              : `${rx.outages.length} outage${rx.outages.length === 1 ? "" : "s"}, ${rx.anomalies.length} anomal${rx.anomalies.length === 1 ? "y" : "ies"}`}
            {rx.strongBgp.length > 0 &&
              `, ${rx.strongBgp.length} BGP event${rx.strongBgp.length === 1 ? "" : "s"} on the site's network`}
            {radar.targetAsn && (
              <span className="block text-xs text-kumo-subtle">
                Target network AS{radar.targetAsn}
                {radar.targetAsName ? ` (${radar.targetAsName})` : ""}
              </span>
            )}
            {[
              ...rx.outages.map((o) => ({
                where: o.scope === "asn" ? `AS${o.asn}` : o.location,
                what: o.description ?? o.cause ?? o.outageType ?? "outage"
              })),
              ...rx.anomalies.map((a) => ({
                where: a.scope === "asn" ? `AS${a.asn}` : a.location,
                what: `${a.type ?? "traffic"} anomaly`
              }))
            ]
              .slice(0, 3)
              .map((e, i) => (
                <span key={i} className="block text-xs text-kumo-subtle">
                  {e.where}: {e.what}
                </span>
              ))}
            {rx.stale.length > 0 && (
              <span className="block text-xs text-kumo-subtle">
                Earlier today: {rx.stale.length} outage
                {rx.stale.length === 1 ? " or anomaly" : "s or anomalies"}, now
                ended
              </span>
            )}
            {rx.weakBgp.length > 0 && (
              <span className="block text-xs text-kumo-subtle">
                {rx.weakBgp.length} minor BGP event
                {rx.weakBgp.length === 1 ? "" : "s"} nearby (context, not the
                cause)
              </span>
            )}
          </span>
        )}
      </Row>
      <Row
        name="Crowd"
        ok={crowd && crowd.total ? crowd.failing / crowd.total < 0.5 : null}
      >
        {crowd && crowd.total ? (
          <span>
            {crowd.failing}/{crowd.total} recent checks failing
            <span className="text-kumo-subtle">
              {" "}
              · last {crowd.windowMinutes} min
            </span>
            <CrowdTable
              rows={[
                ...shownAsn.map((b) => ({
                  ...b,
                  key: `a${b.asn}`,
                  name: `AS${b.asn}${b.asName ? ` ${b.asName}` : ""}`
                })),
                ...shownCountry.map((b) => ({
                  ...b,
                  key: `c${b.country}`,
                  name: b.country
                }))
              ]}
            />
          </span>
        ) : (
          <span className="text-kumo-subtle">No other recent checks</span>
        )}
      </Row>
    </div>
  );
}

export function RegionChips({ regions }: { regions: Evidence["regions"] }) {
  const measured = regions.filter((r) => !r.noData);
  const groups = groupByColo(measured);
  const colos = new Set(measured.map((r) => r.colo).filter(Boolean)).size;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {colos > 0 && (
        <span className="text-xs text-kumo-subtle">
          {colos} distinct location{colos === 1 ? "" : "s"}
        </span>
      )}
      {groups.map((g) => {
        const failed = g.find((r) => !r.ok);
        const r = failed ?? g[0];
        return (
          <span
            key={g[0].region}
            title={g
              .map(
                (x) =>
                  `${x.region}: ${x.ok ? `HTTP ${x.status ?? "?"}` : (x.error ?? x.errorClass ?? "failed")}`
              )
              .join("\n")}
            className={`${failed ? "tone-bad" : "tone-good"} tone-soft inline-flex items-baseline gap-1 rounded-md px-1.5 py-0.5 font-mono text-xs`}
          >
            <span className="text-kumo-default">
              {g.map((x) => x.region).join(",")}
            </span>
            {r.colo && <span className="text-kumo-subtle">→ {r.colo}</span>}
            <span className="tone-text">
              {r.ok ? `${r.ms}ms` : (r.errorClass ?? "fail")}
            </span>
          </span>
        );
      })}
      {regions
        .filter((r) => r.noData)
        .map((r) => (
          <span
            key={r.region}
            title={
              r.vantageSick
                ? "this probe location is unhealthy; ignored"
                : "this probe location returned no data; ignored"
            }
            className="tone-idle tone-soft inline-flex items-baseline gap-1 rounded-md px-1.5 py-0.5 font-mono text-xs"
          >
            <span className="text-kumo-default">{r.region}</span>
            <span className="tone-text">
              {r.vantageSick ? "sick" : "no data"}
            </span>
          </span>
        ))}
    </div>
  );
}

export function ExtraChecks({ checks }: { checks: ExtraCheck[] }) {
  if (!checks.length) return null;
  return (
    <div className="space-y-2">
      <SectionLabel>From other people's side · {checks.length}</SectionLabel>
      <ul className="divide-y divide-kumo-line rounded-lg border border-kumo-line">
        {checks.map((c) => (
          <li key={c.id} className="flex items-start gap-3 px-3 py-2 text-sm">
            <span
              className={`${c.browser?.reachable ? "tone-good" : c.browser ? "tone-bad" : "tone-idle"} tone-dot mt-1.5 size-2 shrink-0 rounded-full`}
            />
            <div className="min-w-0 flex-1">
              <div className="text-kumo-default">{netLabel(c.user)}</div>
              <div className="text-xs text-kumo-subtle italic">
                {visitorLabel(c.user)}
              </div>
              <div className="text-xs text-kumo-subtle">
                {c.browser ? browserLine(c.browser) : "No browser result"} ·{" "}
                {relTime(c.at)}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function StatusRow({
  name,
  s,
  probesOk
}: {
  name: string;
  s: StatusPageInfo;
  probesOk: boolean | null;
}) {
  const contradicts = statusContradicts(s.indicator, probesOk);
  return (
    <Row
      name={name}
      ok={
        s.indicator === "unknown"
          ? null
          : s.indicator === "none" || s.indicator === "maintenance"
      }
    >
      <span>
        {s.description ?? `indicator: ${s.indicator}`}
        <a
          href={s.url}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-1.5 text-xs text-kumo-link"
        >
          {hostOf(s.url)}
        </a>
        {s.componentsDown.length > 0 && (
          <span className="block text-xs text-kumo-subtle">
            Down: {s.componentsDown.slice(0, 3).join(", ")}
          </span>
        )}
        {s.incidents.slice(0, 2).map((i) => (
          <span
            key={i.name + i.createdAt}
            className="block text-xs text-kumo-subtle"
          >
            {i.name} · {i.status}
          </span>
        ))}
        {contradicts && (
          <span className="mt-1 block">
            <Chip tone="warn">
              {probesOk
                ? "status page reports an incident, but our probes pass"
                : "status page says all clear, but our probes fail"}
            </Chip>
          </span>
        )}
      </span>
    </Row>
  );
}

/** Normalized crowd heatmap: failing share per ASN/country, buckets >= 3 samples only (R14). */
function CrowdTable({
  rows
}: {
  rows: Array<CrowdBucket & { key: string; name: string }>;
}) {
  if (!rows.length) return null;
  return (
    <table className="mt-1.5 w-full max-w-sm text-xs">
      <tbody>
        {rows.map((r) => {
          const share = r.failing / r.total;
          return (
            <tr key={r.key}>
              <td className="truncate py-0.5 pr-2 text-kumo-default">
                {r.name}
              </td>
              <td
                className="w-24 py-0.5"
                aria-label={`${Math.round(share * 100)}% failing`}
              >
                <span className="block h-1.5 overflow-hidden rounded-full bg-kumo-tint">
                  <span
                    className="block h-full rounded-full"
                    style={{
                      width: `${Math.round(share * 100)}%`,
                      background: "var(--tone-bad)"
                    }}
                  />
                </span>
              </td>
              <td className="py-0.5 pl-2 text-right font-mono whitespace-nowrap text-kumo-subtle">
                {r.failing}/{r.total}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** N4/N7 facts the browser saw about its own network. */
export function envFacts(env: BrowserEnv): string[] {
  const out: string[] = [];
  if (env.trace?.warp && env.trace.warp !== "off")
    out.push(`WARP ${env.trace.warp}`);
  if (env.trace?.gateway === "on") out.push("Cloudflare Gateway on");
  if (env.traceBlocked)
    out.push("a proxy or captive portal answered instead of Cloudflare");
  if (env.tzMismatch)
    out.push(`timezone ${env.timeZone} doesn't match ${env.trace?.loc} (VPN?)`);
  if (env.ipv6 !== undefined) out.push(env.ipv6 ? "IPv6 works" : "no IPv6");
  return out;
}

/** R18: Cloudflare may itself be at fault. */
export function SelfSuspectBanner({ reasons }: { reasons?: string[] }) {
  if (!reasons?.length) return null;
  return (
    <div className="flex items-start gap-2 rounded-lg bg-kumo-warning-tint px-3 py-2 text-sm text-kumo-default">
      <ShieldWarningIcon
        size={16}
        className="mt-0.5 shrink-0 text-kumo-warning"
      />
      <div>
        <p className="font-medium">
          IsItMe runs on Cloudflare too. Treat this result with care.
        </p>
        <ul className="mt-0.5 text-xs text-kumo-subtle">
          {reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** Hints (never verdict drivers) and the N8 confidence breakdown. */
export function ClassificationExtras({ c }: { c: Classification }) {
  return (
    <>
      {c.hints && c.hints.length > 0 && (
        <div className="space-y-1">
          <SectionLabel>Looks like…</SectionLabel>
          <ul className="space-y-1 text-sm text-kumo-default">
            {c.hints.map((h) => (
              <li key={h} className="flex gap-2.5">
                <span className="tone-you tone-dot mt-[7px] size-1.5 shrink-0 rounded-full" />
                {h}
              </li>
            ))}
          </ul>
        </div>
      )}
      {c.factors && c.factors.length > 0 && (
        <details className="group text-sm">
          <summary className="cursor-pointer text-xs text-kumo-subtle hover:text-kumo-default">
            Why {Math.round(c.confidence * 100)}% confidence
          </summary>
          <ul className="mt-1.5 space-y-0.5">
            {c.factors.map((f, i) => (
              <li key={i} className="flex gap-3">
                <span
                  className={`${f.delta >= 0 ? "tone-good" : "tone-bad"} tone-text w-12 shrink-0 text-right font-mono text-xs leading-5`}
                >
                  {f.delta >= 0 ? "+" : "−"}
                  {Math.round(Math.abs(f.delta) * 100)}
                </span>
                <span className="text-kumo-default">{f.label}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

function safeBundle(report: Report): string {
  try {
    return supportBundle(report, location.origin);
  } catch {
    return `${location.origin}/api/report/${report.host}/${report.id}.txt`;
  }
}

/** N5 support bundle + N11 badge snippet. */
export function ReportTools({ report }: { report: Report }) {
  return (
    <>
      <CopyButton
        icon={FileTextIcon}
        label="Copy for support"
        text={safeBundle(report)}
      />
      <a
        href={`/api/report/${encodeURIComponent(report.host)}/${encodeURIComponent(report.id)}.txt`}
        target="_blank"
        rel="noopener"
        className="rounded-md px-2 py-1 text-xs text-kumo-link hover:bg-kumo-tint"
      >
        .txt
      </a>
      <CopyButton
        icon={TagIcon}
        label="Status badge"
        text={`![isitme](${location.origin}/badge/${report.host}.svg)`}
      />
    </>
  );
}

/** N6: visitor results per ASN, labelled self-reported (R15). */
export function VisitorTable({ checks }: { checks: ExtraCheck[] }) {
  const rows = visitorsByAsn(checks);
  if (!rows.length) return null;
  return (
    <div className="space-y-2">
      <SectionLabel>Visitor results by network · self-reported</SectionLabel>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-kumo-subtle">
            <th className="py-1 font-normal">Network</th>
            <th className="py-1 text-right font-normal">Reachable</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-kumo-line">
          {rows.map((r) => (
            <tr key={r.asn ?? "?"}>
              <td className="py-1.5 text-kumo-default">
                {r.asn ? `AS${r.asn}` : "unknown network"}
                {r.asName && (
                  <span className="text-kumo-subtle"> {r.asName}</span>
                )}
              </td>
              <td
                className={`${r.reachable === r.total ? "tone-good" : r.reachable === 0 ? "tone-bad" : "tone-warn"} tone-text py-1.5 text-right font-mono text-[13px]`}
              >
                {r.reachable}/{r.total}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Brand & page shell ───────────────────────────────────────────────

export function Brand() {
  return (
    <a href="/" className="flex items-center gap-2.5" aria-label="IsItMe home">
      <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
        <path
          d="M5 20 L14 8 L23 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeDasharray="2 2.5"
          className="text-kumo-inactive"
        />
        <circle cx="5" cy="20" r="3.5" className="brand-you" />
        <circle cx="14" cy="8" r="3.5" className="brand-edge" />
        <circle cx="23" cy="20" r="3.5" className="brand-site" />
      </svg>
      <span className="text-[17px] font-semibold tracking-tight text-kumo-default">
        IsIt<span className="brand-me">Me</span>
      </span>
    </a>
  );
}

export function PageShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-full bg-kumo-elevated">
      <header className="border-b border-kumo-line bg-kumo-base">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-3.5">
          <Brand />
          <a
            href="/"
            className="rounded-lg px-3 py-1.5 text-sm text-kumo-subtle hover:bg-kumo-tint hover:text-kumo-default"
          >
            Check a site
          </a>
        </div>
      </header>
      <main className="mx-auto max-w-3xl space-y-5 px-5 py-8">{children}</main>
    </div>
  );
}
