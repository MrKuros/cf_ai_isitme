import { afterEach, describe, expect, it, vi } from "vitest";

const { connect } = vi.hoisted(() => ({ connect: vi.fn() }));
vi.mock("cloudflare:sockets", () => ({ connect }));

import {
  authoritativeNs,
  decodeResponse,
  encodeQuery
} from "../src/lib/dns-tcp";

afterEach(() => {
  vi.unstubAllGlobals();
  connect.mockReset();
});

/** Hand-built response to `encodeQuery("example.com", 1, 0xbeef)`: AA, one compressed A answer. */
function response(rcode = 0, answers: number[][] = [[93, 184, 216, 34]]) {
  const q = encodeQuery("example.com", 1, 0xbeef);
  const bytes = [...q];
  bytes[2] = 0x84; // QR + AA
  bytes[3] = rcode;
  bytes[7] = answers.length;
  for (const ip of answers)
    bytes.push(0xc0, 12, 0, 1, 0, 1, 0, 0, 0x0e, 0x10, 0, 4, ...ip);
  return new Uint8Array(bytes);
}

describe("DNS wire format", () => {
  it("encodes a one-question query", () => {
    expect([...encodeQuery("a.io.", 2, 0x0102)]).toEqual([
      1, 2, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 97, 2, 105, 111, 0, 0, 2, 0, 1
    ]);
  });

  it("round-trips against a hand-built response", () => {
    const r = decodeResponse(
      response(0, [
        [93, 184, 216, 34],
        [1, 2, 3, 4]
      ])
    );
    expect(r).toEqual({
      id: 0xbeef,
      rcode: 0,
      authoritative: true,
      addresses: ["93.184.216.34", "1.2.3.4"]
    });
  });

  it("reads NXDOMAIN with no answers", () => {
    expect(decodeResponse(response(3, []))).toMatchObject({
      rcode: 3,
      addresses: []
    });
  });

  it("throws on a truncated message", () => {
    expect(() => decodeResponse(response().subarray(0, 30))).toThrow(
      RangeError
    );
  });

  it("rejects bad labels", () => {
    expect(() => encodeQuery("a..b")).toThrow();
    expect(() => encodeQuery(`${"x".repeat(64)}.com`)).toThrow();
  });
});

function stubDoh(ns: string[], ips: Record<string, string>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const u = new URL(url);
      const name = u.searchParams.get("name")!;
      const type = u.searchParams.get("type");
      const Answer =
        type === "NS"
          ? ns.map((data) => ({ name, type: 2, TTL: 60, data: `${data}.` }))
          : type === "A" && ips[name]
            ? [{ name, type: 1, TTL: 60, data: ips[name] }]
            : [];
      return Response.json({ Status: 0, Answer });
    })
  );
}

describe("authoritativeNs", () => {
  it("queries each NS over TCP with a length prefix", async () => {
    stubDoh(["ns1.example.com"], { "ns1.example.com": "205.251.192.1" });
    connect.mockImplementation(() => {
      let reply: Uint8Array;
      return {
        opened: Promise.resolve(),
        close: async () => {},
        writable: {
          getWriter: () => ({
            write: async (b: Uint8Array) => {
              expect((b[0] << 8) | b[1]).toBe(b.length - 2);
              const r = response();
              r.set(b.subarray(2, 4)); // echo the query id
              reply = new Uint8Array([0, r.length, ...r]);
            },
            releaseLock: () => {}
          })
        },
        readable: {
          getReader: () => ({
            read: async () => ({ done: false, value: reply })
          })
        }
      };
    });
    expect(await authoritativeNs("www.example.com")).toEqual([
      {
        ns: "ns1.example.com",
        ip: "205.251.192.1",
        rcode: 0,
        addresses: ["93.184.216.34"]
      }
    ]);
    expect(connect).toHaveBeenCalledWith({
      hostname: "205.251.192.1",
      port: 53
    });
  });

  it("connect errors (NS on Cloudflare IPs) and forbidden NS IPs are noData", async () => {
    stubDoh(["ns1.cf.com", "ns2.cf.com", "ns3.cf.com"], {
      "ns1.cf.com": "173.245.58.1",
      "ns2.cf.com": "10.0.0.1"
    });
    connect.mockImplementation(() => ({
      opened: Promise.reject(new Error("proxy request failed")),
      close: async () => {}
    }));
    expect(await authoritativeNs("cf.com")).toEqual([
      { ns: "ns1.cf.com", ip: "173.245.58.1", addresses: [], noData: true },
      { ns: "ns2.cf.com", addresses: [], noData: true }
    ]);
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it("null when the NS lookup fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 502 }))
    );
    expect(await authoritativeNs("example.com")).toBeNull();
  });

  it("null on SERVFAIL, and asks with checking disabled", async () => {
    const f = vi.fn(async (_url: string) => Response.json({ Status: 2 }));
    vi.stubGlobal("fetch", f);
    expect(await authoritativeNs("dnssec-failed.org")).toBeNull();
    expect(new URL(String(f.mock.calls[0][0])).searchParams.get("cd")).toBe(
      "1"
    );
  });
});
