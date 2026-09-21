# IsItMe API

Free, no key. CORS is open on `/api/v1/*`, `/api/host/*` and `/badge/*`. Input schemas live in `src/shared/schemas.ts` and are shared by the REST handler, the MCP tools and the chat tools, so they cannot drift.

Base URL below: `https://isitme.example` (replace with your deployment, or `http://localhost:5173` for `npm run dev:local`).

## Verdicts (stable)

`verdict` values are stable: new values may be added, existing ones are never renamed or removed. Treat an unknown value as `INCONCLUSIVE`.

| Verdict               | Meaning                                                                                              | Watch class |
| --------------------- | ---------------------------------------------------------------------------------------------------- | ----------- |
| `HEALTHY`             | Reachable from every answering vantage                                                               | up          |
| `SLOW`                | Reachable, but edge or median region latency ≥ 3 s                                                   | up          |
| `BLOCKED`             | Bot protection (challenge/WAF/rate limit/geo) answered instead of the site. The site is up           | up          |
| `PARTIAL`             | Server answers, but the page is wrong: parked, empty, an error page, missing `expect` text, or a 404 | down        |
| `DOWN_GLOBAL`         | Failing from ≥ 2 and ≥ 80% of distinct Cloudflare colos                                              | down        |
| `DOWN_REGIONAL`       | Failing from some colos, answering from others                                                       | down        |
| `DNS_FAILURE`         | Both public resolvers (Cloudflare and Google DoH) fail the lookup                                    | down        |
| `TLS_ERROR`           | Every failing vantage failed the TLS handshake and none answered                                     | down        |
| `UPSTREAM_OUTAGE`     | A high-confidence BGP hijack/leak covers the target's prefix and most vantages fail                  | down        |
| `LIKELY_YOUR_NETWORK` | Servers see the site up; your browser/network can't reach it                                         | none        |
| `ISP_OUTAGE`          | As above, and Cloudflare Radar reports an outage for your ISP or country                             | none        |
| `INCONCLUSIVE`        | Not enough independent vantages answered to decide                                                   | none        |

`subtype` (optional) narrows the verdict:

| Subtype                                 | With          | Meaning                                                   |
| --------------------------------------- | ------------- | --------------------------------------------------------- |
| `nxdomain`                              | `DNS_FAILURE` | The name does not exist                                   |
| `dnssec`                                | `DNS_FAILURE` | DNSSEC validation fails (resolves with checking disabled) |
| `parked`                                | `PARTIAL`     | Domain parking page                                       |
| `empty`                                 | `PARTIAL`     | Under 512 bytes of content                                |
| `error_page`                            | `PARTIAL`     | 2xx whose page reads like an error                        |
| `expect_missing`                        | `PARTIAL`     | The `expect` text was not in the first 64 KB              |
| `path_not_found`                        | `PARTIAL`     | The site is up; this path returns 404/410                 |
| `challenge`, `waf`, `rate_limit`, `geo` | `BLOCKED`     | Which kind of bot protection answered                     |
| `origin`                                | `DOWN_*`      | Cloudflare answered 520-524: the site's origin is failing |

## Check a site

```
GET /api/v1/check?url=<domain or URL>[&expect=<text>][&wait=1|0]
```

- `url`: 1-2048 chars. `expect`: optional, 1-200 chars; the page must contain it or the verdict is `PARTIAL/expect_missing`.
- `wait=1` (default): blocks until the check finishes (usually 5-20 s, at most 2 min) and returns a `CheckOutcome`.

```sh
curl 'https://isitme.example/api/v1/check?url=example.com'
```

```json
{
  "ok": true,
  "runId": "4b0c…",
  "host": "example.com",
  "verdict": "HEALTHY",
  "confidence": 0.9,
  "signals": ["6/6 vantages answered"],
  "provider": "Fastly",
  "explanation": "…",
  "reportPath": "/r/example.com/4b0c…"
}
```

`subtype` and `provider` appear when known. Errors: `400 { ok: false, error }` (bad or blocked target), `429` (rate limited).

### Async: 202 + poll

`wait=0` returns at once:

```sh
curl -i 'https://isitme.example/api/v1/check?url=example.com&wait=0'
# HTTP/1.1 202
# { "ok": true, "runId": "4b0c…", "host": "example.com", "pollPath": "/api/v1/runs/4b0c…" }

curl 'https://isitme.example/api/v1/runs/4b0c…'
# { "status": "running", "runId": "4b0c…", "host": "example.com" }   -> poll again in 2-5 s
# ...then the same CheckOutcome as wait=1 (ok: true or ok: false)
```

`GET /api/v1/runs/:id` returns `200` with `{ status: "running" }` or a `CheckOutcome`, `400` for a malformed id, and `404` for an id this caller didn't start. Runs are keyed per caller IP: **poll from the same IP that started the run**. Finished runs are kept 24 h.

## Reports

```
GET /api/report/:host/:id        -> full Report JSON (all evidence)
GET /api/report/:host/:id.txt    -> plain-text support bundle (for your ISP or the site's support)
```

```sh
curl 'https://isitme.example/api/report/example.com/4b0c….txt'
```

Reports are kept **30 days**. An expired report returns **410** `{ "error": "expired", "retentionDays": 30 }` (the `.txt` form returns a 410 text line); an unknown one returns 404. The human page is `/r/:host/:id`.

## Host history

```
GET /api/host/:host   -> { host, samples: [{ at, ms?, ok, verdict, colo? }], latest: { verdict, at, reportId } | null }
```

Last 24 h of stored checks. Read-only: never starts a probe. `cache-control: public, max-age=60`.

## Badge

```
GET /badge/:host.svg
```

Shows the latest stored verdict and its age, or `unknown` when there is none from the last 24 h. It never starts a probe (run a check to refresh it). `cache-control: public, max-age=60`.

```markdown
[![isitme](https://isitme.example/badge/example.com.svg)](https://isitme.example/)
```

## Trending

```
GET /api/trends   -> [{ host, verdict, provider?, asns, lastAt }]
```

Hosts with recent non-healthy checks, ranked by how many distinct networks (ASNs) reported them, not by raw volume. Only hosts reported from at least 3 ASNs are listed. Read-only, CORS `*`, cached 60 s (`cache-control: public, max-age=60`, plus the colo cache). Rate key `report:<ip>`.

## Watch alerts

A watch alerts only on a confirmed up/down change (two runs in a row). Every alert shows in the app, and it can also go to:

- **Webhook** (`setWebhook`): a JSON POST with `text`/`content` for Slack and Discord, plus `host`, `kind`, `from`, `to`, `reportUrl`. The URL must be https and pass the SSRF guard.
- **Email** (the `email` field on `watch`, or `setEmail`): a plain-text message sent through the Workers `send_email` binding (`EMAIL`), from `EMAIL_FROM` or `alerts@isitme.example` by default. **Cloudflare Email Routing delivers only to verified destination addresses** on the account, so any other address is dropped. In local dev (`npm run dev:local`) the message is only logged. A failed send is logged and never blocks the other channels.

**Mute** (`mute { hostOrId, minutes }` chat tool, `muteWatch(watchId, minutes)` callable): `minutes` from 0 to 10080 (7 days), and 0 unmutes. While muted, checks still run and the watch state stays current, but no alert is created or sent on any channel.

**Uptime** (`getUptime(watchId, days = 7)` callable, 1 to 30 days) returns `{ watchId, days, runs, upRuns, excluded, uptime }` built from that watch's own runs. Runs that don't say anything about the site are `excluded`: INCONCLUSIVE / your-network / ISP verdicts, and down runs where every failing server vantage was itself broken (`noData` / `vantageSick`). `uptime = upRuns / (runs - excluded)`, or `null` when no runs count.

## MCP

Streamable HTTP at `/mcp`. Tools return JSON text; summaries by default, full evidence only from `get_report`.

| Tool          | Input              | Result                                                       |
| ------------- | ------------------ | ------------------------------------------------------------ |
| `check_site`  | `{ url, expect? }` | `CheckOutcome` (waits up to 2 min)                           |
| `start_check` | `{ url, expect? }` | `{ ok, runId, host }` at once                                |
| `get_check`   | `{ runId }`        | `{ status: "running" }` or `CheckOutcome`; same session only |
| `get_report`  | `{ host, id }`     | full `Report`, or `{ error: "expired" \| "not found" }`      |

```json
{ "mcpServers": { "isitme": { "url": "https://isitme.example/mcp" } } }
```

## Rate limits

20 requests per 60 s per key. Keys: `api:<ip>` (check + runs), `report:<ip>` (reports, host history, trends), `badge:<ip>`, `mcp:<ip>`. Over the limit: `429`.
