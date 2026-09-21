import { describe, expect, it } from "vitest";
import {
  GuardError,
  assertSafeTarget,
  isForbiddenAddress,
  normalizeTarget,
  assertServerWrite
} from "../src/lib/guard";
import type { Target } from "../src/shared/types";

function ok(input: string): Target {
  const t = normalizeTarget(input);
  if ("error" in t) throw new Error(`expected ok for ${input}: ${t.error}`);
  return t;
}

describe("normalizeTarget: accepted", () => {
  it.each([
    ["example.com", "https://example.com/", "example.com", false],
    ["  Example.COM  ", "https://example.com/", "example.com", false],
    ["http://example.com", "http://example.com/", "example.com", false],
    [
      "https://www.example.com/a/b?q=1#frag",
      "https://www.example.com/a/b",
      "www.example.com",
      false
    ],
    [
      "example.com/?cachebust=123",
      "https://example.com/",
      "example.com",
      false
    ],
    ["example.com/path", "https://example.com/path", "example.com", false],
    ["example.com.", "https://example.com/", "example.com", false],
    ["example.com:8443", "https://example.com:8443/", "example.com", false],
    [
      "http://example.com:8080/x",
      "http://example.com:8080/x",
      "example.com",
      false
    ],
    ["https://example.com:443/", "https://example.com/", "example.com", false],
    ["http://example.com:80", "http://example.com/", "example.com", false],
    ["bücher.de", "https://xn--bcher-kva.de/", "xn--bcher-kva.de", false],
    ["1.1.1.1", "https://1.1.1.1/", "1.1.1.1", true],
    ["http://8.8.8.8/dns", "http://8.8.8.8/dns", "8.8.8.8", true],
    [
      "https://[2606:4700:4700::1111]/",
      "https://[2606:4700:4700::1111]/",
      "2606:4700:4700::1111",
      true
    ]
  ])("%s", (input, url, host, isIp) => {
    const t = ok(input);
    expect(t).toEqual({ input: input.trim(), url, host, isIpLiteral: isIp });
  });
});

describe("normalizeTarget: rejected", () => {
  it.each([
    ["", "empty"],
    ["   ", "blank"],
    ["ftp://example.com", "scheme"],
    ["file:///etc/passwd", "scheme"],
    ["javascript:alert(1)", "garbage"],
    ["data:text/html,hi", "garbage"],
    ["gopher://example.com", "scheme"],
    ["https://user:pass@example.com", "credentials"],
    ["https://user@example.com", "credentials"],
    ["example.com:22", "port"],
    ["http://example.com:6379", "port"],
    ["https://example.com:0", "port"],
    ["localhost", "local name"],
    ["http://localhost:8080", "local name"],
    ["foo.localhost", "local name"],
    ["printer.local", "local name"],
    ["metadata.google.internal", "internal name"],
    ["router.home.arpa", "home.arpa"],
    ["LOCALHOST.", "local name, trailing dot"],
    ["intranet", "no dot"],
    ["127.0.0.1", "loopback"],
    ["http://127.1", "short loopback"],
    ["http://2130706433", "decimal loopback"],
    ["http://0x7f000001", "hex loopback"],
    ["http://0177.0.0.1", "octal loopback"],
    ["10.1.2.3", "private"],
    ["http://169.254.169.254/latest/meta-data", "metadata"],
    ["100.64.0.1", "cgnat"],
    ["0.0.0.0", "unspecified"],
    ["http://[::1]/", "v6 loopback"],
    ["http://[::ffff:127.0.0.1]/", "v4-mapped loopback"],
    ["http://[::ffff:a9fe:a9fe]/", "v4-mapped metadata, hex form"],
    ["http://[fd00::1]/", "ula"],
    ["http://[fe80::1]/", "link-local"],
    ["https://exa mple.com", "space"],
    ["https://" + "a".repeat(2050) + ".com", "too long"]
  ])("%s (%s)", (input) => {
    expect(normalizeTarget(input)).toHaveProperty("error");
  });
});

describe("isForbiddenAddress", () => {
  it.each([
    "0.0.0.0",
    "0.1.2.3",
    "10.0.0.1",
    "10.255.255.255",
    "100.64.0.0",
    "100.127.255.255",
    "127.0.0.1",
    "127.255.255.254",
    "169.254.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "172.31.255.255",
    "192.0.0.8",
    "192.0.2.1",
    "192.168.1.1",
    "198.18.0.1",
    "198.19.255.255",
    "198.51.100.7",
    "203.0.113.9",
    "224.0.0.1",
    "239.255.255.250",
    "240.0.0.1",
    "255.255.255.255",
    "::",
    "::1",
    "0:0:0:0:0:0:0:1",
    "[::1]",
    "fc00::1",
    "fd12:3456:789a::1",
    "fe80::1",
    "febf::1",
    "fec0::1",
    "ff02::1",
    "::ffff:127.0.0.1",
    "::ffff:10.0.0.1",
    "::ffff:7f00:1",
    "::ffff:169.254.169.254",
    "0:0:0:0:0:ffff:192.168.0.1",
    "::127.0.0.1",
    "64:ff9b::10.0.0.1",
    "64:ff9b::a9fe:a9fe",
    "2002:7f00:1::",
    "2001:db8::1",
    "100::1",
    "not-an-ip",
    "",
    "1.2.3",
    "256.1.1.1",
    "1.2.3.4.5",
    "fe80::1%eth0",
    "1::2::3",
    "12345::1",
    "1:2:3:4:5:6:7:8:9"
  ])("forbids %s", (ip) => {
    expect(isForbiddenAddress(ip)).toBe(true);
  });

  it.each([
    "1.1.1.1",
    "8.8.8.8",
    "93.184.216.34",
    "100.63.255.255",
    "100.128.0.0",
    "172.15.255.255",
    "172.32.0.0",
    "169.253.255.255",
    "192.169.0.1",
    "198.20.0.1",
    "223.255.255.255",
    "2606:4700:4700::1111",
    "2001:4860:4860::8888",
    "::ffff:1.1.1.1",
    "::ffff:101:101",
    "64:ff9b::8.8.8.8",
    "2002:0101:0101::1",
    "2a00:1450:4001:82a::200e"
  ])("allows %s", (ip) => {
    expect(isForbiddenAddress(ip)).toBe(false);
  });
});

describe("assertSafeTarget", () => {
  const example = ok("example.com");

  it("passes public resolutions", () => {
    expect(() =>
      assertSafeTarget(example, ["93.184.216.34", "2606:2800:220:1::1"])
    ).not.toThrow();
  });

  it("passes with no resolutions", () => {
    expect(() => assertSafeTarget(example, [])).not.toThrow();
  });

  it("throws GuardError when any resolved address is private", () => {
    expect(() =>
      assertSafeTarget(example, ["93.184.216.34", "10.0.0.5"])
    ).toThrow(GuardError);
    expect(() => assertSafeTarget(example, ["::1"])).toThrow(
      /private or reserved/
    );
  });

  it("throws on a forbidden IP literal target even if it bypassed normalizeTarget", () => {
    const forged: Target = {
      input: "x",
      url: "http://10.0.0.1/",
      host: "10.0.0.1",
      isIpLiteral: true
    };
    expect(() => assertSafeTarget(forged, [])).toThrow(GuardError);
  });

  it("passes a public IP literal", () => {
    expect(() => assertSafeTarget(ok("1.1.1.1"), [])).not.toThrow();
  });
});

describe("agent state is server-owned", () => {
  it("a client connection's state frame throws; the server may write", () => {
    expect(() => assertServerWrite({ id: "conn-1" })).toThrow(/server-owned/);
    expect(() => assertServerWrite("server")).not.toThrow();
  });
});
