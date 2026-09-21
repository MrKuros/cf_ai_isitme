// Workers only (cloudflare:sockets): DNS-over-TCP to the zone's authoritative NS. Never import from probes.ts.
import { connect } from "cloudflare:sockets";
import type { Evidence } from "../shared/types";
import { decodeResponse, encodeQuery, registrableDomain } from "./dns-wire";
import { isForbiddenAddress } from "./guard";
import { dohLookup } from "./probes";

export { decodeResponse, encodeQuery } from "./dns-wire";

type AuthNs = NonNullable<Evidence["authNs"]>[number];

const DOH_TIMEOUT_MS = 3000;
const TCP_TIMEOUT_MS = 4000;
const MAX_NS = 2;

async function nsNames(domain: string): Promise<string[]> {
  const res = await fetch(
    `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=NS&cd=1`,
    {
      headers: { accept: "application/dns-json" },
      signal: AbortSignal.timeout(DOH_TIMEOUT_MS)
    }
  );
  if (!res.ok) throw new Error(`DoH HTTP ${res.status}`);
  const body = (await res.json()) as {
    Status?: number;
    Answer?: Array<{ type: number; data: string }>;
  };
  // cd=1 skips DNSSEC validation so broken-DNSSEC zones still reveal their NS; SERVFAIL etc. = lookup failed.
  if (body.Status !== undefined && body.Status !== 0 && body.Status !== 3)
    throw new Error(`DoH status ${body.Status}`);
  return (body.Answer ?? [])
    .filter((a) => a.type === 2)
    .map((a) => a.data.replace(/\.$/, "").toLowerCase())
    .slice(0, MAX_NS);
}

async function tcpQuery(ip: string, host: string) {
  const socket = connect({ hostname: ip, port: 53 });
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("timed out")), TCP_TIMEOUT_MS)
  );
  try {
    return await Promise.race([exchange(socket, host), timeout]);
  } finally {
    socket.close().catch(() => {});
  }
}

async function exchange(socket: Socket, host: string) {
  await socket.opened;
  const id = Math.floor(Math.random() * 0x10000);
  const q = encodeQuery(host, 1, id);
  const framed = new Uint8Array(q.length + 2);
  framed.set([q.length >> 8, q.length & 0xff]);
  framed.set(q, 2);
  const writer = socket.writable.getWriter();
  await writer.write(framed);
  writer.releaseLock();

  const reader = socket.readable.getReader();
  let buf = new Uint8Array(0);
  for (;;) {
    const { done, value } = await reader.read();
    if (value) {
      const next = new Uint8Array(buf.length + value.length);
      next.set(buf);
      next.set(value, buf.length);
      buf = next;
    }
    if (buf.length >= 2 && buf.length >= 2 + ((buf[0] << 8) | buf[1])) break;
    if (done) throw new Error("connection closed");
  }
  const r = decodeResponse(buf.subarray(2, 2 + ((buf[0] << 8) | buf[1])));
  if (r.id !== id) throw new Error("id mismatch");
  return r;
}

/**
 * Asks up to 2 of the registrable domain's NS directly for `host` A over TCP.
 * Never throws; NS we can't reach (Cloudflare IPs are blocked from Workers) -> noData.
 * [] = the domain has no NS (not delegated); null = the NS lookup itself failed.
 */
export async function authoritativeNs(
  host: string
): Promise<Evidence["authNs"]> {
  let names: string[];
  try {
    names = await nsNames(registrableDomain(host));
  } catch {
    return null;
  }
  return Promise.all(
    names.map(async (ns): Promise<AuthNs> => {
      const d = await dohLookup(ns, {
        timeoutMs: DOH_TIMEOUT_MS,
        checkDnssec: false
      });
      const ip = d.addresses.find((a) => a.includes("."));
      if (!ip || isForbiddenAddress(ip))
        return { ns, addresses: [], noData: true };
      try {
        const r = await tcpQuery(ip, host);
        return { ns, ip, rcode: r.rcode, addresses: r.addresses };
      } catch {
        return { ns, ip, addresses: [], noData: true };
      }
    })
  );
}
