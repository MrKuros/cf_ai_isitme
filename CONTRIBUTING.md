# Contributing to IsItMe

Thanks for looking. IsItMe is MIT-licensed and open to patches. This file covers
how to run it, how it is laid out, and the one rule that is not negotiable.

User-facing documentation lives at
**<https://mrkuros.github.io/isitme>**. This file is for people changing
the code.

## Run it

Requires Node 20+ and a free Cloudflare account.

```bash
npm install
npx wrangler login     # Workers AI is remote even in dev ("remote": true in wrangler.jsonc)
npm run dev            # http://localhost:5173
```

Remote Workers AI needs a `workers.dev` subdomain on your account. Without one,
`npm run dev` fails with error **10063**; open Workers & Pages in the dashboard
once to claim a subdomain.

```bash
npm run dev:local      # LOCAL_ONLY=1: no remote bindings
```

`dev:local` runs everything except the LLM: probes, the REST API, MCP, badges,
reports and every page work, chat tool-calling does not, and explanations fall
back to the per-verdict templates. Use it when you have no account handy.

`RADAR_TOKEN` is optional (`cp .dev.vars.example .dev.vars`). Without it the
Radar step reports `skipped` and verdicts carry slightly less confidence.

## Checks

Everything below must pass before a pull request:

```bash
npm test               # vitest, 528 tests, pure logic only
npx tsc --noEmit
npm run lint           # oxlint over src/ test/ bin/
npx vite build
```

`npm run format` (oxfmt) formats the TypeScript. Markdown and JSON are not
currently formatted by it cleanly, so don't reformat files you aren't changing.

The unit tests deliberately avoid the Cloudflare vitest pool: they cover pure
functions only. Anything that needs a real colo, a real Durable Object or the
real LLM is checked by running the app, not by a test.

## Shape of the project

```
src/lib/        pure logic, no bindings, heavily tested  <- most changes go here
src/agents/     Durable Objects: UserAgent (chat, memory, watches), TargetDO
                (per-host probes, coalescing, reports), ProbeDO (one per region),
                ProviderDO, TrendsDO, IsItMeMcp (MCP server)
src/workflow/   DiagnoseWorkflow: the ordered, retried, durable check pipeline
src/server.ts   Worker router: /agents, /mcp, /api/*, /badge/*, SPA assets
src/shared/     types.ts (shared types and constants) and schemas.ts (zod)
src/client/     React SPA: app.tsx is the router, components/ChatApp.tsx is chat
bin/isitme.mjs  zero-dependency Node CLI over GET /api/v1/check
test/           vitest, one file per module
```

A check flows: chat or API → `DiagnoseWorkflow` → probe steps (DNS, edge, five
regional `ProbeDO`s, Globalping, Radar, status page, provider, crowd) →
`classify()` → `explain()` → stored report. `handoff/ARCHITECTURE.md` has the
full diagram if you have that folder; it is not in the public repo.

## The rule: rules decide, the LLM explains

`src/lib/classify.ts` is a pure function. It is the only place a verdict is
chosen, and its inputs are measurements. `src/lib/explain.ts` turns that verdict
into English with Llama 3.3 on Workers AI. **The model may never change, soften
or second-guess the verdict**, and if Workers AI fails, a per-verdict template
takes over so the product still answers.

This extends to evidence. Adding a new source does not automatically let it vote.
Globalping is the worked example: it contributes exactly one descriptive line to
`signals`, and `test/globalping.test.ts` pins that the verdict, the confidence
and the factor breakdown are byte-identical whether its probes all succeed, all
fail, or never ran. Copy that pattern. If a new source really should move the
verdict, that is a change to `classify.ts` with its own rule and its own tests,
proposed as such.

Related habits worth keeping:

- Missing evidence is not failure. A vantage that did not answer lowers
  confidence; it never counts as a vote that the site is down.
- Nothing the target controls reaches the model unfiltered. Error strings,
  CNAMEs and page titles are dropped (`DROP_KEYS` in `src/lib/explain.ts`),
  `Location` headers are cut to a host, and vendor status-page text is capped.
  A new target-controlled field is not covered until it is in one of those.
- Every outbound fetch goes through the SSRF guard in `src/lib/guard.ts`,
  including every redirect hop and every webhook send.

## New rules need tests

Any change to verdict logic, confidence, alert decisions or the guard needs a
vitest case that fails without it. `test/classify.test.ts` and
`test/p2-classify.test.ts` are table-driven; adding a row is usually enough.
Bug fixes get a regression test too.

Non-trivial pure logic anywhere else also gets a test. Plumbing and UI wiring do
not — we don't mock the platform to feel covered.

## Internal reference docs

`docs/` is for contributors, not users:

| File | What it holds |
|---|---|
| `docs/CONTRACTS.md` | Module-level API contracts. **The source of truth for signatures — keep it in sync with any change you make.** |
| `docs/COMPETITOR_SPEC.md` | Competitor research, the bugs B1–B14, the rules R1–R19, and each item's status |
| `docs/SDK_NOTES.md` | Agents SDK / Workflows signatures verified against the installed versions |
| `docs/API.md` | The public REST API |

## Editing the documentation site

The site at <https://mrkuros.github.io/isitme> lives in this repo under
`docs-site/` and is published to GitHub Pages by a GitHub Actions workflow. Pages
are Markdown: edit the one you mean, open a pull request, and the site rebuilds on
merge. Run it locally first — `package.json` has the `docs:` scripts for the dev
server and the production build — and make sure the build is clean, because a dead
internal link fails it.

Documentation rule, same as the code: every command, payload and output in the
site is something that was actually run. If you can't run it, don't write it.

## Pull requests

- One concern per pull request.
- TypeScript strict, match the surrounding style, sparse comments — comment the
  *why*, not the *what*.
- No new runtime dependency without saying in the pull request why a few lines
  of code won't do.
- Say what you ran. "528 tests, tsc, lint and build clean" is the bar; if you
  exercised it in the real app, say what you saw.
