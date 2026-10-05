#!/usr/bin/env node
// IsItMe CLI. Zero dependencies: node:util, node:fs and global fetch only.
// An HTTP client of GET /api/v1/check (wait=1), nothing else: no agent, no
// WebSocket, no browser vantage.
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

/** Deployed Worker. The deploy phase edits this one line. */
export const DEFAULT_API =
  "https://cf-ai-isitme.patelkashishpatel032.workers.dev";

export const VERSION = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8")
).version;

const HELP = `isitme - is it down, or is it me?

Usage: isitme <domain or URL> [options]

Options:
  --expect <text>   the page must contain this text, or the verdict is PARTIAL
  --json            print the raw API response
  --api <base>      API base URL (default: $ISITME_API or ${DEFAULT_API})
  --timeout <s>     give up after this many seconds (default: 125)
  -h, --help        show this help
  -v, --version     show the version

Exit code: 0 when the site is HEALTHY or SLOW, 1 otherwise.

Examples:
  isitme github.com
  isitme https://example.com/login --expect "Sign in"
  isitme example.com --json | jq -r .verdict`;

const RESET = "\x1b[0m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";

/** Verdicts that mean "the site is fine for you". Everything else exits 1. */
const OK_VERDICTS = new Set(["HEALTHY", "SLOW"]);
/** Verdicts that are a warning rather than a failure, for colour only. */
const WARN_VERDICTS = new Set([
  "SLOW",
  "BLOCKED",
  "INCONCLUSIVE",
  "LIKELY_YOUR_NETWORK",
  "ISP_OUTAGE"
]);

/**
 * @param {string[]} args argv without node and the script path
 * @returns {{error: string} | {help: true} | {version: true} |
 *   {target: string, expect?: string, api: string, json: boolean, timeoutMs: number}}
 */
export function parseCliArgs(args, environment = {}) {
  let values, positionals;
  try {
    ({ values, positionals } = parseArgs({
      args,
      options: {
        json: { type: "boolean", default: false },
        api: { type: "string" },
        expect: { type: "string" },
        timeout: { type: "string" },
        help: { type: "boolean", short: "h", default: false },
        version: { type: "boolean", short: "v", default: false }
      },
      allowPositionals: true
    }));
  } catch (err) {
    return { error: err.message };
  }

  if (values.help) return { help: true };
  if (values.version) return { version: true };
  if (positionals.length === 0) return { error: "no target given" };
  if (positionals.length > 1) {
    return { error: `expected one target, got ${positionals.length}` };
  }

  let timeoutMs = 125_000;
  if (values.timeout !== undefined) {
    const s = Number(values.timeout);
    if (!Number.isFinite(s) || s <= 0) {
      return {
        error: `--timeout must be a positive number of seconds, got "${values.timeout}"`
      };
    }
    timeoutMs = Math.round(s * 1000);
  }

  const api = trimSlashes(values.api ?? environment.ISITME_API ?? DEFAULT_API);
  if (!/^https?:\/\/[^/\s]+$/.test(api)) {
    return { error: `--api must be an http(s) base URL, got "${api}"` };
  }
  if (values.expect === "") return { error: "--expect must not be empty" };

  return {
    target: positionals[0],
    expect: values.expect,
    api,
    json: values.json,
    timeoutMs
  };
}

function trimSlashes(base) {
  return base.replace(/\/+$/, "");
}

/** @returns {string} the /api/v1/check URL for this target. */
export function checkUrl(api, target, expect) {
  const q = new URLSearchParams({ url: target });
  if (expect) q.set("expect", expect);
  return `${trimSlashes(api)}/api/v1/check?${q}`;
}

/** @returns {0 | 1} */
export function exitCode(outcome) {
  return outcome.ok === true && OK_VERDICTS.has(outcome.verdict) ? 0 : 1;
}

/**
 * Renders a CheckOutcome for humans.
 * @param {object} outcome
 * @param {{color?: boolean, api?: string}} [opts]
 */
export function formatOutcome(outcome, opts = {}) {
  const api = trimSlashes(opts.api ?? DEFAULT_API);
  const paint = opts.color ? (c, s) => `${c}${s}${RESET}` : (_c, s) => s;

  if (outcome.ok !== true) {
    const where = outcome.host ? ` (${outcome.host})` : "";
    return paint(RED, `error: ${outcome.error ?? "unknown error"}`) + where;
  }

  const verdict = outcome.subtype
    ? `${outcome.verdict}/${outcome.subtype}`
    : outcome.verdict;
  const colour =
    outcome.verdict === "HEALTHY"
      ? GREEN
      : WARN_VERDICTS.has(outcome.verdict)
        ? YELLOW
        : RED;
  const pct = Math.round((outcome.confidence ?? 0) * 100);
  const lines = [
    `${paint(colour, verdict)}  ${outcome.host}  (confidence ${pct}%)`
  ];

  for (const signal of outcome.signals ?? []) lines.push(`  - ${signal}`);
  if (outcome.provider) lines.push(`  - served by ${outcome.provider}`);
  // The explanation is markdown (the LLM's and the template's both use **bold**);
  // this output is plain text.
  if (outcome.explanation)
    lines.push("", outcome.explanation.replace(/\*\*/g, ""));
  if (outcome.reportPath) lines.push("", `report: ${api}${outcome.reportPath}`);
  return lines.join("\n");
}

/**
 * Fetches a check. Never throws: network and protocol failures come back as
 * `{ ok: false, error }`, the same shape the API uses.
 */
export async function runCheck({ api, target, expect, timeoutMs }) {
  let res, body;
  try {
    res = await fetch(checkUrl(api, target, expect), {
      headers: {
        accept: "application/json",
        "user-agent": `isitme-cli/${VERSION}`
      },
      signal: AbortSignal.timeout(timeoutMs)
    });
    body = await res.text();
  } catch (err) {
    const reason =
      err.name === "TimeoutError" || err.name === "AbortError"
        ? `timed out after ${Math.round(timeoutMs / 1000)}s`
        : `cannot reach ${api}: ${err.message}`;
    return { ok: false, error: reason };
  }

  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    return {
      ok: false,
      error: `${api} returned HTTP ${res.status} and a non-JSON body`
    };
  }
  if (
    parsed === null ||
    typeof parsed !== "object" ||
    typeof parsed.ok !== "boolean"
  ) {
    return {
      ok: false,
      error: `${api} returned HTTP ${res.status} and an unexpected body`
    };
  }
  return parsed;
}

export async function main(argv, io = {}) {
  const out = io.out ?? ((s) => process.stdout.write(`${s}\n`));
  const err = io.err ?? ((s) => process.stderr.write(`${s}\n`));
  const color = io.color ?? Boolean(process.stdout.isTTY);

  const args = parseCliArgs(argv, io.env ?? process.env);
  if ("error" in args) {
    err(`isitme: ${args.error}\n\n${HELP}`);
    return 1;
  }
  if (args.help) {
    out(HELP);
    return 0;
  }
  if (args.version) {
    out(VERSION);
    return 0;
  }

  const outcome = await runCheck(args);
  if (args.json) out(JSON.stringify(outcome, null, 2));
  else {
    const text = formatOutcome(outcome, { color, api: args.api });
    if (outcome.ok === true) out(text);
    else err(text);
  }
  return exitCode(outcome);
}

// Run only as a program: importing this file (the tests do) must not check anything.
// realpathSync because npm installs the bin as a symlink.
if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exitCode = await main(process.argv.slice(2));
}
