// Runtime-agnostic (fetch + performance only): imported by the Worker AND the browser.
import type {
  BlockKind,
  DnsResult,
  PageFlags,
  ProbeErrorClass,
  ProbeResult,
  RedirectHop
} from "../shared/types";
import { assertSafeTarget, normalizeTarget } from "./guard";

export interface HttpProbeOptions {
  /** Default 8000. */
  timeoutMs?: number;
  /** Retry timeout after a timeout/connect failure. Default 15000, 0 disables. */
  retryTimeoutMs?: number;
  /** Default 5. */
  maxRedirects?: number;
  /** Checked before every redirect hop: null = safe, string = refusal reason. */
  hopGuard?: (url: string) => Promise<string | null>;
  /** Text that must appear in the first 64 KB of a 2xx HTML body. */
  expect?: string;
  /** Sent as `x-isitme-check`. */
  checkId?: string;
}

export interface DohOptions {
  timeoutMs?: number;
  /** Default "cloudflare". */
  resolver?: "cloudflare" | "google";
  /** Re-query with cd=1 on SERVFAIL. Default true. */
  checkDnssec?: boolean;
}

const DOH = {
  cloudflare: "https://cloudflare-dns.com/dns-query",
  google: "https://dns.google/resolve"
};
const TRACE = "https://www.cloudflare.com/cdn-cgi/trace";
const USER_AGENT = "IsItMe/1.0 (+https://github.com/MrKuros/isitme)";
const MAX_BODY = 65536;
const PROVIDER_HEADERS = [
  "x-amz-cf-id",
  "x-served-by",
  "x-fastly-request-id",
  "x-azure-ref",
  "x-vercel-id",
  "x-nf-request-id",
  "x-github-request-id"
];
const RCODES: Record<number, string> = {
  1: "FORMERR",
  2: "SERVFAIL",
  3: "NXDOMAIN",
  5: "REFUSED"
};

interface DohAnswer {
  name: string;
  type: number;
  TTL: number;
  data: string;
}
interface DohResponse {
  Status: number;
  AD?: boolean;
  Answer?: DohAnswer[];
}

const elapsed = (start: number) => Math.round(performance.now() - start);

function errorMessage(e: unknown): string {
  if (e instanceof Error) {
    if (e.name === "TimeoutError" || e.name === "AbortError")
      return "timed out";
    return e.message.slice(0, 200);
  }
  return String(e).slice(0, 200);
}

async function dohQuery(
  base: string,
  host: string,
  type: "A" | "AAAA",
  timeoutMs: number,
  cd = false
): Promise<DohResponse> {
  const res = await fetch(
    `${base}?name=${encodeURIComponent(host)}&type=${type}${cd ? "&cd=1" : ""}`,
    {
      headers: { accept: "application/dns-json" },
      signal: AbortSignal.timeout(timeoutMs)
    }
  );
  if (!res.ok) throw new Error(`DoH HTTP ${res.status}`);
  return res.json();
}

/** A + AAAA via Cloudflare or Google DoH (JSON). Never throws. */
export async function dohLookup(
  host: string,
  opts?: DohOptions
): Promise<DnsResult> {
  const start = performance.now();
  const timeoutMs = opts?.timeoutMs ?? 5000;
  const resolver = opts?.resolver ?? "cloudflare";
  const base = DOH[resolver];
  const [a, aaaa] = await Promise.allSettled([
    dohQuery(base, host, "A", timeoutMs),
    dohQuery(base, host, "AAAA", timeoutMs)
  ]);
  const primary =
    a.status === "fulfilled"
      ? a.value
      : aaaa.status === "fulfilled"
        ? aaaa.value
        : null;
  if (!primary) {
    return {
      ok: false,
      rcode: -1,
      addresses: [],
      cnames: [],
      ad: false,
      ms: elapsed(start),
      error: `DNS lookup failed: ${errorMessage((a as PromiseRejectedResult).reason)}`,
      resolver
    };
  }

  const answers = [a, aaaa].flatMap((r) =>
    r.status === "fulfilled" ? (r.value.Answer ?? []) : []
  );
  const addresses = [
    ...new Set(
      answers.filter((x) => x.type === 1 || x.type === 28).map((x) => x.data)
    )
  ];
  const cnames = [
    ...new Set(
      answers.filter((x) => x.type === 5).map((x) => x.data.replace(/\.$/, ""))
    )
  ];
  const rcode = primary.Status;
  // SERVFAIL that resolves with checking disabled = the zone's DNSSEC is broken, not the zone.
  let dnssecFailed = false;
  if (rcode === 2 && (opts?.checkDnssec ?? true)) {
    dnssecFailed = await dohQuery(base, host, "A", timeoutMs, true).then(
      (r) => r.Status === 0,
      () => false
    );
  }
  const ok = rcode === 0 && addresses.length > 0;
  let error: string | undefined;
  if (dnssecFailed) error = "SERVFAIL (DNSSEC validation failed)";
  else if (rcode !== 0) error = RCODES[rcode] ?? `rcode ${rcode}`;
  else if (!addresses.length) error = "no A/AAAA records";
  return {
    ok,
    rcode,
    addresses,
    cnames,
    ad: primary.AD === true,
    ms: elapsed(start),
    ...(error && { error }),
    resolver,
    ...(dnssecFailed && { dnssecFailed })
  };
}

function errorClass(e: unknown): ProbeErrorClass {
  if (
    e instanceof Error &&
    (e.name === "TimeoutError" || e.name === "AbortError")
  )
    return "timeout";
  // Node/undici hides the real reason in `cause`.
  const cause =
    e instanceof Error
      ? (e.cause as { message?: string; code?: string } | undefined)
      : undefined;
  const msg =
    e instanceof Error
      ? `${e.message} ${cause?.code ?? ""} ${cause?.message ?? ""}`
      : String(e);
  if (/tls|ssl|certificate|cert_|handshake/i.test(msg)) return "tls";
  if (/dns|resolve|getaddrinfo|enotfound|name not/i.test(msg)) return "dns";
  if (/refused|reset|econn|connect|unreachable|network|socket/i.test(msg))
    return "connect";
  return "unknown";
}

/** First 64 KB of the body, then cancel. A read that dies midway keeps what arrived. */
async function readBody(res: Response): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const buf = new Uint8Array(MAX_BODY);
  let n = 0;
  try {
    while (n < MAX_BODY) {
      const { done, value } = await reader.read();
      if (done) break;
      const take = value.subarray(0, MAX_BODY - n);
      buf.set(take, n);
      n += take.length;
    }
  } catch {
    // partial body is still evidence
  } finally {
    reader.cancel().catch(() => {});
  }
  return new TextDecoder().decode(buf.subarray(0, n));
}

const fail = (
  r: ProbeResult,
  errorClass: ProbeErrorClass,
  error: string
): ProbeResult => ({ ...r, ok: false, errorClass, error });

/** Maps the final hop's response to a result (R1, R3, R4). */
async function finalHop(
  res: Response,
  url: string,
  ms: number,
  chain: RedirectHop[],
  expect?: string
): Promise<ProbeResult> {
  const status = res.status;
  let r: ProbeResult = { ok: true, status, ms };
  const server = res.headers.get("server");
  const cfRay = res.headers.get("cf-ray");
  if (server) r.server = server.slice(0, 60);
  if (cfRay) r.cfRay = cfRay.slice(0, 40);
  const providerHeaders = PROVIDER_HEADERS.filter((h) => res.headers.has(h));
  if (providerHeaders.length) r.providerHeaders = providerHeaders;
  if (chain.length) r.chain = [...chain, { url: url.slice(0, 500), status }];
  const location = res.headers.get("location");
  if (status >= 300 && status < 400 && location) {
    r.redirectedTo = URL.canParse(location, url)
      ? new URL(location, url).toString().slice(0, 500)
      : location.slice(0, 500);
  }

  let read = false;
  if (status === 525 || status === 526) r = fail(r, "tls", `HTTP ${status}`);
  else if (status === 530) r = fail(r, "dns", `HTTP ${status}`);
  else if (status >= 520 && status <= 524) {
    r = fail(r, "http_5xx", `HTTP ${status}`);
    if (cfRay) r.cdnOrigin = true;
  } else if ([403, 429, 451, 503].includes(status)) {
    read = true;
    const blocked = detectBlock(status, res.headers, await readBody(res));
    if (blocked) {
      r.errorClass = "blocked";
      r.blocked = blocked;
    } else if (status >= 500) r = fail(r, "http_5xx", `HTTP ${status}`);
  } else if (status >= 500) r = fail(r, "http_5xx", `HTTP ${status}`);
  else if (status >= 200 && status < 300) {
    const type = res.headers.get("content-type");
    if (!type || /text\/html/i.test(type)) {
      read = true;
      const p = pageFlags(await readBody(res), expect);
      r.bytes = p.bytes;
      if (p.title) r.title = p.title;
      if (Object.keys(p.flags).length) r.flags = p.flags;
    }
  }
  if (!read) res.body?.cancel().catch(() => {});
  return r;
}

async function probeOnce(
  url: string,
  opts: HttpProbeOptions,
  timeoutMs: number
): Promise<ProbeResult> {
  const start = performance.now();
  const signal = AbortSignal.timeout(timeoutMs);
  const headers: Record<string, string> = { "user-agent": USER_AGENT };
  if (opts.checkId) headers["x-isitme-check"] = opts.checkId;
  const maxRedirects = opts.maxRedirects ?? 5;
  const chain: RedirectHop[] = [];
  let current = url;
  try {
    for (;;) {
      const res = await fetch(current, {
        method: "GET",
        redirect: "manual",
        headers,
        signal
      });
      const ms = elapsed(start);
      const loc = res.headers.get("location");
      if (
        res.status < 300 ||
        res.status >= 400 ||
        !loc ||
        !URL.canParse(loc, current)
      )
        return await finalHop(res, current, ms, chain, opts.expect);

      res.body?.cancel().catch(() => {});
      chain.push({ url: current.slice(0, 500), status: res.status });
      const next = new URL(loc, current).toString();
      // R5: a loop or an endless chain fails in every browser (ERR_TOO_MANY_REDIRECTS)
      if (chain.length > maxRedirects || chain.some((h) => h.url === next))
        return {
          ok: false,
          status: res.status,
          ms,
          errorClass: "unknown",
          error: "redirect loop",
          redirectedTo: next.slice(0, 500),
          chain
        };
      const refused = await opts.hopGuard?.(next);
      if (refused)
        return {
          ok: false,
          ms,
          errorClass: "unknown",
          error: "redirect refused by SSRF guard",
          refused: `${new URL(next).host}: ${refused}`.slice(0, 300),
          chain
        };
      current = next;
    }
  } catch (e) {
    return {
      ok: false,
      ms: elapsed(start),
      error: errorMessage(e),
      errorClass: errorClass(e),
      ...(chain.length && { chain })
    };
  }
}

/**
 * GET with manual, re-guarded redirects, a 64 KB body sniff, and one retry on timeout/connect.
 * Never throws.
 */
export async function httpProbe(
  url: string,
  opts: HttpProbeOptions = {}
): Promise<ProbeResult> {
  const first = await probeOnce(url, opts, opts.timeoutMs ?? 8000);
  const retryMs = opts.retryTimeoutMs ?? 15000;
  if (
    retryMs > 0 &&
    (first.errorClass === "timeout" || first.errorClass === "connect")
  )
    return { ...(await probeOnce(url, opts, retryMs)), retried: true };
  return first;
}

/** `colo=` from https://www.cloudflare.com/cdn-cgi/trace; undefined on failure. */
export async function egressColo(): Promise<string | undefined> {
  try {
    const res = await fetch(TRACE, { signal: AbortSignal.timeout(5000) });
    return (await res.text()).match(/^colo=(\w+)$/m)?.[1];
  } catch {
    return undefined;
  }
}

/** normalizeTarget + DoH + assertSafeTarget for a redirect hop: null when safe, else why not. */
export async function guardUrl(url: string): Promise<string | null> {
  const t = normalizeTarget(url);
  if ("error" in t) return t.error;
  let resolved: string[] = [];
  if (!t.isIpLiteral) {
    // ponytail: DNS rebinding between this lookup and the fetch is not handled
    const dns = await dohLookup(t.host);
    if (!dns.ok) return `${t.host} does not resolve`;
    resolved = dns.addresses;
  }
  try {
    assertSafeTarget(t, resolved);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

const ERROR_TEXT =
  /\b(404|not found|error|service unavailable|bad gateway|maintenance)\b(?!-)/i;
const PARKED_TEXT = /domain (is )?for sale|parked|sedoparking|godaddy.*parked/i;

/** Bot protection that answered instead of the site (R1). */
export function detectBlock(
  status: number,
  headers: Headers,
  body: string
): BlockKind | undefined {
  const server = (headers.get("server") ?? "").toLowerCase();
  if (headers.get("cf-mitigated")?.trim().toLowerCase() === "challenge")
    return "challenge";
  if (
    server.includes("cloudflare") &&
    (status === 403 || status === 503) &&
    /Just a moment|cf-chl|challenge-platform/.test(body)
  )
    return "challenge";
  if (
    server.includes("akamaighost") &&
    status === 403 &&
    /Access Denied/.test(body)
  )
    return "waf";
  if (status === 403 && (headers.has("x-datadome") || headers.has("x-dd-b")))
    return "waf";
  if (status === 429) return "rate_limit";
  if (status === 451) return "geo";
  return undefined;
}

/** "200 but broken" sniffing of the first 64 KB of an HTML body (R4). */
export function pageFlags(
  body: string,
  expect?: string
): { title?: string; bytes: number; flags: PageFlags } {
  const bytes = new TextEncoder().encode(body).length;
  const title =
    body
      .match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
      ?.replace(/\s+/g, " ")
      .trim()
      .slice(0, 120) || undefined;
  const visible = body
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const flags: PageFlags = {};
  // ponytail: spec says <512 B non-whitespace, but that flags small real pages
  // (example.com is 559 B); require both a tiny body and almost no visible text.
  // A body that loads a script or has a mount node is an SPA shell, not empty.
  if (
    body.replace(/\s+/g, "").length < 512 &&
    visible.replace(/ /g, "").length < 64 &&
    !/<script[^>]+src=/i.test(body) &&
    !/<div[^>]+id=["']?(root|app|__next|__nuxt|svelte)\b/i.test(body)
  )
    flags.empty = true;
  const h1 = body.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  if (
    (title && ERROR_TEXT.test(title)) ||
    (visible.length < 2048 &&
      (ERROR_TEXT.test(visible.slice(0, 200)) ||
        (h1 !== undefined && ERROR_TEXT.test(h1))))
  )
    flags.errorPage = true;
  if (PARKED_TEXT.test(`${title ?? ""} ${visible.slice(0, 4096)}`))
    flags.parked = true;
  if (expect && !body.toLowerCase().includes(expect.toLowerCase()))
    flags.expectMissing = true;
  return { ...(title && { title }), bytes, flags };
}
