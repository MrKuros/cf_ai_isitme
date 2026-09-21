import { describe, expect, it } from "vitest";
import { browserVantage, parseBrowserProbe } from "../src/lib/browser-probe";
import { BROWSER_UNTESTABLE } from "../src/shared/types";

const dns = {
  ok: true,
  rcode: 0,
  addresses: ["93.184.216.34", "2606:2800:220:1::1"],
  cnames: ["edge.example.net"],
  ad: false,
  ms: 42
};
const valid = {
  at: 1,
  reachable: true,
  method: "fetch-no-cors",
  ms: 120,
  online: true,
  controlReachable: true,
  dns,
  dnsAlt: null
};

const error = (v: unknown) => {
  const r = parseBrowserProbe(v);
  return r.ok ? null : r.error;
};

describe("parseBrowserProbe (R15)", () => {
  it("accepts a valid probe, stamps `at` server-side, drops unknown keys", () => {
    const r = parseBrowserProbe({ ...valid, extra: "x" });
    expect(r.ok).toBe(true);
    if (!r.ok || !r.probe) throw new Error("expected probe");
    expect(r.probe.at).not.toBe(1);
    expect(r.probe.reachable).toBe(true);
    expect(r.probe.dns?.addresses).toEqual(dns.addresses);
    expect(r.probe.dnsAlt).toBeNull();
    expect("extra" in r.probe).toBe(false);
  });

  it("keeps a sanitized env (N4/N7) and drops junk inside it", () => {
    const r = parseBrowserProbe({
      ...valid,
      env: {
        trace: { warp: "on", gateway: 5, loc: "DE", evil: "x", ip: "1.2.3.4" },
        tzMismatch: true,
        ipv6: "yes",
        timeZone: "Europe/Berlin"
      }
    });
    if (!r.ok || !r.probe) throw new Error("expected probe");
    expect(r.probe.env).toEqual({
      trace: { warp: "on", loc: "DE" },
      tzMismatch: true,
      timeZone: "Europe/Berlin"
    });
  });

  it("null is a valid missing probe", () => {
    expect(parseBrowserProbe(null)).toEqual({ ok: true, probe: null });
  });

  it.each([
    ["a string where a boolean is expected", { ...valid, reachable: "yes" }],
    ["a 10 KB error string", { ...valid, error: "x".repeat(10_240) }],
    ["ms out of range", { ...valid, ms: 60_001 }],
    ["negative ms", { ...valid, ms: -1 }],
    ["unknown method", { ...valid, method: "ping" }],
    ["not an object", "probe"],
    ["an array", []],
    ["undefined", undefined],
    ["dns not an object", { ...valid, dns: "1.2.3.4" }],
    ["dns rcode not an integer", { ...valid, dns: { ...dns, rcode: 1.5 } }],
    ["dns rcode out of range", { ...valid, dns: { ...dns, rcode: 99 } }],
    [
      "dns address not IP-shaped",
      { ...valid, dns: { ...dns, addresses: ["<script>"] } }
    ],
    [
      "too many addresses",
      { ...valid, dns: { ...dns, addresses: Array(21).fill("1.1.1.1") } }
    ],
    ["bad cname", { ...valid, dns: { ...dns, cnames: ["a b"] } }],
    ["dns.ok not boolean", { ...valid, dns: { ...dns, ok: 1 } }],
    [
      "dnsAlt long error",
      { ...valid, dnsAlt: { ...dns, error: "e".repeat(301) } }
    ]
  ])("rejects %s", (_name, v) => {
    expect(error(v)).toBeTruthy();
  });
});

describe("browserVantage", () => {
  it("an untestable (mixed content) probe is missing, not failed", () => {
    expect(
      browserVantage({
        ...valid,
        reachable: false,
        error: BROWSER_UNTESTABLE
      } as never)
    ).toBeNull();
  });
});
