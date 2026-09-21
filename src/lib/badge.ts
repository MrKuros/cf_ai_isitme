import type { HostHistory, Verdict } from "../shared/types";

const LABELS: Record<Verdict, [label: string, color: string]> = {
  HEALTHY: ["up", "#3fb950"],
  SLOW: ["slow", "#d29922"],
  BLOCKED: ["up (bot wall)", "#3fb950"],
  PARTIAL: ["partial", "#d29922"],
  DOWN_GLOBAL: ["down", "#e5534b"],
  DOWN_REGIONAL: ["down in some regions", "#e5534b"],
  DNS_FAILURE: ["dns failure", "#e5534b"],
  TLS_ERROR: ["tls error", "#e5534b"],
  UPSTREAM_OUTAGE: ["upstream outage", "#e5534b"],
  // Server vantages were fine; only the checking user had trouble.
  LIKELY_YOUR_NETWORK: ["up", "#3fb950"],
  ISP_OUTAGE: ["up", "#3fb950"],
  INCONCLUSIVE: ["inconclusive", "#9f9f9f"]
};

const STALE_MS = 24 * 60 * 60_000;

const esc = (t: string) =>
  t
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

function age(ms: number): string {
  const m = Math.max(0, Math.floor(ms / 60_000));
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

// ponytail: ~7px per char approximates Verdana 11px; exact text metrics need a font table.
const width = (t: string) => t.length * 7 + 10;

/** Shields-style "isitme | <verdict> <age>" badge from the cached latest verdict only (N11, R19). */
export function badgeSvg(latest: HostHistory["latest"], now: number): string {
  const fresh = latest && now - latest.at < STALE_MS ? latest : null;
  const [label, color] = fresh
    ? (LABELS[fresh.verdict] ?? ["unknown", "#9f9f9f"])
    : ["unknown", "#9f9f9f"];
  const left = "isitme";
  const right = fresh ? `${label} ${age(now - fresh.at)}` : label;
  const lw = width(left);
  const rw = width(right);
  const w = lw + rw;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="20" role="img" aria-label="${esc(`${left}: ${right}`)}"><title>${esc(`${left}: ${right}`)}</title><clipPath id="r"><rect width="${w}" height="20" rx="3" fill="#fff"/></clipPath><g clip-path="url(#r)"><rect width="${lw}" height="20" fill="#555"/><rect x="${lw}" width="${rw}" height="20" fill="${color}"/></g><g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11"><text x="${lw / 2}" y="14">${esc(left)}</text><text x="${lw + rw / 2}" y="14">${esc(right)}</text></g></svg>`;
}
