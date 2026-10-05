#!/usr/bin/env node
// Route smoke test. Boots `npm run dev:local` on a free port and asserts the status
// and response shape of every route in src/server.ts, plus the SPA fallback pages.
// The vitest suite only covers the pure helpers, so this is the only thing that
// catches a broken route table, a bad binding or an asset-less build.
// No dependencies on purpose: node's fetch and child_process are enough.
import { spawn } from "node:child_process";
import { createServer } from "node:net";

const ROOT = new URL("..", import.meta.url);
// A healthy check runs DNS, the edge, 5 regions, Globalping, Radar and a status page.
const CHECK_TIMEOUT = Number(process.env.SMOKE_TIMEOUT ?? 150_000);
// No INCONCLUSIVE: example.com is reliably reachable, and INCONCLUSIVE is what you get when no
// vantage answered at all — the broken-probe regression this test exists to catch.
const OK_VERDICTS = ["HEALTHY", "SLOW", "PARTIAL", "BLOCKED"];
// Reserved TLD: every resolver answers NXDOMAIN, so this needs no network luck.
const NXDOMAIN = "nope-isitme-smoke.example";

function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

const port = Number(process.env.SMOKE_PORT) || (await freePort());
// workerd's dev server binds ::1 only, so "localhost" answers and 127.0.0.1 does not.
const base = `http://localhost:${port}`;

const output = [];
const server = spawn(
  "npm",
  ["run", "dev:local", "--", "--port", String(port), "--strictPort"],
  { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] }
);
for (const stream of [server.stdout, server.stderr]) {
  stream.on("data", (d) => output.push(String(d)));
}

let stopped = false;
function stop() {
  if (stopped) return;
  stopped = true;
  server.kill("SIGTERM");
  // Vite leaves a workerd child behind if it doesn't get to shut down cleanly.
  setTimeout(() => server.kill("SIGKILL"), 5000).unref();
}
process.on("exit", stop);
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => process.exit(1));

async function waitReady() {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error("dev server exited");
    try {
      const res = await fetch(base + "/", {
        signal: AbortSignal.timeout(5000)
      });
      if (res.ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("dev server never answered /");
}

let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log(`ok    ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL  ${name}: ${e.message}`);
  }
}

function expect(cond, msg) {
  if (!cond) throw new Error(msg);
}

/** Fetch `path`, assert the status and content-type, and return the body. */
async function hit(
  path,
  { status = 200, type, method, body, accept, timeout } = {}
) {
  const res = await fetch(base + path, {
    method,
    body,
    headers: {
      ...(body && { "content-type": "application/json" }),
      ...(accept && { accept })
    },
    signal: AbortSignal.timeout(timeout ?? 30_000)
  });
  const text = await res.text();
  expect(
    res.status === status,
    `${path}: ${res.status} not ${status} (${text.slice(0, 200)})`
  );
  const ct = res.headers.get("content-type") ?? "";
  expect(
    !type || ct.includes(type),
    `${path}: content-type ${ct} is not ${type}`
  );
  if (!ct.includes("json")) return { res, text };
  try {
    return { res, text, json: JSON.parse(text) };
  } catch {
    throw new Error(`${path}: body is not JSON (${text.slice(0, 200)})`);
  }
}

const page = (path) =>
  test(`GET ${path}`, async () => {
    const { text } = await hit(path, { type: "text/html" });
    expect(text.includes('id="root"'), `${path}: not the SPA shell`);
  });

await waitReady();
console.log(`dev:local on ${base}\n`);

// --- /api/v1/check -----------------------------------------------------------
let ok;
await test("GET /api/v1/check (healthy site)", async () => {
  const { json } = await hit("/api/v1/check?url=example.com", {
    timeout: CHECK_TIMEOUT
  });
  expect(json.ok === true, `not ok: ${json.error}`);
  expect(OK_VERDICTS.includes(json.verdict), `odd verdict ${json.verdict}`);
  expect(json.host === "example.com", `host ${json.host}`);
  expect(typeof json.runId === "string" && json.runId.length > 10, "no runId");
  expect(typeof json.confidence === "number", "no confidence");
  expect(Array.isArray(json.signals) && json.signals.length > 0, "no signals");
  expect(typeof json.explanation === "string", "no explanation");
  expect(json.reportPath === `/r/example.com/${json.runId}`, "bad reportPath");
  ok = json;
});

await test("GET /api/v1/check (private address rejected)", async () => {
  const { json } = await hit("/api/v1/check?url=http://169.254.169.254", {
    status: 400
  });
  expect(json.ok === false && typeof json.error === "string", "no error");
});

await test("GET /api/v1/check (missing ?url=)", async () => {
  const { json } = await hit("/api/v1/check", { status: 400 });
  expect(json.error === "missing ?url=", `error was ${json.error}`);
});

await test("GET /api/v1/check (NXDOMAIN)", async () => {
  const { json } = await hit(`/api/v1/check?url=${NXDOMAIN}`, {
    timeout: CHECK_TIMEOUT
  });
  expect(json.verdict === "DNS_FAILURE", `verdict ${json.verdict}`);
  expect(json.subtype === "nxdomain", `subtype ${json.subtype}`);
});

// --- read-only JSON routes ---------------------------------------------------
await test("GET /api/host/:host", async () => {
  const { res, json } = await hit("/api/host/example.com");
  expect(json.host === "example.com", `host ${json.host}`);
  expect(Array.isArray(json.samples), "samples is not an array");
  expect("latest" in json, "no latest key");
  expect(
    res.headers.get("cache-control")?.includes("max-age=60"),
    "not cached for 60s"
  );
});

await test("GET /api/host/:host (bad host)", async () => {
  const { json } = await hit("/api/host/not%20a%20host", { status: 400 });
  expect(json.error === "bad host", `error ${json.error}`);
});

// The public-host guard is server-side, not just in the client: a name that reaches
// TARGET_DO.getByName() persists a Durable Object.
await test("host routes reject non-public hosts", async () => {
  for (const path of [
    "/api/host/localhost",
    "/api/host/aaaa",
    "/api/host/10.0.0.1",
    "/api/report/127.0.0.1/x",
    "/api/report/%5B::1%5D/x"
  ]) {
    const { json } = await hit(path, { status: 400 });
    expect(json.error === "bad host", `${path}: error ${json.error}`);
  }
  await hit("/badge/10.0.0.1.svg", { status: 400 });
  const { json } = await hit("/api/extra-check", {
    status: 400,
    method: "POST",
    body: JSON.stringify({ host: "localhost", reportId: "x" })
  });
  expect(json.error === "bad request", `extra-check: error ${json.error}`);
});

await test("GET /api/trends", async () => {
  const { json } = await hit("/api/trends");
  expect(Array.isArray(json), "not an array");
});

await test("POST /api/extra-check (validation failure)", async () => {
  const { json } = await hit("/api/extra-check", {
    status: 400,
    method: "POST",
    body: JSON.stringify({ host: "example.com" }) // no reportId, no browser probe
  });
  expect(json.error === "bad request", `error ${json.error}`);
});

await test("GET /badge/:host.svg", async () => {
  const { text } = await hit("/badge/example.com.svg", {
    type: "image/svg+xml"
  });
  expect(text.startsWith("<svg"), "not an SVG");
  expect(text.includes("isitme:"), "no badge label");
});

// --- reports ----------------------------------------------------------------
await test("GET /api/report/:host/:id", async () => {
  expect(ok, "the healthy check failed, so there is no report to read");
  const { json } = await hit(`/api/report/example.com/${ok.runId}`);
  expect(json.host === "example.com", `host ${json.host}`);
  expect(json.classification?.verdict === ok.verdict, "verdict disagrees");
  expect(json.evidence, "no evidence");
});

await test("GET /api/report/:host/:id.txt", async () => {
  expect(ok, "the healthy check failed, so there is no report to read");
  const { text } = await hit(`/api/report/example.com/${ok.runId}.txt`, {
    type: "text/plain"
  });
  expect(text.includes("example.com"), "bundle does not name the host");
});

await test("GET /api/report/:host/:id (unknown)", async () => {
  const { json } = await hit("/api/report/example.com/no-such-report", {
    status: 404
  });
  expect(json.error === "not found", `error ${json.error}`);
});

await test("GET /api/report/:host/:id.txt (unknown)", async () => {
  const { text } = await hit("/api/report/example.com/no-such-report.txt", {
    status: 404,
    type: "text/plain"
  });
  expect(text.trim() === "not found", `body ${text}`);
});

// --- MCP --------------------------------------------------------------------
await test("POST /mcp (no session)", async () => {
  const { text } = await hit("/mcp", {
    status: 400,
    method: "POST",
    // Streamable HTTP requires both; without them the transport answers 406 instead.
    accept: "application/json, text/event-stream",
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })
  });
  // The transport answers the error without a json content-type, so parse it here.
  const json = JSON.parse(text);
  expect(json.jsonrpc === "2.0", "not a JSON-RPC response");
  expect(
    /session/i.test(json.error?.message ?? ""),
    `error was ${json.error?.message}`
  );
});

// --- SPA pages --------------------------------------------------------------
for (const p of ["/", "/h/example.com", "/trending", "/c/example.com"]) {
  await page(p);
}

stop();
if (failed) {
  console.log(`\n${failed} failed\n--- dev server output ---`);
  console.log(output.join("").slice(-4000));
}
console.log(failed ? `\nsmoke: ${failed} failed` : "\nsmoke: all passed");
process.exit(failed ? 1 : 0);
