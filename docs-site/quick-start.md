---
title: Quick start
description: "Your first check, and how to read the card it gives back."
---

<script setup>
import { SITE_URL } from "./.vitepress/theme/site";

// A real run, 5 October 2026, against a local dev server (`npm run dev`).
const firstCheck = {
  host: "github.com",
  verdict: "HEALTHY",
  confidence: 0.87,
  elapsed: 14.8,
  signals: [
    "Cloudflare's edge (MAA) got HTTP 200 in 1476ms",
    "5/5 regions reachable (median 665ms)",
    "DNS resolved to 1 address in 166ms",
    "Your browser could reach it in 106ms",
    "4 checks in the last 10 min, 0 failing",
    "Radar: no data (no RADAR_TOKEN)",
    "All 5 outside probes reached it"
  ],
  explanation:
    "The site is reachable from every location we checked. Your browser could reach it in 106ms. All outside probes and regions also reached it successfully.",
  reportPath: "",
  note: "A real run, 5 October 2026. Radar says \"no data\" because no token was configured."
};
</script>

# Quick start

Name a site. Read the card. That's the whole product.

## 1. Open the chat

The chat is the home page of the app.

- **Hosted demo:** <a :href="SITE_URL">{{ SITE_URL }}</a> — not live yet. This page will be true the moment it is.
- **Your own copy:** clone the repo and run `npm run dev`. It prints a `localhost` address, and the chat is at `/`. See [Self-hosting](/self-hosting).

> [!NOTE] No account, no sign-up
> Your device gets a random id in `localStorage`, and that id owns your history, watches and alerts. Clear your browser storage and you start fresh.

## 2. Ask one question

Type it the way you'd say it. These three are the starter buttons on an empty chat:

- `Is github.com down?`
- `Why is my bank site slow?`
- `Watch example.com every 5 minutes`

You don't have to phrase it as a question, and you don't have to paste a full URL — `github.com`, `https://github.com/explore` and "is github down for everyone" all work.

## 3. Watch it work

A card appears straight away and fills in as each step finishes. There are eleven steps:

| Step | What it is |
|---|---|
| DNS lookup | the name, via 1.1.1.1 and 8.8.8.8 |
| Cloudflare edge | an HTTP GET from the data centre nearest you |
| 5 regions | the same GET from US west, US east, Europe, Asia and Oceania |
| Outside probes | the same GET from volunteer probes outside Cloudflare (Globalping) |
| Cloudflare Radar | known outages and routing trouble for your network and the site's |
| Hosting provider | who hosts it, and whether their other sites are failing too |
| Status page | the site's own status page, if it has one |
| Your browser | your own machine tries to load it |
| Crowd reports | what other IsItMe users saw for this site recently |
| Verdict | the rules read the evidence and pick one of twelve answers |
| Explanation | the AI writes the paragraph |

A whole check takes about 15–30 seconds. Steps that have nothing to report are marked skipped, not failed.

## 4. Read the card

<ResultCard v-bind="firstCheck" />

Top to bottom:

**The host and the clock.** What was checked, and how long it took.

**The verdict chip.** One of twelve, with a confidence percentage: <Verdict v="HEALTHY" :confidence="0.87" />. Some verdicts add a subtype — <Verdict v="DNS_FAILURE" sub="domain doesn't exist" :confidence="0.95" /> — which says *which* kind. All twelve are on [Understanding results](/results).

**The headline.** The verdict in one sentence. Note the honesty here: "It's up. Not you, not them." only appears when *your own browser* reached the site too. If the browser step didn't run, the headline is "It's up from everywhere we checked" instead — it won't claim anything about you that it didn't measure.

**The signals.** The plain-language facts the rules actually used, most important first. This is the part to read when you don't trust the verdict: it shows you the same evidence the rules saw, so you can disagree.

**Why 87% confidence.** A fold-out list of what moved the number up and down. In the run above, four agreeing vantage points pushed it up and a missing Radar token pushed it down.

**The 24-hour sparkline.** Edge response time for this host over the last day, from everyone's checks. Red ticks are failing checks; the dashed line is the usual latency, which is what "slow" gets measured against.

**The explanation.** Written by Llama 3.3, from the finished verdict and the evidence. It ends in two or three concrete next steps that fit the verdict — page-level fixes for a healthy site, network fixes only when the problem looks like your network. The AI never picks the verdict and is filtered for anything it invented.

**The buttons.**

| Button | What it does |
|---|---|
| Copy share link | a public link to the full report, good for 30 days |
| Send check link | a link that makes *someone else's* browser run the test, and shows you their result |
| Copy for support | the whole thing as plain text, for pasting into a ticket |
| .txt | the same bundle as a file |
| Status badge | a Markdown snippet for an always-current status badge |
| Steps | re-show the eleven steps |
| Evidence | the raw evidence table: every vantage, every answer |

[Sharing](/sharing) covers the links and the badge.

## 5. Try one here

<TryIt />

This box calls the hosted demo's public API directly from your browser. Until the demo is live it shows the recorded example instead, and says so.

## Where to go next

- **Everything you can ask the chat for:** [Using the chat](/chat).
- **What a verdict means:** [Understanding results](/results).
- **Get told when a site breaks:** [Watching and alerts](/watching).
- **From a terminal or a script:** [CLI](/cli) and [HTTP API](/api).
