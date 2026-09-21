// Pure DNS wire format (RFC 1035): one-question queries, rcode + A answers. No Workers imports.

/** ponytail: naive apex (last two labels), same as statuspage.ts; breaks for co.uk, use a PSL if it matters. */
export function registrableDomain(host: string): string {
  return host.toLowerCase().replace(/\.$/, "").split(".").slice(-2).join(".");
}

export function encodeQuery(name: string, type = 1, id = 0): Uint8Array {
  const labels = name.replace(/\.$/, "").split(".");
  const out = [id >> 8, id & 0xff, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0];
  for (const l of labels) {
    if (!l || l.length > 63 || !/^[\x21-\x7e]+$/.test(l))
      throw new Error(`bad label "${l}"`);
    out.push(l.length, ...[...l].map((c) => c.charCodeAt(0)));
  }
  out.push(0, type >> 8, type & 0xff, 0, 1);
  return new Uint8Array(out);
}

/** Throws RangeError on a truncated message. */
export function decodeResponse(bytes: Uint8Array): {
  id: number;
  rcode: number;
  authoritative: boolean;
  addresses: string[];
} {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const skipName = (off: number): number => {
    for (;;) {
      const len = dv.getUint8(off);
      if (len === 0) return off + 1;
      if ((len & 0xc0) === 0xc0) return off + 2;
      off += len + 1;
    }
  };
  const flags = dv.getUint16(2);
  const qd = dv.getUint16(4);
  const an = dv.getUint16(6);
  let off = 12;
  for (let i = 0; i < qd; i++) off = skipName(off) + 4;
  const addresses: string[] = [];
  for (let i = 0; i < an; i++) {
    off = skipName(off);
    const type = dv.getUint16(off);
    const rdlen = dv.getUint16(off + 8);
    off += 10;
    if (type === 1 && rdlen === 4)
      addresses.push([0, 1, 2, 3].map((k) => dv.getUint8(off + k)).join("."));
    off += rdlen;
  }
  return {
    id: dv.getUint16(0),
    rcode: flags & 0xf,
    authoritative: (flags & 0x0400) !== 0,
    addresses
  };
}
