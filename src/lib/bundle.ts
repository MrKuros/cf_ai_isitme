import type {
  BrowserProbe,
  DnsResult,
  NetInfo,
  ProbeResult,
  Report
} from "../shared/types";

const iso = (ms: number) => new Date(ms).toISOString();

/** ASN/org/country only: never city or any device id. */
function net(u: NetInfo): string {
  const as = u.asn
    ? `AS${u.asn}${u.asOrganization ? ` (${u.asOrganization})` : ""}`
    : "unknown network";
  return u.country ? `${as}, ${u.country}` : as;
}

function dns(name: string, d: DnsResult | null | undefined): string {
  if (!d) return `${name}: not run`;
  const rcode = d.rcode === -1 ? "lookup failed" : `rcode ${d.rcode}`;
  const answers = d.addresses.length ? d.addresses.join(" ") : "no answers";
  return `${name}: ${d.ok ? "ok" : "FAIL"}, ${rcode}, ${answers}${d.dnssecFailed ? ", DNSSEC validation failed" : ""}${d.error ? `, ${d.error}` : ""} (${Math.round(d.ms)}ms)`;
}

function probe(name: string, p: ProbeResult | null | undefined): string {
  if (!p) return `${name}: not run`;
  if (p.noData)
    return `${name}: no data (vantage unavailable${p.error ? `: ${p.error}` : ""})`;
  const bits = [
    p.ok ? "ok" : "FAIL",
    p.status !== undefined && `HTTP ${p.status}`,
    p.errorClass && `error class ${p.errorClass}`,
    p.error,
    p.blocked && `bot protection (${p.blocked})`,
    p.colo && `colo ${p.colo}`,
    `${Math.round(p.ms)}ms`
  ];
  return `${name}: ${bits.filter(Boolean).join(", ")}`;
}

function browser(b: BrowserProbe | null): string {
  if (!b) return "not run";
  if (!b.online) return "browser was offline";
  return `${b.reachable ? "reachable" : `unreachable${b.error ? ` (${b.error})` : ""}`}${b.ms !== undefined ? ` in ${Math.round(b.ms)}ms` : ""}, control ${b.controlReachable ? "reachable" : "unreachable"}`;
}

/** Plain-text evidence bundle for ISP/vendor support (N5). */
export function supportBundle(report: Report, origin: string): string {
  const { evidence: e, classification: c } = report;
  const lines = [
    `IsItMe diagnostic report for ${report.host}`,
    `Time (UTC): ${iso(report.createdAt)}`,
    `Target: ${report.url}`,
    `Tested from: ${net(e.user)}`,
    `Verdict: ${c.verdict}${c.subtype ? ` (${c.subtype})` : ""}, confidence ${Math.round(c.confidence * 100)}%`,
    ...(e.expect ? [`Expected text: "${e.expect}"`] : []),
    "",
    "Signals:",
    ...(c.signals.length ? c.signals.map((s) => `- ${s}`) : ["- none"]),
    "",
    "Vantages:",
    `- ${dns("DNS (Cloudflare DoH)", e.dns)}`,
    `- ${dns("DNS (Google DoH)", e.dnsAlt)}`,
    `- ${probe("Cloudflare edge", e.edge)}`,
    ...e.regions.map((r) => `- ${probe(`Region ${r.region}`, r)}`),
    `- Your browser: ${browser(e.browser)}`,
    `- Radar: ${
      !e.radar
        ? "not run"
        : e.radar.skipped
          ? `skipped${e.radar.skipReason ? ` (${e.radar.skipReason})` : ""}`
          : `${e.radar.outages.length} outage(s), ${e.radar.anomalies.length} anomaly(ies), ${e.radar.bgp.length} BGP event(s)${e.radar.targetAsn ? `; target AS${e.radar.targetAsn}${e.radar.targetAsName ? ` (${e.radar.targetAsName})` : ""}` : ""}`
    }`,
    ...(e.provider ? [`- Provider: ${e.provider.name}`] : []),
    ...(e.statusPage
      ? [
          `- Vendor status page: ${e.statusPage.indicator}${e.statusPage.description ? ` (${e.statusPage.description})` : ""}, ${e.statusPage.url}`
        ]
      : [])
  ];
  if (report.extraChecks.length) {
    lines.push("", "Visitor checks:");
    for (const x of report.extraChecks) {
      const as = x.user.asn
        ? `AS${x.user.asn}${x.user.asOrganization ? ` (${x.user.asOrganization})` : ""}`
        : "an unknown network";
      lines.push(
        `- ${iso(x.at)} self-reported by a visitor on ${as}: ${browser(x.browser)}`
      );
    }
  }
  lines.push("", `Full report: ${origin}/r/${report.host}/${report.id}`);
  return lines.join("\n") + "\n";
}
