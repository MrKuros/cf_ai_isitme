// Browser vantage: runs in the user's browser, never on the Worker.
import { dohLookup } from "../lib/probes";
import {
  BROWSER_UNTESTABLE,
  type BrowserEnv,
  type BrowserProbe
} from "../shared/types";

const CONTROL_URL = "https://www.cloudflare.com/cdn-cgi/trace";
/** 1.1.1.1 over IPv6 only: reachable means the browser has working IPv6 (N7). */
const IPV6_URL = "https://[2606:4700:4700::1111]/cdn-cgi/trace";

/** /cdn-cgi/trace body -> trace fields. No `fl=`/`colo=` line means something else answered (proxy, portal). */
export function parseTrace(body: string): {
  trace?: NonNullable<BrowserEnv["trace"]>;
  blocked: boolean;
} {
  const kv = new Map<string, string>();
  for (const line of body.split("\n")) {
    const i = line.indexOf("=");
    if (i > 0) kv.set(line.slice(0, i).trim(), line.slice(i + 1).trim());
  }
  if (!kv.has("fl") && !kv.has("colo")) return { blocked: true };
  const trace: NonNullable<BrowserEnv["trace"]> = {};
  for (const k of ["warp", "gateway", "loc"] as const) {
    const v = kv.get(k);
    if (v) trace[k] = v.slice(0, 64);
  }
  return { trace, blocked: false };
}

// ponytail: coarse country -> timezone-prefix map for the common cases; unknown countries never mismatch.
const COUNTRY_TZ: Record<string, string[]> = {
  US: ["America/", "Pacific/Honolulu"],
  CA: ["America/"],
  MX: ["America/"],
  BR: ["America/"],
  AR: ["America/"],
  GB: ["Europe/London"],
  IE: ["Europe/Dublin"],
  FR: ["Europe/Paris"],
  DE: ["Europe/Berlin", "Europe/Busingen"],
  NL: ["Europe/Amsterdam"],
  BE: ["Europe/Brussels"],
  ES: ["Europe/Madrid", "Atlantic/Canary", "Africa/Ceuta"],
  IT: ["Europe/Rome"],
  PT: ["Europe/Lisbon", "Atlantic/"],
  CH: ["Europe/Zurich"],
  AT: ["Europe/Vienna"],
  SE: ["Europe/Stockholm"],
  NO: ["Europe/Oslo"],
  DK: ["Europe/Copenhagen"],
  FI: ["Europe/Helsinki"],
  PL: ["Europe/Warsaw"],
  UA: ["Europe/Kiev", "Europe/Kyiv", "Europe/Simferopol"],
  RU: ["Europe/", "Asia/"],
  TR: ["Europe/Istanbul"],
  IL: ["Asia/Jerusalem", "Asia/Tel_Aviv"],
  AE: ["Asia/Dubai"],
  IN: ["Asia/Kolkata", "Asia/Calcutta"],
  CN: ["Asia/Shanghai", "Asia/Urumqi", "Asia/Chongqing"],
  HK: ["Asia/Hong_Kong"],
  TW: ["Asia/Taipei"],
  JP: ["Asia/Tokyo"],
  KR: ["Asia/Seoul"],
  SG: ["Asia/Singapore"],
  ID: ["Asia/Jakarta", "Asia/Makassar", "Asia/Jayapura", "Asia/Pontianak"],
  AU: ["Australia/"],
  NZ: ["Pacific/Auckland", "Pacific/Chatham"],
  ZA: ["Africa/Johannesburg"],
  NG: ["Africa/Lagos"],
  EG: ["Africa/Cairo"]
};

/** True only when both the country and the zone are known and disagree (VPN hint, N4). */
export function tzMismatch(
  loc: string | undefined,
  timeZone: string | undefined
): boolean | undefined {
  const zones = loc ? COUNTRY_TZ[loc.toUpperCase()] : undefined;
  if (!zones || !timeZone || !timeZone.includes("/")) return undefined;
  return zones.some((z) => timeZone.startsWith(z)) ? undefined : true;
}

/** Never throws. Same-origin trace (404 in local dev = unknown), timezone, IPv6 capability. */
export async function collectEnv(): Promise<BrowserEnv> {
  let timeZone: string | undefined;
  try {
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    // unknown
  }
  const trace = async (): Promise<ReturnType<typeof parseTrace> | null> => {
    // ponytail: the local dev server answers /cdn-cgi/trace with the SPA page, so skip it off-edge.
    if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) {
      return null;
    }
    try {
      const res = await fetch("/cdn-cgi/trace", {
        cache: "no-store",
        signal: AbortSignal.timeout(3000)
      });
      return res.ok ? parseTrace((await res.text()).slice(0, 4096)) : null;
    } catch {
      return null;
    }
  };
  const [t, v6] = await Promise.all([trace(), noCorsFetch(IPV6_URL, 3000)]);
  const env: BrowserEnv = { timeZone, ipv6: v6.ok };
  if (t?.blocked) env.traceBlocked = true;
  if (t?.trace) {
    env.trace = t.trace;
    const mismatch = tzMismatch(t.trace.loc, timeZone);
    if (mismatch) env.tzMismatch = true;
  }
  return env;
}

interface Timed {
  ok: boolean;
  ms: number;
  error?: string;
}

function errorText(e: unknown): string {
  if (
    e instanceof DOMException &&
    (e.name === "TimeoutError" || e.name === "AbortError")
  ) {
    return "timed out";
  }
  return e instanceof Error ? e.message : String(e);
}

/** An opaque no-cors response resolves; network, TLS, DNS and mixed-content failures reject. */
async function noCorsFetch(url: string, timeoutMs: number): Promise<Timed> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const start = performance.now();
  try {
    await fetch(url, {
      mode: "no-cors",
      cache: "no-store",
      signal: ctrl.signal
    });
    return { ok: true, ms: Math.round(performance.now() - start) };
  } catch (e) {
    return {
      ok: false,
      ms: Math.round(performance.now() - start),
      error: errorText(e)
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Only `onload` proves reachability: `onerror` fires for a 404 and a dead host alike. */
function imageProbe(src: string, timeoutMs: number): Promise<Timed> {
  return new Promise((resolve) => {
    const img = new Image();
    const start = performance.now();
    const done = (ok: boolean, error?: string) => {
      clearTimeout(timer);
      img.onload = img.onerror = null;
      resolve({ ok, ms: Math.round(performance.now() - start), error });
    };
    const timer = setTimeout(() => {
      img.src = "";
      done(false, "timed out");
    }, timeoutMs);
    img.onload = () => done(true);
    img.onerror = () => done(false, "image failed to load");
    img.src = src;
  });
}

/** Never throws. Reachability + timing only: a no-cors fetch cannot see status codes. */
export async function runBrowserProbe(
  url: string,
  opts?: { timeoutMs?: number }
): Promise<BrowserProbe> {
  const timeoutMs = opts?.timeoutMs ?? 8000;
  const at = Date.now();
  const online = typeof navigator === "undefined" ? true : navigator.onLine;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return {
      at,
      reachable: false,
      method: "none",
      error: "invalid URL",
      online,
      controlReachable: false,
      dns: null
    };
  }
  // An https page can't load http:// (blocked or auto-upgraded): a false "unreachable", so report "can't test".
  if (
    typeof location !== "undefined" &&
    location.protocol === "https:" &&
    parsed.protocol === "http:"
  ) {
    return {
      at,
      reachable: false,
      method: "none",
      error: BROWSER_UNTESTABLE,
      online,
      controlReachable: true,
      dns: null
    };
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, "");
  const isIp = /^[\d.]+$/.test(host) || host.includes(":");

  const target = async (): Promise<
    Timed & { method: BrowserProbe["method"] }
  > => {
    const f = await noCorsFetch(parsed.href, timeoutMs);
    if (f.ok) return { ...f, method: "fetch-no-cors" };
    const img = await imageProbe(
      `${parsed.origin}/favicon.ico?${Date.now()}`,
      Math.min(timeoutMs, 5000)
    );
    return img.ok ? { ...img, method: "image" } : { ...f, method: "none" };
  };

  try {
    const doh = (resolver: "cloudflare" | "google") =>
      isIp
        ? Promise.resolve(null)
        : dohLookup(host, { timeoutMs, resolver }).catch(() => null);
    const [main, control, dns, dnsAlt, env] = await Promise.all([
      target(),
      noCorsFetch(CONTROL_URL, timeoutMs),
      doh("cloudflare"),
      doh("google"),
      collectEnv()
    ]);
    return {
      at,
      reachable: main.ok,
      method: main.method,
      ms: main.ms,
      error: main.ok ? undefined : main.error,
      online,
      controlReachable: control.ok,
      dns,
      dnsAlt,
      env
    };
  } catch (e) {
    return {
      at,
      reachable: false,
      method: "none",
      error: errorText(e),
      online,
      controlReachable: false,
      dns: null
    };
  }
}
