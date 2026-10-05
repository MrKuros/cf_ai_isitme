---
title: Contributing
description: "Where the code lives, the one rule that isn't negotiable, and how to edit these pages."
---

<script setup>
import { REPO_URL } from "./.vitepress/theme/site";
</script>

# Contributing

IsItMe is MIT-licensed and open to patches. The full guide lives in the repo, so
it stays next to the code it describes.

<p>
  <a :href="REPO_URL + '/blob/main/CONTRIBUTING.md'"><strong>CONTRIBUTING.md</strong></a>
  — how to run it, how it's laid out, what has to pass before a pull request.
</p>

## The short version

```bash
npm install
npx wrangler login     # Workers AI is remote even in dev
npm run dev
```

Everything below has to pass:

```bash
npm test               # vitest
npx tsc --noEmit
npm run lint           # oxlint over src/ test/ bin/
npx vite build
```

## The one rule

**Rules decide the verdict. The LLM only explains it.**

`src/lib/classify.ts` is a pure function and the only place a verdict is chosen.
`src/lib/explain.ts` turns that verdict into English, and may never change,
soften or second-guess it.

This extends to evidence: adding a new source does not give it a vote. Globalping
is the worked example — it contributes one line to `signals`, and a test pins
that the verdict and confidence are identical whether its probes succeeded,
failed, or never ran. If a source really should move the verdict, that's a change
to `classify.ts` with its own rule and its own tests.

Verdict logic, confidence, alert decisions and the SSRF guard each need a test
that fails without your change.

## Reference docs

`docs/` in the repo is for contributors rather than users.

<table>
  <thead><tr><th>File</th><th>What it holds</th></tr></thead>
  <tbody>
    <tr>
      <td><a :href="REPO_URL + '/blob/main/docs/CONTRACTS.md'"><code>docs/CONTRACTS.md</code></a></td>
      <td>Module-level API contracts. The source of truth for signatures — keep it in sync with any change you make.</td>
    </tr>
    <tr>
      <td><a :href="REPO_URL + '/blob/main/docs/API.md'"><code>docs/API.md</code></a></td>
      <td>The public REST API, in reference form. The HTTP API page is the readable version.</td>
    </tr>
    <tr>
      <td><a :href="REPO_URL + '/blob/main/docs/COMPETITOR_SPEC.md'"><code>docs/COMPETITOR_SPEC.md</code></a></td>
      <td>Competitor research, the bugs B1–B14 this project set out not to repeat, and the rules R1–R19.</td>
    </tr>
    <tr>
      <td><a :href="REPO_URL + '/blob/main/docs/SDK_NOTES.md'"><code>docs/SDK_NOTES.md</code></a></td>
      <td>Agents SDK and Workflows signatures, verified against the installed versions.</td>
    </tr>
  </tbody>
</table>

## Editing this site

These pages are Markdown under `docs-site/` in the same repo. Edit the one you
mean and open a pull request; GitHub Actions rebuilds the site on merge.

```bash
npm run docs:dev       # live preview
npm run docs:build     # production build — also the link checker
```

A dead internal link fails the build, so run it before opening the pull request.

Three components are available on any page without importing them:
`<Verdict />` for a verdict chip, `<ResultCard />` for a result card, and
`<TryIt />` for the live check box.

> [!IMPORTANT] Same rule as the code
> Every command, payload and output on this site is something that was actually
> run. If you can't run it, don't write it.
