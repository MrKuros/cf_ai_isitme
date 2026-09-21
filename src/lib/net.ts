import type { NetInfo } from "../shared/types";
import { parseV6 } from "./guard";

export function netInfo(request: Request): NetInfo {
  const cf = request.cf as IncomingRequestCfProperties | undefined;
  if (!cf) return {};
  return {
    colo: cf.colo,
    country: cf.country,
    city: cf.city,
    asn: cf.asn,
    asOrganization: cf.asOrganization
  };
}

/** NetInfo safe to put in a public report. */
export function publicNetInfo({ city: _city, ...rest }: NetInfo): NetInfo {
  return rest;
}

/** The rate-limit/voter key: the IPv4 address, or the /64 of an IPv6 one (a client owns the whole /64). */
export function clientIp(request: Request): string {
  const ip = request.headers.get("cf-connecting-ip") ?? "local";
  const g = ip.includes(":") ? parseV6(ip) : null;
  return g
    ? `${g
        .slice(0, 4)
        .map((x) => x.toString(16))
        .join(":")}::/64`
    : ip;
}

// ponytail: unsalted, so a 32-bit IPv4 space is brute-forceable; rows live at most an hour.
export async function hashIp(ip: string): Promise<string> {
  const d = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`isitme:${ip}`)
  );
  return [...new Uint8Array(d).slice(0, 8)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
