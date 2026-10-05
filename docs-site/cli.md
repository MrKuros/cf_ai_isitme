---
title: CLI
description: "Install the isitme command, every flag, exit codes and scripting examples."
---

<script setup>
import { SITE_URL } from "./.vitepress/theme/site";
</script>

# CLI

`isitme` asks the hosted app one question and prints the answer. One file, no dependencies, two exit codes — so a shell script can decide what to do next.

It is a client of [`GET /api/v1/check`](/api#check-a-site) and nothing else. There is no agent, no WebSocket and **no probe from your own machine**, which matters for what it can tell you: see [what the CLI cannot see](#what-the-cli-cannot-see).

> [!NOTE] Examples on this page
> Every command below was run for real. The CLI talks to <code>{{ SITE_URL }}</code> by default, so you can leave `ISITME_API` unset unless you are pointing it at your own copy.

## Install

You need Node 18 or newer (it uses `parseArgs` from `node:util` and `AbortSignal.timeout`). Verified on Node 25. The package is not on npm, so clone the repo and run the file:

```sh
git clone https://github.com/MrKuros/isitme.git
cd isitme
export ISITME_API=http://localhost:5173   # or your own deployment
node bin/isitme.mjs github.com
```

The export is not optional yet: the built-in default only answers once the hosted
app is deployed, and without a base URL the command exits 1 with `cannot reach`.

To type `isitme` instead, link it onto your `PATH`:

```sh
mkdir -p ~/.local/bin
ln -s "$PWD/bin/isitme.mjs" ~/.local/bin/isitme
isitme --version
```

```
1.0.0
```

No `npm install` is needed for the CLI itself — it imports only `node:fs`, `node:url`, `node:util` and global `fetch`. (It reads `package.json` for the version string, so keep it next to the repo rather than copying the one file somewhere else.)

## Which server it talks to

In order of precedence:

1. `--api <base>` on the command line
2. `$ISITME_API` in the environment
3. the built-in default, <code>{{ SITE_URL }}</code>

A base must be a bare `http(s)://host[:port]` — no path, no trailing slash needed (trailing slashes are trimmed for you):

```sh
isitme example.com --api http://localhost:5173
export ISITME_API=http://localhost:5173   # same thing, for a whole session
```

Running your own copy? Point `ISITME_API` at it — see [Self-hosting](/self-hosting).

## Usage

```
isitme <domain or URL> [options]
```

Exactly one target. It can be a bare domain (`github.com`), a full URL with a path (`https://example.com/login`), or an IP address.

| Option | What it does |
|---|---|
| `--expect <text>` | The page must contain this text. If it doesn't, the verdict is <Verdict v="PARTIAL" sub="expect missing" /> and the exit code is 1 — even though the server answered. 1–200 characters. |
| `--json` | Print the raw API response instead of the human format. Exit code is unchanged. |
| `--api <base>` | API base URL. See above. |
| `--timeout <s>` | Give up after this many seconds. Default 125, which is just past the server's own 2-minute ceiling. |
| `-h`, `--help` | Print the help text and exit 0. |
| `-v`, `--version` | Print the version and exit 0. |

There are no other options, and no config file. Bad input is rejected before any request goes out:

```
$ isitme
isitme: no target given

$ isitme a.com b.com
isitme: expected one target, got 2

$ isitme example.com --timeout abc
isitme: --timeout must be a positive number of seconds, got "abc"

$ isitme example.com --expect ""
isitme: --expect must not be empty

$ isitme --nope example.com
isitme: Unknown option '--nope'. To specify a positional argument starting with a '-', place it at the end of the command after '--', as in '-- "--nope"
```

Each of those prints the full help after the error, on stderr, and exits 1.

## What a check looks like

A check runs the whole pipeline on the server — DNS from two resolvers, Cloudflare's edge, five regions, Globalping, outage data — so expect it to take 15–25 seconds.

```sh
isitme example.com
```

```
HEALTHY  example.com  (confidence 70%)
  - Cloudflare's edge (MAA) got HTTP 200 in 1552ms
  - 5/5 regions reachable (median 833ms)
  - DNS resolved to 4 addresses in 148ms
  - Only one Cloudflare location answered
  - 10 checks in the last 10 min, 0 failing
  - Radar: no data (no RADAR_TOKEN)
  - All 5 outside probes reached it
  - served by Cloudflare

The site is reachable from all locations. Your browser result is not available.
Cloudflare's edge and all regions got HTTP 200.
Next steps:
* Try a hard refresh
* Check in a private window
* Clear site data

report: http://localhost:5192/r/example.com/330b001b-8497-42f3-9909-12f3af536951
```

The first line is the verdict, the host and the confidence. Then the signals that drove it, then the written explanation, then a link to the full report. Colour is used only when stdout is a terminal, so pipes and CI logs stay clean.

With a subtype, the first line joins them with a slash — and the exit code flips to 1:

```sh
isitme https://example.com --expect "Sign in"
```

```
PARTIAL/expect_missing  example.com  (confidence 73%)
  - Expected text not found on the page
  - Cloudflare's edge (MAA) got HTTP 200 in 1600ms
  - 5/5 regions reachable (median 1258ms)
  - DNS resolved to 4 addresses in 157ms, DNSSEC-validated
  - served by Cloudflare
```

`--json` gives you the API's own `CheckOutcome` object, pretty-printed, so you can pick fields out of it:

```sh
isitme example.com --json | jq -r .verdict
```

```
HEALTHY
```

Every field is documented in [the API reference](/api#check-a-site). What the verdicts mean is on [Understanding results](/results).

## Exit codes

There are only two.

| Code | When |
|---|---|
| `0` | The verdict is <Verdict v="HEALTHY" /> or <Verdict v="SLOW" /> — the site answered. Also `--help` and `--version`. |
| `1` | Any other verdict, **and** every failure: bad arguments, a timeout, an unreachable API, a rate limit. |

So "exit 0" means *the site answered from the server's point of view*. <Verdict v="SLOW" /> passes on purpose: slow is not down, and a CI job that fails on latency fails on a bad afternoon.

Deliberately on the failing side: <Verdict v="BLOCKED" /> (bot protection answered, not the site) and <Verdict v="INCONCLUSIVE" /> (not enough evidence). Both exit 1.

Failures print to **stderr**, not stdout:

```
$ isitme example.com --timeout 1
error: timed out after 1s

$ isitme example.com --api http://localhost:9
error: cannot reach http://localhost:9: fetch failed

$ isitme example.com      # 21st request in a minute
error: rate limited
```

All three exit 1. The API allows 20 requests per minute per IP; see [rate limits](/api#rate-limits).

## What the CLI cannot see

The web app runs a probe inside your browser, and that probe is what proves the problem is *you*. The CLI has no browser, so:

- <Verdict v="LIKELY_YOUR_NETWORK" /> and <Verdict v="ISP_OUTAGE" /> **never** come back from the CLI. Both rules need a vantage on your machine that failed while the servers succeeded. Without one, the same situation reads as <Verdict v="HEALTHY" /> (the servers are fine) — which is correct but answers only half the question.
- Confidence is capped lower. With no browser vantage, a healthy verdict tops out around 0.7 instead of 0.95.
- `Only one Cloudflare location answered` in the output above is a local-dev artifact: `locationHint` does nothing on a dev machine, so all five region probes run in the same colo. On the deployed app five distinct colos answer.

If you need the "is it me?" half, use the chat app or send someone the [check-from-your-side link](/sharing). The CLI is for "did the site answer", which is what a script usually wants.

## In CI

The gate is the exit code, so no parsing is needed. This is a smoke test after a deploy:

```yaml
# .github/workflows/smoke.yml
- name: Is the site actually up?
  env:
    ISITME_API: https://isitme.example   # your deployment
  run: |
    node bin/isitme.mjs https://example.com --expect "Example Domain"
```

Same thing as a standalone script, which is what was run to produce the output below:

```sh
#!/bin/sh
# Fail the job unless the site is HEALTHY or SLOW.
set -e
isitme "$1" --expect "$2"
```

```
$ ./gate.sh https://example.com "Example Domain"
HEALTHY  example.com  (confidence 70%)
  - Cloudflare's edge (MAA) got HTTP 200 in 1552ms
  ...
$ echo $?
0
```

Notes for CI:

- Add `--expect` whenever you can. Plenty of broken deploys return HTTP 200 with the wrong page, and `--expect` is what turns that into a failure.
- Keep `--timeout` under your job's step timeout. The default is 125 s.
- A check costs one of your 20 requests per minute per IP. A matrix of ten jobs all checking at once from one runner IP is fine; a hundred is not.
- Nothing is installed: `node bin/isitme.mjs` works straight out of a checkout.

## From cron

The useful shape is "say nothing when it's fine", so cron only mails you when something broke:

```sh
#!/bin/sh
# isitme-cron.sh — print one line only when the site is not fine.
out=$(isitme "$1" --json --timeout 60) || {
  echo "$out" | jq -r '"\(.host) \(.verdict // "ERROR") \(.error // .reportPath)"'
  exit 1
}
```

```
$ ./isitme-cron.sh example.com
$ echo $?
0

$ ./isitme-cron.sh this-domain-does-not-exist-isitme-test.com
this-domain-does-not-exist-isitme-test.com DNS_FAILURE /r/this-domain-does-not-exist-isitme-test.com/60f45b1e-cfa0-4bfa-8d26-2f08242d8ecc
$ echo $?
1
```

In a crontab, every 15 minutes:

```txt
*/15 * * * * ISITME_API=https://isitme.example /home/you/bin/isitme-cron.sh example.com
```

> [!TIP] Cron is the wrong tool if you want alerts
> A cron job can only tell *you*, on that one machine, and it re-checks blindly. The app's own [watches](/watching) run on Cloudflare's schedule, confirm a change with a second run before alerting, group an outage into one incident, and push to Slack, Discord or email. Use cron when you want the result inside a shell script; use a watch when you want to be told.

## Source

One file, about 240 lines: [`bin/isitme.mjs`](https://github.com/MrKuros/isitme/blob/main/bin/isitme.mjs). Its argument parsing, output formatting and exit-code logic are exported and unit-tested in `test/cli.test.ts`.
