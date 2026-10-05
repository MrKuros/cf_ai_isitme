---
title: Limits and troubleshooting
description: "What IsItMe cannot do and why, common errors, and known platform quirks."
---

# Limits and troubleshooting

The honest boundaries of the tool, and what to do when a check goes wrong.

## What it cannot do

### No ping, no traceroute from Cloudflare

Cloudflare Workers cannot send ICMP, and cannot open raw sockets. Every
measurement IsItMe takes from Cloudflare's side is an ordinary HTTP request or a
DNS-over-HTTPS query. So there is no round-trip ping, and no hop-by-hop path to
the target.

**What fills the gap:** [Globalping](https://globalping.io) probes, run from
machines on real networks outside Cloudflare, in five continents. Every check
includes them, and they show up as a signal line:

```
All 5 outside probes reached it
```

That answers "is it reachable from networks Cloudflare doesn't control", which is
the part that mattered. It does **not** give you a traceroute. `src/lib/globalping.ts`
can ask Globalping for one — there is a `traceroute` option — but it is off, and
nothing in the app turns it on, because a traceroute almost never finishes inside
the step's 8-second budget. If you self-host and want hops, that's the switch to
flip.

> [!IMPORTANT] Outside probes never change the verdict
> Globalping contributes one descriptive line and nothing else. The verdict and
> its confidence are byte-identical whether its probes all succeeded, all failed,
> or never ran — `test/globalping.test.ts` pins that. Only Cloudflare's own
> vantages and your browser vote. See [How it works](/how-it-works).

### No certificate expiry warnings

A **broken** certificate is detected: if every server vantage fails the TLS
handshake, you get <Verdict v="TLS_ERROR" />. That is a failure happening now.

What IsItMe does not do is tell you a certificate expires in nine days. It never
reads the certificate itself — the platform surfaces a failed handshake, not the
chain — so there is no expiry date to report and no "renew soon" warning. Use a
certificate monitor for that.

Domain _registration_ expiry is read, from RDAP, but only to explain a DNS
failure: if a name stops resolving because the domain lapsed, the report says so.
It never decides a verdict.

### The browser probe can't see status codes

The check from your own machine uses a `no-cors` fetch. The browser deliberately
hides everything about the response from the page — status code, headers, body.
All that comes back is _whether the request completed and how long it took_.

So in your result, "your browser could reach it in 389ms" means exactly that: the
server answered something. It does not mean HTTP 200. The UI labels this row
accordingly, and <Verdict v="PARTIAL" /> or <Verdict v="BLOCKED" /> are always
decided from Cloudflare's vantages, which can see codes.

One case the browser can't test at all: an `http://` target checked from this
`https://` page. The browser blocks or silently upgrades it, which would look
like a false "unreachable". IsItMe reports `mixed content` and leaves the browser
row out of the evidence rather than guessing.

### `locationHint` does nothing locally

The five regional probes are Durable Objects created with a `locationHint`
(`wnam`, `enam`, `weur`, `apac`, `oc`). In local development that hint is
ignored: all five run in your own colo. A local report shows it plainly —

```console
$ curl -s "localhost:5173/api/report/github.com/3f77dae2-7cb4-4db4-b77c-fc6a1d0bfca4" \
    | jq -r '.evidence.regions[] | "\(.region)\t\(.colo)\t\(.status)\t\(.ms)ms"'
wnam	MAA	200	110ms
enam	MAA	200	123ms
weur	MAA	200	122ms
apac	MAA	200	123ms
oc	MAA	200	112ms
```

— five regions, one colo, because this ran on a laptop in Chennai. The classifier
knows, adds the signal "Only one Cloudflare location answered", and caps the
confidence. <Verdict v="DOWN_REGIONAL" /> is effectively unreachable locally for
the same reason: regions can't disagree when they're the same machine.

Multi-region is real only after a deploy. See [Self-hosting](/self-hosting).

### Smaller ones

- **Private and reserved addresses are refused**, before and after redirects.
  IsItMe is a public endpoint, and without this it would be an open proxy into
  people's internal networks.
- **Reports expire after 30 days.** A share link older than that returns
  `410 expired`.
- **Watches have a 5-minute floor** and a cap of 10 per device. "Check every
  minute" gets clamped, and the reply says so.
- **No SMS or voice alerts.** Webhooks (Slack, Discord, generic JSON) and email
  only — per-message billing wasn't worth it.
- **Only HTTP and HTTPS targets**, and only on ports 80, 443, 8080 and 8443. No
  port scans, no arbitrary TCP, no mail or SSH checks. URLs carrying credentials
  are refused.
- **Query strings are dropped** from the target before probing, so
  `?a=1` and `?a=2` are the same check. Without that, a caller could defeat
  per-host coalescing by varying the query.
- **"Not enough evidence" is a real answer.** When the vantages don't agree
  enough to justify anything, you get <Verdict v="INCONCLUSIVE" /> rather than a
  confident guess. That's deliberate.

## Common errors and fixes

### `Error 10063` when starting the dev server

Workers AI is called remotely even in local development (`"remote": true` in
`wrangler.jsonc`), and that needs a `workers.dev` subdomain on your account.
10063 means there isn't one, or it was created seconds ago.

**Fix:** open **Workers & Pages** in the Cloudflare dashboard once to claim a
subdomain, then retry. Or run `npm run dev:local`, which skips remote bindings
entirely — chat tool-calling won't work, but probes, the API, reports, badges and
every page will.

### The explanation reads like a template, not prose

The verdict, confidence and evidence are all correct, but the paragraph is the
signals joined with periods followed by **Next steps** and two fixed bullets.
That is `fallbackExplanation()` in `src/lib/explain.ts`, and the usual reason is
the Workers AI free allocation:

```console
AiError: 4006: you have used up your daily free allocation of 10,000 neurons
```

The rules still decide the verdict, so nothing is wrong with the answer — only
the wording. The allocation resets daily; the Workers Paid plan removes the cap.
Both failures are logged, so `wrangler tail` during a check shows
`[explain] Workers AI call failed` (the call threw) or
`[explain] empty AI response` (it returned nothing usable).

### `missing ?url=`

```console
$ curl -s "localhost:5173/api/v1/check"
{"ok":false,"error":"missing ?url="}
```

The `url` parameter is required. `?url=github.com` is enough; the scheme is
optional.

### `"localhost" is not a public hostname`

```console
$ curl -s "localhost:5173/api/v1/check?url=localhost"
{"ok":false,"error":"\"localhost\" is not a public hostname"}
```

IsItMe only checks names that resolve on the public internet. There is no way to
point it at something inside your own network — see above.

### `Private or reserved addresses can't be checked`

```console
$ curl -s "localhost:5173/api/v1/check?url=192.168.1.1"
{"ok":false,"error":"Private or reserved addresses can't be checked"}
```

Same guard, reached by IP instead of by name. It also fires when a public
hostname _resolves_ to a private address, and on every redirect hop.

### `rate limited` (HTTP 429)

```console
$ curl -s "localhost:5173/api/host/example.com"
{"error":"rate limited"}
```

20 requests per 60 seconds per IP. The budget is counted separately per kind of
endpoint — checks, reports, badges, MCP and chat sockets each have their own — so
hitting it on one doesn't lock you out of the others.

**Fix:** wait a minute, or [self-host](/self-hosting) and raise the limit in
`wrangler.jsonc`.

### `Radar: no data (no RADAR_TOKEN)`

Not an error. Cloudflare Radar evidence is optional and needs an API token. The
check runs fine without it; you just don't get "your ISP has a known outage" as a
signal, and the confidence is a little lower. [Self-hosting](/self-hosting)
covers adding the token.

### A report link returns `404` or `410`

```console
$ curl -s "localhost:5173/api/report/github.com/00000000-0000-0000-0000-000000000000"
{"error":"not found"}
```

`404` means that report ID was never stored for that host — usually a mistyped or
truncated link. `410` with `{"error":"expired","retentionDays":30}` means the
report was real and has aged out. Run a fresh check.

### The chat replies but never runs a check

You're on `npm run dev:local`. Tool-calling needs the real chat model, which
needs the remote `AI` binding. Use `npm run dev`.

### Outside probes vanished from the signals

Globalping is called without an API key, so its quota is 250 probes per hour per
IP address, and one check spends 5. Under sustained load — a deployed Worker
sharing egress addresses, or a lot of watched sites — the step degrades to
`skipped: "rate limited"` and the line disappears.

Nothing is wrong with the verdict: outside probes never voted anyway. If you need
them reliably, see the note in [Self-hosting](/self-hosting).

## Known platform quirks

These are properties of the Cloudflare runtime, not bugs in IsItMe.

| Quirk                                                    | Effect                                                                                                                                                                                                                       |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `locationHint` is ignored in local dev                   | All five regions are one colo.                                                                                                                                                                                               |
| Local `workerd` reports TLS failures as `internal error` | <Verdict v="TLS_ERROR" /> is not observable locally. Deployed, Cloudflare's edge answers `HTTP 526` instead and the verdict fires for real — `expired.badssl.com` on the live demo returns <Verdict v="TLS_ERROR" /> at 95%. |
| `connect()` is blocked to Cloudflare IP ranges           | Authoritative-nameserver lookups over TCP fail for Cloudflare-hosted zones. That row reads "no data" rather than pretending.                                                                                                 |
| Workflows cannot hold WebSockets                         | Live progress goes Workflow → agent → WebSocket, so a step's progress appears a beat after it finishes.                                                                                                                      |

### When IsItMe itself is unreachable

IsItMe runs on Cloudflare, so a bad day at Cloudflare takes the app with it. For
that case there is a second copy of the one thing that needs no server:
[**fallback.html**](/fallback.html), served from GitHub Pages. It runs the
browser probe only — reachable or not, and how long it took — labels the verdict
_browser-only_, and links to
[cloudflarestatus.com](https://www.cloudflarestatus.com). It is the same page the
app ships at `/fallback.html`, published off Cloudflare so the two can't fail
together.

## Still stuck?

Every check keeps its full evidence. Append `.txt` to a report path for a plain
support bundle you can paste into a bug report:

```
/api/report/<host>/<report-id>.txt
```

If it looks like a real bug, the [HTTP API](/api) page documents every response
shape, and [Contributing](/contributing) explains how to file it.
