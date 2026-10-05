import {
  callable,
  getCurrentAgent,
  type Connection,
  type ConnectionContext,
  type Schedule
} from "agents";
import { AIChatAgent, type OnChatMessageOptions } from "@cloudflare/ai-chat";
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  pruneMessages,
  stepCountIs,
  streamText,
  tool
} from "ai";
import { createWorkersAI } from "workers-ai-provider";
import { z } from "zod";
import { CheckInput } from "../shared/schemas";
import {
  assertSafeTarget,
  assertServerWrite,
  normalizeTarget
} from "../lib/guard";
import { dohLookup } from "../lib/probes";
import { clientIp, hashIp, netInfo } from "../lib/net";
import { parseBrowserProbe } from "../lib/browser-probe";
import {
  alertEmailRaw,
  canAddWatch,
  decideWatch,
  MAX_MUTE_MINUTES,
  muteUntil,
  notifyFor,
  WATCH_IDLE_MS
} from "../lib/alerts";
import { uptime } from "../lib/uptime";
import { buildDigest, type DigestWatchInput } from "../lib/digest";
import { LANGS, pickLang } from "../lib/lang";
import { EmailMessage } from "cloudflare:email";
import {
  INITIAL_AGENT_STATE,
  MAX_WATCHES_PER_IP,
  MIN_WATCH_MINUTES,
  CHAT_MODEL,
  STEP_ORDER,
  type AgentBroadcast,
  type AgentState,
  type Alert,
  type BrowserProbe,
  type CheckOutcome,
  type DiagnoseParams,
  type DiagnoseProgress,
  type DiagnoseResult,
  type Evidence,
  type ExportBundle,
  type ExtraCheck,
  type NetInfo,
  type Report,
  type ReportSummary,
  type RunPoll,
  type RunState,
  type RunTrigger,
  type StepName,
  type StepState,
  type Target,
  type UptimeStats,
  type Verdict,
  type Watch
} from "../shared/types";

type ReportRow = {
  id: string;
  host: string;
  created_at: number;
  verdict: string;
  confidence: number;
  trigger: string;
};

interface StartOptions {
  toolCallId?: string;
  watchId?: string;
  previousVerdict?: Verdict;
  wantsBrowser: boolean;
  voter?: string;
  expect?: string;
  lang?: string;
}

// Covers the workflow's worst case: parallel probes + browser wait + explain with one retry.
const RUN_WAIT_MS = 120_000;
const WEBHOOK_TIMEOUT_MS = 5000;
/** A run still "running" after this lost its terminal callback. */
const STALE_RUN_MS = 5 * 60_000;
const DAY_MS = 24 * 60 * 60_000;
// ponytail: fixed sender; Email Routing needs it on a zone you own, override with the EMAIL_FROM var.
const ALERT_FROM = "alerts@isitme.example";
const EMAIL = z.email().max(254);

type ConnState = { ip?: string };

/** Marks a run failed: running steps error out, pending ones are skipped. */
function failRun(r: RunState, error: string): RunState {
  return {
    ...r,
    status: "error",
    error,
    finishedAt: Date.now(),
    steps: Object.fromEntries(
      STEP_ORDER.map((name): [StepName, StepState] => {
        // Runs persisted before a step existed lack its key.
        const st = r.steps[name] ?? { status: "pending" };
        if (st.status === "running")
          return [name, { ...st, status: "error", error }];
        if (st.status === "pending") return [name, { status: "skipped" }];
        return [name, st];
      })
    ) as Record<StepName, StepState>
  };
}

/** Slack parses <!channel> and <url|label>; keep untrusted text inert. */
const escapeSlack = (t: string) =>
  t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const toOutcome = (report: Report): CheckOutcome => ({
  ok: true,
  runId: report.id,
  host: report.host,
  verdict: report.classification.verdict,
  subtype: report.classification.subtype,
  confidence: report.classification.confidence,
  signals: report.classification.signals,
  provider: report.evidence.provider?.name,
  explanation: report.explanation,
  reportPath: `/r/${report.host}/${report.id}`
});

const toSummary = (r: ReportRow): ReportSummary => ({
  id: r.id,
  host: r.host,
  createdAt: r.created_at,
  verdict: r.verdict as Verdict,
  confidence: r.confidence,
  trigger: r.trigger as RunTrigger
});

// ponytail: watch runs fire every few minutes, so they get a small share of the cap and never push chat cards out.
function capRuns(runs: RunState[]): RunState[] {
  let chat = 0;
  let other = 0;
  return runs.filter((r) => (r.trigger === "chat" ? chat++ < 15 : other++ < 5));
}

/** Webhooks are fetched server-side, so they get the same SSRF guard as targets, plus https-only. */
async function validateWebhook(
  input: string
): Promise<{ url: string } | { error: string }> {
  const t = normalizeTarget(input);
  if ("error" in t) return { error: `webhook: ${t.error}` };
  if (!t.url.startsWith("https:")) return { error: "webhook must be https" };
  let resolved: string[] = [];
  if (!t.isIpLiteral) {
    const dns = await dohLookup(t.host);
    if (!dns.ok) return { error: "webhook host does not resolve" };
    resolved = dns.addresses;
  }
  try {
    assertSafeTarget(t, resolved);
  } catch (e) {
    return { error: `webhook blocked: ${(e as Error).message}` };
  }
  // Re-run before every POST. ponytail: DNS rebinding in the gap before the fetch is not handled (same ceiling as the target guard).
  return { url: t.url };
}

/** One per device: name = deviceId (client), "api-<hashIp>" per API caller, or "mcp-<hash>" per MCP session. */
export class UserAgent extends AIChatAgent<Env, AgentState> {
  initialState: AgentState = INITIAL_AGENT_STATE;

  private waiters = new Map<string, (o: CheckOutcome) => void>();
  private browserProbes = new Map<string, BrowserProbe>();

  async onStart() {
    this.sql`CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY, host TEXT, created_at INTEGER, verdict TEXT,
      confidence REAL, trigger TEXT, json TEXT)`;
    this
      .sql`CREATE INDEX IF NOT EXISTS reports_host ON reports (host, created_at)`;
    // Pollable api/mcp runs (R16); outcome is CheckOutcome JSON, NULL while running.
    this.sql`CREATE TABLE IF NOT EXISTS api_runs (
      id TEXT PRIMARY KEY, host TEXT, created_at INTEGER, outcome TEXT)`;
    this.failStaleRuns();
  }

  /** Every field is written server-side only; clients get state, never set it. */
  validateStateChange(_next: AgentState, source: Connection | "server") {
    assertServerWrite(source);
  }

  async onConnect(connection: Connection, ctx: ConnectionContext) {
    connection.setState({ ip: clientIp(ctx.request) } satisfies ConnState);
    this.setState({
      ...this.state,
      user: netInfo(ctx.request),
      origin: new URL(ctx.request.url).origin,
      // Kept once set: a later connect must not undo the user's pick.
      lang:
        this.state.lang ??
        pickLang(ctx.request.headers.get("accept-language") ?? undefined)
    });
    await this.ctx.storage.put("lastSeenAt", Date.now());
    if (this.state.watches.length)
      await this.env.TRENDS_DO.getByName("global")
        .touchWatches(this.state.watches.map((w) => this.claimId(w.id)))
        .catch(() => {});
  }

  async onChatMessage(_onFinish: unknown, options?: OnChatMessageOptions) {
    // Device ids are client-made, so the IP limit is the one that holds.
    const ip = (getCurrentAgent().connection?.state as ConnState | null)?.ip;
    const [device, byIp] = await Promise.all([
      this.env.RATE_LIMITER.limit({ key: `chat:${this.name}` }),
      ip
        ? this.env.RATE_LIMITER.limit({ key: `chat-ip:${ip}` })
        : { success: true }
    ]);
    if (!device.success || !byIp.success) {
      return createUIMessageStreamResponse({
        stream: createUIMessageStream({
          execute: ({ writer }) => {
            const id = crypto.randomUUID();
            writer.write({ type: "text-start", id });
            writer.write({
              type: "text-delta",
              id,
              delta: "You're sending messages too fast. Try again in a minute."
            });
            writer.write({ type: "text-end", id });
          }
        })
      });
    }

    const workersai = createWorkersAI({ binding: this.env.AI });
    const result = streamText({
      model: workersai(CHAT_MODEL, { sessionAffinity: this.sessionAffinity }),
      system: this.systemPrompt(),
      messages: pruneMessages({
        messages: await convertToModelMessages(this.messages),
        toolCalls: "before-last-2-messages"
      }),
      tools: this.tools(ip ? await hashIp(ip) : undefined),
      stopWhen: stepCountIs(5),
      abortSignal: options?.abortSignal
    });
    return result.toUIMessageStreamResponse({
      onError: (e) => {
        console.error("[chat] model call failed", e);
        return "The AI model is unavailable right now. You can still check a site with GET /api/v1/check?url=…";
      }
    });
  }

  private systemPrompt() {
    const { user, watches } = this.state;
    const net = user
      ? [
          user.asn &&
            `AS${user.asn}${user.asOrganization ? ` (${user.asOrganization})` : ""}`,
          user.city,
          user.country,
          user.colo && `Cloudflare colo ${user.colo}`
        ]
          .filter(Boolean)
          .join(", ") || "unknown"
      : "unknown";
    const watchLines = watches.length
      ? watches
          .map(
            (w) =>
              `- ${w.host} every ${w.intervalMinutes} min, last ${w.lastVerdict ?? "not checked yet"}${w.webhookUrl ? ", webhook set" : ""}${w.email ? ", email set" : ""}${w.mutedUntil && w.mutedUntil > Date.now() ? `, muted until ${new Date(w.mutedUntil).toISOString().slice(0, 16)}Z` : ""}`
          )
          .join("\n")
      : "none";
    const recent = this.state.history
      .slice(0, 5)
      .map(
        (h) =>
          `- ${h.host}: ${h.verdict} (${Math.round(h.confidence * 100)}%) ${new Date(h.createdAt).toISOString().slice(0, 16)}Z`
      )
      .join("\n");

    return `You are IsItMe. You tell people whether a website is down for everyone, down in some regions, or only failing on their own connection.
Today is ${new Date().toISOString().slice(0, 10)}.

Rules:
- When the user names a site or URL to check, call diagnose with it. Don't ask first.
- After diagnose returns, reply in ONE short sentence that names the verdict in plain words (e.g. "github.com is up everywhere, including from your network."). A card already shows the evidence and explanation: never quote numbers, timings or signals.
- If diagnose returns ok=false, say briefly why. If the error says the check is still running, say the card will update when it finishes; don't call it a failure.
- Use watch to monitor a site, unwatch to stop, history for past checks, setWebhook for Slack/Discord alerts, setEmail for email alerts, mute to silence a watch's alerts for a while (maintenance).
- Never invent probe results. Only state facts that tools returned.
- For unrelated requests, say in one sentence what you can do.

User's network: ${net}
Watches:
${watchLines}
Recent checks:
${recent || "none"}`;
  }

  private tools(voter?: string) {
    return {
      diagnose: tool({
        description:
          "Check if a website is down, and whether the problem is the site, a region, or the user's own network.",
        inputSchema: CheckInput,
        execute: async (
          { url, expect },
          { toolCallId }
        ): Promise<CheckOutcome> => {
          const target = normalizeTarget(url);
          if ("error" in target) return { ok: false, error: target.error };
          // An https page can't probe an http:// target (mixed content), so don't ask.
          const runId = await this.startRun(
            target,
            this.state.user ?? {},
            "chat",
            {
              toolCallId,
              wantsBrowser: target.url.startsWith("https:"),
              voter,
              expect
            }
          );
          return this.waitForRun(runId, target.host);
        },
        // The card shows everything; the model only needs enough to name the verdict.
        toModelOutput: ({ output }) => ({
          type: "json",
          value: output.ok
            ? {
                ok: true,
                host: output.host,
                verdict: output.verdict,
                confidence: output.confidence,
                provider: output.provider ?? null
              }
            : { ok: false, host: output.host ?? null, error: output.error }
        })
      }),
      watch: tool({
        description:
          "Monitor a website on a schedule and alert when its status changes.",
        inputSchema: CheckInput.extend({
          everyMinutes: z.coerce
            .number()
            .int()
            .max(1440)
            .default(5)
            .describe("Check interval in minutes"),
          webhookUrl: z
            .string()
            .nullish()
            .describe("Optional Slack/Discord webhook URL"),
          until: z
            .enum(["recovered"])
            .optional()
            .describe("Stop watching after the site recovers"),
          email: z
            .string()
            .nullish()
            .describe("Optional email address for alerts")
        }),
        execute: async ({
          url,
          expect,
          everyMinutes,
          webhookUrl,
          until,
          email
        }) => {
          const target = normalizeTarget(url);
          if ("error" in target) return { ok: false, error: target.error };
          const mail = email ? EMAIL.safeParse(email.trim()) : undefined;
          if (mail && !mail.success)
            return { ok: false, error: "invalid email address" };
          let hook: string | undefined;
          if (webhookUrl) {
            const v = await validateWebhook(webhookUrl);
            if ("error" in v) return { ok: false, error: v.error };
            hook = v.url;
          }
          const watch = await this.addWatch(
            target,
            Math.max(everyMinutes, MIN_WATCH_MINUTES),
            voter,
            hook,
            expect,
            until,
            mail?.data
          );
          if ("error" in watch) return { ok: false, error: watch.error };
          return {
            ok: true,
            watchId: watch.id,
            host: watch.host,
            everyMinutes: watch.intervalMinutes,
            until: watch.until,
            email: watch.email
          };
        }
      }),
      unwatch: tool({
        description: "Stop monitoring a website.",
        inputSchema: z.object({
          hostOrId: z.string().describe("Domain or watch id")
        }),
        execute: async ({ hostOrId }) => {
          const matches = this.findWatches(hostOrId);
          for (const w of matches) await this.removeWatch(w.id);
          return { ok: matches.length > 0, removed: matches.length };
        }
      }),
      history: tool({
        description: "List the user's past checks, newest first.",
        inputSchema: z.object({
          host: z.string().nullish().describe("Only this domain"),
          limit: z.coerce.number().int().min(1).max(20).default(10)
        }),
        execute: async ({ host, limit }) => this.listReports(host, limit)
      }),
      setWebhook: tool({
        description:
          "Set or clear the Slack/Discord webhook for a watched website.",
        inputSchema: z.object({
          hostOrId: z.string().describe("Watched domain or watch id"),
          webhookUrl: z
            .string()
            .nullable()
            .describe("Webhook URL, or null to clear")
        }),
        execute: async ({ hostOrId, webhookUrl }) => {
          const w = this.findWatches(hostOrId)[0];
          if (!w) return { ok: false, error: "no such watch" };
          let hook: string | undefined;
          if (webhookUrl) {
            const v = await validateWebhook(webhookUrl);
            if ("error" in v) return { ok: false, error: v.error };
            hook = v.url;
          }
          this.setState({
            ...this.state,
            watches: this.state.watches.map((x) =>
              x.id === w.id ? { ...x, webhookUrl: hook } : x
            )
          });
          return { ok: true, watchId: w.id };
        }
      }),
      setEmail: tool({
        description:
          "Set or clear the alert email address for a watched website. Delivery only works to verified addresses.",
        inputSchema: z.object({
          hostOrId: z.string().describe("Watched domain or watch id"),
          email: z
            .string()
            .nullable()
            .describe("Email address, or null to clear")
        }),
        execute: async ({ hostOrId, email }) => {
          const w = this.findWatches(hostOrId)[0];
          if (!w) return { ok: false, error: "no such watch" };
          const mail = email ? EMAIL.safeParse(email.trim()) : undefined;
          if (mail && !mail.success)
            return { ok: false, error: "invalid email address" };
          this.patchWatch(w.id, { email: mail?.data });
          return { ok: true, watchId: w.id, email: mail?.data ?? null };
        }
      }),
      mute: tool({
        description:
          "Silence a watch's alerts for some minutes (maintenance window). Checks keep running. 0 unmutes.",
        inputSchema: z.object({
          hostOrId: z.string().describe("Watched domain or watch id"),
          minutes: z.coerce
            .number()
            .int()
            .min(0)
            .max(MAX_MUTE_MINUTES)
            .describe("Minutes to mute, max 7 days; 0 clears")
        }),
        execute: async ({ hostOrId, minutes }) => {
          const w = this.findWatches(hostOrId)[0];
          if (!w) return { ok: false, error: "no such watch" };
          return this.muteWatch(w.id, minutes);
        }
      })
    };
  }

  // ── Client (@callable, via agent.stub.*) ──

  @callable()
  async submitBrowserProbe(runId: string, probe: unknown): Promise<void> {
    const run = this.state.runs.find((r) => r.id === runId);
    if (!run?.wantsBrowser || this.browserProbes.has(runId)) return;
    const parsed = parseBrowserProbe(probe);
    if (!parsed.ok || !parsed.probe) return;
    const clean = parsed.probe;
    this.browserProbes.set(runId, clean);
    if (run.status !== "running") return;
    try {
      await this.sendWorkflowEvent("DIAGNOSE_WORKFLOW", runId, {
        type: "browser-probe",
        payload: clean
      });
    } catch {
      // The workflow may not be waiting yet; it reads getBrowserProbe first.
    }
  }

  @callable()
  async unwatch(watchId: string): Promise<boolean> {
    return this.removeWatch(watchId);
  }

  @callable()
  async muteWatch(
    watchId: string,
    minutes: number
  ): Promise<{ ok: boolean; mutedUntil?: number; error?: string }> {
    if (!this.state.watches.some((w) => w.id === watchId))
      return { ok: false, error: "no such watch" };
    if (!Number.isFinite(minutes)) return { ok: false, error: "bad minutes" };
    const mutedUntil = muteUntil(minutes, Date.now());
    this.patchWatch(watchId, { mutedUntil });
    return { ok: true, mutedUntil };
  }

  @callable()
  async getUptime(watchId: string, days = 7): Promise<UptimeStats | null> {
    const watch = this.state.watches.find((w) => w.id === watchId);
    if (!watch) return null;
    const d = Math.min(Math.max(1, Math.floor(Number(days) || 7)), 30);
    const since = Date.now() - d * DAY_MS;
    return uptime(this.watchRows(watch.host, since), watchId, d);
  }

  /** Watch runs for a host since `since`, newest first. Shared by getUptime and the digest. */
  private watchRows(
    host: string,
    since: number
  ): Array<{ verdict: Verdict; evidence?: Evidence }> {
    const rows = this.sql<{ verdict: string; json: string }>`
      SELECT verdict, json FROM reports
      WHERE host = ${host} AND trigger = 'watch' AND created_at >= ${since}
      ORDER BY created_at DESC`;
    return rows.map((r) => {
      try {
        return {
          verdict: r.verdict as Verdict,
          evidence: (JSON.parse(r.json) as Report).evidence
        };
      } catch {
        return { verdict: r.verdict as Verdict };
      }
    });
  }

  @callable()
  async getReport(reportId: string): Promise<Report | null> {
    const [row] = this.sql<{ host: string; json: string }>`
      SELECT host, json FROM reports WHERE id = ${reportId}`;
    if (!row) return null;
    try {
      const live = await this.env.TARGET_DO.getByName(row.host).getReport(
        reportId
      );
      if (live) return live;
    } catch {
      // fall back to our own copy
    }
    return JSON.parse(row.json) as Report;
  }

  @callable()
  async exportData(): Promise<ExportBundle> {
    const { watches, alerts, history } = this.state;
    return { exportedAt: Date.now(), watches, alerts, history };
  }

  /** Overrides the Accept-Language guess; only the explanation is translated, verdicts stay English. */
  @callable()
  async setLang(lang: string): Promise<{ ok: boolean; lang: string }> {
    if (!LANGS.includes(lang))
      return { ok: false, lang: this.state.lang ?? "en" };
    this.setState({ ...this.state, lang });
    return { ok: true, lang };
  }

  @callable()
  async markAlertsRead(): Promise<void> {
    this.setState({
      ...this.state,
      alerts: this.state.alerts.map((a) => (a.read ? a : { ...a, read: true }))
    });
  }

  // ── Worker / workflow RPC (via getAgentByName or this.agent) ──

  /** Full pipeline, resolves when the workflow completes (or RUN_WAIT_MS timeout). Used by /api/v1/check and MCP. */
  async checkNow(
    input: string,
    user: NetInfo,
    trigger: "api" | "mcp",
    opts: { expect?: string; lang?: string } = {}
  ): Promise<CheckOutcome> {
    const started = await this.startCheck(input, user, trigger, opts);
    if (!started.ok) return started;
    return this.waitForRun(started.runId, started.host);
  }

  /** Starts a run and returns at once; poll with getRun (R16). */
  async startCheck(
    input: string,
    user: NetInfo,
    trigger: "api" | "mcp",
    opts: { expect?: string; lang?: string } = {}
  ): Promise<
    | { ok: true; runId: string; host: string }
    | { ok: false; host?: string; error: string }
  > {
    const target = normalizeTarget(String(input));
    if ("error" in target) return { ok: false, error: target.error };
    try {
      const runId = await this.startRun(target, user, trigger, {
        wantsBrowser: false,
        expect: opts.expect,
        lang: opts.lang
      });
      return { ok: true, runId, host: target.host };
    } catch (e) {
      return { ok: false, host: target.host, error: (e as Error).message };
    }
  }

  /** Only runs this agent started are visible, so a leaked run id is useless to other callers. */
  async getRun(runId: string): Promise<RunPoll | null> {
    const [row] = this.sql<{
      host: string;
      created_at: number;
      outcome: string | null;
    }>`SELECT host, created_at, outcome FROM api_runs WHERE id = ${runId}`;
    if (!row) return null;
    if (row.outcome) return JSON.parse(row.outcome) as CheckOutcome;
    if (Date.now() - row.created_at > STALE_RUN_MS)
      return {
        ok: false,
        runId,
        host: row.host,
        error: "lost track of this run"
      };
    return { status: "running", runId, host: row.host };
  }

  async getBrowserProbe(runId: string): Promise<BrowserProbe | null> {
    return this.browserProbes.get(runId) ?? null;
  }

  async onExtraCheck(
    host: string,
    reportId: string,
    check: ExtraCheck
  ): Promise<void> {
    this.broadcast(
      JSON.stringify({
        type: "extra-check",
        reportId,
        host,
        check
      } satisfies AgentBroadcast)
    );
  }

  // ── Schedule callback ──

  async checkWatch(
    payload: { watchId: string },
    schedule?: Schedule<{ watchId: string }>
  ): Promise<void> {
    const watch = this.state.watches.find((w) => w.id === payload.watchId);
    if (!watch) {
      if (schedule) await this.cancelSchedule(schedule.id);
      return;
    }
    // Watches outlive the tab, not the user: nobody connected for WATCH_IDLE_MS ends them.
    const seen = await this.ctx.storage.get<number>("lastSeenAt");
    if (seen === undefined)
      await this.ctx.storage.put("lastSeenAt", Date.now());
    else if (Date.now() - seen > WATCH_IDLE_MS) {
      await this.removeWatch(watch.id);
      return;
    }
    await this.ensureDigest();
    // A run whose terminal callback was lost must not block the watch forever.
    this.failStaleRuns();
    const busy = this.state.runs.some(
      (r) => r.watchId === watch.id && r.status === "running"
    );
    if (busy) return;
    const target = normalizeTarget(watch.url);
    if ("error" in target) return;
    await this.startRun(target, this.state.user ?? {}, "watch", {
      watchId: watch.id,
      previousVerdict: watch.lastVerdict,
      wantsBrowser: false,
      expect: watch.expect
    });
  }

  /**
   * One daily summary per destination: uptime, incidents, slowest site. Never probes and never
   * an alert, so mutes, incident state and lastVerdict are untouched.
   */
  async dailyDigest(): Promise<void> {
    const now = Date.now();
    const since = now - DAY_MS;
    const { watches, alerts } = this.state;
    const rows = watches.map((w) => ({
      watch: w,
      input: {
        watchId: w.id,
        host: w.host,
        rows: this.watchRows(w.host, since),
        incidents: alerts.filter(
          (a) => a.watchId === w.id && a.kind === "down" && a.at >= since
        ).length
      }
    }));
    this.setState({ ...this.state, lastDigestAt: now });
    // Destinations are per watch, so a digest covers only the watches that named it:
    // one summary per destination, over that destination's watches alone.
    const digests = (pick: (w: Watch) => string | undefined) => {
      const by = new Map<string, DigestWatchInput[]>();
      for (const { watch, input } of rows) {
        const to = pick(watch);
        if (to) by.set(to, [...(by.get(to) ?? []), input]);
      }
      return [...by].flatMap(([to, inputs]) => {
        const built = buildDigest(inputs, now);
        return built ? [{ to, built }] : [];
      });
    };
    for (const { to, built } of digests((w) => w.email)) {
      const n = built.summary.watches.length;
      await this.emailAlert(
        to,
        `IsItMe digest: ${n} site${n === 1 ? "" : "s"}`,
        `${built.text}\n`
      );
    }
    for (const { to, built } of digests((w) => w.webhookUrl))
      await this.postWebhook(to, built.text, {
        kind: "digest",
        at: now,
        hours: built.summary.hours
      });
  }

  // ── Workflow callbacks ──

  async onWorkflowProgress(
    _workflowName: string,
    workflowId: string,
    progress: unknown
  ): Promise<void> {
    const p = progress as DiagnoseProgress;
    if (!p?.step) return;
    this.updateRun(workflowId, (r) => ({
      ...r,
      steps: { ...r.steps, [p.step]: { ...r.steps[p.step], ...p.state } }
    }));
  }

  async onWorkflowComplete(
    _workflowName: string,
    workflowId: string,
    result?: unknown
  ): Promise<void> {
    const { report } = result as DiagnoseResult;
    const { verdict, confidence } = report.classification;
    const reportPath = `/r/${report.host}/${report.id}`;
    const outcome = toOutcome(report);
    const summary: ReportSummary = {
      id: report.id,
      host: report.host,
      createdAt: report.createdAt,
      verdict,
      confidence,
      trigger: report.trigger
    };

    this
      .sql`INSERT OR REPLACE INTO reports (id, host, created_at, verdict, confidence, trigger, json)
      VALUES (${report.id}, ${report.host}, ${report.createdAt}, ${verdict}, ${confidence}, ${report.trigger}, ${JSON.stringify(report)})`;
    this.browserProbes.delete(workflowId);

    if (report.trigger === "api" || report.trigger === "mcp") {
      // Server shards have no user to show history to: resolve, then keep a day of rows.
      const cutoff = Date.now() - DAY_MS;
      this.sql`DELETE FROM reports WHERE created_at < ${cutoff}`;
      this.sql`DELETE FROM api_runs WHERE created_at < ${cutoff}`;
      this
        .sql`UPDATE api_runs SET outcome = ${JSON.stringify(outcome)} WHERE id = ${workflowId}`;
      this.deleteWorkflows({
        status: ["complete", "errored", "terminated"],
        createdBefore: new Date(cutoff)
      });
      this.resolveRun(workflowId, outcome);
      return;
    }

    // Synchronous read-modify-write: run, history, watch and alert in one setState.
    const s = this.state;
    const run = s.runs.find((r) => r.id === workflowId);
    const watchId =
      run?.watchId ??
      (this.getWorkflow(workflowId)?.metadata?.watchId as string | undefined);
    const watch =
      report.trigger === "watch"
        ? s.watches.find((w) => w.id === watchId)
        : undefined;
    // The SDK calls this from a retried workflow step (at least once). The setState below persists
    // lastReportId / run status atomically with the watch decision, so a replay must not decide again.
    if (run?.status === "done" || (watch && watch.lastReportId === report.id)) {
      this.resolveRun(workflowId, outcome);
      return;
    }
    const decided = watch
      ? decideWatch(watch, verdict, () => crypto.randomUUID())
      : undefined;
    // Muted: decideWatch still advanced the state; only the notification is dropped.
    const muted =
      watch && decided ? notifyFor(watch, decided, Date.now()) : undefined;
    const decision =
      decided && muted ? { ...decided, watch: muted.watch } : undefined;
    const fired = decision?.alert;
    const update = decision?.incidentUpdate;
    const notify = muted?.notify ?? false;
    let alert: Alert | undefined;
    if (watch && fired && notify) {
      alert = {
        id: crypto.randomUUID(),
        watchId: watch.id,
        host: watch.host,
        at: Date.now(),
        kind: fired.kind,
        incidentId: fired.incidentId,
        from: fired.from,
        to: fired.to,
        reportId: report.id,
        summary:
          report.explanation.slice(0, 400) ||
          report.classification.signals.slice(0, 2).join("; ") ||
          `${fired.from ?? "?"} → ${verdict}`,
        read: false,
        // Updated to sent/failed once the POST settles, so nothing shows "failed" mid-flight.
        webhook: "none"
      };
    }
    this.setState({
      ...s,
      runs: s.runs.map((r) =>
        r.id === workflowId
          ? {
              ...r,
              status: "done",
              finishedAt: Date.now(),
              verdict,
              confidence
            }
          : r
      ),
      history: [summary, ...s.history.filter((h) => h.id !== report.id)].slice(
        0,
        50
      ),
      watches: decision
        ? s.watches.map((w) =>
            w.id === decision.watch.id
              ? {
                  ...decision.watch,
                  lastCheckedAt: Date.now(),
                  lastReportId: report.id
                }
              : w
          )
        : s.watches,
      alerts: alert
        ? [alert, ...s.alerts].slice(0, 50)
        : update
          ? s.alerts.map((a) =>
              a.incidentId === update.incidentId && a.kind === "down"
                ? { ...a, to: update.to, reportId: report.id }
                : a
            )
          : s.alerts
    });

    this.resolveRun(workflowId, outcome);

    // The busy check in checkWatch keeps the confirm run from overlapping a scheduled one.
    if (watch && decision?.confirm)
      await this.schedule(60, "checkWatch", { watchId: watch.id });
    if (
      watch &&
      fired &&
      !notify &&
      fired.kind === "recovered" &&
      watch.until === "recovered"
    )
      await this.removeWatch(watch.id);
    if (!alert || !watch) return;
    const change =
      alert.kind === "recovered" ? "is back up" : `is DOWN (${alert.to})`;
    const reportUrl = (this.state.origin ?? "") + reportPath;
    if (watch.email)
      await this.emailAlert(
        watch.email,
        `IsItMe: ${alert.host} ${change}`,
        `${alert.host} ${change}.\n\n${alert.summary}\n\nReport: ${reportUrl}\n`
      );
    if (watch.webhookUrl) {
      const sent = await this.postWebhook(
        watch.webhookUrl,
        `IsItMe: ${alert.host} ${change}. ${alert.summary} ${reportUrl}`,
        {
          host: alert.host,
          kind: alert.kind ?? null,
          from: alert.from ?? null,
          to: alert.to,
          reportUrl
        }
      );
      const done: Alert = { ...alert, webhook: sent ? "sent" : "failed" };
      alert = done;
      this.setState({
        ...this.state,
        alerts: this.state.alerts.map((a) => (a.id === done.id ? done : a))
      });
    }
    this.broadcast(
      JSON.stringify({ type: "alert", alert } satisfies AgentBroadcast)
    );
    if (alert.kind === "recovered" && watch.until === "recovered")
      await this.removeWatch(watch.id);
  }

  async onWorkflowError(
    _workflowName: string,
    workflowId: string,
    error: string
  ): Promise<void> {
    this.browserProbes.delete(workflowId);
    const run = this.updateRun(workflowId, (r) => failRun(r, error));
    const [apiRun] = this.sql<{ host: string }>`
      SELECT host FROM api_runs WHERE id = ${workflowId}`;
    const outcome: CheckOutcome = {
      ok: false,
      runId: workflowId,
      host: run?.host ?? apiRun?.host,
      error
    };
    if (apiRun)
      this
        .sql`UPDATE api_runs SET outcome = ${JSON.stringify(outcome)} WHERE id = ${workflowId}`;
    this.resolveRun(workflowId, outcome);
  }

  /** One setState for every run stuck in "running" past STALE_RUN_MS (lost callback, restart). */
  private failStaleRuns() {
    const now = Date.now();
    const stale = this.state.runs.filter(
      (r) => r.status === "running" && now - r.startedAt > STALE_RUN_MS
    );
    if (!stale.length) return;
    const ids = new Set(stale.map((r) => r.id));
    const error = "lost track of this run";
    this.setState({
      ...this.state,
      runs: this.state.runs.map((r) => (ids.has(r.id) ? failRun(r, error) : r))
    });
    for (const r of stale) {
      this.browserProbes.delete(r.id);
      this.resolveRun(r.id, { ok: false, runId: r.id, host: r.host, error });
    }
  }

  // ── Internals ──

  private async startRun(
    target: Target,
    user: NetInfo,
    trigger: RunTrigger,
    opts: StartOptions
  ): Promise<string> {
    const runId = crypto.randomUUID();
    const steps = Object.fromEntries(
      STEP_ORDER.map((name): [StepName, StepState] => [
        name,
        {
          status:
            name === "browser" && !opts.wantsBrowser ? "skipped" : "pending"
        }
      ])
    ) as Record<StepName, StepState>;
    const run: RunState = {
      id: runId,
      host: target.host,
      url: target.url,
      trigger,
      toolCallId: opts.toolCallId,
      watchId: opts.watchId,
      wantsBrowser: opts.wantsBrowser,
      status: "running",
      steps,
      startedAt: Date.now()
    };
    // Server agents (api/mcp) have no client watching: skip the synced state; api_runs makes them pollable.
    if (trigger === "chat" || trigger === "watch") {
      this.setState({
        ...this.state,
        runs: capRuns([run, ...this.state.runs])
      });
    } else {
      this
        .sql`INSERT INTO api_runs (id, host, created_at, outcome) VALUES (${runId}, ${target.host}, ${run.startedAt}, NULL)`;
    }

    const params: DiagnoseParams = {
      runId,
      target,
      user,
      trigger,
      ownerId: this.name,
      wantsBrowser: opts.wantsBrowser,
      watchId: opts.watchId,
      voter: opts.voter,
      previousVerdict: opts.previousVerdict,
      expect: opts.expect,
      lang: opts.lang ?? this.state.lang ?? undefined
    };
    try {
      await this.runWorkflow("DIAGNOSE_WORKFLOW", params, {
        id: runId,
        metadata: { host: target.host, trigger, watchId: opts.watchId ?? null }
      });
    } catch (e) {
      await this.onWorkflowError(
        "DIAGNOSE_WORKFLOW",
        runId,
        `could not start: ${(e as Error).message}`
      );
      throw e;
    }
    return runId;
  }

  private waitForRun(runId: string, host: string): Promise<CheckOutcome> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.waiters.delete(runId);
        resolve({
          ok: false,
          runId,
          host,
          error:
            "still running after 2 minutes; the result will appear in the card and report when it finishes"
        });
      }, RUN_WAIT_MS);
      this.waiters.set(runId, (o) => {
        clearTimeout(timer);
        resolve(o);
      });
    });
  }

  private resolveRun(runId: string, outcome: CheckOutcome) {
    const resolve = this.waiters.get(runId);
    this.waiters.delete(runId);
    resolve?.(outcome);
  }

  private updateRun(
    id: string,
    fn: (r: RunState) => RunState
  ): RunState | undefined {
    const run = this.state.runs.find((r) => r.id === id);
    if (!run) return undefined;
    const next = fn(run);
    this.setState({
      ...this.state,
      runs: this.state.runs.map((r) => (r.id === id ? next : r))
    });
    return next;
  }

  private findWatches(hostOrId: string): Watch[] {
    const key = hostOrId.trim().toLowerCase();
    const t = normalizeTarget(hostOrId);
    const host = "error" in t ? key : t.host;
    return this.state.watches.filter(
      (w) => w.id.toLowerCase() === key || w.host === host
    );
  }

  /** Watch ids are per device; the quota table spans every device. */
  private claimId(watchId: string) {
    return `${this.name}:${watchId}`;
  }

  private async addWatch(
    target: Target,
    everyMinutes: number,
    voter: string | undefined,
    webhookUrl?: string,
    expect?: string,
    until?: "recovered",
    email?: string
  ): Promise<Watch | { error: string }> {
    const limit = canAddWatch(this.state.watches, target.host);
    if (limit) return { error: limit };
    const existing = this.state.watches.find((w) => w.host === target.host);
    if (existing) await this.removeWatch(existing.id);
    const id = crypto.randomUUID().slice(0, 8);
    // Device ids are free to mint, so the quota that holds is per IP.
    const claimed = await this.env.TRENDS_DO.getByName("global").claimWatch(
      voter ?? "unknown",
      this.claimId(id),
      MAX_WATCHES_PER_IP
    );
    if (!claimed)
      return {
        error: `watch limit reached for your network (${MAX_WATCHES_PER_IP})`
      };
    const schedule = await this.scheduleEvery(everyMinutes * 60, "checkWatch", {
      watchId: id
    });
    const watch: Watch = {
      id,
      host: target.host,
      url: target.url,
      intervalMinutes: everyMinutes,
      scheduleId: schedule.id,
      webhookUrl,
      expect,
      until,
      email,
      createdAt: Date.now()
    };
    this.setState({ ...this.state, watches: [...this.state.watches, watch] });
    await this.ensureDigest();
    return watch;
  }

  private patchWatch(watchId: string, patch: Partial<Watch>) {
    this.setState({
      ...this.state,
      watches: this.state.watches.map((w) =>
        w.id === watchId ? { ...w, ...patch } : w
      )
    });
  }

  private async removeWatch(watchId: string): Promise<boolean> {
    const watch = this.state.watches.find((w) => w.id === watchId);
    if (!watch) return false;
    this.setState({
      ...this.state,
      watches: this.state.watches.filter((w) => w.id !== watchId)
    });
    await this.cancelSchedule(watch.scheduleId);
    if (!this.state.watches.length) await this.stopDigest();
    await this.env.TRENDS_DO.getByName("global")
      .releaseWatch(this.claimId(watchId))
      .catch(() => {});
    return true;
  }

  /** Exactly one daily digest schedule lives as long as a watch does; the id survives restarts in state. */
  private async ensureDigest() {
    if (this.state.digestScheduleId || !this.state.watches.length) return;
    const s = await this.scheduleEvery(DAY_MS / 1000, "dailyDigest");
    this.setState({ ...this.state, digestScheduleId: s.id });
  }

  private async stopDigest() {
    const id = this.state.digestScheduleId;
    if (!id) return;
    this.setState({ ...this.state, digestScheduleId: null });
    await this.cancelSchedule(id);
  }

  private listReports(host?: string | null, limit = 10): ReportSummary[] {
    const n = Math.min(Math.max(1, limit), 20);
    let rows: ReportRow[];
    if (host) {
      const t = normalizeTarget(host);
      const h = "error" in t ? host.trim().toLowerCase() : t.host;
      rows = this
        .sql<ReportRow>`SELECT id, host, created_at, verdict, confidence, trigger
        FROM reports WHERE host = ${h} ORDER BY created_at DESC LIMIT ${n}`;
    } else {
      rows = this
        .sql<ReportRow>`SELECT id, host, created_at, verdict, confidence, trigger
        FROM reports ORDER BY created_at DESC LIMIT ${n}`;
    }
    return rows.map(toSummary);
  }

  /** Never throws. Cloudflare delivers only to verified destination addresses; local dev just logs it. */
  private async emailAlert(to: string, subject: string, body: string) {
    if (!this.env.EMAIL) return;
    const from =
      (this.env as Env & { EMAIL_FROM?: string }).EMAIL_FROM || ALERT_FROM;
    try {
      await this.env.EMAIL.send(
        new EmailMessage(from, to, alertEmailRaw(from, to, subject, body))
      );
    } catch (e) {
      console.warn(`[email] ${(e as Error).message}`);
    }
  }

  private async postWebhook(
    url: string,
    message: string,
    payload: Record<string, unknown>
  ): Promise<boolean> {
    // Checked once at watch creation isn't enough: the host's DNS can move to a private address later.
    const v = await validateWebhook(url);
    if ("error" in v) {
      console.warn(`[webhook] refused: ${v.error}`);
      return false;
    }
    const text = escapeSlack(message).slice(0, 1900);
    try {
      const res = await fetch(v.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, content: text, ...payload }),
        redirect: "manual",
        signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS)
      });
      await res.body?.cancel();
      return res.ok;
    } catch {
      return false;
    }
  }
}
