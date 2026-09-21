// Pure and deterministic: same Evidence -> same Classification.
import type {
  BlockKind,
  Classification,
  CrowdBucket,
  DnsResult,
  Evidence,
  ProbeResult,
  RadarBgpEvent,
  RegionProbe,
  StatusPageInfo,
  Verdict,
  VerdictSubtype
} from "../shared/types";
import { isForbiddenAddress } from "./guard";

export const SLOW_MS = 3000;
/** Share of answering colos that must fail for DOWN_GLOBAL. */
const GLOBAL_FAIL_RATIO = 0.8;
/** Radar events that ended this long before the check still count. */
const RECENT_MS = 2 * 3600_000;
const STRONG_BGP = 8;
/** Crowd buckets smaller than this are ignored everywhere. */
const MIN_BUCKET = 3;
/** Other failing hosts on the same provider needed to blame it (R9). */
const PROVIDER_BLAME = 3;
/** Cloudflare status components IsItMe's own probes run on (R18). */
const CF_PROBE_COMPONENTS =
  /workers|durable objects|workflows|1\.1\.1\.1|dns resolver|network performance|radar/i;
/** Extra components that matter when the target itself is behind Cloudflare. */
const CF_PROXY_COMPONENTS = /cdn|cache|ssl|dns|waf|load balanc|argo/i;
const SELF_SUSPECT_CAP = 0.7;

/** [label, delta]; the first entry of a list is the base. */
type Factor = [label: string, delta: number];

const clamp = (n: number) =>
  Math.round(Math.min(0.95, Math.max(0.5, n)) * 100) / 100;
const pct = (n: number, d: number) => (d ? n / d : 0);
const plural = (n: number, word: string, many = word + "s") =>
  `${n} ${n === 1 ? word : many}`;
const hostOf = (url: string) => (URL.canParse(url) ? new URL(url).host : "");
/** Vendor free text: one line, capped. */
const vendorText = (s: string) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > 80 ? `${t.slice(0, 79)}…` : t;
};
// ponytail: "maintenance" is excluded; Cloudflare nearly always has some colo in maintenance.
const statusBad = (s: StatusPageInfo | null | undefined): s is StatusPageInfo =>
  !!s &&
  (!["none", "unknown", "maintenance"].includes(s.indicator) ||
    s.componentsDown.length > 0);
const incidentName = (s: StatusPageInfo) =>
  s.incidents[0]?.name ? vendorText(s.incidents[0].name) : "";

function median(xs: number[]): number | undefined {
  if (!xs.length) return undefined;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function ipToBig(ip: string): [bigint, number] | undefined {
  if (!ip.includes(":")) {
    const parts = ip.split(".");
    if (
      parts.length !== 4 ||
      !parts.every((p) => /^\d{1,3}$/.test(p) && +p < 256)
    )
      return undefined;
    return [parts.reduce((a, p) => (a << 8n) + BigInt(p), 0n), 32];
  }
  const halves = ip.split("::");
  if (halves.length > 2) return undefined;
  const split = (s: string) => (s ? s.split(":") : []);
  const head = split(halves[0]);
  const tail = halves.length === 2 ? split(halves[1]) : [];
  const last = tail.length ? tail : head;
  if (last.at(-1)?.includes(".")) {
    const v4 = ipToBig(last.pop()!);
    if (!v4) return undefined;
    last.push((v4[0] >> 16n).toString(16), (v4[0] & 0xffffn).toString(16));
  }
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0) return undefined;
  const groups = [...head, ...Array<string>(fill).fill("0"), ...tail];
  if (groups.length !== 8 || !groups.every((g) => /^[0-9a-f]{1,4}$/i.test(g)))
    return undefined;
  return [groups.reduce((a, g) => (a << 16n) + BigInt(`0x${g}`), 0n), 128];
}

/** True when `ip` is inside `cidr` (IPv4 or IPv6; a bare address means /32 or /128). */
export function cidrContains(cidr: string, ip: string): boolean {
  const [net, bits] = cidr.split("/");
  const a = ipToBig(net);
  const b = ipToBig(ip);
  if (!a || !b || a[1] !== b[1]) return false;
  const len = bits === undefined ? a[1] : Number(bits);
  if (!Number.isInteger(len) || len < 0 || len > a[1]) return false;
  const shift = BigInt(a[1] - len);
  return a[0] >> shift === b[0] >> shift;
}

function failure(p: ProbeResult): string {
  if (p.status) return `HTTP ${p.status}`;
  switch (p.errorClass) {
    case "timeout":
      return `timed out after ${p.ms}ms`;
    case "dns":
      return "DNS error";
    case "connect":
      return "connection refused or reset";
    case "tls":
      return "TLS/certificate error";
    case "blocked":
      return "blocked";
    default:
      return "unknown error";
  }
}

function edgeLine(edge: ProbeResult): string {
  const where = edge.colo
    ? `Cloudflare's edge (${edge.colo})`
    : "Cloudflare's edge";
  return edge.ok
    ? `${where} got HTTP ${edge.status} in ${edge.ms}ms`
    : `${where} failed: ${failure(edge)}`;
}

function regionsLine(regions: RegionProbe[]): string {
  const failed = regions.filter((r) => !r.ok);
  if (!failed.length) {
    const med = median(regions.map((r) => r.ms));
    return `${regions.length}/${regions.length} regions reachable (median ${Math.round(med ?? 0)}ms)`;
  }
  const detail = failed.map((r) => `${r.region}: ${failure(r)}`).join(", ");
  return `${failed.length}/${regions.length} regions failed (${detail})`;
}

const resolverName = (d: DnsResult, fallback: "cloudflare" | "google") =>
  (d.resolver ?? fallback) === "google" ? "8.8.8.8" : "1.1.1.1";
const RCODE: Record<number, string> = {
  0: "no records",
  2: "SERVFAIL",
  3: "NXDOMAIN",
  5: "REFUSED"
};

function dnsLine(
  dns: DnsResult,
  from = resolverName(dns, "cloudflare")
): string {
  if (dns.ok) {
    const sec = dns.ad ? ", DNSSEC-validated" : "";
    return `DNS resolved to ${plural(dns.addresses.length, "address", "addresses")} in ${dns.ms}ms${sec}`;
  }
  switch (dns.rcode) {
    case 3:
      return `The domain does not exist (NXDOMAIN from ${from})`;
    case 2:
      return `The domain's DNS servers failed to answer (SERVFAIL from ${from})`;
    case 0:
      return "The domain exists but has no A/AAAA records";
    case -1:
      return `The DNS lookup via ${from} itself failed`;
    default:
      return `DNS returned an error (rcode ${dns.rcode})`;
  }
}

const BLOCK_PRIORITY: BlockKind[] = ["challenge", "waf", "rate_limit", "geo"];

/**
 * Radar events as classify reads them: outages/anomalies ongoing or ended <= 2h ago (R10) vs stale,
 * and BGP events strong enough to blame (R9: confident and covering the target IP) vs context.
 */
export function radarEvents(evidence: Evidence) {
  const { dns, target } = evidence;
  const radar =
    evidence.radar && !evidence.radar.skipped
      ? evidence.radar
      : { outages: [], anomalies: [], bgp: [] as RadarBgpEvent[] };
  const recent = (end?: string | null) =>
    !end || Date.parse(end) >= evidence.startedAt - RECENT_MS;
  const targetIp =
    dns?.addresses[0] ?? (target.isIpLiteral ? target.host : undefined);
  const strong = (e: RadarBgpEvent) =>
    (e.confidence ?? 0) >= STRONG_BGP &&
    !!targetIp &&
    e.prefixes.some((p) => cidrContains(p, targetIp));
  const bgp = radar.bgp.filter((e) => recent(e.endedAt));
  return {
    outages: radar.outages.filter((o) => recent(o.endDate)),
    anomalies: radar.anomalies.filter((a) => recent(a.endDate)),
    stale: [
      ...radar.outages.filter((o) => !recent(o.endDate)),
      ...radar.anomalies.filter((a) => !recent(a.endDate))
    ],
    strongBgp: bgp.filter(strong),
    weakBgp: bgp.filter((e) => !strong(e))
  };
}

/**
 * Rules, first match wins:
 *  1. DNS_FAILURE          both resolvers (1.1.1.1, 8.8.8.8) answered with the same error, or only one answered.
 *                          Disagreeing resolvers are not a DNS_FAILURE, only a signal. Subtype dnssec / nxdomain.
 *  2. UPSTREAM_OUTAGE      strong BGP event (confidence >= 8, ongoing or ended <= 2h ago, a prefix contains the
 *                          target IP) and failing colos >= 1 and >= ok colos. Weak events are context only.
 *  3. TLS_ERROR            every answering server vantage failed with errorClass "tls"
 *  4. BLOCKED              every answering server vantage is ok but `blocked` (skipped when the browser failed)
 *  5. Quorum over distinct colos (a colo fails when most of its probes fail; an even split is no data):
 *     DOWN_GLOBAL          >= 2 failing colos and >= 80% of answering colos failing, or 1 failing colo, none ok,
 *                          and a failing browser that reached the control URL (the browser is the second vantage)
 *     DOWN_REGIONAL        >= 1 failing colo and >= 1 ok colo (subtype origin when the failure is a 52x)
 *     otherwise, with a failure or no answering colo: LIKELY_YOUR_NETWORK if the browser is offline, else INCONCLUSIVE
 *  6. ISP_OUTAGE           servers ok + browser failed + recent Radar outage/anomaly for the user's ASN/country
 *     LIKELY_YOUR_NETWORK  servers ok + browser failed
 *  7. PARTIAL              reachable, but the path 404s while the root works, or most flagged vantages see a
 *                          parked / expect-missing / error / empty page
 *  8. SLOW                 reachable, but edge or median region time >= max(3000ms, 3x baseline median) (N9)
 *  9. HEALTHY              capped at 0.7 when one colo answered and there is no browser.
 *                          ponytail: R12 would say INCONCLUSIVE here; local dev lands every region in one colo.
 * Answering vantages = edge + regions without noData (a vantageSick failure counts as noData). Missing evidence
 * (null, [], noData, radar.skipped) never counts as a failure; it only lowers confidence, and noData regions are listed.
 * Radar outages/anomalies count while ongoing or ended <= 2h before the check. Crowd buckets under 3 checks are
 * ignored; the crowd moves confidence by at most 0.1 and never picks the verdict.
 * Signals never quote target-controlled text (titles, Location URLs, error strings): hosts only.
 * Provider blame (R9) needs >= 3 other failing hosts on it or its own status page incident; DOWN_* only, +0.05.
 * Status pages (N2), hints (N4, N7) and selfSuspect (R18, caps confidence at 0.7) never pick the verdict.
 * Neither do RDAP expiry, authoritative-NS answers or the status lag ledger (N10): signals only.
 * factors (N8): base first, then every delta; their sum is the confidence before clamp and caps.
 */
export function classify(evidence: Evidence): Classification {
  const {
    dns,
    dnsAlt,
    regions,
    radar,
    crowd,
    browser,
    user,
    target,
    root,
    alt
  } = evidence;
  const excluded = (p: ProbeResult) => !!p.noData || (!!p.vantageSick && !p.ok);
  const edge = evidence.edge && !excluded(evidence.edge) ? evidence.edge : null;
  const answeringRegions = regions.filter((r) => !excluded(r));
  const noDataRegions = regions.filter(excluded);

  // Distinct-colo quorum.
  const vantages: Array<[string, ProbeResult]> = [
    ...(edge ? [[edge.colo ?? "edge", edge] as [string, ProbeResult]] : []),
    ...answeringRegions.map(
      (r) => [r.colo ?? `hint:${r.region}`, r] as [string, ProbeResult]
    )
  ];
  const colos = new Map<string, ProbeResult[]>();
  for (const [k, p] of vantages) colos.set(k, [...(colos.get(k) ?? []), p]);
  const failing: string[] = [];
  for (const [k, ps] of colos) {
    const bad = ps.filter((p) => !p.ok).length;
    // A split colo (edge and a region disagree) is no data, not a vote either way.
    if (bad * 2 === ps.length) colos.delete(k);
    else if (bad * 2 > ps.length) failing.push(k);
  }
  const answeringColos = colos.size;
  const failingColos = failing.length;
  const okColos = answeringColos - failingColos;
  const coloName = (k: string) => k.replace(/^hint:/, "");
  const probes = vantages.map(([, p]) => p);
  const failedProbes = probes.filter((p) => !p.ok);

  const radarUsable = radar !== null && !radar.skipped;
  const { outages, anomalies, stale, strongBgp, weakBgp } =
    radarEvents(evidence);
  const oldRadar = stale.length;

  const browserFailed =
    browser !== null && (!browser.reachable || !browser.online);
  const browserOk = browser !== null && !browserFailed;

  // Crowd (R14): only buckets with enough samples.
  const big = <T extends CrowdBucket>(b: T) => b.total >= MIN_BUCKET;
  const userBucket = user.asn
    ? crowd?.byAsn.filter(big).find((b) => b.asn === user.asn)
    : undefined;
  const others = crowd?.byAsn.filter((b) => big(b) && b.asn !== user.asn) ?? [];
  const othersTotal = others.reduce((a, b) => a + b.total, 0);
  const othersFailing = others.reduce((a, b) => a + b.failing, 0);
  const crowdUserAsn =
    !!userBucket &&
    userBucket.failing >= 2 &&
    pct(userBucket.failing, userBucket.total) >= 0.5 &&
    othersTotal > 0 &&
    pct(othersFailing, othersTotal) < 0.2;
  const crowdWide =
    othersFailing >= MIN_BUCKET && pct(othersFailing, othersTotal) >= 0.5;
  const crowdLine =
    crowd && crowd.total >= MIN_BUCKET
      ? `${plural(crowd.total, "check")} in the last ${crowd.windowMinutes} min, ${crowd.failing} failing`
      : "";
  const crowdWideLine = crowdWide
    ? `${othersFailing} of ${othersTotal} recent checks by other IsItMe users on other networks failed`
    : "";

  // Provider attribution (N1, R9): never blame a provider from one failing site.
  const provider = evidence.provider;
  const stats =
    provider && evidence.providerStats?.provider === provider.id
      ? evidence.providerStats
      : null;
  // ponytail: a status page "belongs" to the provider when its host contains the provider id's first word.
  // Only a curated page can speak for a provider: status.<apex> on a shared suffix belongs to some tenant.
  const providerPage =
    provider?.id === "cloudflare"
      ? evidence.cfStatus
      : provider &&
          evidence.statusPage?.source === "curated" &&
          hostOf(evidence.statusPage?.url ?? "").includes(
            provider.id.split("-")[0]
          )
        ? evidence.statusPage
        : null;
  const providerBlame =
    !!provider &&
    ((stats?.otherFailing ?? 0) >= PROVIDER_BLAME || statusBad(providerPage));
  const providerLine = !provider
    ? ""
    : providerBlame
      ? stats && stats.otherFailing >= PROVIDER_BLAME
        ? `Other ${provider.name} sites are failing too: ${stats.otherFailing} of ${stats.otherHosts} checked in the last ${stats.windowMinutes} min, so this looks like a ${provider.name} problem`
        : `${provider.name}'s status page reports an incident${providerPage && incidentName(providerPage) ? ` (${incidentName(providerPage)})` : ""}, so this looks like a ${provider.name} problem`
      : `Hosted on ${provider.name}; no sign of a wider ${provider.name} outage`;

  // Status page vs reality (N2).
  const sp = evidence.statusPage;
  const serversOk = answeringColos > 0 && failingColos === 0;
  const statusLine = !sp
    ? ""
    : sp.indicator === "none" && failingColos > 0
      ? `The site's status page says all systems operational, but ${failingColos}/${answeringColos} locations failed`
      : statusBad(sp) && serversOk
        ? `The status page reports an incident${incidentName(sp) ? ` (${incidentName(sp)})` : ""} but our probes pass (it may be regional or partial)`
        : "";

  // Shared fate (R18): reasons Cloudflare itself may be at fault.
  const cf = evidence.cfStatus;
  const behindCf =
    !!evidence.edge?.cfRay ||
    radar?.targetAsn === 13335 ||
    provider?.id === "cloudflare";
  const cfGenerated = failing.filter((k) =>
    colos
      .get(k)!
      .some(
        (p) =>
          !p.ok &&
          (p.status ?? 0) >= 500 &&
          /cloudflare/i.test(p.server ?? "") &&
          !p.cdnOrigin &&
          !((p.status ?? 0) >= 520 && (p.status ?? 0) <= 530)
      )
  );
  const cfDns = dns ? resolverName(dns, "cloudflare") === "1.1.1.1" : false;
  // R18 "non-operational component"; a minor incident with no component down (common) is not enough.
  // Only components our probes (or a Cloudflare-fronted target) depend on count: a WARP or
  // dashboard incident says nothing about this check.
  const relevantDown = (cf?.componentsDown ?? []).filter(
    (c) =>
      CF_PROBE_COMPONENTS.test(c) ||
      (behindCf && CF_PROXY_COMPONENTS.test(c)) ||
      [...colos.keys()].some((k) => c.includes(`(${k})`))
  );
  const cfSuspect =
    statusBad(cf) &&
    (relevantDown.length > 0 || ["major", "critical"].includes(cf.indicator));
  const selfSuspect = [
    cfSuspect
      ? `Cloudflare's status page reports ${incidentName(cf) || (relevantDown.length ? `${plural(relevantDown.length, "component")} not operational` : `a ${cf.indicator} incident`)}`
      : "",
    behindCf && cfGenerated.length >= 2
      ? `Cloudflare itself returned 5xx errors from ${cfGenerated.length} locations (not the site's origin)`
      : "",
    cfDns && dns && (dns.rcode === -1 || !dns.ok) && dnsAlt?.ok
      ? "1.1.1.1 failed to resolve it while 8.8.8.8 did"
      : ""
  ].filter(Boolean);

  // User-side hints (N4, N7): "looks like", never verdict drivers.
  const env = browser?.env;
  const warp = env?.trace?.warp;
  const v6 = (dns?.addresses ?? []).filter((a) => a.includes(":"));
  const hints = [
    warp === "on" || warp === "plus"
      ? "Looks like Cloudflare WARP is on; if only you have trouble, try turning it off"
      : "",
    env?.trace?.gateway === "on"
      ? "Looks like Cloudflare Gateway filters your traffic; your organization's policy may block this site"
      : "",
    user.asn === 36183
      ? "Looks like you're using iCloud Private Relay; try turning it off for this network"
      : "",
    env?.tzMismatch
      ? "Your location and time zone disagree, so it looks like a VPN or proxy; try turning it off"
      : "",
    env?.traceBlocked
      ? "Looks like a proxy or captive portal intercepted the request; sign in to the Wi-Fi portal if there is one"
      : "",
    // Blocked means no DoH answer at all (rcode -1); an NXDOMAIN answer proves DoH works.
    browser?.dns?.rcode === -1 &&
    browser.dnsAlt?.rcode === -1 &&
    browser.controlReachable
      ? "Looks like your network blocks DNS-over-HTTPS and public resolvers; try another network"
      : "",
    v6.length && env?.ipv6 && browserFailed && evidence.edge?.ok
      ? "Possible broken IPv6 path: the site has an IPv6 address and so does your network; try disabling IPv6"
      : "",
    v6.some(isForbiddenAddress)
      ? "The site publishes an unreachable IPv6 address (AAAA record), which can break some connections"
      : ""
  ].filter(Boolean);

  // Missing vantages each cost confidence; each noData region is listed and costs a little.
  const missing =
    (edge ? 0 : 1) +
    (answeringRegions.length ? 0 : 1) +
    (browser ? 0 : 1) +
    (radarUsable ? 0 : 0.5);
  // Status page lag ledger (N10). ponytail: a vendor ack before our first failure is not reported.
  const lag = evidence.statusLag;
  const lagMin =
    lag?.vendorAckAt !== undefined && lag.vendorAckAt >= lag.firstFailureAt
      ? Math.round((lag.vendorAckAt - lag.firstFailureAt) / 60_000)
      : undefined;
  const tail = [
    evidence.edge && !edge ? "Cloudflare's edge: no data" : "",
    ...noDataRegions.map((r) => `${r.region}: no data`),
    alt?.probe?.ok ? `${alt.host} works` : "",
    lagMin !== undefined
      ? `The vendor acknowledged the incident ${lagMin} min after our probes first failed`
      : ""
  ];
  const make = (
    verdict: Verdict,
    factors: Factor[],
    signals: string[],
    subtype?: VerdictSubtype
  ): Classification => {
    const down = verdict === "DOWN_GLOBAL" || verdict === "DOWN_REGIONAL";
    const blame: Factor = [
      `Other ${provider?.name} sites failing`,
      down && providerBlame ? 0.05 : 0
    ];
    const all = [...factors, blame]
      .filter(([, d], i) => i === 0 || d !== 0)
      .map(([label, d]) => ({ label, delta: Math.round(d * 1000) / 1000 }));
    const confidence = clamp(all.reduce((a, f) => a + f.delta, 0));
    return {
      verdict,
      ...(subtype ? { subtype } : {}),
      confidence: selfSuspect.length
        ? Math.min(confidence, SELF_SUSPECT_CAP)
        : confidence,
      signals: [
        ...signals,
        down ? providerLine : "",
        statusLine,
        ...tail
      ].filter(Boolean),
      factors: all,
      ...(hints.length ? { hints } : {}),
      ...(selfSuspect.length ? { selfSuspect } : {})
    };
  };
  const result = (
    verdict: Verdict,
    factors: Factor[],
    signals: string[],
    subtype?: VerdictSubtype
  ) =>
    make(
      verdict,
      [
        ...factors,
        ["Missing vantage points", -missing * 0.05],
        ["Locations with no data", -noDataRegions.length * 0.03]
      ],
      signals,
      subtype
    );

  // 1. DNS_FAILURE
  const resolvers = [
    dns ? { d: dns, name: resolverName(dns, "cloudflare") } : null,
    dnsAlt ? { d: dnsAlt, name: resolverName(dnsAlt, "google") } : null
  ].filter((r) => r !== null);
  const answered = resolvers.filter((r) => r.d.rcode !== -1);
  const badDns = answered.filter((r) => !r.d.ok);
  const goodDns = resolvers.find((r) => r.d.ok);
  // Authoritative nameservers queried directly: only worth a line when a public resolver failed.
  const ns = evidence.authNs ?? [];
  const nsAnswering = ns.filter((n) => !n.noData);
  const authNsLine =
    !resolvers.some((r) => !r.d.ok) || !ns.length
      ? ""
      : !nsAnswering.length
        ? "Couldn't query the nameservers directly (no data)"
        : nsAnswering.some((n) => n.rcode === 0 && n.addresses.length)
          ? "The domain's own nameservers answer, so this looks like a resolver-side or DNSSEC problem"
          : "The domain's nameservers are failing";
  if (badDns.length && badDns.length === answered.length) {
    const first = badDns[0].d;
    if (badDns.every((r) => r.d.rcode === first.rcode)) {
      const base =
        { 3: 0.95, 2: 0.85, 0: 0.8 }[first.rcode as 0 | 2 | 3] ?? 0.6;
      const both = answered.length === 2;
      const bdns = browser?.dns;
      const agree = bdns && !bdns.ok;
      const disagree = bdns?.ok;
      const dnssec = badDns.some((r) => r.d.dnssecFailed);
      // RDAP explains, never decides.
      const expires = Date.parse(evidence.rdap?.expiresAt ?? "");
      const expiredDays =
        expires < evidence.startedAt
          ? Math.floor((evidence.startedAt - expires) / 86_400_000)
          : undefined;
      if (expiredDays !== undefined)
        hints.unshift("The owner must renew the domain");
      return make(
        "DNS_FAILURE",
        [
          [
            `DNS answered ${RCODE[first.rcode] ?? `rcode ${first.rcode}`}`,
            base
          ],
          both
            ? ["Both resolvers agree", 0.05]
            : ["Only one resolver answered", -0.1],
          ["Your browser's DNS lookup failed too", agree ? 0.05 : 0],
          ["Your browser's DNS lookup resolved it", disagree ? -0.15 : 0]
        ],
        [
          dnssec
            ? "DNSSEC validation fails, so validating resolvers like 1.1.1.1 and 8.8.8.8 refuse it; the site owner must fix it"
            : "",
          expiredDays === undefined
            ? ""
            : expiredDays
              ? `The domain registration expired ${plural(expiredDays, "day")} ago`
              : "The domain registration expired less than a day ago",
          dnsLine(first, badDns[0].name),
          both ? `${badDns[1].name} agrees` : "Only one DNS resolver answered",
          authNsLine,
          agree ? "Your browser's DNS lookup failed too" : "",
          disagree
            ? `Your browser's DNS lookup did resolve it (${plural(bdns.addresses.length, "address", "addresses")}), so resolvers disagree`
            : ""
        ],
        dnssec ? "dnssec" : first.rcode === 3 ? "nxdomain" : undefined
      );
    }
  }
  const bad = resolvers.find((r) => !r.d.ok);
  const resolverLine =
    bad && goodDns
      ? bad.d.rcode === -1
        ? `The lookup via ${bad.name} failed but ${goodDns.name} resolves it`
        : `${bad.name} returns ${RCODE[bad.d.rcode] ?? `rcode ${bad.d.rcode}`} but ${goodDns.name} resolves it`
      : "";

  const context = [
    edge ? edgeLine(edge) : "",
    answeringRegions.length ? regionsLine(answeringRegions) : "",
    dns ? dnsLine(dns) : "",
    resolverLine,
    authNsLine
  ];

  // 2. UPSTREAM_OUTAGE (R9)
  const bgpAsn = (e: RadarBgpEvent) =>
    radar?.targetAsn && e.asns.includes(radar.targetAsn)
      ? radar.targetAsn
      : e.asns[0];
  const weakBgpLine =
    weakBgp.length && failingColos
      ? `Radar saw a ${(weakBgp[0].confidence ?? 0) < STRONG_BGP ? "low-confidence " : ""}BGP ${weakBgp[0].kind} event on AS${bgpAsn(weakBgp[0])}; not treated as the cause`
      : "";
  if (strongBgp.length && failingColos >= 1 && failingColos >= okColos) {
    const kinds = [...new Set(strongBgp.map((e) => e.kind))].join("/");
    const asn = bgpAsn(strongBgp[0]);
    const who =
      radar?.targetAsName && asn === radar.targetAsn
        ? `AS${asn} (${radar.targetAsName})`
        : `AS${asn}`;
    return result(
      "UPSTREAM_OUTAGE",
      [
        ["Strong BGP event on the site's network", 0.75],
        ["3+ locations failing", failingColos >= 3 ? 0.1 : 0]
      ],
      [
        `Radar saw ${plural(strongBgp.length, `BGP ${kinds} event`)} involving the site's network ${who} in the last 24h`,
        ...context
      ]
    );
  }

  const browserLine = browser
    ? browserOk
      ? `Your browser could reach it${browser.ms !== undefined ? ` in ${Math.round(browser.ms)}ms` : ""}`
      : browser.online
        ? "Your browser could not reach it"
        : "Your browser reported it was offline"
    : "";

  // 3. TLS_ERROR (R3)
  if (probes.length && probes.every((p) => !p.ok && p.errorClass === "tls")) {
    return result(
      "TLS_ERROR",
      [
        ["Every vantage failed TLS", 0.8],
        ["More locations agree", (answeringColos - 1) * 0.05]
      ],
      [
        "The server answers but its TLS certificate is invalid; browsers will block it, and only the site owner can fix it",
        ...context,
        browserLine
      ]
    );
  }

  // 4. BLOCKED (R1)
  if (
    probes.length &&
    !browserFailed &&
    probes.every((p) => p.ok && p.blocked)
  ) {
    const counts = new Map<BlockKind, number>();
    for (const p of probes)
      counts.set(p.blocked!, (counts.get(p.blocked!) ?? 0) + 1);
    const kind = BLOCK_PRIORITY.reduce((a, k) =>
      (counts.get(k) ?? 0) > (counts.get(a) ?? 0) ? k : a
    );
    const status = probes.find((p) => p.blocked === kind)?.status;
    const line =
      kind === "rate_limit"
        ? "Cloudflare's probes were rate limited (HTTP 429): the site is reachable but blocks automated checks; your browser result decides"
        : kind === "geo"
          ? "HTTP 451: blocked for legal reasons in this location"
          : `Cloudflare's probes got HTTP ${status ?? "403"} (bot protection): the site is reachable but blocks automated checks; your browser result decides`;
    return result(
      "BLOCKED",
      [
        ["Probes blocked by bot protection", 0.65],
        ["Your browser reached it", browserOk ? 0.15 : 0]
      ],
      [line, browserLine],
      kind
    );
  }

  // 5. Quorum (R7)
  const failList = failing.map(coloName).join(", ");
  const quorumLine = `${failingColos}/${answeringColos} distinct Cloudflare locations failed (${failList})`;
  const origin = failedProbes.some((p) => p.cdnOrigin);
  const originLine = origin
    ? "Cloudflare's edge answered; the site's origin server is failing (HTTP 52x)"
    : "";
  const browserConfirms =
    browserFailed && browser!.online && browser!.controlReachable;
  const downSubtype = origin ? "origin" : undefined;
  const crowdDown = crowdWide ? 0.05 : 0;
  if (
    failingColos >= 2 &&
    pct(failingColos, answeringColos) >= GLOBAL_FAIL_RATIO
  ) {
    return result(
      "DOWN_GLOBAL",
      [
        ["Most locations failing", 0.8],
        ["4+ locations failing", failingColos >= 4 ? 0.1 : 0],
        ["Your browser failed too", browserFailed ? 0.05 : 0],
        ["Other IsItMe users see it failing", crowdDown]
      ],
      [
        quorumLine,
        originLine,
        ...context,
        browserFailed ? "Your browser could not reach it either" : "",
        browserOk
          ? "Your browser could reach it, so it may be partially up"
          : "",
        crowdWideLine,
        weakBgpLine
      ],
      downSubtype
    );
  }
  if (failingColos === 1 && okColos === 0 && browserConfirms) {
    return result(
      "DOWN_GLOBAL",
      [
        ["One location failed, your browser confirms", 0.6],
        ["Other IsItMe users see it failing", crowdDown]
      ],
      [
        quorumLine,
        originLine,
        "Your browser could not reach it either, while it could reach www.cloudflare.com",
        ...context,
        crowdWideLine,
        weakBgpLine
      ],
      downSubtype
    );
  }
  if (failingColos >= 1 && okColos >= 1) {
    const okList = [...colos.keys()]
      .filter((k) => !failing.includes(k))
      .map(coloName)
      .join(", ");
    return result(
      "DOWN_REGIONAL",
      [
        ["Some locations failing", 0.65],
        ["Failing locations", Math.min(failingColos, 3) * 0.05]
      ],
      [
        quorumLine,
        originLine,
        ...context,
        `Reachable from ${okList}`,
        browser
          ? browserOk
            ? "Your browser could reach it"
            : "Your browser could not reach it"
          : "",
        weakBgpLine
      ],
      downSubtype
    );
  }
  if (failingColos >= 1 || answeringColos === 0) {
    if (browser && !browser.online) {
      return result(
        "LIKELY_YOUR_NETWORK",
        [["Your browser is offline", 0.6]],
        [
          browserLine,
          answeringColos
            ? "Only one Cloudflare location answered, so the site's side can't be confirmed"
            : "Cloudflare's probes returned no data"
        ]
      );
    }
    return make(
      "INCONCLUSIVE",
      [["Not enough evidence", 0.5]],
      [
        answeringColos
          ? `Only one Cloudflare location answered, and it failed (${failList})`
          : "Cloudflare's probes returned no data",
        originLine,
        ...context,
        browser
          ? browserOk
            ? "Your browser could reach it"
            : browser.controlReachable
              ? "Your browser could not reach it"
              : "Your browser could not reach www.cloudflare.com either, so it can't confirm anything"
          : "No browser result to compare with",
        crowdWideLine
      ]
    );
  }

  // From here every answering server vantage reached the site.
  const radarLines = [
    radar && !radar.skipped && radar.errors.length === 0
      ? outages.length || anomalies.length
        ? ""
        : "No ongoing Radar outages or anomalies for your network"
      : `Radar: no data${radar?.skipReason ? ` (${radar.skipReason})` : ""}`,
    oldRadar
      ? `Earlier today: Radar reported ${plural(oldRadar, "outage or anomaly", "outages or anomalies")} for your network or country (ended)`
      : ""
  ];

  // 6. ISP_OUTAGE / LIKELY_YOUR_NETWORK
  if (browserFailed) {
    const b = browser!;
    const firstLine = b.online
      ? `Your browser could not reach it${edge?.ok ? `; Cloudflare's edge got HTTP ${edge.status} in ${edge.ms}ms` : ""}`
      : "Your browser reported it was offline";
    // firstLine already quotes the edge result.
    const serverContext = context.slice(b.online && edge?.ok ? 1 : 0);
    const controlLine = b.controlReachable
      ? "Your browser could reach www.cloudflare.com, so the problem is specific to this site on your network (firewall, DNS filter, VPN or proxy)"
      : "Your browser could not reach www.cloudflare.com either, so your connection itself looks down";
    const crowdAsnLine = crowdUserAsn
      ? `${userBucket!.failing} of ${userBucket!.total} recent checks from AS${user.asn}${userBucket!.asName ? ` (${userBucket!.asName})` : ""} failed, while other networks were fine`
      : "";

    const radarHits = [...outages, ...anomalies];
    if (radarHits.length) {
      const asnHit = radarHits.some((h) => h.scope === "asn");
      const scope = asnHit
        ? `your network AS${user.asn}${user.asOrganization ? ` (${user.asOrganization})` : ""}`
        : `your country (${user.country ?? "unknown"})`;
      const detail = outages.find((o) => o.description)?.description;
      return result(
        "ISP_OUTAGE",
        [
          ["Radar outage or anomaly, your browser failed", 0.75],
          ["Radar names your network", asnHit ? 0.1 : 0],
          ["Other users on your network fail too", crowdUserAsn ? 0.05 : 0]
        ],
        [
          `Radar reports ${plural(outages.length, "ongoing outage")} and ${plural(anomalies.length, "ongoing traffic anomaly", "ongoing traffic anomalies")} for ${scope}`,
          detail ? `Radar: ${detail}` : "",
          firstLine,
          crowdAsnLine,
          ...serverContext
        ]
      );
    }

    const dohResolved = !!(b.dns?.ok || b.dnsAlt?.ok);
    const dohBlocked =
      !!b.dns && !b.dns.ok && !!b.dnsAlt && !b.dnsAlt.ok && b.controlReachable;
    return result(
      "LIKELY_YOUR_NETWORK",
      [
        ["Servers reach it, your browser does not", 0.7],
        ["Other users on your network fail too", crowdUserAsn ? 0.1 : 0],
        [
          "3+ regions reach it",
          answeringRegions.filter((r) => r.ok).length >= 3 ? 0.05 : 0
        ],
        [
          "Your browser reached www.cloudflare.com",
          b.controlReachable ? 0.05 : 0
        ]
      ],
      [
        firstLine,
        controlLine,
        b.online && dohResolved && edge?.ok
          ? "Likely your local DNS resolver or filter (inferred: browsers can't read the local resolver directly)"
          : "",
        dohBlocked
          ? "Your network seems to block DNS-over-HTTPS / public resolvers"
          : "",
        b.dns && !b.dns.ok && dns?.ok
          ? "Your browser's DNS lookup failed while 1.1.1.1 resolved it"
          : "",
        crowdAsnLine,
        ...serverContext,
        ...radarLines
      ]
    );
  }

  // 7. PARTIAL (R4, R5)
  if (
    edge &&
    (edge.status === 404 || edge.status === 410) &&
    root?.ok &&
    (root.status ?? 0) < 400
  ) {
    return result(
      "PARTIAL",
      [["This path 404s while the root works", 0.8]],
      ["The site is up; this page returns 404", ...context, browserLine],
      "path_not_found"
    );
  }
  const flagged = probes.filter((p) => p.flags);
  const broken = flagged.filter(
    (p) =>
      p.flags!.parked ||
      p.flags!.expectMissing ||
      p.flags!.errorPage ||
      p.flags!.empty
  );
  if (broken.length && broken.length > flagged.length / 2) {
    const has = (k: "parked" | "expectMissing" | "errorPage" | "empty") =>
      broken.find((p) => p.flags![k]);
    const empty = has("empty");
    const [subtype, line]: [VerdictSubtype, string] = has("parked")
      ? ["parked", "The domain is parked: the site is gone, not down"]
      : has("expectMissing")
        ? ["expect_missing", "Expected text not found on the page"]
        : has("errorPage")
          ? [
              "error_page",
              "The page answers HTTP 200 but looks like an error page"
            ]
          : ["empty", `The page is nearly empty (${empty?.bytes ?? 0} bytes)`];
    return result(
      "PARTIAL",
      [
        ["Most vantages see a broken page", 0.7],
        ["Every vantage agrees", broken.length === probes.length ? 0.1 : 0]
      ],
      [line, ...context, browserLine],
      subtype
    );
  }

  const retried = vantages
    .filter(([, p]) => p.retried)
    .map(([k, p]) => (p === edge ? "Cloudflare's edge" : coloName(k)));
  const retryLine = retried.length
    ? `${retried.join(", ")} answered only after a retry (first attempt timed out)`
    : "";

  // 8. SLOW
  // N9: with a per-colo baseline, slow means 3x the usual time (never under 3000ms).
  const base = evidence.baseline;
  const slowMs = base ? Math.max(SLOW_MS, 3 * base.medianMs) : SLOW_MS;
  const medRegion = median(answeringRegions.map((r) => r.ms));
  const edgeSlow = !!edge && edge.ms >= slowMs;
  const regionsSlow = medRegion !== undefined && medRegion >= slowMs;
  if (edgeSlow || regionsSlow) {
    return result(
      "SLOW",
      [
        [`Responses took ${slowMs}ms+`, 0.7],
        ["Edge and regions both slow", edgeSlow && regionsSlow ? 0.15 : 0],
        [
          "Your browser was slow too",
          browser?.ms && browser.ms >= slowMs ? 0.05 : 0
        ]
      ],
      [
        base && edgeSlow && base.medianMs > 0
          ? `${(edge!.ms / base.medianMs).toFixed(1)}x slower than usual from ${base.colo} (normally ${Math.round(base.medianMs)}ms)`
          : "",
        edgeSlow
          ? `Cloudflare's edge took ${edge!.ms}ms (slow is ${slowMs}ms+)`
          : "",
        regionsSlow
          ? `Median region response was ${Math.round(medRegion!)}ms (slow is ${slowMs}ms+)`
          : "",
        retryLine,
        ...context,
        browserLine
      ]
    );
  }

  // 9. HEALTHY
  const chain = edge?.chain ?? [];
  const finalHost = chain.length > 1 ? hostOf(chain[chain.length - 1].url) : "";
  // The Location header is target-controlled text: only its host is safe to repeat.
  const redirectHost = edge?.redirectedTo ? hostOf(edge.redirectedTo) : "";
  const redirectLine = finalHost
    ? `Redirected via ${plural(chain.length - 1, "hop")} to ${finalHost}`
    : redirectHost
      ? `Redirects to ${redirectHost} (not followed)`
      : "";
  const agreeing =
    (edge ? 1 : 0) +
    (answeringRegions.length ? 1 : 0) +
    (browserOk ? 1 : 0) +
    (dns?.ok ? 1 : 0);
  const single = answeringColos === 1 && !browser;
  const healthy = result(
    "HEALTHY",
    [
      ["Every answering location reached it", 0.7],
      [`${plural(agreeing, "vantage")} agree`, agreeing * 0.05],
      ["Radar data available", radarUsable ? 0.05 : 0],
      ["Other IsItMe users report failures", crowdWide ? -0.05 : 0]
    ],
    [
      ...context,
      browserLine,
      redirectLine,
      retryLine,
      single ? "Only one Cloudflare location answered" : "",
      crowdWide
        ? `${crowdWideLine}, but Cloudflare's probes reach it`
        : crowdLine,
      ...radarLines,
      target.isIpLiteral ? "Checked an IP address directly (no DNS step)" : ""
    ]
  );
  if (single) healthy.confidence = Math.min(healthy.confidence, 0.7);
  return healthy;
}
