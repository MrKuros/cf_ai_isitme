// Pure. URL normalization + SSRF guard.
import type { Target } from "../shared/types";

export class GuardError extends Error {
  name = "GuardError";
}

const MAX_INPUT = 2048;
// Web ports only, so the probes can't be used to port-scan arbitrary services.
const ALLOWED_PORTS = new Set(["", "80", "443", "8080", "8443"]);
const BLOCKED_NAMES = /(^|\.)(localhost|local|internal|home\.arpa)$/;
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/** Accepts "example.com", "https://x.y/path", etc. Returns { error } for anything unsafe or malformed. */
export function normalizeTarget(input: string): Target | { error: string } {
  const trimmed = input.trim();
  if (!trimmed) return { error: "Enter a site, e.g. example.com" };
  if (trimmed.length > MAX_INPUT) return { error: "URL is too long" };

  let u: URL;
  try {
    u = new URL(
      /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
    );
  } catch {
    return { error: `"${trimmed.slice(0, 100)}" is not a valid URL` };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return { error: "Only http and https URLs can be checked" };
  }
  if (u.username || u.password)
    return { error: "URLs with credentials are not allowed" };
  if (!ALLOWED_PORTS.has(u.port)) {
    return { error: "Only ports 80, 443, 8080 and 8443 can be checked" };
  }

  // URL already lowercases, punycodes IDNs and canonicalizes IPv4 forms like 0x7f.1 or 2130706433.
  const bracketed = u.hostname.startsWith("[");
  let host = bracketed ? u.hostname.slice(1, -1) : u.hostname;
  if (host.endsWith(".")) {
    host = host.slice(0, -1);
    u.hostname = host;
  }
  const isIpLiteral = bracketed || IPV4.test(host);

  if (isIpLiteral) {
    if (isForbiddenAddress(host))
      return { error: "Private or reserved addresses can't be checked" };
  } else {
    if (!host.includes("."))
      return { error: `"${host}" is not a public hostname` };
    if (BLOCKED_NAMES.test(host))
      return { error: "Local and internal hostnames can't be checked" };
  }

  // Query strings would let callers bust the per-URL probe cache and coalescing.
  u.search = "";
  u.hash = "";
  return { input: trimmed, url: u.toString(), host, isIpLiteral };
}

// [network, prefix length]
const V4_BLOCKED: Array<[string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4]
];

function parseV4(ip: string): number | null {
  if (!IPV4.test(ip)) return null;
  const parts = ip.split(".").map(Number);
  if (parts.some((p) => p > 255)) return null;
  return (
    ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0
  );
}

function v4Forbidden(n: number): boolean {
  return V4_BLOCKED.some(([net, bits]) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (n & mask) >>> 0 === (parseV4(net)! & mask) >>> 0;
  });
}

/** Eight 16-bit groups, or null if not a valid IPv6 address (zone ids are rejected). */
export function parseV6(ip: string): number[] | null {
  if (!/^[0-9a-f:.]+$/i.test(ip) || ip.split("::").length > 2) return null;
  let s = ip;
  const v4 = s.match(/:(\d{1,3}(\.\d{1,3}){3})$/);
  if (v4) {
    const n = parseV4(v4[1]);
    if (n === null) return null;
    s =
      s.slice(0, -v4[1].length) +
      `${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const [head, rest] = s.includes("::") ? s.split("::") : [s, null];
  const toGroups = (p: string) => (p ? p.split(":") : []);
  const h = toGroups(head);
  const r = rest === null ? [] : toGroups(rest);
  if ([...h, ...r].some((g) => !/^[0-9a-f]{1,4}$/i.test(g))) return null;
  const known = h.length + r.length;
  if (rest === null ? known !== 8 : known > 7) return null;
  return [...h, ...Array(8 - known).fill("0"), ...r].map((g) =>
    parseInt(g, 16)
  );
}

/** True for private, loopback, link-local, metadata, CGNAT, multicast, reserved, unspecified (v4 + v6, incl. v4-mapped). */
export function isForbiddenAddress(ip: string): boolean {
  const s = ip.trim().replace(/^\[|\]$/g, "");
  const v4 = parseV4(s);
  if (v4 !== null) return s === "255.255.255.255" || v4Forbidden(v4);

  const g = parseV6(s);
  if (!g) return true;
  const embeddedV4 = (hi: number, lo: number) =>
    v4Forbidden(((hi << 16) | lo) >>> 0);

  if (g.slice(0, 6).every((x) => x === 0)) return true; // ::, ::1, deprecated ::a.b.c.d
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff)
    return embeddedV4(g[6], g[7]);
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) {
    return embeddedV4(g[6], g[7]);
  }
  if (g[0] === 0x2002) return embeddedV4(g[1], g[2]); // 6to4
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g[0] & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local (deprecated)
  if ((g[0] & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // documentation
  if (g[0] === 0x0100 && g.slice(1, 4).every((x) => x === 0)) return true; // discard-only
  return false;
}

/** Throws GuardError if the target is an IP literal that is forbidden or any resolved address is forbidden. */
export function assertSafeTarget(target: Target, resolved: string[]): void {
  if (target.isIpLiteral && isForbiddenAddress(target.host)) {
    throw new GuardError(`${target.host} is a private or reserved address`);
  }
  // ponytail: DNS rebinding between this check and the probe fetch is not prevented; pinning the
  // resolved IP would need raw sockets, which Workers can't open to arbitrary hosts.
  const bad = resolved.find(isForbiddenAddress);
  if (bad)
    throw new GuardError(
      `${target.host} resolves to a private or reserved address (${bad})`
    );
}

/** Agent state is server-owned: a client `cf_agent_state` frame must never write it. */
export function assertServerWrite(source: unknown): void {
  if (source !== "server") throw new Error("state is server-owned");
}

/** A /c/<host> path segment naming exactly one public host: no port, path, userinfo or private address. */
export function isPublicHostParam(host: string): boolean {
  const t = normalizeTarget(host);
  return !("error" in t) && t.host === host.trim().toLowerCase();
}
