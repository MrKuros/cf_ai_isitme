---
title: HTTP API
description: "Every route, parameter, response shape, status code and rate limit, with curl examples."
---

<script setup>
import { SITE_URL } from "./.vitepress/theme/site";
</script>

# HTTP API

Run a check, poll it, read the evidence, grab a badge. No key, no sign-up, JSON everywhere except the badge and the support bundle.

Input is parsed by the same schemas the chat tools and the [MCP tools](/mcp) use (`src/shared/schemas.ts`), so the three interfaces cannot drift apart.

## Try one now

<TryIt />

That box is a plain `fetch` of `/api/v1/check` from your browser — the same request the examples below make.

## Base URL

> [!NOTE] Examples on this page
> The hosted app is not deployed yet, so every request below was run against a local dev server and the responses are pasted exactly as they came back. Set `$ISITME` to whichever copy you are talking to:

```sh
export ISITME=http://localhost:5173          # npm run dev, whatever port it prints
# export ISITME=https://isitme.example       # your own deployment
```

(The responses below were captured with it set to `http://localhost:5192`, which is why report links in them point there.)

Once the demo is live its base URL is <code>{{ SITE_URL }}</code>.

## Every route

| Route | Method | Returns |
|---|---|---|
| [`/api/v1/check`](#check-a-site) | GET | a verdict (waits), or a run id (`wait=0`) |
| [`/api/v1/runs/:runId`](#poll-a-run) | GET | `{ status: "running" }` or the verdict |
| [`/api/report/:host/:id`](#reports) | GET | the full report, every piece of evidence |
| [`/api/report/:host/:id.txt`](#support-bundle) | GET | plain-text support bundle |
| [`/api/host/:host`](#host-history) | GET | the last 24 h of stored checks for one host |
| [`/api/trends`](#trending) | GET | hosts lots of networks are reporting right now |
| [`/badge/:host.svg`](#badge) | GET | an SVG status badge |
| [`/api/extra-check`](#add-a-check-from-your-side) | POST | records a visitor's own result on a report |
| [`/mcp`](/mcp) | POST | Model Context Protocol endpoint |

Anything else under `/api/` is `404 {"error": "not found"}`. The human pages (`/r/:host/:id`, `/h/:host`, `/trending`, `/c/:host`) are the web app, not the API.

Only the methods in that table are handled. A `POST /api/v1/check` is not "method not allowed", it falls through to the 404:

```sh
curl -s -X POST "$ISITME/api/v1/check?url=example.com"
```

```json
{ "error": "not found" }
```

## Check a site

```
GET /api/v1/check?url=<domain or URL>[&expect=<text>][&wait=0]
```

| Parameter | Required | Notes |
|---|---|---|
| `url` | yes | 1–2048 characters. A bare domain, a full URL with a path, or an IP literal. |
| `expect` | no | 1–200 characters the page must contain. Missing text makes the verdict <Verdict v="PARTIAL" sub="expect missing" />. |
| `wait` | no | `wait=0` returns a run id immediately. Any other value (or none) waits for the result. |

The explanation follows your `Accept-Language` header; the verdict and signals stay in English. See [languages](#languages).

### Waiting (the default)

The whole pipeline runs before you get an answer: both resolvers, Cloudflare's edge, five regions, Globalping, Radar, the vendor's status page, then the rules, then the LLM paragraph. **Budget 15–25 seconds** and set a client timeout of at least 30.

```sh
curl -s "$ISITME/api/v1/check?url=example.com"
```

```json
{
  "ok": true,
  "runId": "03026336-e706-46ad-b033-4118bdc6f76b",
  "host": "example.com",
  "verdict": "HEALTHY",
  "confidence": 0.7,
  "signals": [
    "Cloudflare's edge (MAA) got HTTP 200 in 1628ms",
    "5/5 regions reachable (median 519ms)",
    "DNS resolved to 4 addresses in 146ms, DNSSEC-validated",
    "Only one Cloudflare location answered",
    "13 checks in the last 10 min, 0 failing",
    "Radar: no data (no RADAR_TOKEN)",
    "All 5 outside probes reached it"
  ],
  "provider": "Cloudflare",
  "explanation": "The site is reachable from every location checked. Your browser result is not available, but all outside probes reached it. \nNext steps:\n* Try a hard refresh or private window\n* Clear site data or try another browser\n* Check the page content for issues",
  "reportPath": "/r/example.com/03026336-e706-46ad-b033-4118bdc6f76b"
}
```

| Field | Always? | Meaning |
|---|---|---|
| `ok` | yes | `false` means the request failed, not that the site is down. |
| `runId` | yes | Also the report id and the workflow instance id. |
| `host` | yes | Normalised lowercase hostname. |
| `verdict` | yes | One of [twelve values](/results). |
| `subtype` | no | Narrows the verdict, e.g. `expect_missing` with `PARTIAL`. |
| `confidence` | yes | 0–1. |
| `signals` | yes | The facts that drove the verdict, most important first. |
| `provider` | no | Who serves the site, when it could be fingerprinted. |
| `explanation` | yes | The LLM paragraph. The rules already decided; this only puts it in words. |
| `reportPath` | yes | Path of the human report, `/r/<host>/<id>`. Prefix it with the base URL. |

`expect` turns a wrong-but-200 page into a failure:

```sh
curl -s "$ISITME/api/v1/check?url=https://example.com&expect=Sign%20in"
```

```json
{
  "ok": true,
  "runId": "4ff35ad2-fb4c-4131-b5dd-ac59ebee2a5a",
  "host": "example.com",
  "verdict": "PARTIAL",
  "subtype": "expect_missing",
  "confidence": 0.73,
  "signals": [
    "Expected text not found on the page",
    "Cloudflare's edge (MAA) got HTTP 200 in 1215ms",
    "5/5 regions reachable (median 548ms)",
    "DNS resolved to 4 addresses in 146ms, DNSSEC-validated",
    "All 5 outside probes reached it"
  ],
  "provider": "Cloudflare",
  "explanation": "The site is partially reachable, with most vantage points seeing a broken page. …",
  "reportPath": "/r/example.com/4ff35ad2-fb4c-4131-b5dd-ac59ebee2a5a"
}
```

Errors come back with `ok: false` and an HTTP status:

```sh
curl -s "$ISITME/api/v1/check"
curl -s "$ISITME/api/v1/check?url=not%20a%20host"
```

```json
{ "ok": false, "error": "missing ?url=" }
{ "ok": false, "error": "\"not a host\" is not a valid URL" }
```

Targets that are refused before anything is probed, with their exact messages:

```
http://127.0.0.1     {"ok":false,"error":"Private or reserved addresses can't be checked"}
http://192.168.1.1   {"ok":false,"error":"Private or reserved addresses can't be checked"}
http://localhost:8080 {"ok":false,"error":"\"localhost\" is not a public hostname"}
ftp://example.com    {"ok":false,"error":"Only http and https URLs can be checked"}
```

All four are `400`. The same guard re-checks every redirect hop, so a public URL that redirects to a private one stops there too.

| Status | Body | When |
|---|---|---|
| `200` | `CheckOutcome` | The check ran. Read `verdict`, not the status code. |
| `202` | `{ ok, runId, host, pollPath }` | `wait=0`. |
| `400` | `{ ok: false, error }` | Missing or unusable `url`, `expect` too long, or a target the SSRF guard refuses. |
| `400` | `{ ok: false, error: "still running after 2 minutes…" }` | The check passed the 2-minute wait. The run continues and its report still lands at `reportPath`, so this one is recoverable. |
| `429` | `{ ok: false, error: "rate limited" }` | Over 20 requests a minute. |

If a check somehow runs past two minutes you get `400` with `ok: false` and the error `still running after 2 minutes; the result will appear in the card and report when it finishes` — the run is not lost, the report still lands at `reportPath`.

### Async: 202 then poll

Use `wait=0` whenever a 20-second request is awkward (a browser, a lambda, a queue worker).

```sh
curl -si "$ISITME/api/v1/check?url=github.com&wait=0"
```

```
HTTP/1.1 202 Accepted
access-control-allow-origin: *
content-type: application/json

{"ok":true,"runId":"2c3c882c-d30a-4a2c-924f-dfec0267bc6d","host":"github.com","pollPath":"/api/v1/runs/2c3c882c-d30a-4a2c-924f-dfec0267bc6d"}
```

A bad target still fails fast, with `400` and the same `{ ok: false, error }` shape.

## Poll a run

```
GET /api/v1/runs/:runId
```

```sh
curl -s "$ISITME/api/v1/runs/2c3c882c-d30a-4a2c-924f-dfec0267bc6d"
```

```json
{ "status": "running", "runId": "2c3c882c-d30a-4a2c-924f-dfec0267bc6d", "host": "github.com" }
```

Twenty-five seconds later the same URL returns the finished `CheckOutcome`, identical to what `wait=1` would have given you:

```json
{
  "ok": true,
  "runId": "2c3c882c-d30a-4a2c-924f-dfec0267bc6d",
  "host": "github.com",
  "verdict": "HEALTHY",
  "confidence": 0.7,
  "signals": [
    "Cloudflare's edge (MAA) got HTTP 200 in 1586ms",
    "5/5 regions reachable (median 791ms)",
    "DNS resolved to 1 address in 261ms",
    "Only one Cloudflare location answered",
    "4 checks in the last 10 min, 0 failing",
    "Radar: no data (no RADAR_TOKEN)",
    "All 5 outside probes reached it"
  ],
  "provider": "GitHub Pages",
  "explanation": "The site is reachable from all locations. …",
  "reportPath": "/r/github.com/2c3c882c-d30a-4a2c-924f-dfec0267bc6d"
}
```

How to poll: wait 2–5 seconds between polls. Each poll costs a request against the same 20-per-minute budget as the check itself, so a 1-second loop will rate-limit you out of your own result.

| Status | Body | When |
|---|---|---|
| `200` | `{ status: "running", … }` | Still going. |
| `200` | `CheckOutcome` | Finished (`ok` can be `true` or `false`). |
| `400` | `{ ok: false, error: "bad run id" }` | Not a UUID. |
| `404` | `{ ok: false, error: "not found" }` | No such run **for you**. |
| `429` | `{ ok: false, error: "rate limited" }` | Over the limit. |

> [!IMPORTANT] Runs belong to the IP that started them
> Runs are stored on a per-caller shard keyed by a hash of your IP, so **poll from the same IP that started the run**. Someone else's run id returns `404`, which also means a leaked run id is useless to anyone else. Finished runs are kept for about 24 hours; a run still unfinished after 5 minutes answers `{ ok: false, error: "lost track of this run" }`.

## Reports

```
GET /api/report/:host/:id
```

Everything the rules looked at, as stored: `evidence` (both DNS lookups, the edge probe, each region, Globalping, Radar, the provider fingerprint, the vendor status page, the browser probe when there was one, baselines), `classification` (verdict, confidence, signals, the confidence `factors`, hints), the `explanation`, and any `extraChecks` visitors added.

```sh
curl -s "$ISITME/api/report/github.com/2c3c882c-d30a-4a2c-924f-dfec0267bc6d" | jq keys
```

```json
["classification","createdAt","evidence","explanation","extraChecks","host","id","lang","trigger","url"]
```

The response for that healthy check was 4.8 KB. Reports are **public** — anyone with the link can read one — so they never contain your device id or your city. Your network is recorded as its ASN, organisation and country.

| Status | Body | When |
|---|---|---|
| `200` | the report | — |
| `400` | `{ "error": "bad host" }` | The host segment isn't a hostname. |
| `404` | `{ "error": "not found" }` | No such report. |
| `410` | `{ "error": "expired", "retentionDays": 30 }` | Older than 30 days. A daily alarm drops the body and leaves a tombstone, so an expired report says so instead of 404. |
| `429` | `{ "error": "rate limited" }` | Over the limit. |

Note the shape: report errors are `{ error }`, while `/api/v1/*` errors are `{ ok: false, error }`.

### Support bundle

Add `.txt` to the same path and you get a plain-text version you can paste into a ticket with your ISP or the site's support team. Same data, no JSON, no app needed to read it.

```sh
curl -s "$ISITME/api/report/github.com/2c3c882c-d30a-4a2c-924f-dfec0267bc6d.txt"
```

```
IsItMe diagnostic report for github.com
Time (UTC): 2026-10-05T08:48:51.862Z
Target: https://github.com/
Tested from: AS134674 (TATA PLAY BROADBAND PRIVATE LIMITED), IN
Verdict: HEALTHY, confidence 70%

Signals:
- Cloudflare's edge (MAA) got HTTP 200 in 1586ms
- 5/5 regions reachable (median 791ms)
- DNS resolved to 1 address in 261ms
- Only one Cloudflare location answered
- 4 checks in the last 10 min, 0 failing
- Radar: no data (no RADAR_TOKEN)
- All 5 outside probes reached it

Vantages:
- DNS (Cloudflare DoH): ok, rcode 0, 20.207.73.82 (261ms)
- DNS (Google DoH): ok, rcode 0, 20.207.73.82 (262ms)
- Cloudflare edge: ok, HTTP 200, colo MAA, 1586ms
- Region wnam: ok, HTTP 200, colo MAA, 792ms
- Region enam: ok, HTTP 200, colo MAA, 791ms
- Region weur: ok, HTTP 200, colo MAA, 643ms
- Region apac: ok, HTTP 200, colo MAA, 643ms
- Region oc: ok, HTTP 200, colo MAA, 791ms
- Your browser: not run
- Radar: skipped (no RADAR_TOKEN)
- Provider: GitHub Pages
- Vendor status page: none (All Systems Operational), https://www.githubstatus.com/api/v2/summary.json

Full report: http://localhost:5192/r/github.com/2c3c882c-d30a-4a2c-924f-dfec0267bc6d
```

(All five regions report colo `MAA` because this ran on a dev machine, where `locationHint` has no effect. On the deployed app they are five different colos.)

The `.txt` form answers in plain text all the way down, including its errors — `not found` with a `404`, and `This report expired (reports are kept 30 days).` with a `410`:

```sh
curl -s -w ' [%{http_code}]\n' "$ISITME/api/report/github.com/nope.txt"
```

```
not found [404]
```

Visitor checks, when someone used a [check-from-your-side link](/sharing), appear as their own section near the bottom, one line per network.

## Host history

```
GET /api/host/:host
```

The last 24 hours of **already stored** checks for one host. It never starts a probe, so it is cheap and always instant — and empty for a host nobody has checked.

```sh
curl -s "$ISITME/api/host/example.com"
```

```json
{
  "host": "example.com",
  "samples": [
    { "at": 1791190084770, "ms": 1628, "ok": true,  "verdict": "HEALTHY", "colo": "MAA" },
    { "at": 1791190100852, "ms": 1215, "ok": false, "verdict": "PARTIAL", "colo": "MAA" },
    { "at": 1791190109427, "ms": 1628, "ok": true,  "verdict": "HEALTHY", "colo": "MAA" }
  ],
  "latest": {
    "verdict": "HEALTHY",
    "at": 1791190109427,
    "reportId": "e985954c-8cae-44ee-8c8f-f1e4304e0aa7"
  }
}
```

`latest` is `null` when there is nothing from the last 24 hours. `at` is epoch milliseconds. `cache-control: public, max-age=60`. This is what the `/h/:host` page and the sparklines are built from.

## Trending

```
GET /api/trends
```

Hosts with recent non-healthy checks, ranked by **how many distinct networks** (ASNs) reported them rather than by raw volume, and listed only once at least 3 ASNs agree. One quiet dev machine therefore returns:

```sh
curl -s "$ISITME/api/trends"
```

```json
[]
```

With traffic, each row is `{ host, verdict, provider?, asns, lastAt }`. Read-only, `cache-control: public, max-age=60`, and cached at the colo on top of that, so the underlying Durable Object sees roughly one read per minute per colo.

## Badge

```
GET /badge/:host.svg
```

The latest **stored** verdict and its age, as an SVG. Like host history it never probes — run a check to refresh it.

```sh
curl -s "$ISITME/badge/example.com.svg" | head -c 200
```

```
<svg xmlns="http://www.w3.org/2000/svg" width="125" height="20" role="img" aria-label="isitme: up 1m ago"><title>isitme: up 1m ago</title>…
```

A host with nothing from the last 24 hours renders `unknown`. `content-type: image/svg+xml; charset=utf-8`, `cache-control: public, max-age=60`, and a bad host segment is a plain-text `400 bad host`.

In a README:

```markdown
[![isitme](https://isitme.example/badge/example.com.svg)](https://isitme.example/h/example.com)
```

## Add a check from your side

```
POST /api/extra-check
```

This is the endpoint behind the [check-from-your-side link](/sharing): a visitor opens `/c/:host?ref=<reportId>`, their browser probes the site, and the result is appended to that report so the owner can see whether other networks agree.

Body, at most 16 KB:

```json
{
  "host": "example.com",
  "reportId": "e985954c-8cae-44ee-8c8f-f1e4304e0aa7",
  "browser": {
    "reachable": false,
    "method": "fetch-no-cors",
    "ms": 4800,
    "online": true,
    "controlReachable": true,
    "error": "load failed"
  }
}
```

```sh
curl -s -X POST "$ISITME/api/extra-check" -H 'content-type: application/json' -d @probe.json
```

```json
{
  "ok": true,
  "check": {
    "id": "bc695c26-48a3-43ea-a3ec-d11c04fe9d34",
    "at": 1791190676111,
    "user": {
      "colo": "MAA",
      "country": "IN",
      "asn": 134674,
      "asOrganization": "TATA PLAY BROADBAND PRIVATE LIMITED"
    },
    "browser": {
      "at": 1791190676111,
      "reachable": false,
      "method": "fetch-no-cors",
      "ms": 4800,
      "error": "load failed",
      "online": true,
      "controlReachable": true,
      "dns": null
    }
  }
}
```

Every `browser` field is optional and individually validated; unknown fields are dropped, and your IP is stored only as a hash, used to keep one check per voter (a second post replaces your first).

| Status | Body | When |
|---|---|---|
| `200` | `{ ok: true, check }` | Recorded. |
| `400` | `{ "error": "bad json" }` | Body isn't JSON. |
| `400` | `{ "error": "bad request" }` | `host` or `reportId` missing or malformed. |
| `400` | `{ "error": "browser.ms must be a number 0..60000" }` | A `browser` field failed validation; the message names it. |
| `404` | `{ "error": "report not found" }` | No such report for that host. |
| `409` | `{ "error": "report has enough checks" }` | The report already holds 20 visitor checks. |
| `413` | `{ "error": "too large" }` | Body over 16 KB. |
| `429` | `{ "error": "rate limited" }` | Over the limit. |

## Rate limits

**20 requests per 60 seconds**, per IP, per bucket. Buckets are independent, so polling a run cannot lock you out of a badge:

| Bucket | Covers |
|---|---|
| `api` | `/api/v1/check`, `/api/v1/runs/:id` |
| `report` | `/api/report/*`, `/api/host/*`, `/api/trends` |
| `badge` | `/badge/*.svg` |
| `extra` | `/api/extra-check` |
| `mcp` | `/mcp` |

Over the limit you get `429` straight away:

```sh
for i in $(seq 1 22); do curl -s -o /dev/null -w '%{http_code} ' "$ISITME/api/host/github.com"; done
```

```
200 200 200 200 200 200 200 200 200 200 200 200 200 200 200 200 200 200 200 200 429 429
```

There is no `Retry-After` header: wait a few seconds and retry. The window is a rolling 60 seconds.

Self-hosting changes this — the limits live in `wrangler.jsonc` (`ratelimits`), so your own copy can be as generous as you like. See [Self-hosting](/self-hosting).

## CORS

`access-control-allow-origin: *` is sent on:

- `/api/v1/check` and `/api/v1/runs/:id`
- `/api/host/:host`
- `/api/trends`
- `/badge/:host.svg`

It is **not** sent on `/api/report/*` or `/api/extra-check`. Reports are readable by anyone with the link, just not from another site's JavaScript — fetch them from your own server instead.

There is no `OPTIONS` handler, so only [simple requests](https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS#simple_requests) work cross-origin: a plain `GET` with no custom headers, exactly like the [Try it](#try-one-now) box above. Add an `Authorization` or custom header and the browser will preflight, the preflight will 404, and the request will fail.

## Languages

The `explanation` is written in the best match from your `Accept-Language` header, out of 20 supported languages. The verdict, subtype and signals are always English, because they are identifiers.

```sh
curl -s -H 'accept-language: fr-FR,fr;q=0.9' "$ISITME/api/v1/check?url=example.com" | jq -r .explanation
```

```
Le site est accessible partout. Votre navigateur n'a pas pu être vérifié. Les régions ont répondu avec un temps de réponse médian de 575ms.
Next steps :
* Essayez une actualisation de la page
* Vérifiez avec un autre navigateur
* Effectuez une recherche avec des mots-clés différents
```

An unsupported or missing language gives English.

## Notes for API callers

- **Verdicts are stable.** New values may be added; existing ones are never renamed or removed. Treat an unknown verdict as <Verdict v="INCONCLUSIVE" />.
- **`ok: true` is not "the site is up".** It means the check ran. The verdict is the answer.
- **No browser vantage from the API.** <Verdict v="LIKELY_YOUR_NETWORK" /> and <Verdict v="ISP_OUTAGE" /> need a failing probe on the user's own machine, which only the web app can run, so an API check never returns them — and healthy confidence caps lower without one.
- **Caching.** `/api/host`, `/api/trends` and `/badge` are cacheable for 60 s. Checks, runs and reports are not cached.
- **The hosted demo is shared.** The 20-per-minute limits, the 30-day report retention and the 24-hour run retention are the demo's settings; a self-hosted copy sets its own.

The internal contract that this page is written from lives in `docs/API.md` and `docs/CONTRACTS.md` in the repo, next to the code.
