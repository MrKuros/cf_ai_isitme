---
title: MCP
description: "Connect Claude Code, Claude Desktop or Cursor, and the four tools they get."
---

<script setup>
import { SITE_URL } from "./.vitepress/theme/site";
</script>

# MCP

IsItMe speaks the Model Context Protocol, so an AI assistant can run a check for you. You ask "is staging actually down, or is it my laptop?" in the editor, and the assistant comes back with the verdict and the evidence instead of guessing.

The endpoint is streamable HTTP, no auth, no key:

```
POST /mcp
```

Once the demo is deployed, that is <code>{{ SITE_URL }}/mcp</code>. For a local copy it is whatever `npm run dev` prints, plus `/mcp`.

> [!NOTE] Examples on this page
> The hosted app is not deployed yet, so every connection below was made against a local dev server on port 5192. Swap in your own base URL; nothing else changes.

## Connect Claude Code

One command — swap in your own base URL (this was run against a local dev server):

```sh
claude mcp add --transport http isitme http://localhost:5192/mcp
```

```
Added HTTP MCP server isitme with URL: http://localhost:5192/mcp to local config
File modified: /home/alien/.claude.json [project: …]
```

Check it:

```sh
claude mcp list
```

```
isitme: http://localhost:5192/mcp (HTTP) - ✔ Connected
```

```sh
claude mcp get isitme
```

```
isitme:
  Scope: Local config (private to you in this project)
  Status: ✔ Connected
  Type: http
  URL: http://localhost:5192/mcp
```

The default scope is `local`: this project, only you. Two alternatives:

```sh
claude mcp add --transport http isitme --scope user  https://isitme.example/mcp   # all your projects
claude mcp add --transport http isitme --scope project https://isitme.example/mcp # committed to the repo
```

`--scope project` writes a `.mcp.json` next to your code:

```json
{
  "mcpServers": {
    "isitme": {
      "type": "http",
      "url": "https://isitme.example/mcp"
    }
  }
}
```

That file is shared, so Claude Code asks each teammate to approve it before connecting — until they do, `claude mcp list` shows `⏸ Pending approval`. The `"type": "http"` line is not optional: an entry with a `url` and no `type` is read as a stdio command and fails.

To remove it: `claude mcp remove isitme`.

## Connect Claude Desktop

Claude Desktop does **not** take a remote server in `claude_desktop_config.json` — that file is for local stdio servers only. Remote servers are added once to your Claude account as a custom connector and then sync to the desktop app:

1. Open [claude.ai](https://claude.ai) → **Customize** → **Connectors** → **+ Add** → **Add custom connector**. (Some versions label the first step **Settings**.)
2. Name it `isitme`.
3. Paste the server URL: <code>{{ SITE_URL }}/mcp</code>.
4. Authentication: **No sign-in** — IsItMe's MCP endpoint is public, with no key and no OAuth.
5. Add it, then enable it in a chat.

Two consequences worth knowing before you try:

- The URL must be reachable from Anthropic's servers on the public internet. A `localhost` dev server or a copy behind a VPN cannot be connected this way — use Claude Code or Cursor for those.
- This is an account-level connector, so it also shows up on claude.ai, not just in the desktop app.

## Connect Cursor

Cursor reads `~/.cursor/mcp.json` (all projects) or `.cursor/mcp.json` (one project). Remote servers are a `url` entry:

```json
{
  "mcpServers": {
    "isitme": {
      "url": "https://isitme.example/mcp"
    }
  }
}
```

No `type` field, no `command`, no credentials. Restart Cursor, or reload the MCP list in **Settings → MCP**, and the four tools appear.

(That format is from Cursor's own documentation. The endpoint itself was verified with Claude Code and with raw JSON-RPC — see [under the hood](#under-the-hood) — but not from inside Cursor.)

## The four tools

| Tool | Input | Returns |
|---|---|---|
| `check_site` | `url`, optional `expect` | The finished verdict. Waits for the whole check. |
| `start_check` | `url`, optional `expect` | `{ ok, runId, host }` immediately. |
| `get_check` | `runId` | `{ status: "running" }` or the finished verdict. |
| `get_report` | `host`, `id` | The full report: every piece of evidence. |

`url` is 1–2048 characters: a bare domain, a full URL with a path, or an IP. `expect` is 1–200 characters the page must contain. They are the same schemas the [HTTP API](/api) uses.

Summaries by default, detail on request: the first three tools return a verdict with its signals and a `reportPath`, which keeps the assistant's context small. The full evidence is one extra call away with `get_report`.

### check_site

The straightforward one. It runs DNS from two resolvers, Cloudflare's edge, five regions, Globalping, Radar and the vendor's status page, then the rules, then the explanation — so it takes 15–25 seconds and waits up to two minutes before giving up.

> **Prompt:** Is example.com down, or is it just me?

The assistant calls `check_site { "url": "example.com" }` and gets:

```json
{
  "ok": true,
  "runId": "ff0a1751-e61e-4e75-ab58-710523d8e4e0",
  "host": "example.com",
  "verdict": "HEALTHY",
  "confidence": 0.7,
  "signals": [
    "Cloudflare's edge (MAA) got HTTP 200 in 2212ms",
    "5/5 regions reachable (median 1656ms)",
    "DNS resolved to 4 addresses in 144ms",
    "Only one Cloudflare location answered",
    "11 checks in the last 10 min, 0 failing",
    "Radar: no data (no RADAR_TOKEN)",
    "All 5 outside probes reached it"
  ],
  "provider": "Cloudflare",
  "explanation": "The site is reachable from all locations. Your browser result is not available. All outside probes and Cloudflare's edge reached the site. …",
  "reportPath": "/r/example.com/ff0a1751-e61e-4e75-ab58-710523d8e4e0"
}
```

More prompts that land on this tool:

> **Prompt:** Check whether `https://staging.example.com/login` still serves the login form.

→ `check_site { "url": "https://staging.example.com/login", "expect": "Sign in" }`. If the server answers 200 but the text is gone, the verdict is <Verdict v="PARTIAL" sub="expect missing" /> — which is the result you actually wanted.

> **Prompt:** Our deploy just finished. Confirm the site is up from more than one region before I go to lunch.

→ `check_site`, then read the `5/5 regions reachable` signal. A <Verdict v="DOWN_REGIONAL" /> verdict here means the deploy is only broken in some places.

A failed call comes back as an error result (`isError: true`) with `{ "ok": false, "error": … }` inside — for example a target the guard refuses, or a check that ran past two minutes.

### start_check and get_check

Use these when a 25-second tool call is awkward, so the assistant can do something else while the check runs.

> **Prompt:** Kick off checks on example.com and github.com, then tell me both results.

```
start_check { "url": "example.com" }
→ { "ok": true, "runId": "af999c2b-5e8d-48a8-ba1e-99d71842ea3b", "host": "example.com" }

get_check { "runId": "af999c2b-5e8d-48a8-ba1e-99d71842ea3b" }
→ { "status": "running", "runId": "af999c2b-5e8d-48a8-ba1e-99d71842ea3b", "host": "example.com" }

… 20 seconds later …

get_check { "runId": "af999c2b-5e8d-48a8-ba1e-99d71842ea3b" }
→ { "ok": true, "verdict": "HEALTHY", "confidence": 0.7, "signals": [ … ], "reportPath": "/r/example.com/af999c2b-…" }
```

> [!IMPORTANT] `get_check` only sees runs from the same session
> Runs are stored per MCP session. A `runId` from another session — another editor window, or a reconnect after a restart — answers:
> ```json
> { "error": "unknown runId for this session" }
> ```
> with `isError: true`. If that happens, start the check again. Reports, unlike runs, are permanent and visible to everyone: `get_report` works across sessions and from any client.

### get_report

Everything the rules looked at. Reach for it when the verdict alone isn't enough: which region failed, what each resolver answered, what the vendor's status page said, what the browser probe saw.

> **Prompt:** It said DOWN_REGIONAL. Which regions failed, and what did DNS say?

```
get_report { "host": "example.com", "id": "ff0a1751-e61e-4e75-ab58-710523d8e4e0" }
```

The `host` and `id` are the two segments of the `reportPath` a check hands back. The result is the full report object — `evidence` (`target`, `user`, `dns`, `dnsAlt`, `edge`, `root`, `alt`, `regions`, `globalping`, `radar`, `crowd`, `browser`, `provider`, `providerStats`, `statusPage`, `cfStatus`, `baseline`), plus `classification`, `explanation` and `extraChecks`. The healthy example above came back as 6.8 KB of JSON, so it is a deliberate second step rather than something to call on every check.

Errors are plain: `{ "error": "not found" }` for an unknown id, `{ "error": "expired", "retentionDays": 30 }` for one older than 30 days, `{ "error": "bad host" }` for a host that isn't a hostname.

## What MCP checks cannot tell you

The web app runs a probe inside your browser, and that probe is the half of the evidence that proves the problem is *you*. An MCP client has no browser, so:

- <Verdict v="LIKELY_YOUR_NETWORK" /> and <Verdict v="ISP_OUTAGE" /> never come back from an MCP check. Both need a vantage on your own machine that failed while the servers succeeded.
- The caller's network is not recorded either, so Radar cannot look up outages for your ISP or country. `Radar: no data` in the example above is a missing token on the dev machine; with a token, an MCP check still only gets target-side Radar evidence.
- Confidence caps lower without a browser vantage — about 0.7 for a healthy verdict instead of 0.95.

So MCP answers "is the site answering, from everywhere we can see" very well. For "is it me", open the app, or send a colleague a [check-from-your-side link](/sharing).

## Limits and privacy

- **20 requests per 60 seconds per IP** on the `/mcp` bucket, independent of the other API buckets. Over it: `429 { "error": "rate limited" }`. One `check_site` is one request, and each `get_check` poll is another.
- Every check writes a **public report** at `/r/<host>/<id>`, kept 30 days. Don't check an internal URL you wouldn't want linkable — and note that private and loopback addresses are refused outright.
- The hosted demo's limits and retention are its own; a [self-hosted copy](/self-hosting) sets them in `wrangler.jsonc`.

## Under the hood

Nothing here is Claude- or Cursor-specific — it is a standard streamable-HTTP MCP server, so any compliant client works. With curl, to prove it:

```sh
# 1. initialize, and keep the session id
curl -si -X POST http://localhost:5192/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}'
```

```
HTTP/1.1 200 OK
content-type: text/event-stream
mcp-session-id: 645c50862e98a98132c23c2a4de14a849af02f0489a83da951039c9961949c50

event: message
data: {"result":{"protocolVersion":"2025-06-18","capabilities":{"tools":{"listChanged":true}},"serverInfo":{"name":"isitme","version":"1.1.0"}},"jsonrpc":"2.0","id":1}
```

```sh
# 2. say hello, then list the tools (same session id on every later request)
SID=645c5086…
curl -s -X POST http://localhost:5192/mcp -H "mcp-session-id: $SID" \
  -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","method":"notifications/initialized"}'

curl -s -X POST http://localhost:5192/mcp -H "mcp-session-id: $SID" \
  -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
```

The tool list comes back as `check_site, start_check, get_check, get_report`. Forget the session header and the server says so:

```json
{"error":{"code":-32000,"message":"Bad Request: Mcp-Session-Id header is required"},"id":null,"jsonrpc":"2.0"}
```

The server is `src/agents/mcp.ts` — a Durable Object (`McpAgent`) that holds one session, with the tool schemas in `src/shared/schemas.ts`.
