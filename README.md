# IsItMe: is it down, or is it me?

Paste a URL and get a plain-English verdict: is the problem the site, one region, the site's provider, the wider internet, or **your** connection? Every verdict comes from measurements taken at several vantage points, not from user complaints.

"Is it down?" sites answer half the question: _is the site up from our server?_ Nobody answers the other half: _is it me?_ That half means your device, your ISP (ASN), your resolver and your country, compared with the measured health of the target. IsItMe answers both halves.

Built entirely on Cloudflare: Agents SDK, Workers AI (Llama 3.3 + GLM-4.7-Flash), Workflows, Durable Objects, Radar, 1.1.1.1 DoH, Email, Rate Limiting and Analytics Engine.

> **Screenshot placeholder:** `docs/screenshot.png` (chat with a live diagnosis card, sidebar showing your network, watches, alerts and recent reports).

## Why IsItMe beats existing tools

Each IsItMe cell below describes code in this repo. The competitor cells come from the competitor research in [docs/COMPETITOR_SPEC.md](docs/COMPETITOR_SPEC.md).

| Capability                                   | Downdetector                      | Down checkers (DFEOJM, isup.me, IIDRN) | Uptime monitors (UptimeRobot, Pingdom, Better Stack, Kuma) | Globalping (MCP)                    | Status aggregators (StatusGator, IsDown) | **IsItMe**                                                                                                                               |
| -------------------------------------------- | --------------------------------- | -------------------------------------- | ---------------------------------------------------------- | ----------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Signal source                                | User complaints, social posts     | One HTTP check from one server         | Scheduled probes                                           | Raw probes on request               | Vendors' own status pages                | Probes from the user's browser, the Cloudflare edge and 5 regions, plus Radar, crowd data and the vendor status page                     |
| Tests from **your** network                  | No                                | No                                     | No                                                         | No                                  | No                                       | Yes: a browser probe with two DoH resolvers, a control URL, and VPN/WARP/Private Relay/captive-portal/IPv6 hints                         |
| Multi-region, deduplicated by real location  | No                                | No                                     | Yes (often paid)                                           | Yes                                 | No                                       | Yes: 5 `locationHint` regions, each reporting the colo it actually ran in, counted once per colo                                         |
| An answer, not raw data                      | Report counts                     | Up/down                                | Up/down                                                    | Raw output the LLM has to interpret | Vendor wording                           | 12 verdicts with subtypes, signals, and a per-factor confidence breakdown                                                                |
| Bot protection is not "down"                 | n/a                               | No (a 403/503 challenge reads as down) | Often no (a WAF block raises a down alert)                 | No                                  | n/a                                      | `BLOCKED`, split into challenge, WAF, rate limit and geo                                                                                 |
| "200 but broken" pages                       | n/a                               | No                                     | Only with a keyword check                                  | No                                  | n/a                                      | `PARTIAL`: parked, empty, error page, missing `expect` text, or a 404 path on a live site                                                |
| TLS and resolver failures as their own layer | No                                | No                                     | TLS only                                                   | Raw data                            | No                                       | `TLS_ERROR`, a Cloudflare vs Google resolver comparison, DNSSEC detection, authoritative NS queries, RDAP expiry                         |
| ISP and country outage context               | Inferred from complaints          | No                                     | No                                                         | No                                  | No                                       | Cloudflare Radar outages, anomalies and BGP events, counted only while recent and only above a confidence threshold                      |
| Status page vs reality                       | No                                | No                                     | No                                                         | No                                  | Shows the vendor's claim                 | Shows the vendor's claim next to the measurements, plus how long the vendor took to acknowledge the failure                              |
| Provider blast radius                        | Blames brands that spike together | No                                     | No                                                         | No                                  | Per vendor                               | CDN/host fingerprint. The provider is blamed only when 3 or more other hosts on it are failing, or its own status page shows an incident |
| Alert noise control                          | n/a                               | n/a                                    | Varies; some tiers alert on a single failed check          | n/a                                 | n/a                                      | 60 s confirm run, 2-run recovery, one incident per outage, mute windows                                                                  |
| Says "we don't know"                         | No                                | No                                     | No                                                         | n/a                                 | No                                       | `INCONCLUSIVE` when too few independent vantages answer                                                                                  |
| Agent access                                 | No                                | No                                     | Paid APIs                                                  | MCP, raw data only                  | MCP on paid tiers                        | Free REST API (sync or async), 4 MCP tools, chat with memory                                                                             |
| Ask a customer to test                       | No                                | No                                     | No                                                         | No                                  | No                                       | `/c/:host?ref=` link: the customer's browser runs the probe, gets its own verdict, and the result joins your report                      |

What competitors still do that IsItMe doesn't: ICMP, traceroute and TCP/UDP port checks (Workers can't send them), certificate-expiry countdowns (Workers don't expose the peer certificate), SMS and voice alerts, hosted status pages, and years of history.

## Competitor bugs we deliberately avoid

The spec lists 14 bugs (B1 to B14) that the first build shared with competitors, and 19 rules (R1 to R19) to fix them. All are implemented, with vitest acceptance tests wherever the logic is pure, except one R12 case, noted in its row.

| Competitor bug                                                                    | Rule | How IsItMe avoids it                                                                                                                                                                                                                    |
| --------------------------------------------------------------------------------- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A WAF or Cloudflare challenge 503 reported as "down" (isup.me, UptimeRobot, Kuma) | R1   | `probes.ts` reads status, headers and up to 64 KB of the body. It recognises `cf-mitigated`, "Just a moment", Akamai, DataDome, 429 and 451. A block counts as reachable and gives `BLOCKED`                                            |
| One slow response counted as an outage                                            | R2   | 8 s first attempt, then one 15 s retry on timeout or connect failure. A late answer feeds `SLOW`. A missing timestamp renders as "never", not "56 years ago"                                                                            |
| An invalid certificate reported as "down"                                         | R3   | 525/526 and TLS error text map to `tls`, 530 to `dns`, and 520–524 with `cf-ray` to "origin failing" → `TLS_ERROR` or `DOWN_*/origin`                                                                                                   |
| A 200 blank, parked or error page reported as healthy                             | R4   | Body sniffing flags empty, error and parked pages, plus an optional `expect` keyword → `PARTIAL`                                                                                                                                        |
| Redirects not followed, or apex/www confusion                                     | R5   | Up to 5 manual redirect hops, each one re-checked by the SSRF guard. A 404 path is compared with the site root, and a failing apex is retried as `www.` (or the reverse)                                                                |
| A broken probe location counted as a vote that the site is down (Globalping #417) | R6   | A failed ProbeDO call becomes `noData` and is left out of every ratio. Each ProbeDO also runs a control fetch and keeps a 5-minute tally, so a sick vantage is flagged and excluded. Missing regions are named in the signals           |
| One vantage decides (UptimeRobot free tier, Kuma #87)                             | R7   | Quorum over **distinct colos**. `DOWN_GLOBAL` needs 2 or more failing colos and at least 80% failing                                                                                                                                    |
| False alerts on a single failed check (UptimeRobot, Kuma #2637)                   | R8   | `alerts.ts`: a class change triggers a 60 s confirm run, recovery needs 2 "up" runs, moving within the same class updates the open incident, and `INCONCLUSIVE` never alerts                                                            |
| The wrong provider blamed (Downdetector blaming AWS for Azure outages)            | R9   | A BGP event counts only at Radar confidence 8 or higher, within 2 h, with a prefix that contains the target IP. Provider blame needs 3 or more other failing hosts or the provider's own status incident                                |
| A stale "last down" shown as current                                              | R10  | Radar outages and anomalies count only while ongoing or ended at most 2 h ago. Missing Radar data reads "Radar: no data", never "no outage"                                                                                             |
| A 1.1.1.1 outage reported as the site's DNS failure                               | R11  | Cloudflare and Google DoH are queried in parallel at the edge and in the browser, with a `cd=1` re-query on SERVFAIL to detect DNSSEC failures. `DNS_FAILURE` needs both resolvers to agree                                             |
| "Any answer beats unknown"                                                        | R12  | `INCONCLUSIVE` replaces the old 0.5-confidence guesses. **Partial:** a lone answering colo with no browser gives `HEALTHY`, capped at 0.7, not `INCONCLUSIVE`, because local dev puts every region in one colo                          |
| An LLM that invents causes                                                        | R13  | Rules pick the verdict. The prompt may only restate the signals, a post-filter drops sentences naming providers that aren't in the evidence, and templates take over if Workers AI fails                                                |
| Crowd noise treated as measurement (Downdetector)                                 | R14  | Crowd rows come only from measured browser probes. They move confidence by at most 0.1, never pick the verdict, and buckets under 3 samples are hidden                                                                                  |
| Unvalidated visitor data shown as evidence                                        | R15  | `browser-probe.ts` validates every field and string length, and returns 400 on a bad shape. Visitor checks are labelled "self-reported"                                                                                                 |
| One shared API handle as a bottleneck (Globalping MCP)                            | R16  | One agent per caller (`api-<hash(ip)>`, one per MCP session), an async `wait=0` mode with polling, and zod schemas shared by REST, MCP and chat, pinned by a snapshot test                                                              |
| Share links that silently break                                                   | R17  | Reports are kept 30 days by a TargetDO alarm, then return 410 and an "expired" page                                                                                                                                                     |
| The checker's own outage blamed on the site                                       | R18  | `selfSuspect` is set from cloudflarestatus.com, from Cloudflare-generated 5xx across colos, or from 1.1.1.1 failing while Google works. It shows a banner and caps confidence at 0.7. The browser result still renders if the run fails |
| Abuse through the checker                                                         | R19  | The SSRF guard runs on every hop, watches are 5 to 1440 min with at most 10 per device and 10 per IP, and badges and reports only read cached data, never probe                                                                         |

## How it works

### Vantage points

| Vantage               | How                                                                                                                                                                                                                                                       | What it proves                                                                                                        |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **Your device**       | Browser probe (`src/client/probe.ts`): a `no-cors` fetch with a `favicon.ico` image fallback, Cloudflare and Google DoH from the browser, a control request, same-origin `/cdn-cgi/trace` (WARP, Gateway, location vs timezone), and an IPv6-only control | Whether _your_ network and resolver can reach it. Reachability and timing only; browsers hide cross-site status codes |
| **Cloudflare's edge** | Cloudflare and Google DoH (A + AAAA, DNSSEC check), an HTTP probe from the Worker's colo, and HTTP probes from five `ProbeDO`s placed in `wnam, enam, weur, apac, oc`. Each reports its real colo and runs a control fetch                                | Whether the site is up, and where; bot protection, TLS and "200 but broken" pages                                     |
| **The internet**      | Cloudflare Radar: outages and traffic anomalies for your ASN and country, and BGP hijacks and leaks affecting the target's prefix                                                                                                                         | Whether your ISP or the site's network has a known incident                                                           |
| **Context**           | Provider fingerprint (CNAME, headers, ASN) with a per-provider failure count; the vendor's Statuspage JSON and cloudflarestatus.com; a per-colo latency baseline; RDAP and authoritative NS queries when DNS fails                                        | Whether it's the provider, whether the vendor admits it, and whether "slow" is unusual                                |

A **crowd signal** adds one more view. Each hostname's `TargetDO` keeps recent checks for 10 minutes, grouped by ASN and country. Only browser checks carry a network. Each hashed client IP gets one vote per host per window, and the crowd can only nudge confidence.

### Rules decide, the LLM explains

A pure, deterministic rule engine (`src/lib/classify.ts`, first match wins) picks one of:

| Verdict               | Rule (summary)                                                                                       |
| --------------------- | ---------------------------------------------------------------------------------------------------- |
| `DNS_FAILURE`         | Both resolvers fail with the same error (subtypes `nxdomain`, `dnssec`)                              |
| `UPSTREAM_OUTAGE`     | A strong, recent BGP event covers the target's prefix, and the vantages fail                         |
| `TLS_ERROR`           | Every answering server vantage fails the TLS handshake                                               |
| `BLOCKED`             | Every answering server vantage gets bot protection instead of the site                               |
| `DOWN_GLOBAL`         | 2 or more distinct colos failing and at least 80% of the answering colos failing                     |
| `DOWN_REGIONAL`       | At least one colo failing and at least one answering (subtype `origin` for Cloudflare 52x)           |
| `ISP_OUTAGE`          | Servers OK, your browser fails, and Radar has a recent outage for your ASN or country                |
| `LIKELY_YOUR_NETWORK` | Servers OK, your browser fails                                                                       |
| `PARTIAL`             | Reachable, but the page is parked, empty, an error page, missing the `expect` text, or the path 404s |
| `SLOW`                | Reachable, but slower than max(3 s, 3× this colo's usual time)                                       |
| `INCONCLUSIVE`        | Not enough independent vantages answered                                                             |
| `HEALTHY`             | Everything else                                                                                      |

Each verdict carries a confidence (0.5 to 0.95), the signals that drove it, a `factors[]` breakdown that the card displays, and "looks like" hints about your setup (VPN, WARP, Private Relay, captive portal, broken IPv6), which never drive the verdict. Missing evidence never counts as a failure; it only lowers confidence.

The LLM (`@cf/meta/llama-3.3-70b-instruct-fp8-fast` on Workers AI) never decides. `src/lib/explain.ts` gives it the verdict, the signals and a compact evidence JSON, and asks for 2 to 4 sentences and a short "Next steps" list. Target-controlled text (error strings, CNAMEs, page titles, `Location` URLs) is stripped or cut down to hosts first, and vendor status text is capped. A post-filter drops any sentence naming a provider that isn't in the evidence. If Workers AI fails, templated next steps per verdict take over.

## Architecture

```
                         WebSocket (state sync + chat stream)
Browser (React SPA) <----------------------------------> UserAgent  (AIChatAgent DO, one per anonymous device id)
  | browser probe --> @callable submitBrowserProbe          | chat tools: diagnose, watch, unwatch, history, setWebhook, setEmail, mute
  |                                                         | memory: SQL reports + synced state (runs, watches, alerts, history)
  |                                                         | watches: scheduleEvery() -> checkWatch -> confirm run -> alert (toast, webhook, email)
  |                                                         v runWorkflow()
  |                                          DiagnoseWorkflow  (AgentWorkflow, durable steps, reportProgress -> live card)
  |                                            dns (CF + Google) -> [ edge | regions | radar ] -> root / www fallback
  |                                              -> [ provider | status ] -> authns / rdap / baseline -> browser -> crowd
  |                                              -> classify -> status lag -> explain -> save (+ Analytics Engine, TrendsDO)
  |                                                         |  every probe goes through
  |                                                         v
  '-- /r, /c, /trending, /api/*, /badge/*, /mcp --> Worker --> TargetDO  (one per hostname)
                                                     |          coalescing + 60s cache, per-host probe budget, crowd store,
                                                     |          reports (30-day alarm), latency samples, status page memo
                                                     |            |
                                                     |            v  getByName("probe-<region>", { locationHint })
                                                     |          ProbeDO x5  (wnam, enam, weur, apac, oc; control fetch, sick tally)
                                                     |--> ProviderDO  (one per CDN/host provider: failing-host counts, never hostnames)
                                                     |--> TrendsDO    (singleton: non-healthy runs, ranked by distinct ASNs; per-IP watch quota)
                                                     '-- /mcp --> IsItMeMcp (McpAgent) --> UserAgent "mcp-<session>"
```

- **UserAgent** (`src/agents/user-agent.ts`): the chat agent and the user's memory. `onConnect` captures your network from `request.cf`. It stores reports in SQLite and syncs runs, watches, alerts and history to every open tab. Watch decisions (confirm, hysteresis, incidents, mute, silent incidents) are pure functions in `src/lib/alerts.ts`. Per-watch uptime (`src/lib/uptime.ts`) leaves out runs caused by a sick vantage or the user's own network. REST callers get an agent per hashed IP, and MCP gets one per session.
- **DiagnoseWorkflow** (`src/workflow/diagnose.ts`): every probe is a `step.do` with retries and a timeout. Independent steps run in parallel. The browser result is read from the agent, or awaited with `step.waitForEvent` for up to 15 s. Watch runs skip the LLM when the verdict hasn't changed.
- **TargetDO** (`src/agents/target-do.ts`): 1000 people checking one host during an outage trigger one probe run. Unique paths can't buy more than 12 real fan-outs per host per minute. It also stores public reports, "check from your side" results, and the latency samples behind the sparkline, badge and baseline.
- **ProbeDO** (`src/agents/probe-do.ts`): a regional vantage that reports the colo it egressed from, runs a control fetch, and flags itself sick when most hosts it saw in the last 5 minutes fail.
- **ProviderDO** (`src/agents/provider-do.ts`) and **TrendsDO** (`src/agents/trends-do.ts`): provider blast radius, and the `/trending` list.
- **IsItMeMcp** (`src/agents/mcp.ts`): an `McpAgent` with `check_site`, `start_check`, `get_check` and `get_report`.

## Assignment requirements

| Requirement                 | Where                                                                                                                                                                                                                                                           |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **LLM**                     | Llama 3.3 70B (`@cf/meta/llama-3.3-70b-instruct-fp8-fast`) on Workers AI writes every grounded explanation via `env.AI.run`. Chat tool-routing (`streamText` + `workers-ai-provider`, 7 tools) uses `@cf/zai-org/glm-4.7-flash`: in live testing Llama 3.3's streamed tool-call arguments arrived corrupted (`{"url": "{"url": "githubgithub.com"}.com"}`), so each model does the job it's reliable at |
| **Workflow / coordination** | Cloudflare Workflows (`DiagnoseWorkflow`, an `AgentWorkflow` with retried, timed, parallel steps and live progress), Durable Objects (`TargetDO` coalescing, `ProbeDO` placement, `ProviderDO`, `TrendsDO`), Agents SDK scheduling for watches and confirm runs |
| **User input (chat)**       | React chat UI (Kumo UI, streamed markdown) served from Workers static assets, over the Agents SDK WebSocket (`useAgent` + `useAgentChat`)                                                                                                                       |
| **Memory / state**          | `UserAgent` SQLite (reports, API runs) and synced state (runs, watches, alerts, history), persisted chat history, and `TargetDO` SQLite (crowd checks, public reports, latency samples). The system prompt includes your network, watches and recent verdicts   |

## Surfaces

| Surface                     | Path                                   | Notes                                                                                                                                                                                                                                            |
| --------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Chat app                    | `/`                                    | Live step card per check, with confidence factors, provider, resolver comparison and status-page chips, and a self-suspect banner. Sidebar with your network, alerts, watches (mute, uptime) and history. Data export                            |
| Public share report         | `/r/:host/:id`                         | Read-only, with a response-time sparkline, visitor results grouped by network, and "copy for support". Shows an "expired" state after 30 days. Never includes the owner's device id or city                                                      |
| "Check from your side" link | `/c/:host?ref=:reportId`               | Send it to a customer. Their browser runs the probe and they get **their own** verdict. The result (ISP and country only, never the IP) joins your report and is pushed to your open app                                                         |
| Trending                    | `/trending`, `GET /api/trends`         | Non-healthy hosts from the last hour, ranked by distinct failing networks, not volume. Only hosts reported from 3 or more ASNs are shown                                                                                                         |
| REST API                    | `GET /api/v1/check?url=&expect=&wait=` | Returns a `CheckOutcome` (verdict, subtype, confidence, signals, provider, explanation, report path). `wait=0` returns 202 and a poll path for `GET /api/v1/runs/:id`. CORS open. See [docs/API.md](docs/API.md)                                 |
| Host history                | `GET /api/host/:host`                  | Last 24 h of samples and the latest verdict. Never probes                                                                                                                                                                                        |
| MCP server                  | `/mcp` (streamable HTTP)               | `check_site`, `start_check`/`get_check`, `get_report`, with input schemas shared with REST                                                                                                                                                       |
| Status badge                | `/badge/:host.svg`                     | Latest stored verdict and its age. Never triggers a probe                                                                                                                                                                                        |
| Support bundle              | `GET /api/report/:host/:id.txt`        | Plain-text evidence (UTC times, your ASN, per-vantage results, resolver comparison) to paste to your ISP or the site's support                                                                                                                   |
| Alerts                      | in-app, webhook, email                 | Watches every 5 to 1440 min, optionally with `expect` text or `until: recovered`. Confirmed down and recovery alerts go to a toast, a Slack/Discord-compatible webhook, and email (when the `EMAIL` binding is configured). Mute for maintenance |
| Static fallback             | `public/fallback.html`                 | Self-contained, browser-only checker for when the app itself won't load, for example during a Cloudflare incident                                                                                                                                |

## Safety

- **SSRF guard** (`src/lib/guard.ts`, 100+ unit tests):
  - Only http/https URLs on ports 80, 443, 8080 or 8443, with no credentials.
  - Blocks `localhost`, `.local`, `.internal` and `.home.arpa` names.
  - Blocks private, loopback, link-local, metadata, CGNAT, multicast and reserved ranges, for IPv4, IPv6, IPv4-mapped, NAT64 and 6to4 forms, and for odd IPv4 spellings like `0x7f.1`.
  - The same check applies to IP literals, to every address the hostname resolves to, and to **every redirect hop**.
  - Query strings are dropped, so callers can't bust the cache or coalescing.
  - Response bodies are read only up to 64 KB for classification. They are never rendered, and page text never reaches the LLM or the signals.
- **Webhooks** must be https, pass the same guard, and are re-checked before every send, since DNS can move later. Untrusted text is escaped for Slack. Email headers are stripped of CR/LF.
- **Rate limits** (Workers Rate Limiting binding, 20 requests per 60 s per key): chat per device and per IP, new WebSockets per IP, and REST, MCP, reports, trends, badges and extra checks per IP. `TargetDO` adds a per-host probe budget, and watches are capped per device and per IP.
- **Untrusted client input**: browser probe payloads are validated field by field. Only `user-agent/<device id>` agents are reachable from outside, so browsers can't talk to the API or MCP agents.
- **Rendering**: LLM markdown is rendered with no images (no tracking pixels on shared reports) and no raw HTML.
- **Privacy**: reports never contain the owner's device id, city or the browser's IP. ProviderDO returns counts, never other hostnames.

## Observability

- **Workers Analytics Engine** (`isitme_checks` dataset): one data point per check.
  - Index: host.
  - Blobs: host, verdict, trigger, country, colo, edge error class.
  - Doubles: total duration, DNS ms, edge ms, confidence.

  For example:

  ```sql
  SELECT blob2 AS verdict, count() AS checks, avg(double1) AS avg_ms
  FROM isitme_checks WHERE timestamp > NOW() - INTERVAL '1' DAY GROUP BY verdict
  ```

- **Workers Logs** (`observability.enabled`): structured log lines, including one line for each real `TargetDO` probe run, so you can see coalescing working. Rejected ProbeDOs, Workers AI failures, refused webhooks and email failures are logged too.
- **Per-step state**: every run's step timings and summaries are kept in the report, so a shared report shows exactly what was measured.

## Run it locally

Requires Node 20+ and a free Cloudflare account.

```bash
npm install
npx wrangler login               # Workers AI runs remotely even in dev ("remote": true)
cp .dev.vars.example .dev.vars   # optional: RADAR_TOKEN=<Cloudflare API token with Radar read>
npm run dev                      # http://localhost:5173
```

- **Remote Workers AI needs a `workers.dev` subdomain on your account.** Without one, `npm run dev` fails with error **10063**. Open Workers & Pages in the dashboard once to claim a subdomain, or use the fallback below.
- `npm run dev:local` (`LOCAL_ONLY=1`) skips remote bindings. Probes, the REST API, MCP, badges, reports and every page still work. Chat needs Workers AI, and explanations fall back to the per-verdict templates.
- Without `RADAR_TOKEN`, the Radar step reports "skipped" and verdicts carry a little less confidence.

Checks:

```bash
npm test                         # 472 vitest tests: classify, guard, probes, alerts, explain, schemas, …
npx tsc --noEmit
npx vite build
curl 'http://localhost:5173/api/v1/check?url=example.com'
curl 'http://localhost:5173/api/v1/check?url=example.com&wait=0'     # 202 + pollPath
curl 'http://localhost:5173/badge/example.com.svg'
```

Try these in the chat:

- `Is github.com down?`
- `is doesnotexist-xyz123.com down` returns `DNS_FAILURE` (subtype `nxdomain`)
- `check http://169.254.169.254` is refused by the SSRF guard
- `watch mysite.com every 5 minutes and post to https://hooks.slack.com/services/…`
- `watch mysite.com until it recovers`
- `mute mysite.com for 60 minutes`
- `what did I check today?`
- `stop watching mysite.com`

## Deploy

```bash
npx wrangler secret put RADAR_TOKEN   # optional
npm run deploy                        # vite build && wrangler deploy
```

This creates the Worker, six Durable Object classes (SQLite-backed, migrations `v1` to `v3`), the `diagnose-workflow` Workflow, the rate limiter, the Analytics Engine dataset and the `EMAIL` binding. Email alerts only reach addresses verified in Email Routing. Set the `EMAIL_FROM` var to an address on a zone you own. After deploy, the five `ProbeDO`s really do land in different regions, and the card shows the colo each one ran in.

## Caveats

- In local dev, `locationHint` does nothing, so all five "regions" run on your machine and count as one colo. True multi-region probing only happens after deploy. A `locationHint` is also only a hint, which is why vantages are counted per real colo.
- The 525/526 → `TLS_ERROR` mapping follows Cloudflare's documented edge codes and is unit-tested with mocks. Locally, a bad certificate shows up as an opaque error. Production behaviour needs checking after deploy (see [docs/SDK_NOTES.md](docs/SDK_NOTES.md)).
- The browser probe can't see status codes: `no-cors` only proves the request completed. It can't test `http://` targets from the `https://` app (mixed content), so those runs skip it.
- Probes are HTTP only. Workers can't send ICMP or run traceroute, and `connect()` to Cloudflare IPs is blocked, so authoritative NS queries to Cloudflare-hosted nameservers show up as "no data".
- Workers can't pin the IP a hostname resolved to, so a DNS rebind between the guard check and the fetch is not prevented.
- Provider attribution uses real traffic only (no canary probes), so a rarely checked provider rarely gets blamed.
- Identity is an anonymous device id in `localStorage`. Clearing it starts a fresh history. Use the sidebar export first.

## Roadmap

- Accounts and teams (Cloudflare Access or magic links), shared watches, and a support inbox for "check from your side" results.
- Canary hosts per provider, so blast radius works without organic traffic.
- Publish `public/fallback.html` to GitHub Pages as a second, off-Cloudflare deploy target.
- Globalping as an extra probe source for last-mile vantage points outside Cloudflare.

### Pricing sketch

| Tier | Price   | Includes                                                                    |
| ---- | ------- | --------------------------------------------------------------------------- |
| Free | $0      | Ad-hoc checks, share links, "check from your side" links, 1 watch at 15 min |
| Pro  | ~$9/mo  | 10 watches at 5 min, webhooks and email, 10k API/MCP checks per month       |
| Team | ~$49/mo | Shared watches, support inbox for customer checks, SSO, 100k API checks     |

Costs stay low because `TargetDO` coalescing means an outage costs one probe run per host per minute, however many people ask.

See [PROMPTS.md](./PROMPTS.md) for the prompt history used to build this, and the prompts the app sends to Workers AI. The competitor research, rules and build status are in [docs/COMPETITOR_SPEC.md](docs/COMPETITOR_SPEC.md).
