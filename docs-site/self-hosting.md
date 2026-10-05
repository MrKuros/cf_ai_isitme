---
title: Self-hosting
description: "Deploy your own copy: bindings, secrets, limits, costs and custom domains."
---

# Self-hosting

IsItMe is a single Workers project. There is no database to provision and no
server to keep alive — `npm run deploy` creates everything it needs.

## What you need

- A Cloudflare account. A free one is enough.
- Node 20 or newer.
- A `workers.dev` subdomain on the account. Open **Workers & Pages** in the
  dashboard once and Cloudflare offers you one.

## Deploy

```bash
git clone https://github.com/MrKuros/isitme
cd isitme
npm install
npx wrangler login
npm run deploy
```

`npm run deploy` is `vite build && wrangler deploy`: it bundles the React app
into `dist/`, uploads the Worker, and creates the Durable Objects, the Workflow,
the rate limiter and the Analytics Engine dataset on first run. Your copy lands
at `https://cf-ai-isitme.<your-subdomain>.workers.dev`.

There is also a one-click path from the README's **Deploy to Cloudflare** button,
which forks the repo and deploys it for you.

## Every binding, explained

All of them are declared in `wrangler.jsonc`. None of them need to be created by
hand first.

| Binding             | Kind             | What it is for                                                                                                      |
| ------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------- |
| `AI`                | Workers AI       | Writes the explanation (Llama 3.3 70B) and routes chat messages to tools (GLM-4.7-Flash).                           |
| `DIAGNOSE_WORKFLOW` | Workflow         | The check itself: ordered, retried, durable steps. One run per check.                                               |
| `UserAgent`         | Durable Object   | One per visitor. Holds the conversation, saved checks, watches and alert settings.                                  |
| `TARGET_DO`         | Durable Object   | One per host checked. De-duplicates simultaneous checks of the same site, and stores its history and share reports. |
| `PROBE_DO`          | Durable Object   | One per region. Each is placed with a `locationHint` and loads the site from there.                                 |
| `PROVIDER_DO`       | Durable Object   | Counts failures per hosting provider, so a Cloudflare- or AWS-wide problem is recognised as one.                    |
| `TRENDS_DO`         | Durable Object   | The global "what's breaking now" list behind `/trending`.                                                           |
| `MCP_OBJECT`        | Durable Object   | Session state for the MCP server at `/mcp`.                                                                         |
| `RATE_LIMITER`      | Rate limiting    | 20 requests per 60 seconds per IP, counted separately for each kind of endpoint.                                    |
| `ANALYTICS`         | Analytics Engine | Writes one row per check so you can query your own usage. Nothing is written if you remove it.                      |
| `EMAIL`             | Email sending    | Email alerts for watched sites. Needs setup — see below.                                                            |
| `assets`            | Static assets    | Serves the built SPA from `dist/`. `/agents/*`, `/api/*`, `/mcp*` and `/badge/*` hit the Worker first.              |

The Durable Object classes are all SQLite-backed (`new_sqlite_classes` in the
`migrations` list). Don't renumber or rename those migration tags on an existing
deployment; Cloudflare uses them to track what already exists.

> [!WARNING] Durable Object class names are load-bearing
> The Workflow resolves agents by class name after bundling. If you rename a
> class, rename it in `wrangler.jsonc` too, and add a migration.

## Secrets and variables

Only one secret exists, and it is optional.

```bash
npx wrangler secret put RADAR_TOKEN
```

`RADAR_TOKEN` is a Cloudflare API token with Radar read access. With it, each
check also asks Cloudflare Radar whether your ISP, your country or the site's
host has a known outage or routing event. Without it that step is skipped
cleanly — the signal line reads:

```
Radar: no data (no RADAR_TOKEN)
```

and the verdict carries slightly less confidence. Nothing breaks.

For local development, put it in `.dev.vars` instead:

```bash
cp .dev.vars.example .dev.vars   # then fill in RADAR_TOKEN=
```

One optional plain variable:

| Variable     | Default                 | What it does                                                                                                  |
| ------------ | ----------------------- | ------------------------------------------------------------------------------------------------------------- |
| `EMAIL_FROM` | `alerts@isitme.example` | The `From:` address on alert emails. The default is a placeholder, and while it is set email alerts stay off. |

### Email alerts

The `EMAIL` binding is Cloudflare's [Email
Routing](https://developers.cloudflare.com/email-routing/email-workers/send-email-workers/)
send API, and it has two constraints that are easy to trip over:

1. **The sender must be on a zone you own.** The default
   `alerts@isitme.example` is a placeholder and will be rejected. Add a domain
   to your account, enable Email Routing on it, and set `EMAIL_FROM` to an
   address on that domain.
2. **The recipient must be a verified destination address** in that zone's Email
   Routing settings. Cloudflare will not send to arbitrary addresses.

Until you set `EMAIL_FROM`, email is simply unavailable rather than broken:
asking the chat for email alerts gets a refusal naming the variable, and alerts
and digests skip email instead of attempting a send Email Routing would reject.
Webhook alerts (Slack, Discord, any JSON endpoint) need no setup at all, so they
are the easier path. See [Watching and alerts](/watching).

## Free-tier limits and realistic costs

What one check actually consumes, counted from the code:

| Resource              | Per check                                                                                               |
| --------------------- | ------------------------------------------------------------------------------------------------------- |
| Workflow runs         | 1 (about a dozen steps)                                                                                 |
| Durable Object calls  | ~8: one per region, one for the host, plus provider and trends                                          |
| Workers AI calls      | 1 for the explanation, plus 1 chat-model call if you asked in the chat                                  |
| Outbound requests     | DNS over two resolvers, one edge probe, five regional probes, Globalping, Radar, the site's status page |
| Analytics Engine rows | 1                                                                                                       |

A check takes roughly 5 to 15 seconds wall-clock, most of it waiting on the
network rather than burning CPU, and Workers bills CPU time, not wall-clock.

The numbers that bound a free account — Workers requests per day, Workers AI
neurons per day, Durable Object requests, Workflow steps — are set by Cloudflare
and change, so this page does not copy them. Read them at
[Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/),
[Durable Objects
pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) and
[Workers AI
pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/). For a
personal copy with a handful of watched sites, the free allocation is the thing
you'll be inside; the first limit you are likely to meet is Workers AI, because
every check spends one generation on its explanation.

Two app-level guards exist to keep a copy cheap:

- **Watches are clamped to a 5-minute minimum interval**, and 10 watches per
  device. Asking the chat for "every minute" gets clamped, and it tells you.
- **Checks of the same host are coalesced.** A thousand people asking about the
  same site during an outage run one check between them.

### The Globalping quota is shared

Globalping is called without an API key, which means a quota of **250 probes per
hour per IP address**, confirmed from its own response headers:

```console
$ curl -sD - -o /dev/null -X POST https://api.globalping.io/v1/measurements \
    -H 'content-type: application/json' \
    -d '{"type":"ping","target":"example.com","limit":1}'
HTTP/2 202
x-ratelimit-limit: 250
x-ratelimit-consumed: 1
x-ratelimit-remaining: 219
x-ratelimit-reset: 3511
```

One IsItMe check uses 5 of those. A deployed Worker shares its egress addresses
with other Cloudflare traffic, so under sustained load that step degrades to
`skipped: "rate limited"` and the outside probes quietly disappear from the
evidence. The verdict is unaffected — Globalping never votes — but the signal
line goes away. If you plan heavy use, get a Globalping token and add it to
`src/lib/globalping.ts`; today the code sends no `Authorization` header.

## Custom domain

Workers custom domains are a `routes` entry in `wrangler.jsonc`:

```jsonc
"routes": [
  { "pattern": "isitme.example.com", "custom_domain": true }
]
```

The zone has to be on the same Cloudflare account. `npm run deploy` then creates
the hostname and its certificate.

Three files hardcode the deployed origin, and a custom domain means editing all
three:

| File                                 | What it sets                                          |
| ------------------------------------ | ----------------------------------------------------- |
| `bin/isitme.mjs`                     | `DEFAULT_API` — where the CLI checks by default       |
| `docs-site/.vitepress/theme/site.ts` | `SITE_URL` — every link and live example on this site |
| `index.html`                         | `og:url` and `og:image` — link previews               |

## Local versus deployed

`npm run dev` runs the real Worker in a local `workerd`, with Workers AI called
remotely. Most of the app behaves identically. These things do not:

|                    | Local dev                                                                                                                            | Deployed                                     |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------- |
| **Regions**        | `locationHint` is ignored. All five "regions" run in your own colo.                                                                  | Five genuinely different Cloudflare regions. |
| **Confidence**     | Capped, because one location is not five.                                                                                            | Full.                                        |
| **TLS failures**   | `workerd` reports them as an opaque `internal error`, so <Verdict v="TLS_ERROR" /> is not reachable locally.                         | Real bad certificates produce it.            |
| **Cloudflare IPs** | `connect()` to Cloudflare addresses is blocked, so nameserver lookups over TCP fail for Cloudflare-hosted zones. Labelled "no data". | Works.                                       |

The regional one is visible in any local report. All five entries come back with
the same `colo`:

```console
$ curl -s "localhost:5173/api/v1/check?url=github.com" | jq -r '.signals[]'
Cloudflare's edge (MAA) got HTTP 200 in 1636ms
5/5 regions reachable (median 501ms)
DNS resolved to 1 address in 124ms
Only one Cloudflare location answered
5 checks in the last 10 min, 0 failing
Radar: no data (no RADAR_TOKEN)
All 5 outside probes reached it
```

> "Only one Cloudflare location answered" is the app telling you it knows. After
> a deploy that line disappears and the confidence goes up.

The same call against the deployed demo, which has a `RADAR_TOKEN`:

```console
$ curl -s "https://cf-ai-isitme.patelkashishpatel032.workers.dev/api/v1/check?url=example.com" \
    | jq -r '.signals[]'
Cloudflare's edge (ORD) got HTTP 200 in 7ms
5/5 regions reachable (median 6ms)
DNS resolved to 4 addresses in 3ms, DNSSEC-validated
11 checks in the last 10 min, 0 failing
No ongoing Radar outages or anomalies for your network
All 5 outside probes reached it
```

The five regions ran in DFW, ORD, AMS, KIX and MEL — the full
[report's](/sharing#the-text-bundle-for-support-tickets) vantage list names each
colo.

There is also `npm run dev:local` (`LOCAL_ONLY=1`), which skips every remote
binding. Probes, the REST API, MCP, badges, reports and all the pages work;
chat tool-calling does not, and explanations fall back to per-verdict templates.
Use it when you have no Cloudflare account to hand.

[Limits and troubleshooting](/limits) covers what goes wrong and how to fix it.
