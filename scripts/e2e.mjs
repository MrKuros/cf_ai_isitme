#!/usr/bin/env node
// Browser end-to-end test: asks the chat a question and asserts the diagnosis card
// that comes back. The two worst bugs so far — garbled tool calls and an asset-less
// deploy — were both invisible to the unit tests and obvious here.
//
// Playwright is not a project dependency (it carries a browser download), so this
// resolves it at runtime: `npm i --no-save playwright` first, or run it against a
// global install.
//
//   E2E_URL      what to test                  (default http://localhost:$E2E_PORT)
//   E2E_PORT     port for the default URL      (default 5180)
//   E2E_PROMPT   the question to ask           (default "is github.com down or is it me?")
//   E2E_BROWSER  chromium executable path      (default: Playwright's own)
//   E2E_WAIT     ms to wait for the verdict    (default 90000)
//   E2E_OUT      screenshot directory          (default the OS temp dir)
//
// Needs a server with the real Workers AI (`npm run dev`, or the deployed app):
// dev:local has no tool calling, so no card is ever created.
import { tmpdir } from "node:os";
import { chromium } from "playwright";

const url =
  process.env.E2E_URL ?? `http://localhost:${process.env.E2E_PORT ?? 5180}`;
const prompt = process.env.E2E_PROMPT ?? "is github.com down or is it me?";
const wait = Number(process.env.E2E_WAIT ?? 90_000);
const out = process.env.E2E_OUT ?? tmpdir();

// Kept in step with VERDICTS in src/client/components/ui.tsx.
const VERDICT_LABELS = [
  "Healthy",
  "Slow",
  "Down everywhere",
  "Down in some regions",
  "DNS failure",
  "Likely your network",
  "ISP/regional outage",
  "Upstream outage",
  "Blocks bots",
  "Certificate error",
  "Partly broken",
  "Inconclusive"
];

const browser = await chromium.launch({
  executablePath: process.env.E2E_BROWSER || undefined
});
const page = await browser.newPage({ viewport: { width: 1400, height: 1200 } });
const logs = [];
page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));

const failures = [];
function expect(cond, msg) {
  if (!cond) failures.push(msg);
}

try {
  await page.goto(url, { waitUntil: "networkidle" });
  await page.screenshot({ path: `${out}/e2e-1-empty.png` });

  const box = page.locator("textarea, input[type=text]").first();
  await box.fill(prompt);
  await box.press("Enter");

  // The card appears while the run is still going (aria-busy), then settles.
  const cards = page.locator("article[aria-busy]");
  const done = page.locator('article[aria-busy="false"]');
  const settled = await done
    .first()
    .waitFor({ timeout: wait })
    .then(
      () => true,
      () => false
    );
  if (!settled) {
    // Workers AI has a daily free allowance. Once it runs out the model never
    // answers, so no tool call and no card — a quota state, not a regression.
    const page_text = await page.locator("body").innerText();
    if (
      /AI model is unavailable|daily free allocation|neurons/i.test(page_text)
    ) {
      console.log(
        "SKIP: Workers AI is out of its daily allowance; chat cannot run."
      );
      await browser.close();
      process.exit(75);
    }
  }
  expect(settled, `no finished diagnosis card after ${wait}ms`);

  const card = cards.first();
  const text = await card.innerText();

  expect(
    !text.includes("Couldn't finish the check."),
    "the card is an error card: " + text.split("\n").slice(0, 6).join(" / ")
  );
  const label = VERDICT_LABELS.find((v) => text.includes(v));
  expect(label, "no verdict badge on the card");

  // The LLM's prose, rendered through the Markdown component. Streamdown appends
  // its class after Tailwind's arbitrary-variant ones, which a plain `.sd-theme`
  // selector doesn't match, so match the attribute instead.
  const explanation = card.locator('[class*="sd-theme"]').first();
  // The card stops being busy when the run finishes, but the explanation arrives
  // with the tool result a beat later, so it gets its own wait.
  await explanation.waitFor({ timeout: 30_000 }).catch(() => {});
  const prose = (await explanation.count())
    ? await explanation.innerText()
    : "";
  await page.screenshot({ path: `${out}/e2e-2-after.png`, fullPage: true });
  expect(
    prose.trim().length > 40,
    `no explanation on the card (${prose.length} chars)`
  );

  // Counted last: a duplicate (the old garbled-tool-call bug) shows up late.
  const count = await cards.count();
  expect(count === 1, `expected exactly 1 diagnosis card, saw ${count}`);

  console.log(`url:      ${url}`);
  console.log(`prompt:   ${prompt}`);
  console.log(`verdict:  ${label ?? "none"}`);
  console.log(`cards:    ${count}`);
  console.log(`---CARD---\n${text.slice(0, 2000)}`);
} catch (e) {
  failures.push(`threw: ${e.message}`);
} finally {
  await browser.close();
}

if (failures.length) {
  console.log(
    "---LOGS---\n" +
      logs
        .filter((l) => !l.includes("[debug]"))
        .slice(-25)
        .join("\n")
  );
  console.log(`\ne2e: ${failures.length} failed`);
  for (const f of failures) console.log(`FAIL  ${f}`);
  process.exit(1);
}
console.log(`\ne2e: passed (screenshots in ${out})`);
