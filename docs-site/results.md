---
title: Understanding results
description: "All twelve verdicts in plain words, plus confidence, signals and hints."
---

<script setup>
// Real runs, 5 October 2026, against a local dev server (`npm run dev`).
const healthy = {
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
  note: "A real local run, 5 October 2026."
};

const inconclusive = {
  host: "expired.badssl.com",
  verdict: "INCONCLUSIVE",
  confidence: 0.5,
  elapsed: 18.6,
  signals: [
    "Only one Cloudflare location answered, and it failed (MAA)",
    "Cloudflare's edge (MAA) failed: unknown error",
    "5/5 regions failed (wnam: unknown error, enam: unknown error, weur: unknown error, apac: TLS/certificate error, oc: unknown error)",
    "DNS resolved to 1 address in 167ms",
    "No browser result to compare with",
    "All 5 outside probes reached it"
  ],
  explanation: "The site is inconclusive due to not enough evidence.",
  reportPath: "",
  note: "A real local run. The certificate on this site is deliberately expired."
};
</script>

# Understanding results

Every check ends in exactly one of twelve verdicts. They are picked by fixed rules reading the evidence, in a fixed order, first match wins. The AI writes the paragraph underneath and never the verdict — so the same evidence always gives the same answer, and that answer is testable.

## All twelve

| Verdict | In one line | Whose problem | Alerts a watch? |
|---|---|---|---|
| <Verdict v="HEALTHY" /> | It worked from everywhere, including from you. | nobody's | up |
| <Verdict v="SLOW" /> | It works, but it's taking far too long. | the site's | up |
| <Verdict v="BLOCKED" /> | It's up, but it refuses automated checks. | nobody's | up |
| <Verdict v="DOWN_GLOBAL" /> | It failed from nearly everywhere. | the site's | down |
| <Verdict v="DOWN_REGIONAL" /> | It failed from some places and worked from others. | the site's | down |
| <Verdict v="DNS_FAILURE" /> | The name doesn't turn into an address. | the site's | down |
| <Verdict v="TLS_ERROR" /> | It answers, but its certificate is invalid. | the site's | down |
| <Verdict v="PARTIAL" /> | It answers, but with the wrong page. | the site's | down |
| <Verdict v="UPSTREAM_OUTAGE" /> | The site's network provider is mis-routing it. | their provider's | down |
| <Verdict v="LIKELY_YOUR_NETWORK" /> | Everyone else reaches it. You don't. | yours | never |
| <Verdict v="ISP_OUTAGE" /> | Same, and your ISP has a known outage. | your ISP's | never |
| <Verdict v="INCONCLUSIVE" /> | Not enough evidence to say. | unknown | never |

"Alerts a watch" is the only thing the verdict name is used for mechanically: a watch alerts you when it crosses between **up** and **down**, and the three "never" verdicts are deliberately silent. [Watching and alerts](/watching) explains why.

> [!NOTE] Five of the twelve have a real example on this page
> The rest need a real outage to happen while we're watching. Where there's no live run to paste, the section says what the rule requires instead of inventing output. [Limits and troubleshooting](/limits) lists what a local copy can't show you.

## It's working

### <Verdict v="HEALTHY" />

**What it means for you:** nothing is wrong. Whatever you were trying to do, try it again — and if it still fails, the problem is in the page itself or in your browser session, not in the network path.

Every Cloudflare location that answered reached the site, nothing looked slow, and the page didn't look broken.

<ResultCard v-bind="healthy" />

The headline matters here. **"It's up. Not you, not them."** is only claimed when your own browser reached the site too. With no browser result, the headline drops to "It's up from everywhere we checked" — it will not tell you you're fine if it never tested you.

Confidence starts at 0.70 and gains 0.05 for each vantage that agrees (edge, regions, your browser, DNS), so a full house lands near 0.90. It is capped at 0.70 when only one Cloudflare location answered, which is what always happens on a laptop.

### <Verdict v="SLOW" />

**What it means for you:** it's not broken, it's struggling. Nothing on your side will fix it. If it's your site, this is the warning before an outage.

Reachable everywhere, but the edge or the median region took **3 seconds or more**. If the site has enough history, the bar moves: slow means three times its usual time from that location, never less than 3 seconds. So a site that normally answers in 2 seconds has to reach 6 before this fires, and a fast site that jumps to 3.1 seconds does.

The signals name both the measured time and the threshold, and the sparkline's dashed line is the "usual" it was compared against.

### <Verdict v="BLOCKED" />

**What it means for you:** **trust your own browser, not the robot.** The site is up; it just won't talk to automated clients. If the card says your browser reached it, you're fine.

Every Cloudflare location got an answer, and every one of those answers was bot protection rather than the site. Four flavours, shown as the subtype:

| Subtype | What happened |
|---|---|
| <Verdict v="BLOCKED" sub="bot challenge" /> | an interactive challenge page |
| <Verdict v="BLOCKED" sub="firewall block" /> | a WAF rule said no |
| <Verdict v="BLOCKED" sub="rate limited" /> | HTTP 429 |
| <Verdict v="BLOCKED" sub="geo-blocked" /> | HTTP 451, blocked for legal reasons from there |

A real run against a site with bot protection:

```
www.g2.com                                       Blocks bots · bot challenge 58%
It's up, but it blocks automated checks.
  Cloudflare's probes got HTTP 403 (bot protection): the site is reachable
  but blocks automated checks; your browser result decides
  All 5 outside probes reached it
```

Confidence is low on purpose — 0.65 base, and only +0.15 when your browser got through. The rule is also skipped entirely if your browser failed: a site that blocks us *and* blocks you is a real problem, so it's classified on the evidence instead.

## It's the site

### <Verdict v="DOWN_GLOBAL" />

**What it means for you:** stop debugging. It's not you, it's not your ISP, there is nothing to fix on your side. Wait, or tell the site's owner.

Two ways to get here:

1. **At least two distinct Cloudflare locations failed, and they were at least 80% of the locations that answered.** Confidence from 0.80, up to +0.10 with four or more failing, +0.05 if your browser failed too, +0.05 if other IsItMe users are seeing it fail on other networks.
2. **Only one location answered, it failed, and your browser failed too while still reaching `www.cloudflare.com`.** Your browser is the second vantage point. Confidence 0.60 — lower, because it's thinner evidence.

The subtype <Verdict v="DOWN_GLOBAL" sub="origin server failing" /> means Cloudflare itself answered fine and the site's own origin server behind it is what's failing (an HTTP 52x). That's a useful distinction if it's your site: the CDN is healthy, your server isn't.

If the site's hosting provider also has three or more other sites failing right now, or its own status page reports an incident, a signal says so and confidence goes up 0.05 — the outage is bigger than this one site.

### <Verdict v="DOWN_REGIONAL" />

**What it means for you:** it works from some parts of the world and not others. If you can't reach it, you're in a bad region and there's nothing to fix locally; if you can, someone else can't.

At least one Cloudflare location failed **and** at least one succeeded. The signals list both sets by name, so you can see which regions are affected. Confidence from 0.65, +0.05 per failing location up to three.

This is also where a bad anycast route or a half-finished deploy shows up, and it's the verdict that a single-vantage uptime monitor structurally cannot produce.

### <Verdict v="DNS_FAILURE" />

**What it means for you:** the name itself is broken. No browser, VPN or router restart will help. If it's your domain, this is yours to fix — and it's usually registration, nameservers or DNSSEC.

Both public resolvers (1.1.1.1 and 8.8.8.8) answered with **the same** error, or only one of them answered at all. Resolvers that *disagree* are deliberately not a DNS failure — that's a signal, not a verdict, because one resolver having a bad day isn't the domain's fault.

```
definitely-not-a-real-domain-isitme-test.com    DNS failure · domain doesn't exist 95%
The name doesn't resolve.
  The domain does not exist (NXDOMAIN from 1.1.1.1)
  8.8.8.8 agrees
```

| Subtype | What it means | Confidence base |
|---|---|---|
| <Verdict v="DNS_FAILURE" sub="domain doesn't exist" /> | NXDOMAIN — nothing is registered, or it's a typo | 0.95 |
| <Verdict v="DNS_FAILURE" sub="DNSSEC broken" /> | the signatures don't validate, so every validating resolver refuses it; only the owner can fix it | — |
| *(no subtype)* | SERVFAIL — the domain's own nameservers didn't answer | 0.85 |
| *(no subtype)* | the domain exists but publishes no A/AAAA record | 0.80 |

Three extra things it will tell you when they apply: whether the domain's **own nameservers** answer when queried directly (which separates "the domain is broken" from "the resolvers are"), whether the **registration has expired** and by how many days, and whether **your browser's** own DNS lookup agreed. If your browser resolved a name that both public resolvers refused, confidence drops 0.15 — something is odd, and the card says so rather than hiding it.

### <Verdict v="TLS_ERROR" />

**What it means for you:** the site is running, but your browser will refuse to show it, and it's right to. Don't click through the warning. Only the owner can fix this.

Every location that answered failed with a TLS error. Usually an expired certificate, a name mismatch or an incomplete chain. Confidence from 0.80, plus 0.05 for each extra location that agrees.

> [!WARNING] You won't see this one on a local copy
> Local `workerd` reports certificate failures as an opaque "internal error", so a genuinely expired certificate comes out as <Verdict v="INCONCLUSIVE" /> on a laptop. The example at the bottom of this page is exactly that case.

### <Verdict v="PARTIAL" />

**What it means for you:** the server is alive and answering, but what it's serving is wrong. An uptime monitor that only checks for a response would call this "up".

Two rules produce it:

**The page you asked for is gone, but the site isn't.** The URL returns 404 or 410 while the site's root works. Confidence 0.80.

```
github.com                                       Partly broken · this page 404s 73%
It answers, but the page looks broken.
  The site is up; this page returns 404
  Cloudflare's edge (MAA) got HTTP 404 in 2560ms
  5/5 regions reachable (median 1079ms)
  DNS resolved to 1 address in 153ms
  All 5 outside probes reached it
```

**Most locations saw a broken page.** More than half of the locations that looked at the page flagged it. Confidence 0.70, +0.10 when every location agrees.

| Subtype | What was wrong |
|---|---|
| <Verdict v="PARTIAL" sub="parked domain" /> | a registrar parking page — the site is *gone*, not down |
| <Verdict v="PARTIAL" sub="expected text missing" /> | you asked for a keyword and it wasn't on the page |
| <Verdict v="PARTIAL" sub="error page" /> | HTTP 200, but the page reads like an error |
| <Verdict v="PARTIAL" sub="blank page" /> | almost no content, and no sign of an app that would fill it in |
| <Verdict v="PARTIAL" sub="this page 404s" /> | the path is gone, the root works |

The keyword case is the one you ask for yourself — see [checking for a keyword](/chat#check-for-a-keyword):

```
example.com                                      Partly broken · expected text missing 73%
It answers, but the page looks broken.
  Expected text not found on the page
  Cloudflare's edge (MAA) got HTTP 200 in 1677ms
  5/5 regions reachable (median 576ms)
  DNS resolved to 3 addresses in 155ms, DNSSEC-validated
  All 5 outside probes reached it
```

The "blank page" rule is careful not to flag single-page apps: a nearly empty document that loads an external script or has a `root` / `app` / `__next` container is treated as normal, because that is what a React page looks like before it runs.

### <Verdict v="UPSTREAM_OUTAGE" />

**What it means for you:** the site is probably fine and its network provider isn't. Traffic to it is being routed somewhere it shouldn't be. This fixes itself, usually in minutes, and nobody involved can speed it up.

Cloudflare Radar saw a **BGP hijack or route leak** in the last 24 hours that is confident (score 8 or more on Radar's scale), still ongoing or ended less than two hours ago, and covers a prefix that actually contains the site's IP address — and at least as many locations are failing as succeeding. Confidence from 0.75, +0.10 with three or more locations failing.

Weaker BGP events never pick this verdict. They appear as a signal reading "not treated as the cause", so you can see the context without the verdict overstating it.

This needs a Radar API token. Without one, Radar is skipped and this verdict can never fire.

## It's you

Both of these are the whole reason the project exists, and both are **silent for watches** — a monitor that pages you because *your laptop* lost Wi-Fi is worse than no monitor.

### <Verdict v="LIKELY_YOUR_NETWORK" />

**What it means for you:** every server reached it. Your browser didn't. The problem is between your machine and the site: a firewall, a DNS filter, a VPN, a proxy, a captive portal, or your Wi-Fi.

Every Cloudflare location that answered reached the site, and your browser failed. Confidence from 0.70, +0.10 if other IsItMe users on your network are failing too, +0.05 with three or more regions reaching it, +0.05 if your browser could still reach `www.cloudflare.com`.

That control request is the important one, and the card tells you which way it went:

- **Your browser could reach `www.cloudflare.com`** → your connection works, and something is blocking *this site specifically*.
- **It couldn't reach that either** → your connection itself is down, and nothing about the site has been established.

It also looks for the specific causes it can see: a DNS lookup that works from the edge but not from your browser, a network that blocks DNS-over-HTTPS and public resolvers altogether, and the hints below.

A separate, thinner branch gives the same verdict at 0.60 confidence when your browser simply reports itself **offline** — there's no point blaming a website when the device says it has no network.

### <Verdict v="ISP_OUTAGE" />

**What it means for you:** it's not you *or* the site, it's the company between you. You can confirm it, you can't fix it, and you now have something concrete to tell them.

Same shape as above — servers fine, your browser failed — **plus** Cloudflare Radar reporting an ongoing outage or a verified traffic anomaly for your network (by ASN) or your country. Confidence from 0.75, +0.10 when Radar names your network specifically rather than your whole country, +0.05 when other IsItMe users on your network are failing too.

Radar events count while they're ongoing, or if they ended less than two hours before the check. Older ones appear as an "earlier today" signal instead of picking the verdict. Without a Radar token this verdict can never fire, and the case falls through to <Verdict v="LIKELY_YOUR_NETWORK" />.

## We don't know

### <Verdict v="INCONCLUSIVE" />

**What it means for you:** the evidence contradicted itself or wasn't there. Run it again, and open the site in your own browser so your vantage point gets included.

Confidence is always 0.50, the floor, and the card changes shape: the signals move into a box labelled **"What we saw, so you can judge"**, because the facts are still worth your time even when the conclusion isn't there.

<ResultCard v-bind="inconclusive" />

That run is the honest local-development version of a certificate error. Local `workerd` mostly reports TLS failures as "unknown error" — one region out of five got the real reason — and all five "regions" are the same machine, with no browser vantage. So the rules had one failing location, nothing to compare it to, and said so. On a real deployment this is <Verdict v="TLS_ERROR" />.

#### Why this verdict exists at all

Because the alternative is lying. Every competing tool in this category answers with a confident single word, and when the evidence is thin that word is a guess. A guess is worse than a shrug, in three specific ways:

- **"Down" when it isn't** sends you to the status page and the support queue for nothing.
- **"It's you"** when it isn't sends you to restart a router that was never the problem.
- Either one, once, costs the tool all of your trust in the ninety-five cases where it was right.

So the rules were written to reach for this verdict whenever the evidence doesn't actually support a conclusion: one location answering and failing with nothing to corroborate it, no location answering at all, or a split where the edge and a region disagree about the same data centre. A split vote counts as *no data*, not as a vote for either side.

The cost is admitted: on a laptop, where every region lands in one data centre, you will see this verdict for things that are genuinely down. On a real multi-region deployment it should be rare.

## Reading the rest of the card

### Confidence

A number from **0.50 to 0.95**, never outside it. There is no 100%: the measurement is a handful of HTTP requests, and claiming certainty from that would be false.

Each verdict starts from a base and then gains or loses:

| Moves it up | Moves it down |
|---|---|
| more vantage points agreeing | each missing vantage point (−0.05) |
| both DNS resolvers giving the same answer | each region that returned no data (−0.03) |
| your own browser confirming the server result | your browser contradicting it |
| other IsItMe users seeing the same thing | other users *not* seeing it |
| Radar data being available at all | evidence that Cloudflare itself may be at fault (caps it at 0.70) |

Open **"Why *n*% confidence"** on any card for the actual arithmetic: the base, every adjustment and its label. Nothing is hidden, which also means nothing has to be taken on faith.

Two caps worth knowing: a <Verdict v="HEALTHY" /> from a single Cloudflare location with no browser result can't exceed 0.70, and any verdict with a reason to suspect Cloudflare's own infrastructure is capped at 0.70 as well.

### Signals

The short facts above the explanation, ordered most important first. They are the evidence the rules actually used — not a summary written afterwards, and not the AI's work.

Two things they will never contain, by design:

- **Text the site controls.** No page titles, no error strings, no redirect URLs. Only hostnames. A page cannot inject anything into your card.
- **Invented numbers.** Every number comes from a measurement. Missing evidence appears as "no data", never as a zero.

Missing evidence is always printed rather than quietly dropped — "Radar: no data (no RADAR_TOKEN)", "`apac`: no data", "No browser result to compare with". If a check only had half its vantage points, you can see that from the card.

### Hints — "Looks like…"

A separate list, under its own heading, of things about *your* setup that might explain what you're seeing. Hints are never allowed to pick a verdict. They are phrased as "looks like", because they are inferred:

| Hint | Why it appears |
|---|---|
| Cloudflare WARP is on | your trace says WARP is enabled |
| Cloudflare Gateway filters your traffic | your organisation's policy may be blocking this site |
| iCloud Private Relay | you're on Apple's relay network (AS36183) |
| A VPN or proxy | your reported location and your time zone disagree |
| A proxy or captive portal | the trace request came back with the wrong thing — sign in to the Wi-Fi portal |
| Your network blocks DNS-over-HTTPS | neither public resolver answered from your browser, though the network otherwise works |
| A broken IPv6 path | the site has an IPv6 address, so does your network, and only you failed |
| The site publishes an unreachable IPv6 address | an AAAA record pointing somewhere nothing can reach |
| The owner must renew the domain | the registration has expired |

Each one comes with the thing to try, usually "turn it off and check again".

### The "Cloudflare might be the problem" banner

IsItMe runs on Cloudflare, so Cloudflare having a bad day would make IsItMe wrong — in the most confusing possible direction. Rather than hide that, a check that has reason to suspect its own infrastructure says so in a banner above the signals, and its confidence is capped at 0.70.

The three reasons: Cloudflare's own status page reporting an incident in a component this check depends on; Cloudflare itself (not the site's origin) returning 5xx from two or more locations; and 1.1.1.1 failing to resolve a name that 8.8.8.8 resolved fine.

### The explanation

The paragraph at the bottom, written by Llama 3.3 from the finished verdict and the evidence, ending in two or three next steps.

It is downstream of everything else:

- The model is given the finished verdict and told never to contradict it, soften it into a different one, or second-guess it.
- It gets the evidence as JSON, not the page. The page body never reaches it — only the byte count, the title and the flags — so a hostile page has very little surface to talk to it through. Error strings, which can carry text the site chose, are stripped; redirect URLs are cut down to a hostname; vendor incident text is capped at 80 characters.
- After the model writes, **every sentence and bullet naming a hosting provider or ISP that the evidence never mentioned is deleted.** That's the specific lie this filter exists to stop: a model asked why a site is down loves to blame AWS.
- It is capped at 120 words, markdown only.

If the model is unavailable, a plain template built from the signals and the verdict's standard next steps appears instead, and the rest of the card is unchanged.

If your browser's `Accept-Language` isn't English, the explanation is written in your language. The verdict name and the signals stay in English.

## Where to go next

- **How to ask for a check:** [Using the chat](/chat).
- **Which verdicts wake you up:** [Watching and alerts](/watching).
- **Why the rules decide and the AI doesn't:** [How it works](/how-it-works).
- **What it structurally can't see:** [Limits and troubleshooting](/limits).
