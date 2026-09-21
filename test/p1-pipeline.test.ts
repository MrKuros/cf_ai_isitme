import { afterEach, describe, expect, it, vi } from "vitest";
import { httpProbe } from "../src/lib/probes";

afterEach(() => vi.unstubAllGlobals());

describe("probe records provider fingerprint headers", () => {
  it("lists only known header names present on the final hop", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("{}", {
            headers: {
              "content-type": "application/json",
              "X-Served-By": "cache-sjc",
              "x-amz-cf-id": "abc",
              "x-random": "1"
            }
          })
      )
    );
    const r = await httpProbe("https://example.com/");
    expect(r.providerHeaders?.sort()).toEqual(["x-amz-cf-id", "x-served-by"]);
  });

  it("omitted when none present", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 204 }))
    );
    expect(
      (await httpProbe("https://example.com/")).providerHeaders
    ).toBeUndefined();
  });
});
