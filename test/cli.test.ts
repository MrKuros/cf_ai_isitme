import { afterEach, describe, expect, it, vi } from "vitest";
// @ts-expect-error bin/isitme.mjs is plain Node ESM; allowJs is off for the Worker build.
import * as cli from "../bin/isitme.mjs";

const parse = (args: string[], env: Record<string, string> = {}) =>
  cli.parseCliArgs(args, env);

describe("parseCliArgs", () => {
  it("takes one positional target and the defaults", () => {
    expect(parse(["github.com"])).toEqual({
      target: "github.com",
      expect: undefined,
      api: cli.DEFAULT_API,
      json: false,
      timeoutMs: 125_000
    });
  });

  it("--help and --version win over everything", () => {
    expect(parse(["--help"])).toEqual({ help: true });
    expect(parse(["-v", "github.com"])).toEqual({ version: true });
  });

  it("reads every flag", () => {
    expect(
      parse([
        "example.com",
        "--json",
        "--expect",
        "Sign in",
        "--api",
        "http://localhost:5173/",
        "--timeout",
        "7.5"
      ])
    ).toEqual({
      target: "example.com",
      expect: "Sign in",
      api: "http://localhost:5173",
      json: true,
      timeoutMs: 7500
    });
  });

  it("falls back to $ISITME_API, and --api beats it", () => {
    expect(parse(["a.com"], { ISITME_API: "https://x.test" }).api).toBe(
      "https://x.test"
    );
    expect(
      parse(["a.com", "--api", "https://y.test"], {
        ISITME_API: "https://x.test"
      }).api
    ).toBe("https://y.test");
  });

  it("rejects bad input instead of throwing", () => {
    expect(parse([]).error).toMatch(/no target/);
    expect(parse(["a.com", "b.com"]).error).toMatch(/one target/);
    expect(parse(["a.com", "--nope"]).error).toBeTruthy();
    expect(parse(["a.com", "--timeout", "0"]).error).toMatch(/positive/);
    expect(parse(["a.com", "--timeout", "soon"]).error).toMatch(/positive/);
    expect(parse(["a.com", "--api", "ftp://x"]).error).toMatch(/http/);
    expect(parse(["a.com", "--expect", ""]).error).toMatch(/empty/);
  });
});

describe("checkUrl", () => {
  it("builds the v1 check URL and escapes the target", () => {
    expect(cli.checkUrl("https://x.test", "https://a.com/a b")).toBe(
      "https://x.test/api/v1/check?url=https%3A%2F%2Fa.com%2Fa+b"
    );
  });

  it("adds expect only when set, and tolerates a trailing slash", () => {
    expect(cli.checkUrl("https://x.test/", "a.com", "Sign in")).toBe(
      "https://x.test/api/v1/check?url=a.com&expect=Sign+in"
    );
  });
});

describe("exitCode", () => {
  const codes = (verdicts: string[]) =>
    verdicts.map((verdict) => cli.exitCode({ ok: true, verdict }));

  it("0 only for HEALTHY and SLOW", () => {
    expect(codes(["HEALTHY", "SLOW"])).toEqual([0, 0]);
    expect(
      codes(["DOWN_GLOBAL", "BLOCKED", "PARTIAL", "INCONCLUSIVE"])
    ).toEqual([1, 1, 1, 1]);
  });

  it("1 for an error outcome", () => {
    expect(cli.exitCode({ ok: false, error: "rate limited" })).toBe(1);
  });
});

describe("formatOutcome", () => {
  const outcome = {
    ok: true,
    runId: "r1",
    host: "example.com",
    verdict: "DOWN_GLOBAL",
    subtype: "origin",
    confidence: 0.92,
    signals: ["5/6 vantages failed", "Cloudflare answered 521"],
    provider: "Fastly",
    explanation: "The site's origin is refusing connections.",
    reportPath: "/r/example.com/abc"
  };

  it("prints verdict, subtype, confidence, signals, provider and report URL", () => {
    const text = cli.formatOutcome(outcome, { api: "https://x.test/" });
    expect(text).toContain("DOWN_GLOBAL/origin  example.com  (confidence 92%)");
    expect(text).toContain("  - 5/6 vantages failed");
    expect(text).toContain("  - served by Fastly");
    expect(text).toContain("The site's origin is refusing connections.");
    expect(text).toContain("report: https://x.test/r/example.com/abc");
  });

  it("colours only when asked", () => {
    expect(cli.formatOutcome(outcome, { color: false })).not.toContain("\x1b[");
    expect(cli.formatOutcome(outcome, { color: true })).toContain("\x1b[31m");
    expect(
      cli.formatOutcome(
        { ...outcome, verdict: "HEALTHY", subtype: undefined },
        { color: true }
      )
    ).toContain("\x1b[32m");
    expect(
      cli.formatOutcome(
        { ...outcome, verdict: "SLOW", subtype: undefined },
        { color: true }
      )
    ).toContain("\x1b[33m");
  });

  it("survives a minimal outcome", () => {
    expect(
      cli.formatOutcome({ ok: true, host: "a.com", verdict: "INCONCLUSIVE" })
    ).toBe("INCONCLUSIVE  a.com  (confidence 0%)");
  });

  it("renders an error outcome", () => {
    expect(
      cli.formatOutcome({ ok: false, error: "rate limited", host: "a.com" })
    ).toBe("error: rate limited (a.com)");
  });
});

describe("runCheck (fetch stubbed, no network)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const stub = (impl: () => Promise<Response> | never) =>
    vi.stubGlobal("fetch", vi.fn(impl));
  const args = { api: "https://x.test", target: "a.com", timeoutMs: 1000 };

  it("returns the parsed CheckOutcome", async () => {
    stub(
      async () => new Response(JSON.stringify({ ok: true, verdict: "HEALTHY" }))
    );
    expect(await cli.runCheck(args)).toEqual({ ok: true, verdict: "HEALTHY" });
  });

  it("turns a non-JSON body into an error outcome", async () => {
    stub(
      async () => new Response("<html>502 Bad Gateway</html>", { status: 502 })
    );
    expect(await cli.runCheck(args)).toEqual({
      ok: false,
      error: "https://x.test returned HTTP 502 and a non-JSON body"
    });
  });

  it("rejects JSON that isn't a CheckOutcome", async () => {
    stub(async () => new Response("[1,2]", { status: 200 }));
    expect((await cli.runCheck(args)).error).toMatch(/unexpected body/);
  });

  it("turns a network failure into an error outcome", async () => {
    stub(() => {
      throw Object.assign(new Error("getaddrinfo ENOTFOUND x.test"), {
        name: "TypeError"
      });
    });
    expect((await cli.runCheck(args)).error).toMatch(
      /cannot reach https:\/\/x.test/
    );
  });

  it("reports a timeout in seconds", async () => {
    stub(() => {
      throw Object.assign(new Error("aborted"), { name: "TimeoutError" });
    });
    expect((await cli.runCheck({ ...args, timeoutMs: 9000 })).error).toBe(
      "timed out after 9s"
    );
  });
});

describe("main", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const io = () => {
    const out: string[] = [];
    const err: string[] = [];
    return {
      out: (s: string) => out.push(s),
      err: (s: string) => err.push(s),
      color: false,
      env: {},
      _out: out,
      _err: err
    };
  };

  it("--help exits 0 on stdout", async () => {
    const o = io();
    expect(await cli.main(["--help"], o)).toBe(0);
    expect(o._out.join("\n")).toContain("Usage: isitme");
  });

  it("--version prints the package version", async () => {
    const o = io();
    expect(await cli.main(["--version"], o)).toBe(0);
    expect(o._out).toEqual([cli.VERSION]);
  });

  it("a usage error exits 1 with the help on stderr", async () => {
    const o = io();
    expect(await cli.main([], o)).toBe(1);
    expect(o._err.join("\n")).toContain("isitme: no target given");
  });

  it("--json prints the raw body and still sets the exit code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ ok: true, verdict: "DOWN_GLOBAL" }))
      )
    );
    const o = io();
    expect(
      await cli.main(["a.com", "--json", "--api", "https://x.test"], o)
    ).toBe(1);
    expect(JSON.parse(o._out.join("\n"))).toEqual({
      ok: true,
      verdict: "DOWN_GLOBAL"
    });
  });

  it("writes a failed check to stderr", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ ok: false, error: "rate limited" }), {
            status: 429
          })
      )
    );
    const o = io();
    expect(await cli.main(["a.com", "--api", "https://x.test"], o)).toBe(1);
    expect(o._out).toEqual([]);
    expect(o._err.join("\n")).toBe("error: rate limited");
  });
});
