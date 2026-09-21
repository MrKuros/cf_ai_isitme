// Pure: CNAME chain / response headers / Radar ASN -> hosting provider (N1).
import type { ProviderInfo } from "../shared/types";

const NAMES: Record<string, string> = {
  cloudflare: "Cloudflare",
  cloudfront: "CloudFront",
  akamai: "Akamai",
  fastly: "Fastly",
  "azure-front-door": "Azure Front Door",
  vercel: "Vercel",
  netlify: "Netlify",
  heroku: "Heroku",
  "github-pages": "GitHub Pages",
  aws: "AWS",
  "microsoft-azure": "Microsoft Azure",
  "google-cloud": "Google Cloud"
};

const CNAMES: Array<[suffix: string, id: string]> = [
  ["cloudfront.net", "cloudfront"],
  ["akamaiedge.net", "akamai"],
  ["akamai.net", "akamai"],
  ["edgekey.net", "akamai"],
  ["fastly.net", "fastly"],
  ["fastlylb.net", "fastly"],
  ["azurefd.net", "azure-front-door"],
  ["azureedge.net", "azure-front-door"],
  ["cdn.cloudflare.net", "cloudflare"],
  ["vercel-dns.com", "vercel"],
  ["netlify.app", "netlify"],
  ["netlifyglobalcdn.com", "netlify"],
  ["herokudns.com", "heroku"],
  ["github.io", "github-pages"]
];

const HEADERS: Array<[header: string, id: string]> = [
  ["cf-ray", "cloudflare"],
  ["x-amz-cf-id", "cloudfront"],
  ["x-served-by", "fastly"],
  ["x-fastly-request-id", "fastly"],
  ["x-azure-ref", "azure-front-door"],
  ["x-vercel-id", "vercel"],
  ["x-nf-request-id", "netlify"],
  ["x-github-request-id", "github-pages"]
];

const ASNS: Record<number, string> = {
  13335: "cloudflare",
  16509: "aws",
  14618: "aws",
  8075: "microsoft-azure",
  15169: "google-cloud",
  396982: "google-cloud",
  20940: "akamai",
  16625: "akamai",
  54113: "fastly"
};

/** First match wins in order cname > header > asn; `via` lists every source that agreed. */
export function fingerprint(input: {
  cnames: string[];
  server?: string;
  cfRay?: string;
  providerHeaders?: string[];
  asn?: number;
}): ProviderInfo | null {
  const cname = input.cnames
    .map((c) => c.toLowerCase().replace(/\.$/, ""))
    .flatMap((c) =>
      CNAMES.filter(([s]) => c === s || c.endsWith(`.${s}`)).map(([, id]) => id)
    );
  const present = new Set(
    (input.providerHeaders ?? []).map((h) => h.toLowerCase())
  );
  if (input.cfRay) present.add("cf-ray");
  const header = HEADERS.filter(([h]) => present.has(h)).map(([, id]) => id);
  if (/akamaighost/i.test(input.server ?? "")) header.push("akamai");
  const asn = input.asn !== undefined ? ASNS[input.asn] : undefined;

  const id = cname[0] ?? header[0] ?? asn;
  if (!id) return null;
  const via: ProviderInfo["via"] = [];
  if (cname.includes(id)) via.push("cname");
  if (header.includes(id)) via.push("header");
  if (asn === id) via.push("asn");
  return { id, name: NAMES[id], via };
}

/** Name used in CONTRACTS.md. */
export const fingerprintProvider = fingerprint;
