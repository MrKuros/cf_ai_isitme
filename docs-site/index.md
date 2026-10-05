---
layout: home
title: Is it down, or is it me?
description: "Ask whether a site is down, and get told whether it's the site, one region, its provider, the wider internet — or your own connection."
hero:
  name: IsItMe
  text: Is it down, or is it me?
  tagline: Every other tool checks a site from one place. IsItMe also checks it from yours, and tells you which side the problem is on.
  actions:
    - theme: brand
      text: Quick start
      link: /quick-start
    - theme: alt
      text: How it works
      link: /how-it-works
    - theme: alt
      text: Run your own
      link: /self-hosting
features:
  - title: Your device
    details: A browser probe from your own machine — timing, both public resolvers over DoH, and hints about VPNs, WARP, Private Relay and captive portals.
  - title: Cloudflare's edge
    details: Both resolvers, an HTTP probe from the nearest colo, and five more from Durable Objects placed in wnam, enam, weur, apac and oc.
  - title: The wider internet
    details: Cloudflare Radar outages and BGP events, the site's own status page, a host fingerprint, and Globalping probes from outside Cloudflare.
  - title: Rules decide, the LLM explains
    details: A deterministic rule engine picks one of twelve verdicts from the evidence. Llama 3.3 only writes the paragraph, and a filter drops anything it invents.
---

## Try it

<TryIt />

## Where to go next

- **New here?** [Quick start](/quick-start) walks through your first check.
- **Got a verdict you don't understand?** [Understanding results](/results) explains all twelve.
- **Want it in a script or CI?** [CLI](/cli) and [HTTP API](/api).
- **Want your own copy?** [Self-hosting](/self-hosting).
