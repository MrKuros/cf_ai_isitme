---
title: Using the chat
description: "Every chat command with example phrasings and the replies they produce."
---

# Using the chat

There are seven things the chat can do. You never type a command — you say what you want, and the model picks the matching tool.

| Say something like                               | Tool         | What happens                                   |
| ------------------------------------------------ | ------------ | ---------------------------------------------- |
| "is github.com down?"                            | `diagnose`   | runs one check, shows a card                   |
| "watch example.com every 10 minutes"             | `watch`      | re-checks on a schedule, alerts on change      |
| "stop watching example.com"                      | `unwatch`    | deletes the watch                              |
| "what have I checked recently?"                  | `history`    | lists your past checks                         |
| "send alerts for example.com to &lt;webhook&gt;" | `setWebhook` | Slack / Discord alerts                         |
| "email alerts for example.com to me@example.com" | `setEmail`   | email alerts, when the deployment has a sender |
| "mute example.com for 90 minutes"                | `mute`       | keeps checking, stops alerting                 |

Everything below is a real transcript from the [live demo](https://cf-ai-isitme.patelkashishpatel032.workers.dev)
on 5 October 2026, except the email example, which is a local run — the reason is
in that section.

> [!IMPORTANT] Two different kinds of text
> The **chip** or **card** under your message is the tool's own output — fixed text, written by the code. The sentence after it is written by the model, so its exact wording changes from run to run. The verdict itself never does: it comes from rules, not from the model. See [How it works](/how-it-works).

## Check a site

Name a site and it checks it. It won't ask you to confirm first.

**"is github.com down?"**

```
github.com                                       6.0s   Healthy 95%
It's up. Not you, not them.
  Cloudflare's edge (MXP) got HTTP 200 in 74ms
  5/5 regions reachable (median 54ms)
  DNS resolved to 1 address in 3ms
  Your browser could reach it in 181ms
  6 checks in the last 10 min, 0 failing
  No ongoing Radar outages or anomalies for your network
  All 5 outside probes reached it
```

> github.com is up everywhere, including from your network.

Other phrasings that work: `github.com`, `https://github.com/explore`, "is github down for everyone or just me", "why is my bank site slow".

The card is the answer. The model is told to reply in one short sentence and never to quote numbers or timings, because the card already has them — so if a number ever appears in the sentence and not on the card, the card is right.

### Check for a keyword

Add what the page must contain and it is checked too. A reachable site whose page is missing that text is not healthy — it's <Verdict v="PARTIAL" sub="expected text missing" />.

**"check example.com and make sure the page contains the text Example Domain"**

```
example.com                                      6.2s   Healthy 95%
It's up. Not you, not them.
  Cloudflare's edge (ORD) got HTTP 200 in 5ms
  5/5 regions reachable (median 8ms)
  DNS resolved to 4 addresses in 3ms, DNSSEC-validated
  Your browser could reach it in 135ms
  9 checks in the last 10 min, 0 failing
  No ongoing Radar outages or anomalies for your network
  All 5 outside probes reached it
```

> example.com is up everywhere, including from your network, and the page contains the expected text.

**"check example.com and make sure the page contains the text Totally Not Here"** — same site, text that isn't on the page:

```
example.com                                      7.5s   Partly broken · expected text missing 80%
It answers, but the page looks broken.
  Expected text not found on the page
  Cloudflare's edge (ORD) got HTTP 200 in 6ms
  5/5 regions reachable (median 6ms)
  DNS resolved to 4 addresses in 2ms, DNSSEC-validated
  Your browser could reach it in 169ms
  All 5 outside probes reached it
```

> example.com is up but is missing the text "Totally Not Here" that you requested.

Details: the match is case-insensitive, against the raw response body, in the first 64 KB only. Up to 200 characters. It is a substring match, not a regular expression. A watch can carry a keyword too, which turns "is it up" into "is it serving the right page".

## Watch a site

**"watch example.com every 10 minutes"**

```
Watching example.com every 10 min. Alerts land in the sidebar.
```

> I'm now monitoring example.com every 10 minutes.

What the rules do with the interval and the limits:

- **Minimum 5 minutes.** Ask for 1 and you get 5. Maximum 1440 (one day). The default, if you don't say, is 5.
- **10 watches per device, and 10 per network.** Over either and it answers `watch limit reached (10)` or `watch limit reached for your network (10)`.
- **Watching a host you already watch replaces that watch**, it doesn't add a second one.
- Alerts appear in the app's sidebar by default. Webhook and email are extra, below.
- Your watches are listed in the sidebar, not by a chat tool — there's nothing to ask for them.

Alerts are deliberately slow to fire: a status change must be confirmed by a second check a minute later before you hear about it, and verdicts that blame _your_ side never alert at all. [Watching and alerts](/watching) has the full rules, the uptime percentage and the daily digest.

### Watch until it recovers

For the "I'm waiting for this to come back" case. The watch deletes itself once it has told you the site recovered.

**"watch example.com every 5 minutes until it recovers"**

```
Watching example.com every 5 min. Alerts land in the sidebar.
```

> I'm now watching example.com every 5 minutes until it recovers.

The chip doesn't mention the one-shot part — it's in the watch, and the recovery alert is the last thing that watch ever sends.

## Stop watching

Either the domain or the watch id works.

**"stop watching example.com"**

```
Stopped 1 watch.
```

> Monitoring for example.com has been stopped.

If nothing matches, the chip reads `Nothing matched that watch.`

## See past checks

**"what have I checked recently?"**

```
● example.com   Healthy                      10/5/2026, 5:53:04 PM
● github.com    Healthy                      10/5/2026, 5:52:25 PM
```

> You've recently checked github.com and example.com, and both were healthy from your network.

Each row links to that check's full report. Newest first, 10 by default, 20 at most, and you can narrow it to one domain ("what have I checked for github.com"). Your device keeps its last 50.

## Slack and Discord alerts

Paste the webhook URL into the sentence.

**"send alerts for example.com to https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXX"**

```
Webhook updated.
```

> Slack webhook alerts are now set up for example.com.

Rules on the URL, because the server will be the one fetching it:

- **https only.** `http` is refused with `webhook must be https`.
- **It must resolve, and resolve to a public address.** Private, loopback, link-local and cloud-metadata addresses are refused (`webhook blocked: …`), as are hostnames that don't resolve (`webhook host does not resolve`).
- Slack and Discord webhook URLs both work as-is. Anything that accepts a JSON POST works.
- The site must already be watched. Setting a webhook does not create a watch — if it isn't watched yet you get `no such watch`.
- To turn it off, say "clear the webhook for example.com".

You can also give the webhook when you create the watch: "watch example.com every 10 minutes and send alerts to &lt;url&gt;".

## Email alerts

Email only works on a deployment that has a sender address, and nothing in the
hosted demo does: `EMAIL_FROM` ships as the placeholder `alerts@isitme.example`,
which Cloudflare Email Routing refuses. So the tool refuses up front rather than
storing an address that would never receive anything.

**"email alerts for example.com to alerts@example.com"** (a local run — the gate
is the same wherever `EMAIL_FROM` is unset):

```
email alerts are not configured on this deployment: set the EMAIL_FROM variable to an address on a zone with Cloudflare Email Routing. Webhooks and in-app alerts work.
```

> Email alerts aren't available on this deployment. You can use a webhook URL or in-app alerts instead.

On a copy that _does_ set `EMAIL_FROM` the chip just says `Done` — the tool
returns the address, and the model's sentence is what repeats it back.

> [!WARNING] Email delivery is the one feature that depends on the deployment
> Cloudflare Email Routing sends only **from a zone you own** and only **to
> verified destination addresses** on it. Both halves are setup you have to do,
> which is why webhooks are the easier path. A malformed address is refused
> before any of that, with `invalid email address`. [Watching and alerts](/watching)
> covers the rules; [Self-hosting](/self-hosting) covers `EMAIL_FROM` and the
> binding.

## Mute a watch

For planned maintenance: keep checking, stop telling me.

**"mute example.com for 90 minutes"**

```
Done
```

> The alerts for example.com are now muted for the specified duration.

- Checks keep running while muted, so the history and the uptime number stay complete.
- Maximum 7 days. `0` minutes unmutes.
- If a site goes down while muted and recovers while muted, you hear about neither — the recovery alert for a silenced incident is dropped too, so you never get a "recovered" with no "down".
- The sidebar shows a muted watch as **Muted**, with an **Unmute** option, so you can do this without the chat.

## Things worth knowing

**It remembers.** Your past checks, your watches and your network (ASN, city, country, the Cloudflare colo you connect through) are in front of the model on every message, so "watch it too" and "check the other one again" usually land.

**It stays on topic.** Ask it something unrelated and it says in one sentence what it can do instead.

**Twenty messages a minute**, per device and per network. Over that: `You're sending messages too fast. Try again in a minute.`

**If the model is down, checks aren't.** When Workers AI can't be reached the chat says so and points at `GET /api/v1/check?url=…`, which needs no model at all. The verdict never needed one — only the explanation does, and that falls back to a plain template built from the signals.

**Clear chat** empties the conversation. Your watches, alerts and history survive it; they live on your device's agent, not in the transcript.

## What the chat can't do

These exist in the product but have no chat tool, so asking won't work:

- **Listing your watches** — the sidebar does that.
- **Turning the daily digest on or off** — it's automatic once you have a watch.
- **Changing the explanation language** — it is taken from your browser's `Accept-Language` when you connect, and there is no way to override it from the chat.
- **Fetching a full report** — the card's share link and the [HTTP API](/api) do that.
