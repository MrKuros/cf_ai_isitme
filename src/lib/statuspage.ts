// Atlassian Statuspage summary.json discovery + parse (N2, R18). JSON only, never scraped.
import type { StatusIncident, StatusPageInfo } from "../shared/types";
import { guardUrl } from "./probes";
import curated from "./status-pages.json";

export const CF_STATUS_URL =
  "https://www.cloudflarestatus.com/api/v2/summary.json";
const MAX_BODY = 256 * 1024;
const INDICATORS = ["none", "minor", "major", "critical", "maintenance"];
const RESOLVED = ["resolved", "postmortem", "completed"];
// ponytail: hand-kept multi-tenant suffixes where status.<apex> belongs to some tenant; a PSL private-section check is the upgrade
const SHARED_SUFFIXES = new Set([
  "pages.dev",
  "workers.dev",
  "github.io",
  "netlify.app",
  "vercel.app",
  "herokuapp.com",
  "web.app",
  "firebaseapp.com",
  "fly.dev",
  "onrender.com",
  "azurewebsites.net",
  "cloudfront.net",
  "appspot.com"
]);

export function statusPageUrl(
  host: string
): { url: string; source: "curated" | "statuspage" } | null {
  const labels = host.toLowerCase().replace(/\.$/, "").split(".");
  if (labels.length < 2 || /^[\d.]+$|:/.test(host)) return null;
  // ponytail: naive apex (last two labels), breaks for co.uk; use a PSL if it matters
  const apex = labels.slice(-2).join(".");
  const url = (curated as Record<string, string>)[apex];
  if (url) return { url, source: "curated" };
  return SHARED_SUFFIXES.has(apex)
    ? null
    : {
        url: `https://status.${apex}/api/v2/summary.json`,
        source: "statuspage"
      };
}

const str = (v: unknown, max = 200) =>
  typeof v === "string" ? v.slice(0, max) : undefined;
const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null;

/** Pure: a summary.json body -> StatusPageInfo, or null when it isn't Statuspage-shaped. */
export function parseStatuspage(
  json: unknown,
  url: string,
  source: StatusPageInfo["source"],
  now: number
): StatusPageInfo | null {
  if (
    !isObj(json) ||
    !isObj(json.status) ||
    typeof json.status.indicator !== "string" ||
    !Array.isArray(json.incidents) ||
    !Array.isArray(json.components)
  )
    return null;
  const indicator = INDICATORS.includes(json.status.indicator)
    ? (json.status.indicator as StatusPageInfo["indicator"])
    : "unknown";
  const incidents: StatusIncident[] = json.incidents
    .filter(isObj)
    .filter((i) => !RESOLVED.includes(String(i.status)))
    .slice(0, 5)
    .map((i) => ({
      name: str(i.name) ?? "incident",
      status: str(i.status, 40) ?? "unknown",
      ...(str(i.impact, 40) && { impact: str(i.impact, 40) }),
      createdAt: str(i.created_at, 40) ?? ""
    }));
  const componentsDown = json.components
    .filter(isObj)
    .filter(
      (c) =>
        typeof c.status === "string" &&
        c.status !== "operational" &&
        c.status !== "under_maintenance"
    )
    .slice(0, 10)
    .map((c) => str(c.name, 100) ?? "component");
  const description = str(json.status.description);
  return {
    url,
    source,
    indicator,
    ...(description && { description }),
    incidents,
    componentsDown,
    fetchedAt: now
  };
}

async function readCapped(res: Response): Promise<string | null> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let n = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      n += value.length;
      if (n > MAX_BODY) return null;
      chunks.push(value);
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  const buf = new Uint8Array(n);
  let off = 0;
  for (const c of chunks) {
    buf.set(c, off);
    off += c.length;
  }
  return new TextDecoder().decode(buf);
}

/** Never throws; null = no (valid) status page. */
export async function fetchStatusPage(
  url: string,
  source: StatusPageInfo["source"]
): Promise<StatusPageInfo | null> {
  try {
    if (await guardUrl(url)) return null;
    const res = await fetch(url, {
      redirect: "manual",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(5000)
    });
    if (res.status !== 200) {
      res.body?.cancel().catch(() => {});
      return null;
    }
    const text = await readCapped(res);
    if (text === null) return null;
    return parseStatuspage(JSON.parse(text), url, source, Date.now());
  } catch {
    return null;
  }
}
