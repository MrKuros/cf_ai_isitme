import { describe, expect, it } from "vitest";
import { fingerprint } from "../src/lib/provider";

describe("N1 provider fingerprint", () => {
  it.each([
    ["d111.cloudfront.net", "cloudfront"],
    ["e123.a.akamaiedge.net", "akamai"],
    ["www.example.com.edgekey.net.", "akamai"],
    ["dualstack.n.sni.global.fastly.net", "fastly"],
    ["x.azurefd.net", "azure-front-door"],
    ["example.com.cdn.cloudflare.net", "cloudflare"],
    ["cname.vercel-dns.com", "vercel"],
    ["site.netlify.app", "netlify"],
    ["foo.herokudns.com", "heroku"],
    ["user.github.io", "github-pages"]
  ])("cname %s -> %s", (cname, id) => {
    expect(fingerprint({ cnames: ["www.example.com", cname] })).toEqual(
      expect.objectContaining({ id, via: ["cname"] })
    );
  });

  it("does not match a suffix inside a label", () => {
    expect(fingerprint({ cnames: ["notcloudfront.net"] })).toBeNull();
  });

  it.each([
    [{ cfRay: "8abc-SJC" }, "cloudflare"],
    [{ providerHeaders: ["x-amz-cf-id"] }, "cloudfront"],
    [{ providerHeaders: ["x-served-by"] }, "fastly"],
    [{ providerHeaders: ["x-azure-ref"] }, "azure-front-door"],
    [{ server: "AkamaiGHost" }, "akamai"],
    [{ providerHeaders: ["x-vercel-id"] }, "vercel"],
    [{ providerHeaders: ["x-nf-request-id"] }, "netlify"],
    [{ providerHeaders: ["x-github-request-id"] }, "github-pages"]
  ])("header %o -> %s", (h, id) => {
    expect(fingerprint({ cnames: [], ...h })).toEqual(
      expect.objectContaining({ id, via: ["header"] })
    );
  });

  it.each([
    [13335, "cloudflare", "Cloudflare"],
    [16509, "aws", "AWS"],
    [14618, "aws", "AWS"],
    [8075, "microsoft-azure", "Microsoft Azure"],
    [396982, "google-cloud", "Google Cloud"],
    [16625, "akamai", "Akamai"],
    [54113, "fastly", "Fastly"]
  ])("asn %i -> %s", (asn, id, name) => {
    expect(fingerprint({ cnames: [], asn })).toEqual({
      id,
      name,
      via: ["asn"]
    });
  });

  it("nothing matches -> null", () => {
    expect(fingerprint({ cnames: ["a.example.net"], asn: 64512 })).toBeNull();
  });

  it("cname beats header beats asn", () => {
    expect(
      fingerprint({
        cnames: ["x.fastly.net"],
        cfRay: "1-SJC",
        asn: 16509
      })?.id
    ).toBe("fastly");
    expect(
      fingerprint({ cnames: [], providerHeaders: ["x-amz-cf-id"], asn: 13335 })
        ?.id
    ).toBe("cloudfront");
  });

  it("via lists every agreeing source", () => {
    expect(
      fingerprint({
        cnames: ["example.com.cdn.cloudflare.net"],
        cfRay: "1-SJC",
        asn: 13335
      })
    ).toEqual({
      id: "cloudflare",
      name: "Cloudflare",
      via: ["cname", "header", "asn"]
    });
    expect(
      fingerprint({ cnames: [], server: "AkamaiGHost", asn: 20940 })?.via
    ).toEqual(["header", "asn"]);
    // AWS ASN is a different id from CloudFront: no merge
    expect(
      fingerprint({ cnames: ["d1.cloudfront.net"], asn: 16509 })?.via
    ).toEqual(["cname"]);
  });
});
