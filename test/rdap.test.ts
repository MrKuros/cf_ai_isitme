import { afterEach, describe, expect, it, vi } from "vitest";
import { parseRdap, rdapLookup } from "../src/lib/rdap";

afterEach(() => vi.unstubAllGlobals());

const fixture = {
  objectClassName: "domain",
  ldhName: "EXAMPLE.COM",
  status: ["client transfer prohibited", "redemption period"],
  events: [
    { eventAction: "registration", eventDate: "1995-08-14T04:00:00Z" },
    { eventAction: "expiration", eventDate: "2026-09-18T04:00:00Z" }
  ],
  entities: [
    {
      objectClassName: "entity",
      roles: ["registrant"],
      vcardArray: ["vcard", [["fn", {}, "text", "Someone"]]]
    },
    {
      objectClassName: "entity",
      roles: ["registrar"],
      vcardArray: [
        "vcard",
        [
          ["version", {}, "text", "4.0"],
          ["fn", {}, "text", "Example Registrar, Inc."]
        ]
      ]
    }
  ]
};

describe("RDAP parse", () => {
  it("extracts expiry, status and registrar", () => {
    expect(parseRdap(fixture)).toEqual({
      expiresAt: "2026-09-18T04:00:00Z",
      status: ["client transfer prohibited", "redemption period"],
      registrar: "Example Registrar, Inc."
    });
  });

  it("null for non-domain junk", () => {
    expect(parseRdap(null)).toBeNull();
    expect(parseRdap({ errorCode: 404 })).toBeNull();
  });
});

describe("rdapLookup", () => {
  it("fetches rdap.org and never throws", async () => {
    const f = vi.fn(async (_url: string) => Response.json(fixture));
    vi.stubGlobal("fetch", f);
    expect((await rdapLookup("example.com"))?.registrar).toBe(
      "Example Registrar, Inc."
    );
    expect(f.mock.calls[0][0]).toBe("https://rdap.org/domain/example.com");

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 404 }))
    );
    expect(await rdapLookup("nope.example")).toBeNull();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("down");
      })
    );
    expect(await rdapLookup("example.com")).toBeNull();
  });
});
