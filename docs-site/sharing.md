---
title: Sharing
description: "Report links, check-from-your-side links, badges, per-host pages and trending."
---

# Sharing

Ways to hand a result to someone else — or ask them to run one from their own
network.

The `curl` examples below were run against the live demo, with
`ISITME=https://cf-ai-isitme.patelkashishpatel032.workers.dev`. Point `ISITME` at
your own origin to repeat them.

## Report links

Every check saves a report at `/r/<host>/<id>`. The card in the chat has a
**Copy share link** button; the report page itself has **Copy link**. The page is public and read-only: anyone with the link sees the verdict,
the signals, the explanation and the full evidence grid, and nothing they do
there starts a new check.

What a link does _not_ carry: your device id, your IP address or your city. The
report keeps the network's ASN, its organisation name and the country, because
that is what makes "it's your ISP" verifiable. Visitor checks have their
identifying key stripped before the report is served.

### They expire after 30 days

Reports are kept **30 days**. After that the link stays valid but the content is
gone, and the page says so instead of 404-ing: "This report expired (reports are
kept 30 days)." The API answers `410` with `{"error":"expired","retentionDays":30}`.
An id that never existed answers `404`:

```console
$ curl -s "$ISITME/api/report/example.com/00000000-0000-0000-0000-000000000000"
{"error":"not found"}
```

If you need a result to outlive that, copy the text bundle below.

### The text bundle, for support tickets

Two buttons on every report: **Copy for support**, and `.txt` which opens the
same thing at `/api/report/<host>/<id>.txt`. It is plain text, safe to paste into
a ticket, an email or a chat with someone who will never click a link:

```console
$ curl -s "$ISITME/api/report/example.com/0dfe52e9-d514-4540-af78-5ebb50331bf7.txt"
IsItMe diagnostic report for example.com
Time (UTC): 2026-10-05T12:26:26.381Z
Target: https://example.com/
Tested from: AS24560 (Bharti Airtel Limited), IN
Verdict: HEALTHY, confidence 85%

Signals:
- Cloudflare's edge (ORD) got HTTP 200 in 7ms
- 5/5 regions reachable (median 6ms)
- DNS resolved to 4 addresses in 3ms, DNSSEC-validated
- 11 checks in the last 10 min, 0 failing
- No ongoing Radar outages or anomalies for your network
- All 5 outside probes reached it

Vantages:
- DNS (Cloudflare DoH): ok, rcode 0, 172.66.147.243 104.20.23.154 2606:4700:10::ac42:93f3 2606:4700:10::6814:179a (3ms)
- DNS (Google DoH): ok, rcode 0, 104.20.23.154 172.66.147.243 2606:4700:10::ac42:93f3 2606:4700:10::6814:179a (65ms)
- Cloudflare edge: ok, HTTP 200, colo ORD, 7ms
- Region wnam: ok, HTTP 200, colo DFW, 5ms
- Region enam: ok, HTTP 200, colo ORD, 7ms
- Region weur: ok, HTTP 200, colo AMS, 5ms
- Region apac: ok, HTTP 200, colo KIX, 8ms
- Region oc: ok, HTTP 200, colo MEL, 6ms
- Your browser: not run
- Radar: 0 outage(s), 0 anomaly(ies), 0 BGP event(s); target AS13335 (CLOUDFLARENET)
- Provider: Cloudflare

Full report: https://cf-ai-isitme.patelkashishpatel032.workers.dev/r/example.com/0dfe52e9-d514-4540-af78-5ebb50331bf7
```

`Your browser: not run` because this check came in over the API, which has no
browser vantage. The five regions report five different colos — DFW, ORD, AMS,
KIX and MEL — which is what a deployed copy looks like; in local development
`locationHint` is ignored and all five land in your own colo.

## "Check from your side" links

This is the one for support teams. The chat card has **Send check link** and the
report page has **Copy check link**; both give you `/c/<host>?ref=<report id>`. Send it to the customer who says
your site is broken.

What they see: a page that says "Someone asked you to run this", their browser
trying the site from their own network, and a verdict computed for _them_ — the
same rules, with their network and browser swapped in for yours. No sign-up, no
install, nothing to explain.

What you get: their result appended to your report, under
**Visitor results by network**, labelled _self-reported_. It shows reachable or
not, the timing, and their ASN — never their IP or their location.

The rules around it:

- One entry per visitor. If they run it again, their new result replaces their
  old one rather than stacking.
- **20 visitor checks per report.** Past that, new ones are refused with
  `409 report has enough checks` instead of evicting anyone.
- A link without `?ref=` still works. The visitor gets their own answer; nothing
  is sent anywhere.
- Browsers block plain `http://` requests from a secure page, so an http-only
  target can't be tested this way and the page says so.
- The host in the URL is checked against the private-address guard before the
  visitor's browser is pointed at it, so a link like `/c/192.168.1.1` won't make
  anyone's browser probe their own LAN.

You also see it land. The chat that created the report gets a toast —
"Someone checked example.com from their side", with their network and whether it
was reachable — so you know while the ticket is still open.

## Badges

`/badge/<host>.svg` is a shields-style status badge. The **Status badge** button
on a report or a host page copies the markdown with your origin filled in:

```md
![isitme](https://<your-isitme-origin>/badge/example.com.svg)
```

It is **cache-only**: it reads the last stored verdict for that host and never
runs a check. A badge on a popular README therefore can't be used to hammer the
site it describes. The SVG is the whole response:

```console
$ curl -s "$ISITME/badge/example.com.svg"
<svg xmlns="http://www.w3.org/2000/svg" width="125" height="20" role="img" aria-label="isitme: up 0m ago"><title>isitme: up 0m ago</title><clipPath id="r">…</clipPath><g clip-path="url(#r)"><rect width="52" height="20" fill="#555"/><rect x="52" width="73" height="20" fill="#3fb950"/></g><g fill="#fff" text-anchor="middle" font-family="Verdana,…" font-size="11"><text x="26" y="14">isitme</text><text x="88.5" y="14">up 0m ago</text></g></svg>
```

(Shortened with `…` in two places; the response is one line of SVG and nothing
else.)

Two consequences of being cache-only:

- The badge carries an age (`up 0m ago`). Nothing older than **24 hours** counts,
  so a host nobody has checked today reads `unknown` in grey.
- It is cached for 60 seconds.

The wording collapses twelve verdicts into a handful, because a badge has no room
to explain whose fault it is:

| Verdict                                                         | Badge says                  |
| --------------------------------------------------------------- | --------------------------- |
| <Verdict v="HEALTHY" />                                         | `up`, green                 |
| <Verdict v="SLOW" />                                            | `slow`, amber               |
| <Verdict v="PARTIAL" />                                         | `partial`, amber            |
| <Verdict v="DOWN_GLOBAL" />                                     | `down`, red                 |
| <Verdict v="DOWN_REGIONAL" />                                   | `down in some regions`, red |
| <Verdict v="DNS_FAILURE" />                                     | `dns failure`, red          |
| <Verdict v="TLS_ERROR" />                                       | `tls error`, red            |
| <Verdict v="UPSTREAM_OUTAGE" />                                 | `upstream outage`, red      |
| <Verdict v="BLOCKED" />                                         | `up (bot wall)`, green      |
| <Verdict v="LIKELY_YOUR_NETWORK" />, <Verdict v="ISP_OUTAGE" /> | `up`, green                 |
| <Verdict v="INCONCLUSIVE" />                                    | `inconclusive`, grey        |

The last two rows are the interesting ones. Those verdicts mean the site was fine
from every server vantage and only the person checking had trouble — which is not
something to paint on the site's badge.

## Per-host pages

`/h/<host>` is a public page for one site: the latest verdict, a link to its full
report, a 24-hour sparkline, the failing windows in that period, and the crowd
summary from the most recent check. It is the natural target for a badge, because
like the badge it never starts a check.

The data behind it is one call:

```console
$ curl -s "$ISITME/api/host/example.com"
{"host":"example.com","samples":[{"at":1791202984295,"ms":5,"ok":true,"verdict":"HEALTHY","colo":"ORD"},{"at":1791203172858,"ms":7,"ok":false,"verdict":"PARTIAL","colo":"ORD"},{"at":1791203186381,"ms":7,"ok":true,"verdict":"HEALTHY","colo":"ORD"}],"latest":{"verdict":"HEALTHY","at":1791203186381,"reportId":"0dfe52e9-d514-4540-af78-5ebb50331bf7"}}
```

(Trimmed to the last three samples; the real response had eighteen, one per check
in the last 24 hours. The `PARTIAL` one is the keyword check from
[Using the chat](/chat), which found no match.) Samples
are shared across everyone who checked that host, which is what makes the
sparkline and the failing-window list worth looking at.

## Trending

`/trending` lists what is breaking right now across everyone using IsItMe,
ranked by **how many different networks saw it fail** — not by how many checks
ran. One person refreshing cannot push a site up the list.

The privacy rule that makes a shared page like this safe: a host appears only
once people on **at least 3 different networks (ASNs)** have found it failing in
the last hour. Your private or internal lookups never show up, because they only
ever come from one network. Only non-healthy results are recorded at all, the
window is one hour, and the list is capped at 20 rows.

With nothing trending, the API is honest about it and the page explains the
3-network rule instead of showing an empty table:

```console
$ curl -s "$ISITME/api/trends"
[]
```

Each row links to that host's `/h/<host>` page, and the list is cached for 60
seconds.

## Hosted demo vs your own copy

|                                               | Hosted demo                           | Your own copy                                                          |
| --------------------------------------------- | ------------------------------------- | ---------------------------------------------------------------------- |
| Report links, check links, badges, host pages | same                                  | same                                                                   |
| 30-day report expiry                          | same                                  | same (`REPORT_TTL_DAYS` in `src/shared/types.ts`)                      |
| Trending                                      | shared across everyone using the demo | only your own traffic, so the 3-network rule will often leave it empty |
| Report links in alerts                        | the demo's origin                     | whichever origin your browser connected from                           |

All the paths above are relative, so a report link copied from your own copy
points at your own copy, and nothing on these pages hardcodes an origin.
