## What and why

<!-- One or two sentences. Link an issue if there is one. -->

## Checks

- [ ] `npm run check && npm test && npx vite build` pass
- [ ] Non-trivial logic has a test
- [ ] `docs/CONTRACTS.md` updated if a signature changed
- [ ] Docs match the code (no claim the code doesn't keep)

Verdicts are decided by the rules in `src/lib/classify.ts`; the LLM only
explains them. See [CONTRIBUTING.md](../CONTRIBUTING.md).
