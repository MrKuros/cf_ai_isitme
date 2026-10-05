---
title: Watching and alerts
description: "Intervals, limits, mute, uptime, and wiring up Slack, Discord and email."
---

# Watching and alerts

Have IsItMe re-check a site on a schedule and tell you when the answer changes.

## Start a watch

Ask for it in the chat:

```
watch example.com every 5 minutes
```

You can add the pieces in the same sentence, or later:

| Say                                                                     | What it does                                                |
| ----------------------------------------------------------------------- | ----------------------------------------------------------- |
| `watch example.com every 10 minutes`                                    | sets the interval                                           |
| `watch example.com and alert my Slack hook https://hooks.slack.com/...` | adds a webhook                                              |
| `email me at you@example.com when example.com goes down`                | adds an email address                                       |
| `watch example.com until it recovers`                                   | one-shot: the watch deletes itself after the recovery alert |
| `watch example.com and check the page says "Add to cart"`               | adds a keyword check                                        |
| `mute example.com for 2 hours`                                          | silences alerts, keeps checking                             |
| `stop watching example.com`                                             | removes the watch                                           |

Watches, alerts and mute buttons all live in the left sidebar. A watch runs on
the server, so it keeps going after you close the tab. With the tab open, an
alert also pops a toast that stays until you dismiss it.

## How often it checks

The interval you ask for is clamped to **5 minutes minimum** and 1440 minutes
(a day) maximum. Anything shorter becomes 5 minutes rather than being refused.
The floor is there because every check runs real probes from five regions
against someone else's site.

If you re-watch a host you are already watching, the old watch is replaced
rather than duplicated.

## How many you can have

Two limits, both of which you can hit:

- **10 watches per device** — the browser you are using.
- **10 watches per network** — counted by your IP address, across every device
  on it. Device ids are free to mint, so this is the limit that actually holds.

Past either one, the chat answers `watch limit reached`. Stopping a watch frees
its slot immediately.

## What a watched check sees

A scheduled check has no browser to ask, so it runs the edge, the five regions,
DNS, Radar, the status page and the outside probes — but not your device. That
means a watch can tell you the site is down; it can never tell you it is _your_
network. Those verdicts (<Verdict v="LIKELY_YOUR_NETWORK" />,
<Verdict v="ISP_OUTAGE" />) only come from a check you run yourself.

## Keyword check

Give a watch some text the page must contain, and every server vantage looks for
it in the first 64 KB of the response body, case-insensitively.

If more than half the vantages that read a page can't find your text, the
verdict is <Verdict v="PARTIAL" sub="expect_missing" /> — "the site answers, but
it isn't serving your page". That counts as down for alerting, so you get told.

The text is 1–200 characters and shows under the watch in the sidebar
(`expects "Add to cart"`). It is matched against raw HTML, so pick something the
server actually sends, not text a script writes in afterwards.

## Before you get told

Monitoring tools are famous for 3am false alarms. Two guards exist to stop that.

**Confirm first.** Verdicts are sorted into three classes: up
(<Verdict v="HEALTHY" />, <Verdict v="SLOW" />, <Verdict v="BLOCKED" />), down
(<Verdict v="DOWN_GLOBAL" />, <Verdict v="DOWN_REGIONAL" />,
<Verdict v="DNS_FAILURE" />, <Verdict v="TLS_ERROR" />,
<Verdict v="UPSTREAM_OUTAGE" />, <Verdict v="PARTIAL" />) and neither
(<Verdict v="LIKELY_YOUR_NETWORK" />, <Verdict v="ISP_OUTAGE" />,
<Verdict v="INCONCLUSIVE" />). An alert needs **two checks in a row** in the new
class. The first one schedules an extra check 60 seconds later instead of
alerting, and the sidebar shows `confirming Down everywhere…`.

**The first check is the baseline.** It records where the site stands and never
alerts — there is no previous answer for it to have changed from. So watching a
site that is _already_ down gets you no "down" alert; the alert you get is the
"back up" one when it recovers.

**The same counter guards the way back.** Recovery also needs two consecutive up
checks, so a site that flaps between up and down doesn't alert on every flip.

Verdicts in the "neither" class never alert and never start the counter. If the
checker can't tell, you don't get woken up.

## Incidents, not alert storms

A confirmed down alert opens an **incident** and the sidebar marks the watch
`incident open`. While it is open:

- A move to a _different_ down verdict (say <Verdict v="DOWN_GLOBAL" /> to
  <Verdict v="DNS_FAILURE" />) updates that same alert in place. No second
  notification is sent.
- The confirmed recovery closes the incident and sends one "back up" alert
  carrying the same incident id.

So an outage is one alert, one update trail and one recovery — not one message
per check.

## Mute

Mute is for maintenance windows. Checks keep running and uptime keeps counting;
only the notification is dropped.

The sidebar offers 1 hour, 8 hours, 24 hours and unmute. In the chat you can ask
for any number of minutes up to 7 days; 0 unmutes.

One detail worth knowing: if a site goes down **while muted**, the recovery stays
silent too. There is no point sending "example.com is back up" for an outage you
were never told about.

## Uptime

Each watch shows a 7-day uptime percentage under its name, recalculated after
every check. It is computed over that watch's own scheduled runs — not over
checks you typed by hand.

Two kinds of run are left out of the ratio entirely:

- Anything in the "neither" class, because it says nothing about the site.
- A down run where _every_ failing vantage was itself broken — no data, or a
  vantage we already know is sick. The site shouldn't be blamed for our probes.

The sidebar tooltip says as much: "Runs caused by our own vantage problems are
excluded". With no countable runs, uptime reads `n/a` rather than 0%.

## Daily digest

While you have at least one watch, one digest goes out every 24 hours to each
webhook and each email address you configured. One message per destination, not
one per watch. Two watched sites produce this:

```
IsItMe digest: 2 sites, last 24h
- a.com: uptime 75.0%, 1 incident, now HEALTHY
- b.com: uptime 100%, 0 incidents, now HEALTHY
Slowest: b.com (900ms average)
```

The digest never probes anything and never decides an alert, so it can't trip
mute, the confirm counter or an incident. "Slowest" is the mean edge response
time and only appears when you watch more than one site. A watch with no runs in
the window is skipped; if no watch ran at all, no digest is sent.

## Slack and Discord

Both take the same incoming-webhook URL, pasted into the chat:

```
watch example.com and send alerts to https://hooks.slack.com/services/T000/B000/XXXX
```

The body posted to it is JSON with `text` (what Slack reads), `content` (what
Discord reads) and the structured fields, so one URL works for either without
you choosing a format:

```json
{
  "text": "IsItMe: example.com is DOWN (DOWN_GLOBAL). <summary> <report url>",
  "content": "IsItMe: example.com is DOWN (DOWN_GLOBAL). <summary> <report url>",
  "host": "example.com",
  "kind": "down",
  "from": "HEALTHY",
  "to": "DOWN_GLOBAL",
  "reportUrl": "https://<your-isitme-origin>/r/example.com/<id>"
}
```

The digest posts `kind: "digest"` with `at` and `hours` instead of the host
fields.

Rules the URL has to pass:

- **https only.** An `http://` hook is refused when you add it.
- **Public hosts only.** The URL is resolved and checked against the same
  private-address guard as a check target, so a webhook can't be used to make
  the server poke at something internal. It is re-checked immediately before
  every POST, not just when you add it, because DNS can move afterwards.
- 5-second timeout, no redirects followed, message text truncated to 1900
  characters, and `<` `>` `&` escaped so a site's own HTML can't fake a Slack
  mention.

A failed POST is recorded on the alert as `webhook: failed`. The alert itself
still appears in the sidebar, so a broken hook never loses you the alert.

> [!NOTE] Local dev
> A webhook must be https and must resolve to a public address, so you cannot
> point one at `localhost` while testing. Try a real hook URL, or watch the
> sidebar instead.

## Email

Add an address in the chat (`email me at you@example.com when …`), or ask to
change it later. Alerts and the daily digest both go there as plain text.

Email is where a self-hosted copy needs the most setup, because Cloudflare's
send-email binding is deliberately narrow:

1. **The sender must be on a zone you own.** `EMAIL_FROM` ships as
   `alerts@isitme.example`, a placeholder, not a real domain. Until you set it
   to an address on your own zone, email alerts are unavailable: asking for one
   in the chat gets a refusal that names the variable, and alerts and digests
   skip email rather than attempt a send that would be rejected.
2. **The recipient must be a verified destination address** in Cloudflare Email
   Routing on your account. There is no way around this — Cloudflare refuses
   anything else, which is what stops a worker being turned into a spam relay.
   An unverified address is accepted by the chat and then silently fails to
   deliver.
3. The `send_email` binding is already declared in `wrangler.jsonc`, so there is
   nothing to add there.

Delivery is best-effort by design: a send that fails is logged on the server and
never shown as an error in the chat. The alert is still in your sidebar either
way. See [Self-hosting](/self-hosting) for the account-side steps.

## When a watch stops on its own

- **`until recovered`** — the watch deletes itself after the confirmed recovery
  alert. Good for "tell me when my deploy is back".
- **7 days of silence** — if no device has connected to your agent for a week,
  the next scheduled run removes the watch instead of checking. Watches outlive
  the tab, not the person. Opening the app refreshes that clock.

## Hosted demo vs your own copy

|                                                  | Hosted demo                           | Your own copy                                                 |
| ------------------------------------------------ | ------------------------------------- | ------------------------------------------------------------- |
| Intervals, limits, confirm, mute, uptime, digest | same                                  | same                                                          |
| Email alerts                                     | not configured — no verified sender   | works once Email Routing and `EMAIL_FROM` are set             |
| Outage data in a watched check                   | depends on the deployed `RADAR_TOKEN` | reads `no data` until you add a token                         |
| Five real regions                                | yes                                   | only after `npm run deploy`; locally all five run in one colo |

Next: [Sharing](/sharing) covers handing a result to someone else, and
[Limits and troubleshooting](/limits) collects the hard numbers.
