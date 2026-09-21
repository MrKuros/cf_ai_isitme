# IsItMe module contracts

The spec is `/home/alien/.claude/plans/jazzy-greeting-flamingo.md`. SDK signatures are in `docs/SDK_NOTES.md`.
All shared types live in **`src/shared/types.ts`**. Import them from there, and never redefine them locally.
During wave P0 only the prep step edits it (see Ownership). Outside a wave, new shared fields go there as **optional** fields; mention them in your summary.

Rules for every module: TypeScript strict, sparse comments, starter code style (2 spaces, double quotes, semicolons, no trailing commas).
No new npm deps, because everything needed is installed. Every stub currently throws `"not implemented"`. Replace the body and keep the exported signature.

## Ownership

Wave P0 (spec: `docs/COMPETITOR_SPEC.md`). Packages build in parallel against the contract below and **must not edit this file** or `src/shared/types.ts` (the prep step already added every P0 type). Need something new? Say so in your summary.

| File                                                                                                      | Owner       | P0 work                                                                                     |
| --------------------------------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------- |
| `wrangler.jsonc`, `env.d.ts`, `src/env-secrets.d.ts`, `vitest.config.ts`, `package.json`                  | foundation  | don't edit, except to re-run `npm run types`                                                |
| `src/shared/types.ts`, `docs/CONTRACTS.md`, `src/client/components/ui.tsx` (`VERDICTS`)                   | prep        | done for P0                                                                                 |
| `src/lib/probes.ts`, `src/lib/guard.ts`, `test/probes.test.ts`, `test/guard.test.ts`, `docs/SDK_NOTES.md` | p0-probes   | R1–R5, R11 (probe v2, dual resolver, DNSSEC), R19 hop guard; record 525/526/530 findings    |
| `src/agents/target-do.ts`, `src/agents/probe-do.ts`, `src/workflow/diagnose.ts`, `src/client/probe.ts`    | p0-edge     | R6 (noData, controls, sick vantage), R11 wiring (dnsAlt edge + browser), R5 root/alt probes |
| `src/lib/classify.ts`, `test/classify.test.ts`, `src/lib/explain.ts`, `test/explain.test.ts`              | p0-classify | classifier v2 (rule order below), R13 templates/post-filter                                 |
| `src/lib/alerts.ts`, `test/alerts.test.ts`, `src/agents/user-agent.ts`                                    | p0-alerts   | R8, R19 watch caps, submitBrowserProbe via `parseBrowserProbe`                              |
| `src/server.ts`, `src/lib/net.ts`, `src/lib/browser-probe.ts`, `test/browser-probe.test.ts`               | p0-server   | R15, R16 (per-caller API agent), `/agents/*` name guard                                     |
| `src/agents/mcp.ts`, rest of `src/client/**`, `README.md`, `PROMPTS.md`                                   | unowned     | not touched in P0                                                                           |

All P0 functions are implemented (wave P0 integrated). `hashIp`, `sanitizeProbe` and `browserVantage` live in `net.ts` / `browser-probe.ts`.

Wave P1 prep is done: every P1 shared type is in `src/shared/types.ts`, `PROVIDER_DO` is bound (migration `v2`), and stubs with final signatures exist (see **Wave P1** below). P1 packages keep those signatures and fill the bodies.

---

## Wave P2 (implemented; spec: `docs/COMPETITOR_SPEC.md` §4 P2)

Wave P2 prep: shared types added, `TRENDS_DO` bound (migration `v3`), `EMAIL` send_email binding added, `TrendsDO` stub exported. P2 packages keep these signatures and fill the bodies.

### Shared types added (all additive / optional, see `src/shared/types.ts`)

| Type / field                                                               | Purpose                                                                                                                                                                                                                                                                                                                                                       |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Evidence.baseline?: { colo, medianMs, samples } \| null`                  | N9. Median edge latency for this colo over 24 h of TargetDO samples. SLOW compares against `max(3000, 3 × medianMs)`; with too few samples leave it `null` and keep the 3000 ms rule                                                                                                                                                                          |
| `Evidence.statusLag?: { firstFailureAt, vendorAckAt? } \| null`            | N10. First probe-confirmed failure (TargetDO) vs the vendor incident `created_at` (N2). `vendorAckAt` absent = not acknowledged yet. Report line: "vendor acknowledged N min after our probes first failed"                                                                                                                                                   |
| `Evidence.rdap?: { expiresAt?, status?, registrar? } \| null`              | RDAP via `https://rdap.org/domain/<d>` (`src/lib/rdap.ts`), fetched only on NXDOMAIN (either rcode 3), 5 s timeout, never throws. **Explanation only, never a verdict driver**. `registrar` capped at 80 chars in explain                                                                                                                                     |
| `Evidence.authNs?: Array<{ ns, ip?, rcode?, addresses, noData? }> \| null` | DNS-over-TCP `connect()` to the zone's NS on port 53 (`src/lib/dns-tcp.ts`, Workers only; wire codec in pure `src/lib/dns-wire.ts`). Up to 2 NS, 4 s timeout, random query id must echo. Connect error / forbidden or missing IP → `noData: true`. `[]` = no NS (not delegated), `null` = the NS lookup itself failed. Run only when a public resolver failed |
| `Watch.mutedUntil?: number`                                                | epoch ms. While `now < mutedUntil`, watch runs still execute and record, but no alert/webhook/email is sent                                                                                                                                                                                                                                                   |
| `Watch.email?: string`                                                     | alert recipient via `env.EMAIL`                                                                                                                                                                                                                                                                                                                               |
| `TrendItem { host, verdict, provider?, asns, lastAt }`                     | one row of `/api/trends`                                                                                                                                                                                                                                                                                                                                      |
| `UptimeStats { watchId, days, runs, upRuns, excluded, uptime }`            | per-watch uptime; `uptime = upRuns / (runs - excluded)`, `null` when no counted runs                                                                                                                                                                                                                                                                          |

`null` = step ran and failed/skipped; `undefined` = older report or not applicable.

### `TrendsDO` (`src/agents/trends-do.ts`), plain `DurableObject<Env>`, singleton

Get it with `env.TRENDS_DO.getByName("global")`. SQL table `trends(host, verdict, provider, asn, at)`; `record` prunes rows > 60 min old and caps at 10k rows; `list` looks at the last 60 min and returns the top 20 by `asns` desc, then `lastAt`. Pure SQL/helpers in `src/lib/history.ts`.

```ts
record(item: { host: string; verdict: Verdict; provider?: string; asn?: number }): Promise<void>
list(): Promise<TrendItem[]>
```

- Callers record only non-HEALTHY runs (workflow save step, best-effort; a retried step may record twice, which doesn't change distinct-ASN counts). `asn` is the checking user's ASN.
- `list()` ranks by distinct failing ASNs (`asns`), not volume, and **returns only hosts with `asns >= 3`** (privacy: never expose a host only one or two networks checked).

### Email alerts and mute (`user-agent.ts`)

- `wrangler.jsonc` binds `"send_email": [{ "name": "EMAIL" }]`. `env.d.ts` types it as `SendEmail`, but it may be absent at runtime (local dev, unconfigured account): **always guard with `if (env.EMAIL)`** and fall back silently to in-app + webhook alerts.
- Email Routing only delivers to verified destination addresses; document that next to the watch email field in the UI.
- Mute: see `Watch.mutedUntil` above. Unmute = clear the field. Pure helpers in `alerts.ts`: `shouldNotify(watch, now)`, `muteUntil(minutes, now)` (0 clears, capped at `MAX_MUTE_MINUTES` = 7 days). A muted `until:'recovered'` watch still gets removed on recovery; `incidentUpdate` edits still apply.
- Chat tools: `mute { hostOrId, minutes 0..10080 }` → `{ ok, mutedUntil? }`; `setEmail { hostOrId, email | null }` → `{ ok, watchId, email }`; `watch` takes optional `email` (zod `z.email().max(254)`).
- `@callable muteWatch(watchId, minutes): Promise<{ ok, mutedUntil?, error? }>` (client sends `0` to unmute).
- Email: `alertEmailRaw()` (alerts.ts) builds text/plain MIME, CR/LF stripped from headers. Sender = optional `EMAIL_FROM` var, else `alerts@isitme.example` (must be replaced with an Email Routing domain). Failures only logged.

### Uptime (`user-agent.ts`)

- Per-watch `UptimeStats` computed from that watch's report history over `days`.
- `excluded` counts runs flagged vantage-caused (R6: `vantageSick`, `USER_SIDE`, inconclusive) and never counts them as down.
- Pure: `src/lib/uptime.ts` `uptime(rows, watchId, days)`, `vantageCaused(verdict, evidence)`. Excluded = none-class verdict, or a down run whose every failing edge/region probe has `noData`/`vantageSick`. Down runs without a failing HTTP vantage (e.g. DNS_FAILURE) count.
- `@callable getUptime(watchId, days = 7): Promise<UptimeStats | null>`, days clamped 1..30; reads own SQL reports with `trigger = 'watch'`.

### Classify / explain (P2)

- N9: SLOW threshold `max(3000, 3 × baseline.medianMs)` (3000 without baseline), for edge and median region. Slow-edge signal: "3.8x slower than usual from FRA (normally 1500ms)".
- RDAP: DNS_FAILURE with past `expiresAt` → signal "The domain registration expired N days ago" and "The owner must renew the domain" first in `Classification.hints`. Verdict/confidence unchanged.
- authNs lines only after a public resolver failed: resolver-side/DNSSEC problem (an NS answered rcode 0 with addresses), "The domain's nameservers are failing", or "Couldn't query the nameservers directly (no data)".
- N10: "The vendor acknowledged the incident N min after our probes first failed", every verdict, only when `vendorAckAt >= firstFailureAt`.

### Routes and client (P2)

| Route                  | Behavior                                                                                                                                                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /api/trends`      | `TrendsDO("global").list()` → `TrendItem[]`. Rate key `report:<ip>`. `cache-control: public, max-age=60`, CORS `*`. Covered by `run_worker_first` `/api/*`                                                                     |
| `/trending`            | SPA route (`app.tsx`, `TrendingPage.tsx`) rendering `/api/trends`                                                                                                                                                              |
| `public/fallback.html` | N13. Self-contained static page (no Worker, no build step) that runs a browser-only probe, labels the result "browser-only", and links cloudflarestatus.com. Also deployed to GitHub Pages so it works when Cloudflare is down |

---

## Wave P1 (prep done; spec: `docs/COMPETITOR_SPEC.md` §4 P1)

### Shared types added (all additive / optional, see `src/shared/types.ts`)

| Type / field                                                                  | Purpose                                                                                                             |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `ProviderInfo { id, name, via[] }`                                            | N1 fingerprint. `id` (e.g. `"fastly"`) is also the `ProviderDO` name                                                |
| `ProviderStats { provider, windowMinutes, otherHosts, otherFailing }`         | N1 blast radius. **Counts only, never other hostnames** (privacy)                                                   |
| `StatusIncident`, `StatusPageInfo`                                            | N2 vendor status page / R18 cloudflarestatus, normalized from Atlassian Statuspage `summary.json`                   |
| `BrowserEnv`, `BrowserProbe.env?`                                             | N4/N7: `/cdn-cgi/trace` fields (`warp`, `gateway`, `loc`; never `ip`, reports are public), `traceBlocked`, `timeZone`, `tzMismatch`, `ipv6`. Hints only, never verdict drivers |
| `ProbeResult.providerHeaders?`                                                | lowercase fingerprint header names present on the final hop (list in the type's doc comment)                        |
| `Evidence.provider?`, `providerStats?`, `statusPage?`, `cfStatus?`, `expect?` | new evidence inputs; `null` = step skipped/failed, `undefined` = older report                                       |
| `Classification.factors?`, `hints?`, `selfSuspect?`                           | N8 confidence breakdown; user-side next steps; R18 reasons (non-empty = banner + confidence capped at 0.7)          |
| `StepName` += `"provider"`, `"status"`                                        | `STEP_ORDER` = dns, edge, regions, radar, provider, status, browser, crowd, classify, explain                       |
| `DiagnoseParams.expect?`, `Watch.expect?`, `Watch.until?: "recovered"`        | R4 keyword; one-shot watches deleted after the confirmed recovery alert                                             |
| `REPORT_TTL_DAYS = 30`                                                        | R17                                                                                                                 |
| `HostSample`, `HostHistory`                                                   | per-host sparkline + badge source                                                                                   |
| `CheckOutcome` (ok) += `subtype?`, `provider?` (`ProviderInfo.name`)          | API/MCP summary                                                                                                     |
| `RunPoll = { status: "running", runId, host? } \| CheckOutcome`               | `GET /api/v1/runs/:id`, MCP `get_check`                                                                             |
| `ExportBundle { exportedAt, watches, alerts, history }`                       | `@callable exportData()`                                                                                            |

Persisted runs from before P1 lack the `provider`/`status` step keys; readers must treat a missing step as `pending` (`DiagnosisCard` skips it, `user-agent.ts` defaults it).

### `src/lib/provider.ts` (pure, unit-tested; new)

```ts
export function fingerprint(input: {
  // alias: fingerprintProvider
  cnames: string[]; // DnsResult.cnames (both resolvers merged)
  server?: string; // ProbeResult.server
  cfRay?: string; // ProbeResult.cfRay
  providerHeaders?: string[]; // ProbeResult.providerHeaders
  asn?: number; // RadarEvidence.targetAsn
}): ProviderInfo | null;
```

- Static table: CNAME suffixes (`cloudfront.net`, `akamaiedge.net`, `fastly.net`, `azurefd.net`, `cdn.cloudflare.net`, `vercel-dns.com`, `netlify.app`, `herokudns.com`, `github.io`), headers (`cf-ray`, `x-amz-cf-id`, `x-served-by`/`x-fastly-request-id`, `x-azure-ref`, `server: AkamaiGHost`, `x-vercel-id`, `x-nf-request-id`, `x-github-request-id`), CNAMEs also `akamai.net`, `edgekey.net`, `fastlylb.net`, `azureedge.net`, `netlifyglobalcdn.com`. ASNs (13335 Cloudflare, 16509/14618 AWS, 54113 Fastly, 8075 Microsoft Azure, 20940/16625 Akamai, 15169/396982 Google Cloud). Ids are kebab-case (`cloudfront`, `azure-front-door`, `github-pages`, `aws`, `microsoft-azure`, `google-cloud`, ...).
- `via` lists every signal kind that matched the winning provider. CNAME beats header beats ASN on conflict.
- `probes.ts httpProbe` sets `providerHeaders` from the final hop's response headers (only the names in the list above).

### `ProviderDO` (`src/agents/provider-do.ts`), plain `DurableObject<Env>`, one per provider id

Get one with `env.PROVIDER_DO.getByName(provider.id)`.

```ts
record(host: string, ok: boolean, at: number): Promise<void>        // upsert latest {host, ok, at}; drop rows older than 1 h
stats(excludeHost: string, windowMinutes = 10): Promise<ProviderStats>
// distinct hosts (excluding excludeHost) with a row in the window, and how many of them are failing (latest row !ok)
```

- `stats().provider` is the DO name, i.e. `provider.id`; `classify` ignores stats whose `provider` differs from `evidence.provider.id`.
- SQL table `hits(host TEXT PRIMARY KEY, ok INTEGER, at INTEGER)`. Never returns hostnames. `// ponytail:` no canary probes.
- R9: provider attribution (UPSTREAM_OUTAGE / "X is failing") needs `otherFailing >= 3`, **or** the vendor status page showing an incident; server vantages must fail too. A single site failing on AWS is never an "AWS outage".

### `src/lib/statuspage.ts` (pure parse + fetch; new) and `src/lib/status-pages.json`

```ts
export const CF_STATUS_URL =
  "https://www.cloudflarestatus.com/api/v2/summary.json";
export function statusPageUrl(
  host: string
): { url: string; source: "curated" | "statuspage" } | null;
//   curated map (status-pages.json: apex -> summary.json URL, ~40 hosts) first, else https://status.<apex>/api/v2/summary.json
//   (apex = last two labels, `ponytail:` no PSL). null for IP literals / single labels, and for an uncurated host
//   under a multi-tenant suffix (pages.dev, workers.dev, github.io, netlify.app, vercel.app, herokuapp.com, web.app,
//   firebaseapp.com, fly.dev, onrender.com, azurewebsites.net, cloudfront.net, appspot.com): status.<suffix> is some tenant's site.
export function parseStatuspage(
  json: unknown,
  url: string,
  source: StatusPageInfo["source"],
  now: number
): StatusPageInfo | null;
//   Atlassian summary.json only: status.indicator/description, incidents[] (unresolved, <= 5), components[] with status not "operational"/"under_maintenance" -> componentsDown (<= 10)
export async function fetchStatusPage(
  url: string,
  source: StatusPageInfo["source"]
): Promise<StatusPageInfo | null>;
//   guardUrl(url) first (SSRF), redirect "manual", 5 s timeout, 256 KB body cap. Anything else (HTML, 3xx, 404, bad JSON/shape) -> null ("no status page found"). Never throws.
```

- Only JSON Statuspage plus the curated list. Never scrape HTML.
- `TargetDO.statusPage(host)` memoizes it 60 s. Cloudflare's own status (R18) is `env.TARGET_DO.getByName("cloudflare.com").cfStatus()` (memo `"cfstatus"`, 60 s), so it is cached once for everyone.

### `src/lib/bundle.ts` (pure; implemented, `test/bundle.test.ts`)

```ts
export function supportBundle(report: Report, origin: string): string;
```

Plain-text evidence bundle for ISP/vendor support (N5): UTC timestamps, target, verdict + subtype + confidence, user ASN/country (from `publicNetInfo`, so no city, no device id), per-vantage results (edge, each region with colo), resolver comparison, provider/status page if present, signals, report link `origin + "/r/" + host + "/" + id`. Served by `GET /api/report/:host/:id.txt` and the "Copy for support" button.

### `src/lib/badge.ts` (pure, `test/badge.test.ts`)

```ts
export function badgeSvg(latest: HostHistory["latest"], now: number): string;
```

Shields-style "isitme | <label> <age>" SVG. Labels/colors are a local map (no client imports). `latest` null or older than 24 h → grey "unknown". All text XML-escaped.

### Workflow additions (`src/workflow/diagnose.ts`)

- `DiagnoseParams.expect` → `evidence.expect`, and passed to `t.edge(url, runId, expect)` / `t.regions(url, expect)` / `ProbeDO.probe(url, region, checkId?, expect?)` (the memo keys include `expect`). `root`/`alt` probes don't pass it.
- **`provider`** and **`status`** steps run in parallel after edge/regions/radar (and root/alt); both skipped ("DNS failed") when the domain failed DNS, and never fail the run (error/skipped only).
- **`provider`**: `fingerprint({ cnames: [...dns.cnames, ...dnsAlt.cnames], server/cfRay/providerHeaders from edge, asn: radar?.targetAsn })`. If found: `PROVIDER_DO.getByName(id).record(host, serverOk, startedAt)` (serverOk = majority of answering edge+region vantages ok; not recorded when none answered) then `.stats(host, 10)` → `evidence.provider`, `evidence.providerStats`. Summary "Fastly · 2 of 9 other sites failing". Skipped with "no provider fingerprint" when null.
- **`status`**: `Promise.all([t.statusPage(host), TARGET_DO("cloudflare.com").cfStatus()])` → `evidence.statusPage`, `evidence.cfStatus`. Summary "<indicator>: <description>" or "no status page found", plus " · Cloudflare: <description>" when cloudflarestatus is not `none`.
- `classify` then uses them: R9 provider attribution, N2 "vendor says operational; 4/5 regions failing", R18 `selfSuspect` (cfStatus non-operational component; target behind Cloudflare with Cloudflare-generated 5xx outside 520–530 across ≥2 colos; CF DoH failing while Google works), `factors[]`, `hints[]` from `browser.env`.
- P2: steps `authns` (only when a resolver failed), `rdap` (only when either rcode is 3, on the registrable domain) and `baseline` (`t.baseline(edge.colo)`) run in parallel before the browser step, no progress cards, `null` on failure, spread into evidence before classify. After classify, when `statusPage` has incidents, step `statuslag` → `t.statusLag(statusPage, down ? startedAt : undefined)` → `evidence.statusLag` before explain. The save step records non-HEALTHY runs to `TRENDS_DO("global")` (errors logged). `median()` lives in `src/lib/history.ts`.

### TargetDO samples and retention

```ts
hostHistory(): Promise<HostHistory>
getReportStatus(id: string): Promise<{ report: Report } | { expired: true } | null>
statusPage(host: string): Promise<StatusPageInfo | null>   // memo("status:"+host) -> statusPageUrl + fetchStatusPage
cfStatus(): Promise<StatusPageInfo | null>                 // memo("cfstatus") -> fetchStatusPage(CF_STATUS_URL, "curated")
alarm(): Promise<void>                                     // R17 sweep
```

- `saveReport` also inserts one `samples(at INTEGER, ms REAL, ok INTEGER, verdict TEXT, colo TEXT, report_id TEXT)` row when the report row is new (edge ms/colo, `ok = VERDICT_CLASS[verdict] !== "down"`, verdict), prunes samples to 24 h / 2000 rows, and sets an alarm (now + 1 day) if none exists.
- `hostHistory` returns the newest 288 samples of the last 24 h (oldest first) and `latest` = newest sample's `{ verdict, at, reportId }`. SQL only: it never probes (R19).
- **Retention (R17)**: `alarm()` sets `json = NULL` on reports with `created_at < expireBefore(now)` (`src/lib/retention.ts`: `now - REPORT_TTL_DAYS days`), keeping the row as a tombstone, prunes samples, and re-arms for 1 day while live reports or samples remain. `getReport` / `appendExtraCheck` return `null` for a tombstone or a row past the TTL the alarm hasn't swept yet; `getReportStatus` returns `{ expired: true }` for those, `{ report }` when live, `null` when the id never existed.

### UserAgent additions (`src/agents/user-agent.ts`)

```ts
// Server RPC (API + MCP)
startCheck(input: string, user: NetInfo, trigger: "api" | "mcp", opts?: { expect?: string }):
  Promise<{ ok: true; runId: string; host: string } | { ok: false; host?: string; error: string }>
getRun(runId: string): Promise<RunPoll | null>          // running -> { status: "running" }, done -> CheckOutcome, unknown -> null
checkNow(input, user, trigger, opts?: { expect?: string })   // gains opts
// @callable
exportData(): Promise<ExportBundle>                     // client saves it as isitme-export.json
```

- The `diagnose` and `watch` chat tools gain an optional `expect` string; `watch` gains `until?: "recovered"`. A watch with `until: "recovered"` is removed (schedule cancelled) right after its confirmed recovery alert fires.
- `CheckOutcome` fills `subtype` and `provider` from the report.
- api/mcp runs are rows in `api_runs(id TEXT PRIMARY KEY, host TEXT, created_at INTEGER, outcome TEXT)`: inserted by `startRun`, `outcome` (CheckOutcome JSON) set in `onWorkflowComplete`/`onWorkflowError`, pruned after a day with `reports`. A row with no outcome after `STALE_RUN_MS` polls as `{ ok: false, error: "lost track of this run" }`.
- `exportData` returns synced state as is (webhook URLs included: it is the device owner's own download).
- Runs are only pollable through the agent that started them (`api-<hashIp>`, or the MCP session's shard), so a run id leaks nothing to other callers.

---

## Pure libraries

### `src/lib/probes.ts` (runtime-agnostic: runs in the Worker AND the browser)

It uses only `fetch`, `AbortSignal.timeout`, `performance.now()`, `URL`, and the pure `guard.ts`. There are no `cloudflare:*` imports and no `Env`.

```ts
export interface HttpProbeOptions {
  timeoutMs?: number; // 8000
  retryTimeoutMs?: number; // 15000, 0 disables the retry
  maxRedirects?: number; // 5
  hopGuard?: (url: string) => Promise<string | null>; // null = safe, string = refusal reason
  expect?: string; // must appear in the first 64 KB of a 2xx HTML body
  checkId?: string; // sent as `x-isitme-check: <checkId>`; TargetDO passes a fresh UUID per probe, never the run/report id
}
export async function httpProbe(
  url: string,
  opts?: HttpProbeOptions
): Promise<ProbeResult>; // GET only; the HEAD option is removed
export async function dohLookup(
  host: string,
  opts?: {
    timeoutMs?: number;
    resolver?: "cloudflare" | "google";
    checkDnssec?: boolean; /* true */
  }
): Promise<DnsResult>;
export async function guardUrl(url: string): Promise<string | null>; // normalizeTarget + dohLookup + assertSafeTarget
export function detectBlock(
  status: number,
  headers: Headers,
  body: string
): BlockKind | undefined;
export function pageFlags(
  body: string,
  expect?: string
): { title?: string; bytes: number; flags: PageFlags };
export async function egressColo(): Promise<string | undefined>;
```

- **None of these ever throw**, except the pure helpers on impossible input. Failures come back inside the result.
- **`dohLookup`**
  - Resolvers: `cloudflare` → `https://cloudflare-dns.com/dns-query`, `google` → `https://dns.google/resolve` (same JSON shape). Sets `resolver`.
  - Two parallel GETs, `?name=<host>&type=A|AAAA`, `accept: application/dns-json`.
  - `rcode` is the A query's `Status`, or `-1` if the fetch failed.
  - `addresses` holds only type 1/28 answers. `cnames` holds only type 5 answers, trailing dot stripped. `ok = rcode === 0 && addresses.length > 0`. `ms` is wall time.
  - **DNSSEC (R11)**: when `checkDnssec` and `rcode === 2`, re-query A with `cd=1`. NOERROR there sets `dnssecFailed: true` (the result stays `ok: false`, rcode 2).
- **`httpProbe`**
  - GET, `redirect: "manual"`, `user-agent: IsItMe/1.0 (+https://github.com/…/cf_ai_isitme)`, plus `x-isitme-check` when `checkId` is set.
  - **Redirects (R5)**: follows 301/302/303/307/308 up to `maxRedirects`, resolving `Location` against the current URL. Before each hop (not the first request, which the workflow already guarded) it awaits `hopGuard(next)`; a non-null answer stops the probe **without fetching**: `{ ok: false, refused: reason, errorClass: "unknown", chain }`. When `maxRedirects` runs out, or the next hop is already in `chain` (a loop), the probe stops with `{ ok: false, errorClass: "unknown", error: "redirect loop", status: <last 3xx>, redirectedTo, chain }`: browsers fail these with ERR_TOO_MANY_REDIRECTS. `chain` lists every hop `{url, status}` including the final one; `status`, `server`, `cfRay`, `redirectedTo` describe the final hop. `ms` runs from probe start to the final hop's headers (redirect hops included).
  - **Body (R1, R4)**: reads at most 64 KB (stream, then cancel) on 2xx `text/html` and on 403/429/451/503; otherwise cancels unread. Sets `bytes`, `title`, `flags` from `pageFlags`, `blocked` from `detectBlock`.
  - **`ok`** = the final hop answered 2xx/3xx/4xx, **or** `blocked` is set (then `errorClass: "blocked"`, `ok: true`). 5xx, 525/526 and 530 are failures.
  - **Retry (R2)**: on `timeout` or `connect`, retry once with `retryTimeoutMs`. The retry's result wins and gets `retried: true` (its `ms` is the retry's).
  - `ms` covers the time from before the (final) fetch until headers arrive.
  - `errorClass`, first match wins:

    | Failure                                       | `errorClass`                                                  |
    | --------------------------------------------- | ------------------------------------------------------------- |
    | timeout                                       | `"timeout"`                                                   |
    | status 525/526, or TLS/cert text in the error | `"tls"`                                                       |
    | status 530, or DNS text in the error          | `"dns"`                                                       |
    | connection refused/reset                      | `"connect"`                                                   |
    | status 520–524                                | `"http_5xx"`, plus `cdnOrigin: true` when `cf-ray` is present |
    | any other status ≥ 500                        | `"http_5xx"`                                                  |
    | bot block (`detectBlock` hit)                 | `"blocked"` (with `ok: true`)                                 |
    | anything else                                 | `"unknown"`                                                   |

- **`detectBlock`** (R1): `cf-mitigated: challenge` → `challenge`; `server: cloudflare` + 403/503 + body `/Just a moment|cf-chl|challenge-platform/` → `challenge`; `server: AkamaiGHost` + 403 + "Access Denied" → `waf`; `x-datadome` or `x-dd-b` header → `waf`; 429 → `rate_limit`; 451 → `geo`. Else `undefined`.
- **`pageFlags`** (R4): `bytes` = body length; `title` from `<title>` (trimmed, ≤120 chars); `empty` = fewer than 512 non-whitespace body chars **and** fewer than 64 non-whitespace visible-text chars (deviation: the plain 512 rule flagged example.com) **and** no `<script src=…>` and no `<div id="root|app|__next|__nuxt|svelte…">` mount node (an SPA shell is not empty); `errorPage` = `/\b(404|not found|error|service unavailable|bad gateway|maintenance)\b(?!-)/i` matches the title, or (visible text < 2048 chars) the first 200 chars of visible text or the `<h1>`; `parked` = `/domain (is )?for sale|parked|sedoparking|godaddy.*parked/i`; `expectMissing` = `expect` given and not in the body. Only set flags that are true.
- **`guardUrl`**: returns `null` when the URL passes `normalizeTarget`, resolves via Cloudflare DoH, and passes `assertSafeTarget`; otherwise the reason. Same DNS-rebinding ceiling as the guard.
- **`egressColo`**: fetches `https://www.cloudflare.com/cdn-cgi/trace` and parses the `colo=` line.

### `src/lib/guard.ts` (pure, fully unit-tested)

```ts
export class GuardError extends Error {}
export function normalizeTarget(input: string): Target | { error: string };
export function isForbiddenAddress(ip: string): boolean;
export function assertSafeTarget(target: Target, resolved: string[]): void; // throws GuardError
```

- **`normalizeTarget`**
  - Trims the input and adds `https://` if there is no scheme.
  - Allows only the `http:` and `https:` schemes.
  - Rejects inputs that have credentials, have no dot in a non-IP host, or are longer than 2048 chars.
  - Rejects `localhost`, `*.localhost`, `*.local`, `*.internal`, and `*.home.arpa`.
  - Rejects a forbidden IP literal.
  - Lowercases the host and strips the fragment. The `URL` API already turns IDNs into punycode.
  - `isIpLiteral` is true for IPv4, and for bracketed IPv6 (brackets are stripped in `host`).
  - Allows non-default ports.
- **`isForbiddenAddress`**: returns true for these ranges.
  - IPv4: 0/8, 10/8, 100.64/10, 127/8, 169.254/16 (incl. metadata), 172.16/12, 192.0.0/24, 192.0.2/24, 192.168/16, 198.18/15, 198.51.100/24, 203.0.113/24, 224/4, 240/4, and 255.255.255.255.
  - IPv6: ::, ::1, fc00::/7, fe80::/10, ff00::/8, and 64:ff9b::/96 + ::ffff:0:0/96 (checked against the embedded v4).
  - Garbage input is forbidden.
- **`assertSafeTarget`**: throws if the IP literal is forbidden or if any resolved address is forbidden.
- **Known ceiling:** DNS rebinding between the check and the fetch. Mark it with `// ponytail:` and don't solve it.

### `src/lib/classify.ts` (pure, deterministic, fully unit-tested)

```ts
export function classify(evidence: Evidence): Classification; // verdict, subtype?, confidence, signals
```

**Vantage set.** Server vantages = `edge` plus `regions`, minus any with `noData` or `vantageSick` (each excluded one adds a signal like `"apac: no data"` and lowers confidence). Vantages are **deduplicated by `colo`** (R7): a colo counts as failing only if every probe in it failed; a vantage with no `colo` counts on its own. "Failing" = `!ok`; "answering" = `ok` (a `blocked` probe answers). Ratios use distinct colos only.

Rules in order, first match wins:

1. **DNS_FAILURE** (R11): `dns` failed with rcode ≠ -1, **and** `dnsAlt` is missing or failed with the same rcode. Subtype `dnssec` if either has `dnssecFailed`, `nxdomain` for rcode 3. If only one resolver fails, no verdict: add signal `"resolver <name> failing"` and continue. If the browser DoH resolves but the edge doesn't, it's still DNS_FAILURE, with a signal.
2. **UPSTREAM_OUTAGE** (R9): a BGP event with `confidence ≥ 8`, ongoing or ended ≤ 2h before `startedAt`, one of whose `prefixes` contains the target IP, **and** ≥ 50% of distinct server colos failing. Weaker events are context signals only.
3. **TLS_ERROR** (R3): at least one server vantage, and every failing distinct colo failed with `errorClass: "tls"`, and no colo answered.
   A colo fails when **more than half** of its probes fail; an even split (edge and a region in one colo disagreeing) drops the colo as no data.
4. **DOWN_GLOBAL** (R7): ≥ 2 distinct colos failing **and** ≥ 80% of distinct colos failing. Subtype `origin` when any failure has `cdnOrigin`.
5. **DOWN_REGIONAL** (R7): ≥ 1 distinct colo failing and ≥ 1 answering. Subtype `origin` as above.
6. **INCONCLUSIVE** (R12): fewer than 2 distinct server colos, unless there is exactly 1, it answered, and the browser reached the target (they agree). Also when every server vantage is noData. With a reachable browser add `"your browser could reach it"`. Replaces the old `DOWN_GLOBAL 0.5` / `HEALTHY 0.5` fallbacks.
7. **PARTIAL** (R4, R5): all answering server vantages are reachable, and (a) a majority of them carry `flags.empty | errorPage | parked | expectMissing` → subtype `parked` > `expect_missing` > `error_page` > `empty` (first present wins), or (b) the final status is 404/410 and `root?.ok` → subtype `path_not_found` ("the site is up; this page returns 404").
8. **ISP_OUTAGE** (R10): browser unreachable (or crowd failures concentrated in the user's ASN), server colos answering, and a Radar outage/anomaly for the user's ASN or country that is ongoing (`endDate == null`) or ended ≤ 2h before `startedAt`. Older ones only add `"earlier today: …"`.
9. **LIKELY_YOUR_NETWORK**: browser unreachable, `!online`, or `!controlReachable`, and server colos answering. Crowd failures concentrated in the user's ASN also count.
10. **BLOCKED** (R1): every answering server vantage is `blocked`. Subtype = the block kind (`challenge`/`waf`/`rate_limit`/`geo`). A reachable browser raises confidence. (A failing browser was already handled by rules 8–9.)
11. **SLOW**: edge `ms` ≥ 3000 or the median region `ms` ≥ 3000 (a `retried` success counts, with its retry `ms`).
12. **HEALTHY**: otherwise.

- `confidence` is 0.5 to 0.95. More agreeing distinct colos raise it; missing or noData vantages lower it. **Crowd data moves it by at most ±0.1 and never changes the verdict** (R14).
- `signals` are short, factual English, e.g. `"2/3 regions (distinct colos) failed (wnam: HTTP 503, apac: timed out)"`. The `Location` header and page `title` are target-controlled: repeat only a host, never raw text.
- Missing evidence (`null`, `radar.skipped`, Radar errors) is never a failure and never "no outage": the signal says `"Radar: no data"`.
- `evidence.alt` (www./apex fallback) adds a signal like `"www.example.com works"`; it never changes the verdict.
- **P1 additions.** R9 provider blame only on DOWN\_\* (+0.05 factor). R18 `selfSuspect` caps confidence at 0.7; its cloudflarestatus reason needs a component down or a `major`/`critical` indicator (a lone minor incident is not enough). Status-page `"maintenance"` is never treated as an incident (Cloudflare nearly always has one); `statusBad` holds the rule. Provider↔status-page match is by the first word of `provider.id` in the status host, and only for a `source: "curated"` page (`cloudflare` uses `cfStatus`); an uncurated `status.<apex>` guess never blames a provider.
- **`factors`** (N8): `{label, delta}` with deltas rounded to 3 decimals, base first. Their sum equals confidence **before** clamping and before the two 0.7 caps (selfSuspect; single colo without browser), which are not listed as factors.
- Local dev caveat: every region runs in one colo. Deliberate R12 deviation: a single answering colo with no failures still reaches PARTIAL/SLOW/HEALTHY (HEALTHY capped at 0.7 without a browser); INCONCLUSIVE is used when a lone colo fails or nothing answers.

### `src/lib/radar.ts`

```ts
export async function gatherRadar(
  env: Pick<Env, "RADAR_TOKEN">,
  input: RadarInput
): Promise<RadarEvidence>;
```

- **No token**: returns `{ skipped: true, skipReason: "no RADAR_TOKEN", outages: [], anomalies: [], bgp: [], errors: [] }`.
- **Calls**: base `https://api.cloudflare.com/client/v4/radar/`, header `Authorization: Bearer <token>`, 8s timeout each. The calls run in parallel via `Promise.allSettled`:
  - `entities/asns/ip?ip=<targetIp>` sets `targetAsn` and `targetAsName`.
  - `annotations/outages?dateRange=1d&asn=<userAsn>` and `annotations/outages?dateRange=1d&location=<userCountry>` fill `outages`.
  - `traffic_anomalies?dateRange=1d&status=VERIFIED&asn=` and `&location=` fill `anomalies`.
  - After `targetAsn` is known: `bgp/hijacks/events?involvedAsn=<targetAsn>&dateRange=1d` and `bgp/leaks/events?involvedAsn=<targetAsn>&dateRange=1d` fill `bgp`.
- **Response wrapper**: `{ success, result }`.
- **Failures**: each failed call pushes a string onto `errors`. The result is `skipped: true` only if every call failed.
- **Never throws.**

### `src/lib/explain.ts`

```ts
export async function explain(
  env: Pick<Env, "AI">,
  evidence: Evidence,
  classification: Classification
): Promise<string>;
```

- Model: `MODEL` from `src/shared/types.ts`, called with `generateText` + `createWorkersAI({ binding: env.AI })`, or with `env.AI.run` directly.
- **The system prompt must say:**
  - The verdict is final. Don't change it.
  - Explain in 2 to 4 sentences, then give up to 3 concrete next steps.
  - Use only facts in the JSON.
  - Say "your browser could reach it", never "it returned 200", for the browser vantage.
- **Input**: the evidence goes in as compact JSON (drop empty arrays).
- **Output**: markdown under 120 words.
- `compactEvidence` cuts every `name` and `description` string to 80 chars (vendor-written status-page text) before it reaches the model.
- The output goes through `filterUngrounded(text, groundingText(evidence, classification))`: sentences naming a provider absent from the evidence are dropped. `groundingText` is the compact evidence minus plumbing that always names Cloudflare/Google (`resolver`, `server` fields, "Cloudflare's edge/locations/probes/WARP/Gateway" wording) and minus `cfStatus` unless `selfSuspect` is set. On an AI error or an empty filtered answer it returns `fallbackExplanation(classification)` (templates from `NEXT_STEPS` / `NEXT_STEPS_BY_SUBTYPE`, < 120 words). Never returns `""`, never throws.

### `src/lib/net.ts`

`netInfo(request): NetInfo`, `publicNetInfo(n)` (drops `city`), `clientIp(request)` (IPv4 as-is; IPv6 reduced to its `/64`, e.g. `2001:db8:1:2::/64`, since a client owns the whole /64), `hashIp(ip): Promise<string>` (16 hex chars, moved from user-agent.ts).

### `src/lib/browser-probe.ts` (pure)

```ts
export function parseBrowserProbe(
  raw: unknown
): { ok: true; probe: BrowserProbe | null } | { ok: false; error: string };
export function sanitizeProbe(p: Partial<BrowserProbe> | null): BrowserProbe; // moved from user-agent.ts
export function browserVantage(
  p: Partial<BrowserProbe> | null
): BrowserProbe | null; // moved; null when untestable
```

- **`parseBrowserProbe`** (R15): `null` → `{ ok: true, probe: null }`. Otherwise a strict shape check: booleans are booleans, `method` is one of the three, `ms` is 0–60000, strings (incl. `error`) ≤ 300 chars, `dns` and `dnsAlt` are `null`/absent or a valid `DnsResult` (rcode integer, ≤ 20 addresses/cnames matching the IP/hostname patterns). Any violation → `{ ok: false, error }` (the route replies 400; `submitBrowserProbe` drops it). Unknown keys are dropped. A valid probe goes through `sanitizeProbe` (which stamps `at` and caps strings) and keeps `dnsAlt` and `env` (N4/N7; each `BrowserEnv` field kept only with the right type, strings capped, unknown keys dropped; `env` is not a reason to 400).

### `src/lib/alerts.ts` (pure)

```ts
export interface WatchDecision {
  watch: Watch; // lastVerdict, pending fields, openIncidentId updated
  alert?: {
    kind: "down" | "recovered";
    from?: Verdict;
    to: Verdict;
    incidentId: string;
  };
  confirm: boolean; // schedule a confirm checkWatch in 60 s
  incidentUpdate?: { incidentId: string; to: Verdict }; // same-class move: update the open alert, no webhook
}
export function decideWatch(
  watch: Watch,
  verdict: Verdict,
  newId: () => string
): WatchDecision;
export function canAddWatch(watches: Watch[], host: string): string | null; // error text or null
```

See **Watch logic** below for the semantics.

---

## Durable Objects

### `TargetDO` (`src/agents/target-do.ts`), plain `DurableObject<Env>`, one per hostname

Get one with `env.TARGET_DO.getByName(target.host)`.

**Coalescing decision:** TargetDO **runs the probes itself**. Every probe method is wrapped in one private helper:

```ts
private memo<T>(key: string, fn: () => Promise<T>): Promise<T>
// in-memory: inflight Map<string, Promise<T>> + cache Map<string, { at: number; value: T }>
// cache hit if Date.now() - at < PROBE_CACHE_TTL_S * 1000; otherwise join inflight; otherwise run fn.
// On a real run: console.log(`[TargetDO ${host}] probe run ${key}`) (this is the verification #4 signal).
```

- The workflow calls one TargetDO method per `step.do`. Each step coalesces on its own, so the live card still gets per-step progress, and 1000 concurrent users still trigger one probe run per step per 60s.
- Failed results are cached too, because they are results, not throws.

RPC methods:

```ts
dns(host: string): Promise<{ dns: DnsResult; dnsAlt: DnsResult }>
                                                      // memo("dns:"+host) -> dohLookup(host, cloudflare) and (google) in parallel.
                                                      // Throws only when BOTH have rcode -1 (not cached, step retries).
edge(url: string, expect?: string, exact = false): Promise<ProbeResult>
                                                      // memo("edge:"+url+expect) ->
                                                      // httpProbe(url, { hopGuard: guardUrl, checkId: crypto.randomUUID(), expect }) + colo = await egressColo()
                                                      // Over PROBE_BUDGET (12 runs/host/min) a fresh or in-flight result for another path stands in,
                                                      // only with the same `expect` and no `refused` (canSubstitute, src/lib/target-rules.ts).
                                                      // exact = true (R5e root probe, R5f www alt) never takes a stand-in.
regions(url: string, expect?: string): Promise<RegionProbe[]>
                                                      // memo("regions:"+url+expect) -> one entry per REGION:
                                                      //   env.PROBE_DO.getByName(`probe-${r}`, { locationHint: r }).probe(url, r, undefined, expect)
                                                      //   A rejected RPC becomes { region: r, ok: false, ms: 0, noData: true, error: "probe unavailable" } (R6).
                                                      //   confirmSick: tally-based vantageSick survives only when >= 3 regions answered ok.
radar(input: RadarInput): Promise<RadarEvidence>      // memo("radar:"+JSON.stringify(input)) -> gatherRadar(this.env, input)
recordCheck(check: CrowdCheck): Promise<void>         // SQL insert; trims rows older than 1h
crowdStats(windowMinutes = 10): Promise<CrowdStats>   // SQL aggregate over the window; byAsn/byCountry sorted by failing desc, top 10
saveReport(report: Report, ownerId: string): Promise<void>
getReport(id: string): Promise<Report | null>          // report + its extraChecks; null when unknown or expired. Never returns ownerId or ExtraCheck.voter.
appendExtraCheck(reportId: string, check: ExtraCheck, voter: string): Promise<{ ownerId: string } | "full" | null>
                                                      // null if unknown report. voter = hashIp(clientIp): one entry per voter (a re-check replaces it).
                                                      // "full" at MAX_EXTRA_CHECKS (20): new voters are refused, old entries never evicted.
hostHistory(): Promise<HostHistory>                    // P1, see "TargetDO samples and retention"
getReportStatus(id: string): Promise<{ report: Report } | { expired: true } | null>   // P1, R17
statusPage(host: string): Promise<StatusPageInfo | null>                              // P1, N2
cfStatus(): Promise<StatusPageInfo | null>                                            // P1, R18
baseline(colo: string): Promise<Evidence["baseline"]>                                // P2 N9: median ms of ok samples for colo over 24 h; null below 10 samples
statusLag(statusPage: StatusPageInfo | null, failingNowAt?: number): Promise<Evidence["statusLag"]>  // P2 N10: null without unresolved incident or failing streak
```

SQL goes through `this.ctx.storage.sql.exec(...)`. Tables:

- `checks(at INTEGER, ok INTEGER, ms REAL, asn INTEGER, as_name TEXT, country TEXT, colo TEXT, source TEXT)`
- `reports(id TEXT PRIMARY KEY, owner_id TEXT, created_at INTEGER, json TEXT)` (`json` NULL = expired tombstone)
- `samples(at INTEGER, ms REAL, ok INTEGER, verdict TEXT, colo TEXT, report_id TEXT)`

`extraChecks` are stored inside the report json, via read-modify-write.

### `ProbeDO` (`src/agents/probe-do.ts`), plain `DurableObject<Env>`, one per region

```ts
probe(url: string, region: RegionHint, checkId?: string, expect?: string): Promise<RegionProbe>
// const [r, colo, controls] = await Promise.all([
//   httpProbe(url, { hopGuard: guardUrl, checkId, expect }), egressColo(),
//   control fetches: https://www.cloudflare.com/cdn-cgi/trace and https://www.google.com/generate_204 (5s timeout each)
// ]); return { ...r, colo, region, ...sick }
```

- **Controls (R6)**: they run alongside every probe. If the target probe failed **and** both controls failed, return `noData: true, vantageSick: true` (the vantage is broken, not the target). If the target answered, ignore the controls.
- **Rolling tally (R6)**: an in-memory 5-minute map of `host → last ok`. When ≥ 6 distinct hosts are in the window and more than 50% of them failed, every failure from this region gets `vantageSick: true` (not `noData`; `ok` stays as measured) for the next 5 minutes. `TargetDO.regions` does not pass `checkId` (the regions cache is keyed by URL). "While other regions see them fine" is checked in `TargetDO.regions` (`confirmSick`): the flag is dropped unless ≥ 3 regions answered ok, so a provider-wide outage can't suppress real failures. In-memory, so an eviction resets it.
- Never throws. Local dev ignores `locationHint`, so all five regions report your local colo.

---

## DiagnoseWorkflow (`src/workflow/diagnose.ts`)

```ts
export class DiagnoseWorkflow extends AgentWorkflow<
  UserAgent,
  DiagnoseParams,
  DiagnoseProgress
> {
  async run(
    event: AgentWorkflowEvent<DiagnoseParams>,
    step: AgentWorkflowStep
  ): Promise<void>;
}
```

- Binding: `DIAGNOSE_WORKFLOW`. Name: `diagnose-workflow`.
- The workflow instance id equals `params.runId`, which is also the report id. The agent passes `{ id: runId }` to `runWorkflow`.
- `const t = this.env.TARGET_DO.getByName(params.target.host)`.

### Progress

Around every step, call:

```ts
await this.reportProgress({ step, state: { status: "running", startedAt } });
// ...step...
await this.reportProgress({ step, state: { status: "done" | "skipped" | "error", startedAt, finishedAt, summary?, error? } });
```

`UserAgent.onWorkflowProgress` merges `state` into `runs[i].steps[step]`.

### Steps, in order

Step config for probes: `{ retries: { limit: 2, delay: "1 second", backoff: "exponential" }, timeout: "30 seconds" }`.

1. **`dns`**
   - If `target.isIpLiteral`, mark it skipped and set `dns = dnsAlt = null`.
   - Otherwise `{ dns, dnsAlt } = await step.do("dns", cfg, () => t.dns(host))`; both go into `Evidence`.
   - Then, **outside step.do**, call `assertSafeTarget(target, [...dns.addresses, ...dnsAlt.addresses])`. On `GuardError`, mark the step error, call `await step.reportError("blocked: " + msg)`, and return.
   - If **both** `!dns.ok` and `!dnsAlt.ok`, mark the step error (not a throw), skip `edge`, `regions`, and `radar` (status `skipped`), and continue at `browser`. One failing resolver is a signal, not a skip.
2. **`edge`**: `t.edge(url, runId)`.
   - If `edge.refused`, a redirect hop failed the guard: mark the step error and `await step.reportError("blocked: " + edge.refused)`, then return (R5c).
   - **Root (R5)**: if the URL path isn't `/` and `edge.status` is 404/410, `root = await t.edge(origin + "/")` inside the same step.
   - **Alt (R5)**: if DNS failed on both resolvers or `edge.errorClass` is `dns`/`connect`/`tls`, probe the other host once (`www.` added, or stripped): `altT = TARGET_DO.getByName(altHost)`, `altT.dns` → guard → `altT.edge(altUrl)`, in its own `step.do("alt", …)` (no progress events; failures give `alt = null`). Store `evidence.alt = { host, dns, probe }`.
3. **`regions`**: `t.regions(url)`.
4. **`radar`**: `t.radar({ targetIp: dns?.addresses[0] ?? dnsAlt?.addresses[0] ?? (isIpLiteral ? host : undefined), userAsn: user.asn, userCountry: user.country })`. The status is `skipped` if `radar.skipped`.
5. **`browser`**: only if `wantsBrowser`, otherwise `skipped`.
   - `let b = await step.do("browser-read", () => this.agent.getBrowserProbe(runId))`.
   - If `b` is null, `try { b = (await step.waitForEvent<BrowserProbe>("browser-wait", { type: "browser-probe", timeout: "15 seconds" })).payload } catch { b = null }`.
   - A null result is marked `skipped` with the summary "no result from your browser".
   - This covers both orderings: whether the probe arrives before or after the workflow reaches this step.
6. **`crowd`**
   - One `step.do`: first `t.recordCheck(...)`, then `t.crowdStats(10)`. Browser rows carry the user's `asn/asName/country/colo` and a hashed-IP `voter` (one row per voter per window); edge rows carry none of them. `byAsn`/`byCountry` count browser rows only.
   - `ok`/`ms`/`source` come from the browser if it's present, otherwise from the edge.
   - Watch/api/mcp runs record with `source: "edge"`.
7. **`classify`**: `step.do("classify", async () => classify(evidence))`.
8. **`explain`**
   - Skipped when `trigger === "watch" && classification.verdict === previousVerdict`, with `explanation = ""`.
   - Otherwise run `explain(this.env, evidence, classification)` with `{ retries: { limit: 1, delay: "2 seconds" }, timeout: "45 seconds" }`.
9. **`save`** (not a StepName, so no progress events)
   - Build the `Report`: `evidence.user = publicNetInfo(user)`, `extraChecks: []`, `id = runId`.
   - `await t.saveReport(report, ownerId)`.
   - Write an Analytics Engine data point (see below).
   - Then `await step.reportComplete<DiagnoseResult>({ runId, report, explainSkipped })`.

A step that fails after its retries (edge, regions, radar, crowd, explain) never fails the run. Catch the error, mark the step `error`, and use `null` or `[]`. Only the guard aborts the run.

**Analytics** (`this.env.ANALYTICS.writeDataPoint`), best effort in try/catch:
`{ indexes: [host], blobs: [host, verdict, trigger, user.country ?? "", user.colo ?? "", edge?.errorClass ?? ""], doubles: [totalMs, dns?.ms ?? 0, edge?.ms ?? 0, confidence] }`.

---

## UserAgent (`src/agents/user-agent.ts`), `AIChatAgent<Env, AgentState>`

### Identity

- Name = device id from the browser (must match `/^[A-Za-z0-9_-]{16,64}$/` and must not start with `api-` or `mcp-`; the server enforces both).
- API callers get `api-<hashIp(ip)>` (one agent per caller, R16). MCP gets one agent per MCP session (`mcp-<hash of the McpAgent id>`). Both are reached only server-side through `getAgentByName`. Their runs are not put in synced state, and reports older than a day are deleted.

### State (`AgentState`)

- `initialState = INITIAL_AGENT_STATE`.
- `onConnect(conn, ctx)` sets `user = netInfo(ctx.request)` and `origin = new URL(ctx.request.url).origin`.
- `runs` is newest first, capped at 20. `alerts` and `history` are capped at 50.
- **State is server-owned**: `validateStateChange(next, source)` throws for any `source !== "server"`, so a client `cf_agent_state` frame is rejected (callables that call `setState` are server writes and still work).
- **Mutate state only through synchronous read-modify-write** (`this.setState({ ...this.state, runs: ... })`) with no `await` between the read and `setState`. Concurrent workflow callbacks rely on this.

### SQL

- `reports(id TEXT PRIMARY KEY, host TEXT, created_at INTEGER, verdict TEXT, confidence REAL, trigger TEXT, json TEXT)` holds the full reports, for history.
- Watches live in state only. There are no `prefs`, because nothing needs them.

### Run lifecycle

These are internal helpers. The names are suggestions, but the behavior is fixed.

- **`startRun(target, user, trigger, { toolCallId?, watchId?, previousVerdict?, wantsBrowser }): Promise<string>`**
  1. Set `runId = crypto.randomUUID()`.
  2. Push a `RunState` with every step `pending` (`browser: skipped` if `!wantsBrowser`).
  3. Call `await this.runWorkflow("DIAGNOSE_WORKFLOW", params satisfies DiagnoseParams, { id: runId, metadata: { host, trigger } })`.
- **`waitForRun(runId, timeoutMs = 60_000): Promise<CheckOutcome>`**
  - Uses an in-memory `Map<runId, resolve>`, resolved by `onWorkflowComplete`/`onWorkflowError`.
  - On timeout (120s) it returns `{ ok: false, runId, host, error: "still running…" }`; the card follows `run.status`, not this outcome.
- **`onWorkflowProgress(_, id, p)`**: `p` is a `DiagnoseProgress`. Merge it into the run's steps.
- **`onWorkflowComplete(_, id, r)`**: `r` is a `DiagnoseResult`.
  1. Set the run to `done`, with `verdict` and `confidence`.
  2. Insert the SQL report and prepend to `history`.
  3. If `r.report.trigger === "watch"`, run the watch logic.
  4. Resolve the waiter with `CheckOutcome { ok: true, ..., reportPath: "/r/" + host + "/" + id }`.
- **`onWorkflowError(_, id, error)`**: set the run to `error`, set any `running`/`pending` steps to `error`/`skipped`, and resolve the waiter with `{ ok: false, error }`.

### Chat tools

`CHAT_MODEL` (GLM-4.7-Flash; Llama 3.3 tool-call streaming was corrupted), `stopWhen: stepCountIs(5)`. Rate-limit each turn with `env.RATE_LIMITER.limit({ key: "chat:" + this.name })`.

| tool         | input (zod)                                                                                       | behavior / output                                                                                                                                                                                           |
| ------------ | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `diagnose`   | `{ url: string }`                                                                                 | `normalizeTarget` → `startRun(..., "chat", { toolCallId, wantsBrowser: true })` → `await waitForRun`. Output: `CheckOutcome`                                                                                |
| `watch`      | `{ url: string, everyMinutes: number (MIN_WATCH_MINUTES..1440, default 5), webhookUrl?: string }` | `canAddWatch` must pass (≤ `MAX_WATCHES`, R19), then `scheduleEvery(everyMinutes*60, "checkWatch", { watchId })`, pushes a `Watch`. Output: `{ ok, watchId, host, everyMinutes }` or `{ ok: false, error }` |
| `unwatch`    | `{ hostOrId: string }`                                                                            | Matches a watch by id or host, then `cancelSchedule` and removes it. Output: `{ ok, removed: number }`                                                                                                      |
| `history`    | `{ host?: string, limit?: number (≤20) }`                                                         | SQL query. Output: `ReportSummary[]`                                                                                                                                                                        |
| `setWebhook` | `{ hostOrId: string, webhookUrl: string \| null }`                                                | Sets or clears the webhook. Output: `{ ok, watchId }`                                                                                                                                                       |

- **Webhook URL validation (SSRF)**: `normalizeTarget(webhookUrl)` must pass, the URL must be `https:`, and `dohLookup` + `assertSafeTarget` must pass.
- **System prompt**: extract the site from the message and call `diagnose`. After `diagnose` returns, reply in 1 to 2 sentences that reference the verdict. Don't repeat the explanation, because the card shows it. Never invent probe results.

### `@callable` (client → `agent.stub.*`)

```ts
submitBrowserProbe(runId: string, probe: BrowserProbe): Promise<void>
//   parseBrowserProbe(probe) first; on { error } ignore it (log). Then store in memory Map (read by getBrowserProbe), and if the run is still running:
//   this.sendWorkflowEvent("DIAGNOSE_WORKFLOW", runId, { type: "browser-probe", payload: probe }) (catch + ignore errors)
unwatch(watchId: string): Promise<boolean>
getReport(reportId: string): Promise<Report | null>   // host from own SQL -> TARGET_DO(host).getReport(id) ?? own json copy
markAlertsRead(): Promise<void>
```

### Server/workflow RPC (not callable from the browser)

```ts
checkNow(input: string, user: NetInfo, trigger: "api" | "mcp", opts?: { expect?: string }): Promise<CheckOutcome>   // wantsBrowser: false; = startCheck + wait
getBrowserProbe(runId: string): Promise<BrowserProbe | null>
onExtraCheck(host: string, reportId: string, check: ExtraCheck): Promise<void>        // broadcast AgentBroadcast "extra-check"
checkWatch(payload: { watchId: string }): Promise<void>                              // schedule callback
```

### Watch logic (R8)

`checkWatch({ watchId, confirm? })` → `startRun(..., "watch", { watchId, previousVerdict: watch.lastVerdict, wantsBrowser: false })`. On completion, `onWorkflowComplete` calls `decideWatch(watch, verdict, newId)`. There is no separate suppression flag: a run with no usable vantages classifies as INCONCLUSIVE (class `none`), which never alerts.

- The caller always updates `lastCheckedAt` and `lastReportId`; `decideWatch` returns the watch with `lastVerdict` and the pending fields updated.
- **Exactly-once**: the SDK calls `onWorkflowComplete` from a retried workflow step. `lastReportId` (and the run's `done` status) is persisted in the same `setState` as the decision, so a replay with `watch.lastReportId === report.id` or a `done` run only resolves waiters: no second `decideWatch`, alert, email or webhook.
- **Silent incidents**: `notifyFor(prev, decision, now)` (`alerts.ts`). A down alert dropped by a mute sets `watch.silentIncident`; the matching recovery is dropped too and clears it, even after the mute ended.
- **Quotas and expiry (R19)**: besides `MAX_WATCHES` per device, `TrendsDO.claimWatch(hashIp, "<agent>:<watchId>", MAX_WATCHES_PER_IP = 10)` caps active watches per client IP (IPv6 /64) across devices; `removeWatch` releases the claim, `onConnect` refreshes the device's claims. A watch whose device has not connected for `WATCH_IDLE_MS` (7 days, `lastSeenAt` in DO storage) is removed at its next `checkWatch`.
- **Classes** come from `VERDICT_CLASS`: `up` (HEALTHY/SLOW/BLOCKED), `down` (DOWN\_\*/DNS_FAILURE/TLS_ERROR/UPSTREAM_OUTAGE/PARTIAL), `none` (LIKELY_YOUR_NETWORK/ISP_OUTAGE/INCONCLUSIVE).
- **State** = class of `lastVerdict`. The first non-`none` run only sets `lastVerdict` (baseline, no alert).
- `none` → clear `pendingVerdict`/`pendingCount`, no alert.
- Class equals state → clear pending, set `lastVerdict`. If the verdict differs and an incident is open → `incidentUpdate` (update the open alert's `to`, no new webhook).
- Class differs from state → `pendingCount = (pending verdict had the same class ? pendingCount : 0) + 1`, `pendingVerdict = verdict`.
  - `pendingCount < 2` → `confirm: true`: `this.schedule(60, "checkWatch", { watchId })`.
  - `pendingCount >= 2` → clear pending, `alert.kind: "down"` (returned watch has `openIncidentId = alert.incidentId`, a fresh `newId()`) or `"recovered"` (`openIncidentId` cleared; `incidentId` = the old id, or a fresh one if none was open).
- Acceptance tests (`test/alerts.test.ts`): HEALTHY→DOWN→HEALTHY = 0 alerts; HEALTHY→DOWN→DOWN = 1; DOWN→HEALTHY→DOWN = no recovery; DOWN_REGIONAL→DOWN_GLOBAL = 0 new webhooks; HEALTHY→INCONCLUSIVE = 0.
- **`canAddWatch`**: `"watch limit reached (MAX_WATCHES)"` when `watches.length >= MAX_WATCHES` and `host` is not already watched (re-watching replaces); else `null`. The interval is clamped to `MIN_WATCH_MINUTES..1440` by the `watch` tool, not rejected.
- **Firing an alert**:
  1. Create an `Alert` with `kind` and `incidentId`. The summary is the report explanation, or a one-liner built from the signals.
  2. Prepend it to `alerts`.
  3. `this.broadcast(JSON.stringify({ type: "alert", alert } satisfies AgentBroadcast))`.
  4. If a `webhookUrl` is set, `POST` JSON `{ text, content: text, host, from, to, kind, reportUrl: origin + reportPath }` with a 5s timeout. Set `alert.webhook` to `"sent"` or `"failed"`.

---

## MCP (`src/agents/mcp.ts`)

- `IsItMeMcp extends McpAgent<Env>`, binding `MCP_OBJECT`, served by `IsItMeMcp.serve("/mcp", { binding: "MCP_OBJECT" })` (already wired in server.ts).
- Every tool returns `{ content: [{ type: "text", text: JSON.stringify(result, null, 2) }], isError }`. Summaries by default; full evidence only from `get_report`.
- Input schemas come from `src/shared/schemas.ts` (P1, new), the same zod schemas the REST handler uses (R16).

| tool          | input              | result                                                                                       |
| ------------- | ------------------ | -------------------------------------------------------------------------------------------- |
| `check_site`  | `{ url, expect? }` | `checkNow(...)` → `CheckOutcome` (implemented, `expect` is P1)                               |
| `start_check` | `{ url, expect? }` | `startCheck(...)` → `{ ok, runId, host }` at once (P1)                                       |
| `get_check`   | `{ runId }`        | `getRun(runId)` → `RunPoll`, or an error for an unknown id (P1)                              |
| `get_report`  | `{ host, id }`     | `TargetDO(host).getReportStatus(id)` → full `Report`, `{ expired: true }`, or not found (P1) |

- Every tool uses one UserAgent per MCP session: `mcp-${await hashIp(this.ctx.id.toString())}`, so `start_check`/`get_check` meet. `serverShard` is gone.
- The tool name → input schema map is `MCP_TOOLS` in `src/shared/schemas.ts` (`test/schemas.test.ts` pins it and the `CheckInput` JSON schema).

---

## HTTP routes (`src/server.ts`, implemented)

| Route                                                                       | Behavior                                                                                                                                                                                                          |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/agents/user-agent/:deviceId` (WS + HTTP)                                  | `routeAgentRequest`. Any other `/agents/*` path, a bad device id, or a name starting with `api-`/`mcp-` returns 404                                                                                               |
| `GET /api/v1/check?url=[&expect=][&wait=1]`                                 | rate key `api:<ip>` → `UserAgent("api-" + await hashIp(ip)).checkNow(url, netInfo, "api")` → `CheckOutcome` (200/400/429)                                                                                         |
| `GET /api/v1/check?url=&wait=0` (P1)                                        | same agent → `startCheck` → **202** `{ ok: true, runId, host, pollPath: "/api/v1/runs/" + runId }` (400 on a bad target)                                                                                          |
| `GET /api/v1/runs/:id` (P1)                                                 | rate key `api:<ip>` → same `api-<hashIp>` agent → `getRun(id)` → `RunPoll` (200), 404 when unknown to this caller                                                                                                 |
| `GET /api/report/:host/:id`                                                 | rate key `report:<ip>` → `TargetDO(host).getReportStatus(id)` (P1) → `Report`, **410** `{ error: "expired", retentionDays: REPORT_TTL_DAYS }`, or 404                                                             |
| `GET /api/report/:host/:id.txt` (P1)                                        | same lookup → `text/plain` `supportBundle(report, url.origin)`; 410/404 as plain text                                                                                                                             |
| `GET /api/host/:host` (P1)                                                  | rate key `report:<ip>` → `TargetDO(host).hostHistory()` → `HostHistory`. Never probes. `cache-control: public, max-age=60`, CORS `*`                                                                              |
| `GET /badge/:host.svg` (P1)                                                 | rate key `badge:<ip>`; host decoded + lowercased; `badgeSvg(hostHistory().latest, now)` (`src/lib/badge.ts`; "unknown" when null or > 24 h old). Zero probes (R19). `cache-control: public, max-age=60`, CORS `*` |
| `POST /api/extra-check` `{ host, reportId, browser: BrowserProbe \| null }` | rate key `extra:<ip>`, 16KB cap → `parseBrowserProbe` (400 on `{ error }`) → `browserVantage` → `appendExtraCheck(reportId, check, hashIp(ip))` (409 `{ error }` when the report is full) → `waitUntil(owner.onExtraCheck(...))` → `{ ok, check }`                                       |
| `/mcp`, `/mcp/*`                                                            | rate key `mcp:<ip>` → McpAgent                                                                                                                                                                                    |
| everything else                                                             | static assets / SPA fallback (`run_worker_first` covers only `/agents/*`, `/api/*`, `/mcp*`, and `/badge/*`)                                                                                                      |

`RATE_LIMITER` allows 20 requests per 60s per key.

**Deliberate deviations from the spec:**

- The support bundle is at `/api/report/:host/:id.txt`, not `/r/:host/:id.txt`: `/r/*` is the SPA route, and serving `.txt` there would need the Worker in front of every report page.
- Export is a `@callable exportData()` over the device's websocket, not `GET /api/v1/export`: the device id is the only credential, and putting it in a URL would make it a bearer secret in logs and history.
- The client renders R17's expired state on a 410 from `/api/report/...` ("This report expired (reports are kept 30 days)").

---

## Client (`src/client/`)

- **Entry and routing**
  - `index.html` → `src/client/main.tsx` → `app.tsx`.
  - Routing is manual, through `location.pathname`. `app.tsx` already does it:
    - `/` → chat
    - `/r/:host/:id` → `<ReportPage host id />`
    - `/c/:host?ref=:reportId` → `<CheckPage host refId />`
- **Device id**: `getDeviceId()` in `app.tsx`. It lives in localStorage key `isitme:deviceId` and is a `crypto.randomUUID()`.
- **Agent connection**: `useAgent<UserAgent, AgentState>({ agent: "UserAgent", name: getDeviceId(), onMessage })`.
  - `agent.state` is the live `AgentState`.
  - `onMessage` parses `AgentBroadcast` into toasts.
- **Chat**: `useAgentChat({ agent })`. For a tool part where `getToolName(part) === "diagnose"`:
  - Find the run with `state.runs.find(r => r.toolCallId === part.toolCallId)`.
  - Render `<DiagnosisCard run={run} outcome={part.state === "output-available" ? part.output as CheckOutcome : undefined} />`.
- **`/?q=`**: `takeQuery` sends `Is <host> down?` only when `q` has no whitespace and `normalizeTarget(q)` succeeds (the link is attacker-chosen and becomes the user's own chat message); anything else is dropped.
- **Headlines**: `headlineOf(verdict, browserReached)`: HEALTHY says "Not you, not them" only when the user's browser reached the site, else "It's up from everywhere we checked.". `EvidenceGrid({ evidence, verdict? })`: the status-page contradiction chip uses `probesOkOf(verdict)` (`format.ts`); the Radar row is red only for recent outages/anomalies or R9-strong BGP (`radarEvents` from `classify.ts`), with stale events and weak BGP as subtle context.
- **Browser probe trigger**
  - When a run appears with `status === "running" && wantsBrowser && trigger === "chat"` and its id isn't in a local `Set` of already-probed ids, add it to the set.
  - Then call `runBrowserProbe(run.url)` and `agent.stub.submitBrowserProbe(run.id, probe)`.
  - Only the tab that sent the message needs to do this, but a duplicate is harmless because the first probe wins.
- **`probe.ts`**: `runBrowserProbe(url, { timeoutMs = 8000 }?): Promise<BrowserProbe>`. Never throws.
  1. Do a `fetch(url, { mode: "no-cors", cache: "no-store", signal })`. Resolving counts as `reachable`, with method `"fetch-no-cors"`.
  2. On reject, fall back to `new Image().src = origin + "/favicon.ico?" + Date.now()`, with method `"image"`.
  3. Check the control at `https://www.cloudflare.com/cdn-cgi/trace` (no-cors) and record `controlReachable`.
  4. Record `online = navigator.onLine`.
  5. `dns = await dohLookup(host)` and `dnsAlt = await dohLookup(host, { resolver: "google" })` from `../lib/probes`, in parallel (R11).
  6. `env = collectEnv()`: same-origin `/cdn-cgi/trace` (skipped on localhost), timezone vs trace `loc`, IPv6 control. Sent as `BrowserProbe.env`.
- **Components**
  - `DiagnosisCard({ run, outcome, localProbe? })`: `localProbe` is this tab's browser probe for the run, used for the R18 "your browser could / could not reach it" line on a run error. Shows the steps in `STEP_ORDER` with status icons and summaries, then the verdict badge, confidence, signals, explanation (streamdown), a "Copy share link" button (`origin + reportPath`), and a "Send check link" button (`origin + "/c/" + host + "?ref=" + runId`).
  - `Sidebar({ state, onUnwatch, onMarkAlertsRead, onExport })`: `onExport` downloads `exportData()` as `isitme-export.json`. Shows your network (`state.user`: ASN/org/country/colo), watches (with unwatch), alerts (unread count), and history (links to `/r/...`).
  - `ReportPage({ host, id })`: `fetch("/api/report/" + encodeURIComponent(host) + "/" + id)`, rendered read-only, including `extraChecks`.
  - `CheckPage({ host, refId })`:
    - Refuses to probe unless `isPublicHostParam(host)` (`guard.ts`: `normalizeTarget(host)` succeeds and yields exactly `host`, so no smuggled port, path, userinfo, private IP or `.local`); shows "not a public site" instead.
    - Runs `runBrowserProbe(report?.url ?? "https://" + host)`.
    - If `refId` is set, POSTs `/api/extra-check`.
    - Shows the visitor a simple result: "Your browser could / couldn't reach host".
    - Without `refId`, it only shows the local result.
- **Styling**: Kumo components plus Tailwind, as in the starter (`docs/starter-app.tsx.txt`). The dark mode toggle uses `data-mode` on `<html>`, set in `index.html`.

---

## Verification commands

- `npx tsc --noEmit`: must stay clean.
- `npm test`: vitest over `test/**/*.test.ts`.
- `npx vite build`
- `npm run types`: after any wrangler.jsonc change.
