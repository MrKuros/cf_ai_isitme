import {
  BROWSER_UNTESTABLE,
  type BrowserEnv,
  type BrowserProbe,
  type DnsResult
} from "../shared/types";

const MAX_TEXT = 300;
const MAX_MS = 60_000;
const MAX_LIST = 20;
const METHODS: BrowserProbe["method"][] = ["fetch-no-cors", "image", "none"];

const str = (v: unknown, max = MAX_TEXT) =>
  typeof v === "string" ? v.slice(0, max) : undefined;
const num = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;
const strList = (v: unknown, pattern: RegExp) =>
  Array.isArray(v)
    ? v
        .filter((x): x is string => typeof x === "string" && pattern.test(x))
        .slice(0, MAX_LIST)
    : [];
const IP_CHARS = /^[0-9a-f:.]{2,45}$/i;
const HOSTNAME = /^[a-z0-9_.-]{1,253}$/i;

function cleanDns(v: unknown): DnsResult | null {
  if (!v || typeof v !== "object") return null;
  const d = v as Partial<DnsResult>;
  return {
    ok: d.ok === true,
    rcode: num(d.rcode) ?? -1,
    addresses: strList(d.addresses, IP_CHARS),
    cnames: strList(d.cnames, HOSTNAME),
    ad: d.ad === true,
    ms: num(d.ms) ?? 0,
    error: str(d.error),
    ...(d.resolver === "cloudflare" || d.resolver === "google"
      ? { resolver: d.resolver }
      : {}),
    ...(typeof d.dnssecFailed === "boolean"
      ? { dnssecFailed: d.dnssecFailed }
      : {})
  };
}

const bool = (v: unknown) => (typeof v === "boolean" ? v : undefined);

function cleanEnv(v: unknown): BrowserEnv | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const e = v as Record<string, unknown>;
  const t =
    e.trace && typeof e.trace === "object" && !Array.isArray(e.trace)
      ? (e.trace as Record<string, unknown>)
      : null;
  const trace = t
    ? {
        warp: str(t.warp, 20),
        gateway: str(t.gateway, 20),
        loc: str(t.loc, 8)
      }
    : undefined;
  const out: BrowserEnv = {
    trace,
    traceBlocked: bool(e.traceBlocked),
    timeZone: str(e.timeZone, 64),
    tzMismatch: bool(e.tzMismatch),
    ipv6: bool(e.ipv6)
  };
  return JSON.parse(JSON.stringify(out)) as BrowserEnv;
}

/** The browser probe comes from the client: keep only known fields with sane types and sizes. */
export function sanitizeProbe(p: Partial<BrowserProbe> | null): BrowserProbe {
  const method = p?.method;
  const env = cleanEnv(p?.env);
  return {
    at: Date.now(),
    reachable: p?.reachable === true,
    method: method === "fetch-no-cors" || method === "image" ? method : "none",
    ms: num(p?.ms),
    error: str(p?.error),
    online: p?.online !== false,
    controlReachable: p?.controlReachable !== false,
    dns: cleanDns(p?.dns),
    ...(p?.dnsAlt !== undefined ? { dnsAlt: cleanDns(p.dnsAlt) } : {}),
    ...(env && { env })
  };
}

/** A client probe as evidence: null when the browser couldn't test the target at all (missing, not failed). */
export function browserVantage(
  p: Partial<BrowserProbe> | null
): BrowserProbe | null {
  if (!p) return null;
  const clean = sanitizeProbe(p);
  return clean.error === BROWSER_UNTESTABLE ? null : clean;
}

type Obj = Record<string, unknown>;

/** First problem with field `k` of `o`, or null. Absent fields are fine. */
function check(
  o: Obj,
  k: string,
  kind: "boolean" | "ms" | "text"
): string | null {
  const v = o[k];
  if (v === undefined) return null;
  if (kind === "boolean")
    return typeof v === "boolean" ? null : `${k} must be a boolean`;
  if (kind === "text")
    return typeof v === "string" && v.length <= MAX_TEXT
      ? null
      : `${k} must be a string of at most ${MAX_TEXT} chars`;
  return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= MAX_MS
    ? null
    : `${k} must be a number 0..${MAX_MS}`;
}

function checkList(o: Obj, k: string, pattern: RegExp): string | null {
  const v = o[k];
  if (v === undefined) return null;
  return Array.isArray(v) &&
    v.length <= MAX_LIST &&
    v.every((x) => typeof x === "string" && pattern.test(x))
    ? null
    : `${k} must be at most ${MAX_LIST} valid entries`;
}

function checkDns(v: unknown, name: string): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== "object" || Array.isArray(v))
    return `${name} must be an object`;
  const d = v as Obj;
  const bad =
    check(d, "ok", "boolean") ??
    check(d, "ad", "boolean") ??
    check(d, "ms", "ms") ??
    check(d, "error", "text") ??
    checkList(d, "addresses", IP_CHARS) ??
    checkList(d, "cnames", HOSTNAME);
  if (bad) return `${name}.${bad}`;
  const r = d.rcode;
  if (
    r !== undefined &&
    !(Number.isInteger(r) && (r as number) >= -1 && (r as number) <= 23)
  )
    return `${name}.rcode must be an integer -1..23`;
  return null;
}

/** Strict R15 validation of an untrusted probe: `ok: false` means reply 400 (or ignore it). */
export function parseBrowserProbe(
  v: unknown
): { ok: true; probe: BrowserProbe | null } | { ok: false; error: string } {
  if (v === null) return { ok: true, probe: null };
  if (!v || typeof v !== "object" || Array.isArray(v))
    return { ok: false, error: "browser must be an object or null" };
  const o = v as Obj;
  const bad =
    check(o, "reachable", "boolean") ??
    check(o, "online", "boolean") ??
    check(o, "controlReachable", "boolean") ??
    check(o, "ms", "ms") ??
    check(o, "error", "text") ??
    (o.method === undefined ||
    METHODS.includes(o.method as BrowserProbe["method"])
      ? null
      : "method is not a known probe method") ??
    checkDns(o.dns, "dns") ??
    checkDns(o.dnsAlt, "dnsAlt");
  if (bad) return { ok: false, error: `browser.${bad}` };
  return { ok: true, probe: sanitizeProbe(o as Partial<BrowserProbe>) };
}
