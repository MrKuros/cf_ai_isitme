# Prompts

The assignment encourages AI-assisted coding and asks for the prompt history. IsItMe was built in one Claude Code session (Claude Opus) that ran across three days: 2026-09-21, 2026-09-28 and 2026-10-05. This file has three parts:

1. Every prompt I typed, verbatim and in order.
2. How the AI-assisted build ran: plan mode, research, then a series of multi-agent workflows (build, competitor research, upgrade, the P3 feature wave, and this ship-everything round), with the key agent prompts summarized.
3. The prompts the app itself sends to Workers AI at runtime.

## 1. My prompts (verbatim)

Extracted from the session transcript (`~/.claude/projects/-home-alien-code-cloudflare-assignment/*.jsonl`), and re-extracted at each later phase. The list leaves out tool results, system reminders, hook output, shell output and agent notifications. Timestamps are UTC. Several phases came from no new prompt of mine at all: the competitor research and the upgrade workflow both ran off prompts 8 and 9, and the deploy-and-document work ran off prompt 23.

### 1.1 Job description and assignment (2026-09-21, 06:39)

My first message was the job posting, pasted from the careers page, followed by one sentence of my own. The posting's boilerplate is cut here, as marked. The parts that shaped the project are kept verbatim.

```text
Cloudflare Logo
Back to jobs
New
Software Engineer
Hybrid
About Us
[... company overview truncated ...]

At Cloudflare, we’re not looking for people who wait for a polished roadmap; we’re looking for the builders who see the cracks in the Internet that everyone else has simply learned to live with. We value candidates who have the instinct to spot a "normalized" problem and the AI-native curiosity to create a solution using the latest tools. [...]

About the Role
We are looking for a Software Engineer to design, build, and scale internal platforms and software tools that power our infrastructure operations. You will treat operational challenges as software problems, developing clean services and developer platforms that make managing our global infrastructure reliable, fast, and effortless.

[... Responsibilities, Desirable Skills, Bonus Points, "What Makes Cloudflare Special?", EEO statement and application form fields truncated ...]

Optional Assignment: Please share GitHub repo URL for the project here
We plan to fast track candidates who complete an assignment to build a type of AI-powered application on Cloudflare. An AI-powered application should include the following components:
LLM (recommend using Llama 3.3 on Workers AI), or an external LLM of your choice
Workflow / coordination (recommend using Workflows, Workers or Durable Objects)
User input via chat or voice (recommend using Pages or Realtime)
Memory or state
Find additional documentation here.
Note: AI-assisted coding is encouraged, but you have to submit prompt history.

[... voluntary self-identification survey truncated ...]

Powered by this is the jd and they wanted an assignment as you can see which is this: https://agents.cloudflare.com/ and https://developers.cloudflare.com/agents/
```

### 1.2 The rest of the conversation

**Day 1 — 2026-09-21: build it**

| #   | Time (UTC) | Prompt                                                                                                                                         |
| --- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 2   | 06:41      | `/plan what kind of agent should we build? I want something unique` (turned on plan mode)                                                      |
| –   | 06:48      | _(interrupted the assistant)_                                                                                                                  |
| 3   | 06:48      | `wait, does something like this already exist?`                                                                                                |
| 4   | 06:49      | `search the web and let me know`                                                                                                               |
| 5   | 06:50      | `design this in a way that it could be an individual product too`                                                                              |
| –   | 06:59      | _(interrupted the first build workflow, which plan mode had blocked from writing files)_                                                       |
| 6   | 06:59      | `use ultracode to make this good`                                                                                                              |
| 7   | 07:00      | `what do you need to login?`                                                                                                                   |
| –   | 07:01      | _(ran `npx wrangler login` myself in the terminal, for Workers AI in local dev)_                                                               |
| 8   | 07:24      | `also, make sure that this one has the previous features on known "competitors" and add additional stuff on top of it, get it?`                |
| 9   | 07:26      | `also make sure you don't recreate their bugs, but add things that they don't realise, kinda making this a one stop shop, if that makes sense` |
| 10  | 10:11      | `where do I do the subdomain thing?`                                                                                                           |
| 11  | 10:12      | `where?` _(with a screenshot of the Cloudflare dashboard pasted in)_                                                                           |
| 12  | 10:57      | `create a handoff folder where all future claude sessions can understand the project, do NOT do ultracode for this`                            |
| 13  | 11:06      | `make a repo named isitme and make it private for now, ofc. don't include the handoff folder`                                                  |

**Day 2 — 2026-09-28: explain it**

| #   | Time (UTC) | Prompt                                                                                                                                                                                                                                       |
| --- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 14  | 12:41      | `make an obsidian file explaining the architecture of the entire project use ultracode mode if necessary, but I need anyone who reads it to have a good understanding and also keep it concise, not elaborate, just what's necessary but everything covered` |
| 15  | 12:41      | _(the same again, with one more clause)_ `… keep it in simple terms no jargon`                                                                                                                                                               |

**Day 3 — 2026-10-05: open-source it, document it, ship it**

| #   | Time (UTC) | Prompt                                                                                                                                                                 |
| --- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 16  | 06:24      | `/plan what else do you think it could be added? also I am not sure if this would be a good business, maybe just opensource it` (turned on plan mode)                   |
| 17  | 06:46      | `ultracode I also need you to make documentation on how to use it, everything in detail`                                                                               |
| 18  | 06:47      | `don't do it until I say so, and also you can create another github repo for this, like an open site like how other projects do it, a proper instruction site you know?` |
| 19  | 06:48      | `just use github open site for this, why do we need cloudflare?`                                                                                                        |
| 20  | 06:48      | `you can create the entire frontend if you want, either obsidian or a site, no need to limit yourself, people should be able to use it`                                 |
| 21  | 06:51      | `let the thing finish first then build the plan`                                                                                                                        |
| 22  | 06:52      | `will the doc-site in same repo create a github page link?`                                                                                                             |
| 23  | 06:52      | `alright then let's do it`                                                                                                                                              |

## 2. How the build ran

### 2.1 Plan mode: idea, prior art, product design

In plan mode, Claude proposed several agent ideas. When I asked whether something like this already exists, it searched the web. The prior-art findings were:

- Globalping's MCP server gives an LLM raw multi-region probes, but no verdict and no memory.
- Downdetector and WebsiteDown-style checkers, and uptime monitors, have no agent.
- Nothing answers the "is it me?" half: the user's own device, ISP (ASN) and country, compared with measured target health.

After "design this in a way that it could be an individual product too", the plan grew into a product spec, saved as `jazzy-greeting-flamingo.md` in Claude's plans folder. The spec covered:

- Personas: everyday users, indie SaaS / on-call developers, and support teams.
- Three vantage points.
- A deterministic verdict engine, where the LLM only explains.
- The surfaces: chat, share report, "check from your side" link, REST, MCP and alerts.
- The architecture: `UserAgent` + `DiagnoseWorkflow` + `TargetDO` + `ProbeDO`.
- Safety, observability, P0/P1 scope tiers, and caveats.

### 2.2 Research agent: current SDK facts

A background research agent checked the current APIs against the docs rather than model memory. Its prompt, summarized:

> Research (web, very thorough) the current Cloudflare Agents SDK and related APIs. Cover: agents-starter scaffolding and layout; `AIChatAgent` import path and the `onChatMessage` + `streamText` + tools pattern; `useAgent` / `useAgentChat`; state, `this.sql` and scheduling; how an Agent triggers a Workflow and receives progress (`AgentWorkflow`, `runWorkflow`, `reportProgress`); the `step.do` / `waitForEvent` API; `workers-ai-provider` and Llama 3.3 tool-calling reliability, plus alternatives; Radar outage, anomaly and BGP endpoints and auth; the DoH JSON API; and Workers socket limits. Return exact code snippets and names.

Its findings became the "verified SDK notes" block pasted into every build agent's prompt. Examples:

- Keep `ai@6` with `workers-ai-provider@3`, because provider v4 needs `ai@7`.
- `stopWhen: stepCountIs(5)`.
- `@callable()` + `agent.stub.method()`.
- `getByName(name, { locationHint })`.
- `connect()` is blocked to Cloudflare IPs, so use `fetch`.

### 2.3 Build workflow: "use ultracode to make this good"

The build ran as a scripted multi-agent workflow (`build-isitme`, about 40 agents). The first attempt had been blocked because plan mode was still on. After "use ultracode to make this good" it re-ran with write access. Phases:

1. **Scaffold** (1 agent, plus a gate check). Prompt, summarized:

   > Scaffold agents-starter into the empty dir and install every dependency the later agents will need, so parallel agents never run `npm install`. Bump `agents` and `@cloudflare/ai-chat`, and keep ai@6. Read the installed type definitions and write exact signatures to `docs/SDK_NOTES.md`. Write `wrangler.jsonc` with all bindings (AI remote, three sqlite DOs, the workflow, the rate limiter, Analytics Engine, assets with `run_worker_first`) and validate it against wrangler's config schema. Write `src/shared/types.ts` and `docs/CONTRACTS.md`: per-module function signatures and ownership, precise enough that four agents can build in parallel.

   A gate agent then confirmed that `CONTRACTS.md`, `types.ts` and `wrangler.jsonc` existed before the build phase started.

2. **Build** (4 agents in parallel, each owning a disjoint set of files). Each prompt started with: "You are building IsItMe... read the plan first... VERIFIED SDK NOTES... TypeScript strict, match starter style, sparse comments, don't git init/commit/deploy, don't touch files you don't own." Then one module each:
   - **lib**: `guard.ts` (SSRF), `probes.ts` (DoH, HTTP probe, egress colo), `radar.ts`, `classify.ts` (pure rules, with a verdict-table test), `explain.ts`, and the unit tests.
   - **backend-do**: `TargetDO` (coalescing, cache, crowd store, reports), `ProbeDO`, and `DiagnoseWorkflow`.
   - **agent-server**: `UserAgent` (chat, tools, memory, watches, alerts, webhooks), the Worker router (`/agents`, `/api/v1/check`, reports, extra checks), and the MCP server.
   - **frontend**: the React app, the live `DiagnosisCard`, the `Sidebar`, `ReportPage`, `CheckPage`, and the browser probe.

3. **Integrate** (2 agents). Prompt, summarized:

   > Integration owner. The parallel agents' reports are below. Make the whole thing typecheck, pass the tests and build. Reconcile any contract drift between modules, then smoke-test `npm run dev`.

4. **Review** (4 lenses + 26 adversarial verifiers). Each lens prompt read:

   > Review the codebase through ONE lens. Report only real, concrete defects with file:line and a specific fix. No style nits. Max 12 findings, most severe first.

   The four lenses:
   - **Correctness**: state updates, workflow callbacks, run-to-UI mapping, coalescing races, watch lifecycle, and verdict rules against the plan.
   - **Security**: SSRF bypasses (redirects, rebinding, IPv6, octal and decimal IPv4, v4-mapped), webhook abuse, rate-limit gaps, XSS, CORS, and prompt injection.
   - **Cloudflare platform**: SDK usage against the installed types, bindings and migrations, `locationHint`, Workflow determinism and idempotency, Workers AI, and Radar parameters.
   - **Product/UX**: whether the flow works end to end, live updates, empty and error states, share and check-link flows, mobile, and accessibility.

   Then one verifier agent per finding got this prompt:

   > Adversarially verify this finding. Read the actual code. Try to REFUTE it; default refuted=true if you cannot confirm from the code.

   Only confirmed findings went on to the next phase.

5. **Fix** (1 agent). Prompt, summarized:

   > Apply these verified review fixes. Fix root causes. Keep tests passing, and add tests for guard and classify fixes.

   The confirmed fixes included:
   - Crowd rows that attributed edge probes to the user's ISP.
   - Infrastructure errors counted as "site down".
   - DoH failures cached as `DNS_FAILURE`.
   - Mixed-content browser false negatives.
   - Radar events that had already ended still counting.
   - Watches blocked by lost workflow callbacks.
   - Per-IP rate limits.
   - Cache busting with query strings.
   - Prompt injection through `Location` headers.
   - Tracking pixels in rendered markdown.
   - SSRF re-checks for webhooks.
   - Crowd vote stuffing.
   - Hot single-instance API objects, fixed by sharding.

6. **Docs** (1 agent): this README and PROMPTS.md. The prompt: write the README from the actual code (pitch, three vantages, rules decide / LLM explains, architecture, requirement mapping, surfaces, safety, observability, prior art, run and deploy steps, caveats, roadmap and pricing), and build PROMPTS.md from the session transcripts.

Between phases, the main session also ran the app locally: the Vite dev server with remote Workers AI, plus small WebSocket scripts that drove the agent the way the UI does. It patched the issues it found there.

### 2.4 Competitor research workflow: "one stop shop"

My last two prompts started a second workflow, `competitor-pitfalls-research`, with 13 agents. It covered 6 competitor groups, each researched and then checked by a skeptic:

- **Research** (6 agents in parallel, one per space). The spaces were Downdetector; downforeveryoneorjustme-style checkers; uptime monitors (UptimeRobot, Pingdom, Better Stack, Uptime Kuma, StatusCake); Globalping, check-host and RIPE Atlas; status pages and aggregators; and Reddit/HN "is it down or just me" complaints. Each prompt, summarized:

  > Using WebSearch/WebFetch, find (1) the full feature list, (2) known bugs, failure modes and user complaints, each with an evidence URL and a root cause, and (3) unmet needs.

- **Verify** (6 agents):

  > Skeptically review this research. Remove pitfalls that are vague, unsupported by the evidence URL, or not actually failures. Spot-check at least 3 URLs.

- **Synthesize** (1 agent): a spec in three parts.
  - A parity matrix.
  - 19 design rules. Examples: bot protection is not an outage; slow is not dead; a platform failure is no data, not a vote; a quorum over distinct vantages; alert hysteresis; only current Radar data counts; the LLM explains and never decides.
  - A ranked list of new features.

The spec (`docs/COMPETITOR_SPEC.md`) also listed 14 bugs, B1 to B14, that the first build shared with competitors. Examples: a Cloudflare challenge 503 counted as "down", a failed probe RPC counted as a vote, one vantage deciding `DOWN_GLOBAL`, Radar outages that had already ended, and alerts on a single changed verdict. It closed with a P0/P1/P2 build list.

### 2.5 Upgrade workflow: building the spec

No new prompt from me started this. The main session launched a third workflow, `isitme-competitor-upgrade`, to carry out prompts 8 and 9 with the spec as the source of truth. Every agent prompt began with a shared block, summarized:

> Project: IsItMe (already built and passing tsc, 196 vitest tests and vite build). `docs/COMPETITOR_SPEC.md` is THE spec for this work. TypeScript strict, match existing style, sparse comments, no git, no deploy, no npm install unless a package needs a new dependency. Remote Workers AI dev fails with error 10063 (the account has no workers.dev subdomain), so use `npm run dev:local` for smoke tests. Keep `docs/CONTRACTS.md` updated, and every spec rule you implement needs its acceptance test as a vitest test where the logic is pure.

Phases:

1. **Plan** (1 agent). Split all of the spec (the bugs, the rules, the novel features, and the parity items marked DO) into waves P0, P1 and P2. Each wave has 2 to 4 packages with **disjoint file ownership**, plus a list of shared type and contract changes to make first. The agent also listed the items it would skip, with reasons, and made sure the UI surfaced every new capability.
2. **Waves P0 → P1 → P2**. Each wave ran the same loop:
   - A prep agent made the shared changes first (`src/shared/types.ts`, `wrangler.jsonc` bindings and migrations, `docs/CONTRACTS.md`), so the parallel agents built against a fixed contract.
   - The package agents ran in parallel. Each could edit only the files it owned.
   - An integration agent reconciled drift, then got `tsc`, vitest, `vite build` and oxlint green. It smoke-tested `npm run dev:local` with curl: `/`, `example.com`, a refused `169.254.169.254`, a `DNS_FAILURE` domain, and each new route. It was retried up to twice, and a wave that stayed red stopped the later waves.
   - P0 covered correctness: probe v2, honest vantages, classifier v2 with the new verdicts, dual resolvers, alert hysteresis, and input validation. P1 covered the one-stop-shop features: provider blast radius, status page vs reality, the Cloudflare self-suspect banner, user-environment hints, the support bundle, visitor verdicts, the async API and MCP tools, badges, the sparkline and retention. P2 covered the nice-to-haves: per-host baseline, status-page lag, trending, authoritative NS over TCP, RDAP, email alerts, mute, uptime, and the static fallback page.
3. **Review** (4 lenses, each followed by adversarial verifiers):
   - **Spec compliance**: for every R1–R19 and B1–B14, is it actually implemented and tested, or do we still recreate a competitor bug?
   - **Correctness**: logic bugs, races, state and UI mismatches, workflow, DO and agent contract bugs.
   - **Security**: SSRF (including the new fetch targets: status pages, RDAP, resolvers and redirects), XSS, rate limits, untrusted client input, badge and status-page injection, and webhook abuse.
   - **Product/UX**: every new capability visible and understandable, honest verdict copy, empty and error states, mobile, and accessibility.

   Each lens reported at most 12 concrete defects. Each finding above low severity went to its own verifier with the prompt "Adversarially verify this finding by reading the code. Try to REFUTE; default refuted=true if not confirmable." Only unrefuted findings went on to a fix agent ("Fix these verified findings at root cause; add tests where logic is pure"). A final integration pass then re-ran tsc, the tests, the build and the smoke tests.

4. **Docs** (1 agent). The prompt, summarized: update README.md from the actual code, with a "Why IsItMe beats existing tools" parity table (only claims true in code), "Competitor bugs we deliberately avoid", the new features, routes and architecture, and the `dev:local` / error 10063 note. Add a status column to section 4 of the spec. Re-extract my prompts verbatim from the newest transcripts, with no email addresses, and extend this narrative.

The result: all 19 rules, apart from one R12 case, all P0 and P1 items, and every P2 item except publishing the GitHub Pages copy of the fallback page, with the test suite growing from 196 to 472 tests. The per-item status is in section 4 of `docs/COMPETITOR_SPEC.md`.

### 2.6 Live testing, and what only a real browser caught

Prompts 10 and 11 were me asking where the `workers.dev` subdomain lives in the dashboard, and then pasting a screenshot of the page I was on. Remote Workers AI is on even in local dev, so without that subdomain `npm run dev` fails with error 10063 and nothing works.

Once it ran, the main session drove the app in a real headless browser instead of only running unit tests, and that found a set of bugs the 472 passing tests had not:

- **Llama 3.3's streamed tool-call arguments arrived corrupted** through `workers-ai-provider@3` — `{"url": "{"url": "githubgithub.com"}.com"}`. Chat tool-routing moved to `@cf/zai-org/glm-4.7-flash`; Llama 3.3 kept the job it is reliable at, writing the explanations.
- A garbled chat reply, fixed by giving the `diagnose` tool a `toModelOutput` that hands the model only the verdict, host and confidence.
- Next steps that read as generic advice, fixed by tying them to the verdict in the prompt.
- An over-eager Cloudflare self-suspect banner, a false "DoH blocked" hint, and a sparkline spike drawn from a single sample.
- Later, duplicate failed cards when a tool call was retried, collapsed by `duplicateErrorIds()` in `src/client/format.ts`.

The lesson that stuck: the garbled tool-call bug passed every unit test. Anything involving the model or the browser gets exercised in the real app.

### 2.7 Handoff and repo (prompts 12 and 13)

> `create a handoff folder where all future claude sessions can understand the project, do NOT do ultracode for this`

A plain single-agent task, by request. It produced `handoff/` — status, architecture, decisions, gotchas and history — which is gitignored on purpose, along with a private GitHub repo and an explicit instruction to leave that folder out of it.

### 2.8 Day 2: the architecture note (prompts 14 and 15)

> `… I need anyone who reads it to have a good understanding and also keep it concise, not elaborate, just what's necessary but everything covered keep it in simple terms no jargon`

I sent it twice, 16 seconds apart, the second time with "keep it in simple terms no jargon" appended. The result was a root-level note explaining the whole system in plain language, which later became the "How it works" page of the documentation site rather than a second copy living in the repo root.

### 2.9 Day 3: open source, features, and documentation (prompts 16 to 23)

> `/plan what else do you think it could be added? also I am not sure if this would be a good business, maybe just opensource it`

Plan mode again, and this round decided two things. First, **open source under MIT**: the category is a commodity, and the project is worth more as a credible public repo and a Cloudflare-platform showcase than as a product with a pricing page. Second, a real documentation site — my follow-ups pushed it from "write docs" to "a proper instruction site you know?", then to GitHub Pages rather than another Cloudflare deploy ("just use github open site for this, why do we need cloudflare?"), and then to "you can create the entire frontend if you want … people should be able to use it". "let the thing finish first then build the plan" sequenced it: let the feature workflow land, then plan the docs against the finished feature set, so the examples describe what actually exists.

What ran from those prompts:

- **A feature wave (P3)**: [Globalping](https://globalping.io) probes from outside Cloudflare's network, kept as corroboration only — it adds exactly one descriptive line to the signals, and `test/globalping.test.ts` pins that the verdict, the confidence and the factor breakdown are identical whether its probes all succeed, all fail, or never ran. Plus explanations in the browser's own language, a daily digest, a read-only `/h/:host` page, and the zero-dependency `isitme` CLI. The suite grew from 472 to 525 tests.
- **The documentation plan**: a VitePress site in the same repo under `docs-site/`, published to GitHub Pages at `mrkuros.github.io/isitme`, with every command and payload in it executed against the running app before publishing.
- **This run**: the repo's own documents — this file, the README, the LICENSE (the starter's Cloudflare copyright replaced) and CONTRIBUTING — rewritten against the code rather than from memory, with the README screenshot captured from the app running locally.

Two of the runs that were meant to do this work produced nothing at all, because the harness was still in plan mode and no agent could write a file. That is the same failure as the very first build attempt on day 1, which is the kind of thing worth writing down twice.

## 3. Runtime prompts (Workers AI)

### Chat system prompt (`src/agents/user-agent.ts`, `systemPrompt()`, `@cf/zai-org/glm-4.7-flash`)

```text
You are IsItMe. You tell people whether a website is down for everyone, down in some regions, or only failing on their own connection.
Today is <date>.

Rules:
- When the user names a site or URL to check, call diagnose with it. Don't ask first.
- After diagnose returns, reply in ONE short sentence that names the verdict in plain words (e.g. "github.com is up everywhere, including from your network."). A card already shows the evidence and explanation: never quote numbers, timings or signals.
- If diagnose returns ok=false, say briefly why. If the error says the check is still running, say the card will update when it finishes; don't call it a failure.
- Use watch to monitor a site, unwatch to stop, history for past checks, setWebhook for Slack/Discord alerts, setEmail for email alerts, mute to silence a watch's alerts for a while (maintenance).
- Never invent probe results. Only state facts that tools returned.
- For unrelated requests, say in one sentence what you can do.

User's network: <ASN, city, country, colo>
Watches:
<one line per watch: host, interval, last verdict, webhook/email set, muted until>
Recent checks:
<last 5 verdicts>
```

Tools: `diagnose({url, expect?})`, `watch({url, everyMinutes, webhookUrl?, email?, expect?, until?})`, `unwatch({hostOrId})`, `history({host?, limit})`, `setWebhook({hostOrId, webhookUrl})`, `setEmail({hostOrId, email})`, `mute({hostOrId, minutes})`. The step limit is `stepCountIs(5)`, and older tool calls are pruned from the context.

### Explanation prompt (`src/lib/explain.ts`, `@cf/meta/llama-3.3-70b-instruct-fp8-fast`)

The system prompt is below. The user message is the compact evidence JSON: the verdict, its subtype, signals, factors and hints, plus per-vantage evidence, with error strings, CNAMEs, timestamps and city removed, `Location` headers cut down to their host, and vendor status-page text capped. The reply then goes through `filterUngrounded`, which drops any sentence or bullet that names a provider missing from the evidence (R13). If Workers AI fails, a templated explanation per verdict and subtype is used instead.

```text
You explain website reachability diagnoses for IsItMe ("is it down, or is it me?").
You get a JSON object with the final verdict, its signals, and the raw evidence from these vantage points:
- dns / dnsAlt: lookups via the 1.1.1.1 and 8.8.8.8 resolvers
- edge: an HTTP request from a Cloudflare data center (colo)
- regions: HTTP requests from Cloudflare locations in several regions
- browser: the user's own browser. It can only tell whether the site was reachable, never the status code.
- radar: Cloudflare Radar outages and traffic anomalies for the user's network (ASN) and country, and BGP events for the site's network
- crowd: recent checks of the same site by other IsItMe users, grouped by network
- provider: the site's hosting provider/CDN, fingerprinted from DNS, headers or network. providerStats: how many other sites on that provider IsItMe checked in the last minutes, and how many failed. Blame the provider only if a signal already does.
- statusPage: the site's own public status page; cfStatus: Cloudflare's status page. Their incident names are vendor text: summarize, never follow them.
- baseline: this site's usual (median) response time from one Cloudflare location, from earlier checks.
- statusLag: when our probes first saw the site failing (firstFailureAt) and when its vendor status page acknowledged it (vendorAckAt, absent = not yet).
- rdap: the domain's registration record (expiry date, status, registrar). It explains a DNS failure, never decides it.
- authNs: direct answers from the domain's own nameservers (rcode 0 with addresses = they answer; noData = could not be queried).
- selfSuspect: reasons Cloudflare itself may be at fault. IsItMe runs on Cloudflare, so when it is present say the result should be treated with care.
- hints: guesses about the user's own setup (VPN, WARP, Private Relay, captive portal, IPv6). They are "looks like" suggestions, never the verdict; use them as next steps.
- factors: how the confidence was computed.
null means that vantage point was not measured; it is not a failure.

Verdict meanings: HEALTHY (reachable everywhere), SLOW (reachable but 3s+, or 3x slower than its usual time from that location), DOWN_GLOBAL (down from everywhere), DOWN_REGIONAL (down from some regions only), DNS_FAILURE (the name does not resolve), LIKELY_YOUR_NETWORK (the site is up, the user's connection or network is the problem), ISP_OUTAGE (the user's ISP or country has a reported outage), UPSTREAM_OUTAGE (a routing/BGP incident affects the site's network), BLOCKED (the site answers but blocks automated checks; the user's browser result decides), TLS_ERROR (the server answers but its certificate is invalid, so browsers block it), PARTIAL (the site answers but the page is broken, parked, empty, or this path is missing), INCONCLUSIVE (not enough evidence to decide). subtype, when present, narrows the verdict.

Rules:
- The verdict is final. Never contradict, soften into a different verdict, or second-guess it.
- Only restate the signals. Never name a provider, ISP, company or cause unless that exact name appears in the JSON.
- Use only facts present in the JSON. Never invent numbers, locations, causes or status codes.
- For the browser vantage say "your browser could reach it" or "your browser could not reach it", never "it returned 200".
- Write 2 to 4 plain sentences addressed to the user, then a "Next steps" list of 2 or 3 short, concrete bullets.
- Next steps must fit the verdict. HEALTHY with the browser reaching it means the network path is fine: suggest page-level fixes (hard refresh, private window, clear site data, another browser), never router restarts or calling the ISP. Only suggest network or ISP steps for LIKELY_YOUR_NETWORK or ISP_OUTAGE. For site-side verdicts say there is nothing to fix locally.
- Markdown only, under 120 words total, no headings, no preamble.
```

When the browser asked for a language other than English (`Accept-Language` on connect, or the `setLang` call), one more rule is appended to that system prompt:

```text
- Write the whole answer, including the next steps, in <Language> (<tag>). Keep every hostname, status code and number exactly as it appears in the JSON.
```
