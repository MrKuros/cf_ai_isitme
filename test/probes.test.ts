import { afterEach, describe, expect, it, vi } from "vitest";
import {
  detectBlock,
  dohLookup,
  guardUrl,
  httpProbe,
  pageFlags
} from "../src/lib/probes";

type Handler = (
  url: string,
  init?: RequestInit
) => Response | Promise<Response>;

function mockFetch(handler: Handler) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
    handler(String(input), init)
  );
  vi.stubGlobal("fetch", fn);
  return fn;
}

const timeout = () => {
  throw new DOMException("t", "TimeoutError");
};
const refusedConn = () => {
  throw new TypeError("fetch failed: connection refused");
};
const res = (status: number, body = "", headers: Record<string, string> = {}) =>
  new Response(status === 204 || status === 304 ? null : body, {
    status,
    headers
  });
const page = (text: string) =>
  `<html><head><title>Home</title></head><body><p>${text}</p></body></html>`;
const normal = page("Welcome to our store. ".repeat(1400));

afterEach(() => vi.unstubAllGlobals());

describe("R1 bot protection is not an outage", () => {
  it("a: cloudflare 503 'Just a moment...' -> blocked challenge, ok", async () => {
    mockFetch(() =>
      res(503, "<title>Just a moment...</title>", { server: "cloudflare" })
    );
    const r = await httpProbe("https://example.com/");
    expect(r).toMatchObject({
      ok: true,
      status: 503,
      errorClass: "blocked",
      blocked: "challenge",
      server: "cloudflare"
    });
  });

  it("b: 403 with cf-mitigated: challenge", async () => {
    mockFetch(() => res(403, "", { "cf-mitigated": "challenge" }));
    const r = await httpProbe("https://example.com/");
    expect(r).toMatchObject({ ok: true, blocked: "challenge" });
  });

  it("c: plain nginx 503 -> down", async () => {
    mockFetch(() => res(503, "Service Unavailable", { server: "nginx" }));
    const r = await httpProbe("https://example.com/");
    expect(r).toMatchObject({ ok: false, errorClass: "http_5xx" });
    expect(r.blocked).toBeUndefined();
  });

  it("d: 429 -> rate_limit", async () => {
    mockFetch(() => res(429));
    expect(await httpProbe("https://example.com/")).toMatchObject({
      ok: true,
      blocked: "rate_limit"
    });
  });

  it("detectBlock: akamai, datadome, 451, plain 403", () => {
    const h = (o: Record<string, string>) => new Headers(o);
    expect(
      detectBlock(403, h({ server: "AkamaiGHost" }), "Access Denied")
    ).toBe("waf");
    expect(detectBlock(403, h({ "x-datadome": "1" }), "")).toBe("waf");
    expect(detectBlock(451, h({}), "")).toBe("geo");
    expect(
      detectBlock(403, h({ server: "nginx" }), "Forbidden")
    ).toBeUndefined();
  });
});

describe("R2 slow is not dead", () => {
  it("a: timeout then 200 -> ok, retried", async () => {
    let n = 0;
    mockFetch(() => (n++ === 0 ? timeout() : res(200, normal)));
    const r = await httpProbe("https://example.com/");
    expect(r).toMatchObject({ ok: true, status: 200, retried: true });
    expect(n).toBe(2);
  });

  it("b: both time out -> failed timeout", async () => {
    const f = mockFetch(timeout);
    const r = await httpProbe("https://example.com/");
    expect(r).toMatchObject({
      ok: false,
      errorClass: "timeout",
      retried: true
    });
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("no retry on 5xx or when disabled", async () => {
    const f = mockFetch(() => res(500));
    await httpProbe("https://example.com/");
    expect(f).toHaveBeenCalledTimes(1);
    const g = mockFetch(timeout);
    await httpProbe("https://example.com/", { retryTimeoutMs: 0 });
    expect(g).toHaveBeenCalledTimes(1);
  });
});

describe("R3 TLS and synthetic Cloudflare codes", () => {
  it("a: 526 -> tls", async () => {
    mockFetch(() => res(526));
    expect(await httpProbe("https://example.com/")).toMatchObject({
      ok: false,
      errorClass: "tls"
    });
  });

  it("530 -> dns", async () => {
    mockFetch(() => res(530));
    expect(await httpProbe("https://example.com/")).toMatchObject({
      ok: false,
      errorClass: "dns"
    });
  });

  it("c: 522 with cf-ray -> http_5xx, cdnOrigin", async () => {
    mockFetch(() => res(522, "", { "cf-ray": "8abc-FRA" }));
    expect(await httpProbe("https://example.com/")).toMatchObject({
      ok: false,
      errorClass: "http_5xx",
      cdnOrigin: true,
      cfRay: "8abc-FRA"
    });
  });

  it("thrown certificate error -> tls", async () => {
    mockFetch(() => {
      throw new Error("certificate has expired");
    });
    expect(await httpProbe("https://example.com/")).toMatchObject({
      ok: false,
      errorClass: "tls"
    });
  });
});

describe("R4 200 but broken", () => {
  it("40-byte body -> empty", () => {
    expect(pageFlags("<html><body>hi</body></html>".padEnd(40)).flags).toEqual({
      empty: true
    });
  });

  it("small real page (example.com) -> not empty", () => {
    const body = `<!doctype html><html><head><title>Example Domain</title></head><body><div><h1>Example Domain</h1><p>This domain is for use in documentation examples without needing permission. Avoid use in operations.</p><p><a href="https://iana.org/domains/example">Learn more</a></p></div></body></html>`;
    expect(pageFlags(body).flags).toEqual({});
  });

  it("<title>502 Bad Gateway</title> -> errorPage", () => {
    const p = pageFlags(
      page("x".repeat(600)).replace("Home", "502 Bad Gateway")
    );
    expect(p.title).toBe("502 Bad Gateway");
    expect(p.flags.errorPage).toBe(true);
  });

  it("normal 30 KB page -> no flags", () => {
    const p = pageFlags(normal);
    expect(p.bytes).toBeGreaterThan(30_000);
    expect(p.flags).toEqual({});
  });

  it("expect 'Sign in' missing -> expectMissing", () => {
    expect(pageFlags(normal, "Sign in").flags).toEqual({ expectMissing: true });
    expect(pageFlags(normal, "welcome TO").flags).toEqual({});
  });

  it("Vite SPA shell (script + #root) -> no flags", () => {
    const vite = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/vite.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Vite + React + TS</title>
    <script type="module" crossorigin src="/assets/index-abc123.js"></script>
    <link rel="stylesheet" crossorigin href="/assets/index-def456.css">
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>`;
    expect(pageFlags(vite).flags).toEqual({});
  });

  it("errorPage needs a whole word: 'Terror Films' no, '404 Not Found' yes", () => {
    const films = page("x".repeat(600)).replace("Home", "Terror Films");
    expect(pageFlags(films).flags).toEqual({});
    expect(
      pageFlags(page("Order 14045 shipped, error-free since 2404")).flags
        .errorPage
    ).toBeUndefined();
    expect(
      pageFlags(page("x".repeat(600)).replace("Home", "404 Not Found")).flags
        .errorPage
    ).toBe(true);
  });

  it("parked domain", () => {
    expect(
      pageFlags(page("This domain is for sale! " + "x".repeat(600))).flags
        .parked
    ).toBe(true);
  });

  it("httpProbe reads 2xx html, caps at 64 KB", async () => {
    mockFetch(() =>
      res(200, "a".repeat(100_000), { "content-type": "text/html" })
    );
    const r = await httpProbe("https://example.com/");
    expect(r.bytes).toBe(65536);
    const s = mockFetch(() =>
      res(200, "", { "content-type": "application/json" })
    );
    const j = await httpProbe("https://example.com/");
    expect(j.flags).toBeUndefined();
    expect(s).toHaveBeenCalledTimes(1);
  });
});

describe("R5 redirects", () => {
  it("a: 301 -> 200: ok with a 2-hop chain", async () => {
    mockFetch((url) =>
      url === "https://example.com/"
        ? res(301, "", { location: "/home" })
        : res(200, normal)
    );
    const r = await httpProbe("https://example.com/");
    expect(r).toMatchObject({ ok: true, status: 200 });
    expect(r.chain).toEqual([
      { url: "https://example.com/", status: 301 },
      { url: "https://example.com/home", status: 200 }
    ]);
  });

  it("b: 301 -> dead host -> failed", async () => {
    mockFetch((url) =>
      url === "https://example.com/"
        ? res(301, "", { location: "https://dead.example.net/" })
        : refusedConn()
    );
    const r = await httpProbe("https://example.com/");
    expect(r).toMatchObject({ ok: false, errorClass: "connect" });
  });

  it("c: 302 to metadata IP is refused, never fetched", async () => {
    const f = mockFetch(() =>
      res(302, "", { location: "http://169.254.169.254/" })
    );
    const r = await httpProbe("https://example.com/", { hopGuard: guardUrl });
    expect(r.ok).toBe(false);
    expect(r.refused).toMatch(/^169\.254\.169\.254: /);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it.each([307, 308])("d: %i is followed", async (status) => {
    const f = mockFetch((url) =>
      url.endsWith("/a")
        ? res(status, "", { location: "/b" })
        : res(200, normal)
    );
    const r = await httpProbe("https://example.com/a");
    expect(r).toMatchObject({ ok: true, status: 200 });
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("stops after maxRedirects: failed, reports where it pointed", async () => {
    let n = 0;
    const f = mockFetch(() => res(302, "", { location: `/r${++n}` }));
    const r = await httpProbe("https://example.com/", { maxRedirects: 2 });
    expect(f).toHaveBeenCalledTimes(3);
    expect(r).toMatchObject({
      ok: false,
      status: 302,
      error: "redirect loop",
      redirectedTo: "https://example.com/r3"
    });
  });

  it("A -> B -> A loop fails instead of reading as healthy", async () => {
    const f = mockFetch((url) =>
      res(302, "", { location: url.endsWith("/a") ? "/b" : "/a" })
    );
    const r = await httpProbe("https://example.com/a");
    expect(f).toHaveBeenCalledTimes(2);
    expect(r).toMatchObject({
      ok: false,
      errorClass: "unknown",
      error: "redirect loop"
    });
  });

  it("sends the UA and x-isitme-check header, GET only", async () => {
    const f = mockFetch(() => res(204));
    await httpProbe("https://example.com/", { checkId: "run-1" });
    const init = f.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(init.method).toBe("GET");
    expect(init.redirect).toBe("manual");
    expect(headers["x-isitme-check"]).toBe("run-1");
    expect(headers["user-agent"]).toMatch(/^IsItMe\//);
  });
});

describe("R11 dual resolvers and DNSSEC", () => {
  const doh = (Status: number, Answer: unknown[] = []) =>
    new Response(JSON.stringify({ Status, AD: false, Answer }));

  it("uses dns.google when resolver is google", async () => {
    const f = mockFetch(() =>
      doh(0, [{ name: "example.com", type: 1, TTL: 60, data: "93.184.216.34" }])
    );
    const r = await dohLookup("example.com", { resolver: "google" });
    expect(r).toMatchObject({
      ok: true,
      resolver: "google",
      addresses: ["93.184.216.34"]
    });
    for (const [u] of f.mock.calls)
      expect(String(u)).toMatch(/^https:\/\/dns\.google\/resolve\?name=/);
  });

  it("SERVFAIL, then NOERROR with cd=1 -> dnssecFailed", async () => {
    const f = mockFetch((url) => (url.includes("cd=1") ? doh(0) : doh(2)));
    const r = await dohLookup("dnssec-failed.org");
    expect(r).toMatchObject({
      ok: false,
      rcode: 2,
      dnssecFailed: true,
      resolver: "cloudflare",
      error: "SERVFAIL (DNSSEC validation failed)"
    });
    expect(f).toHaveBeenCalledTimes(3);
  });

  it("plain SERVFAIL stays SERVFAIL", async () => {
    mockFetch(() => doh(2));
    const r = await dohLookup("broken.example");
    expect(r.dnssecFailed).toBeUndefined();
    expect(r.error).toBe("SERVFAIL");
  });

  it("lookup failure -> rcode -1, never throws", async () => {
    mockFetch(timeout);
    expect(await dohLookup("example.com")).toMatchObject({
      ok: false,
      rcode: -1
    });
  });
});
