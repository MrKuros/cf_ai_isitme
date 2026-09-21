// Shared contract between Worker, agents, workflow, and client. See docs/CONTRACTS.md.

// Llama 3.3 writes verdict explanations. Chat tool-routing uses GLM: Llama 3.3's
// streamed tool-call arguments arrive corrupted through workers-ai-provider.
export const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
export const CHAT_MODEL = "@cf/zai-org/glm-4.7-flash";

export const REGIONS = ["wnam", "enam", "weur", "apac", "oc"] as const;
export type RegionHint = (typeof REGIONS)[number];

/** Seconds a TargetDO keeps a probe result before re-running it. */
export const PROBE_CACHE_TTL_S = 60;

export const MIN_WATCH_MINUTES = 5;
export const MAX_WATCHES = 10;
/** Active watches per client IP (IPv6 /64) across all its devices. */
export const MAX_WATCHES_PER_IP = 10;

/** Reports older than this are deleted by a TargetDO alarm; reads return 410 / "expired" (R17). */
export const REPORT_TTL_DAYS = 30;

// ── Inputs ───────────────────────────────────────────────────────────

/** Network facts about a caller, from `request.cf`. Every field is optional (local dev has none). */
export interface NetInfo {
  colo?: string;
  country?: string;
  city?: string;
  asn?: number;
  asOrganization?: string;
}

/** A normalized, guard-checked check target. Produced only by `normalizeTarget`. */
export interface Target {
  /** What the user typed, trimmed. */
  input: string;
  /** Canonical URL: http(s) scheme, lowercase host, no credentials, no query, no fragment. */
  url: string;
  /** Lowercase hostname (punycode for IDNs), no port. TargetDO name and report key. */
  host: string;
  /** True when `host` is an IPv4/IPv6 literal (DNS step is skipped). */
  isIpLiteral: boolean;
}

// ── Probe results ────────────────────────────────────────────────────

export type ProbeErrorClass =
  | "timeout"
  | "dns"
  | "connect"
  | "tls"
  | "http_5xx"
  | "blocked"
  | "unknown";

export type BlockKind = "challenge" | "waf" | "rate_limit" | "geo";

export interface PageFlags {
  /** Under 512 bytes of non-whitespace. */
  empty?: boolean;
  /** 2xx whose title/body reads like an error page. */
  errorPage?: boolean;
  parked?: boolean;
  /** The `expect` text was not in the first 64 KB. */
  expectMissing?: boolean;
}

export interface RedirectHop {
  url: string;
  status: number;
}

/**
 * One HTTP probe from one vantage (GET only).
 * `ok` = the FINAL hop answered (2xx/3xx/4xx, or a bot-protection block).
 * 5xx, TLS (525/526) and origin-DNS (530) are failures.
 * Redirects are followed up to 5 hops, each hop re-guarded.
 * `noData` = the vantage itself failed; excluded from every ratio.
 */
export interface ProbeResult {
  ok: boolean;
  status?: number;
  ms: number;
  error?: string;
  errorClass?: ProbeErrorClass;
  /** Location header when status is 3xx. Never fetched. */
  redirectedTo?: string;
  /** Cloudflare colo the probe egressed from, when known. */
  colo?: string;
  /** Bot protection answered instead of the site (ok stays true). */
  blocked?: BlockKind;
  server?: string;
  cfRay?: string;
  /** 520-524 with cf-ray: Cloudflare is fine, the site's origin is failing. */
  cdnOrigin?: boolean;
  /** Body bytes read (capped at 64 KB). */
  bytes?: number;
  title?: string;
  flags?: PageFlags;
  /** Every hop including the final one. */
  chain?: RedirectHop[];
  /** First attempt timed out or failed to connect; this is the retry's result. */
  retried?: boolean;
  noData?: boolean;
  /** The vantage's control fetches failed (implies noData). */
  vantageSick?: boolean;
  /** Set when a redirect hop was refused by the SSRF guard. */
  refused?: string;
  /** Lowercase names of provider fingerprint headers present (x-amz-cf-id, x-served-by, x-fastly-request-id, x-azure-ref, x-vercel-id, x-nf-request-id, x-github-request-id). */
  providerHeaders?: string[];
}

/** A ProbeDO's result: `region` is the requested locationHint, `colo` the actual colo. */
export interface RegionProbe extends ProbeResult {
  region: RegionHint;
}

export interface DnsResult {
  /** rcode 0 with at least one address. */
  ok: boolean;
  /** DoH `Status` (0 NOERROR, 2 SERVFAIL, 3 NXDOMAIN). -1 when the lookup itself failed. */
  rcode: number;
  /** A + AAAA answers. */
  addresses: string[];
  /** CNAME chain, if any. */
  cnames: string[];
  /** DNSSEC authenticated data flag. */
  ad: boolean;
  ms: number;
  error?: string;
  resolver?: "cloudflare" | "google";
  /** SERVFAIL normally, NOERROR with cd=1. */
  dnssecFailed?: boolean;
}

export interface RadarOutage {
  scope: "asn" | "country";
  asn?: number;
  location?: string;
  cause?: string;
  outageType?: string;
  description?: string;
  startDate: string;
  endDate?: string | null;
}

export interface RadarAnomaly {
  scope: "asn" | "country";
  asn?: number;
  location?: string;
  status?: string;
  type?: string;
  startDate: string;
  endDate?: string | null;
}

export interface RadarBgpEvent {
  kind: "hijack" | "leak";
  id: string;
  startedAt: string;
  endedAt?: string | null;
  confidence?: number;
  asns: number[];
  prefixes: string[];
}

export interface RadarInput {
  targetIp?: string;
  userAsn?: number;
  userCountry?: string;
}

export interface RadarEvidence {
  /** True when no RADAR_TOKEN is configured or every call failed. */
  skipped: boolean;
  skipReason?: string;
  targetAsn?: number;
  targetAsName?: string;
  /** Outage annotations for the user's ASN and/or country (last 24h). */
  outages: RadarOutage[];
  /** Verified traffic anomalies for the user's ASN and/or country (last 24h). */
  anomalies: RadarAnomaly[];
  /** BGP hijacks/leaks involving the target's ASN (last 24h). */
  bgp: RadarBgpEvent[];
  /** Per-call failures that did not skip the whole step. */
  errors: string[];
}

// ── Provider & status pages (N1, N2, R18) ───────────────────────────

export interface ProviderInfo {
  /** Stable id, e.g. "fastly"; also the ProviderDO name. */
  id: string;
  name: string;
  via: Array<"cname" | "header" | "asn">;
}

/** Counts only: never other hostnames (privacy). */
export interface ProviderStats {
  provider: string;
  windowMinutes: number;
  /** Distinct hosts on this provider seen in the window, excluding the target. */
  otherHosts: number;
  otherFailing: number;
}

export interface StatusIncident {
  name: string;
  status: string;
  impact?: string;
  createdAt: string;
}

export interface StatusPageInfo {
  url: string;
  source: "statuspage" | "curated";
  indicator:
    | "none"
    | "minor"
    | "major"
    | "critical"
    | "maintenance"
    | "unknown";
  description?: string;
  incidents: StatusIncident[];
  componentsDown: string[];
  fetchedAt: number;
}

/** One recorded check in a TargetDO ring buffer. Network fields are set only for browser rows. */
export interface CrowdCheck {
  at: number;
  ok: boolean;
  ms?: number;
  asn?: number;
  asName?: string;
  country?: string;
  colo?: string;
  source: "browser" | "edge";
  /** Hashed client IP: one browser row per voter per host per window. */
  voter?: string;
}

export interface CrowdBucket {
  total: number;
  failing: number;
}

export interface CrowdStats {
  windowMinutes: number;
  total: number;
  failing: number;
  byAsn: Array<CrowdBucket & { asn: number; asName?: string }>;
  byCountry: Array<CrowdBucket & { country: string }>;
}

/** What the browser can see about its own network (N4, N7). Heuristic hints only, never a verdict driver. */
export interface BrowserEnv {
  /** Parsed same-origin /cdn-cgi/trace. `ip` is never kept: reports are public. */
  trace?: { warp?: string; gateway?: string; loc?: string };
  /** /cdn-cgi/trace returned a non-trace body (proxy / captive portal). */
  traceBlocked?: boolean;
  timeZone?: string;
  /** trace.loc disagrees with the timezone (VPN hint). */
  tzMismatch?: boolean;
  /** The IPv6-only control was reachable. */
  ipv6?: boolean;
}

/** BrowserProbe.error when the browser can't test the target at all (http target from an https page). */
export const BROWSER_UNTESTABLE = "mixed content";

/**
 * The user's own browser vantage. A no-cors fetch cannot see status codes:
 * `reachable` means "the request completed", nothing more.
 */
export interface BrowserProbe {
  at: number;
  reachable: boolean;
  method: "fetch-no-cors" | "image" | "none";
  ms?: number;
  error?: string;
  /** navigator.onLine at probe time. */
  online: boolean;
  /** Whether a known-good control URL was reachable from the same browser. */
  controlReachable: boolean;
  /** DoH lookup of the target from the browser (reveals local DNS filtering vs edge view). */
  dns: DnsResult | null;
  /** Google DoH from the browser (`dns` is Cloudflare DoH). */
  dnsAlt?: DnsResult | null;
  env?: BrowserEnv;
}

/** Everything the classifier and the explainer see. `null` = step skipped or failed. */
export interface Evidence {
  target: Target;
  user: NetInfo;
  dns: DnsResult | null;
  /** The second resolver (Google). */
  dnsAlt?: DnsResult | null;
  edge: ProbeResult | null;
  /** Origin root probe, when the requested path 404s. */
  root?: ProbeResult | null;
  /** www./apex fallback, when the target fails at DNS/connect/TLS. */
  alt?: {
    host: string;
    dns: DnsResult | null;
    probe: ProbeResult | null;
  } | null;
  regions: RegionProbe[];
  radar: RadarEvidence | null;
  crowd: CrowdStats | null;
  browser: BrowserProbe | null;
  provider?: ProviderInfo | null;
  providerStats?: ProviderStats | null;
  /** The target vendor's status page (N2). */
  statusPage?: StatusPageInfo | null;
  /** cloudflarestatus.com summary (R18). */
  cfStatus?: StatusPageInfo | null;
  /** Keyword the page must contain (R4). */
  expect?: string;
  /** Per-colo latency baseline from TargetDO samples (P2). */
  baseline?: { colo: string; medianMs: number; samples: number } | null;
  /** Time from first failed probe to vendor status-page acknowledgement (P2). */
  statusLag?: { firstFailureAt: number; vendorAckAt?: number } | null;
  /** Registration data for the registrable domain (P2). */
  rdap?: { expiresAt?: string; status?: string[]; registrar?: string } | null;
  /** Direct queries to the zone's authoritative nameservers (P2). */
  authNs?: Array<{
    ns: string;
    ip?: string;
    rcode?: number;
    addresses: string[];
    noData?: boolean;
  }> | null;
  startedAt: number;
  finishedAt?: number;
}

// ── Verdict ──────────────────────────────────────────────────────────

export type Verdict =
  | "HEALTHY"
  | "SLOW"
  | "DOWN_GLOBAL"
  | "DOWN_REGIONAL"
  | "DNS_FAILURE"
  | "LIKELY_YOUR_NETWORK"
  | "ISP_OUTAGE"
  | "UPSTREAM_OUTAGE"
  | "BLOCKED"
  | "TLS_ERROR"
  | "PARTIAL"
  | "INCONCLUSIVE";

export type VerdictSubtype =
  | "dnssec"
  | "nxdomain"
  | "parked"
  | "empty"
  | "error_page"
  | "expect_missing"
  | "path_not_found"
  | "challenge"
  | "waf"
  | "rate_limit"
  | "geo"
  | "origin";

/** Watch alerting class: alerts fire only on up <-> down; "none" never alerts. */
export type VerdictClass = "up" | "down" | "none";

export const VERDICT_CLASS: Record<Verdict, VerdictClass> = {
  HEALTHY: "up",
  SLOW: "up",
  BLOCKED: "up",
  DOWN_GLOBAL: "down",
  DOWN_REGIONAL: "down",
  DNS_FAILURE: "down",
  TLS_ERROR: "down",
  UPSTREAM_OUTAGE: "down",
  PARTIAL: "down",
  LIKELY_YOUR_NETWORK: "none",
  ISP_OUTAGE: "none",
  INCONCLUSIVE: "none"
};

export interface Classification {
  verdict: Verdict;
  subtype?: VerdictSubtype;
  /** 0..1 */
  confidence: number;
  /** Human-readable facts that drove the verdict, most important first. */
  signals: string[];
  /** Confidence contributions, for the UI breakdown (N8). */
  factors?: Array<{ label: string; delta: number }>;
  /** User-side next-step hints ("looks like a VPN"), never verdict drivers. */
  hints?: string[];
  /** Reasons Cloudflare itself may be at fault (R18). Non-empty = show the banner, confidence capped at 0.7. */
  selfSuspect?: string[];
}

// ── Runs (live step card) ────────────────────────────────────────────

export type StepName =
  | "dns"
  | "edge"
  | "regions"
  | "radar"
  | "provider"
  | "status"
  | "browser"
  | "crowd"
  | "classify"
  | "explain";

export const STEP_ORDER: StepName[] = [
  "dns",
  "edge",
  "regions",
  "radar",
  "provider",
  "status",
  "browser",
  "crowd",
  "classify",
  "explain"
];

export interface StepState {
  status: "pending" | "running" | "done" | "skipped" | "error";
  startedAt?: number;
  finishedAt?: number;
  /** One-line result for the card, e.g. "93.184.216.34 in 12ms". */
  summary?: string;
  error?: string;
}

export type RunTrigger = "chat" | "watch" | "api" | "mcp";

export interface RunState {
  /** = workflow instance id = report id. */
  id: string;
  host: string;
  url: string;
  trigger: RunTrigger;
  /** Chat tool call that started it; the UI maps a tool part to its run via this. */
  toolCallId?: string;
  watchId?: string;
  /** Client should run the browser probe and call submitBrowserProbe(id, ...). */
  wantsBrowser: boolean;
  status: "running" | "done" | "error";
  steps: Record<StepName, StepState>;
  startedAt: number;
  finishedAt?: number;
  verdict?: Verdict;
  confidence?: number;
  error?: string;
}

// ── Reports ──────────────────────────────────────────────────────────

/** A visitor's result from a /c/:host?ref=:reportId link. */
export interface ExtraCheck {
  id: string;
  at: number;
  user: NetInfo;
  browser: BrowserProbe | null;
  /** hashIp of the poster: dedupe key, stored only, stripped from every read. */
  voter?: string;
}

/** Public, shareable. Never contains the owner's device id or city. */
export interface Report {
  id: string;
  host: string;
  url: string;
  createdAt: number;
  trigger: RunTrigger;
  evidence: Evidence;
  classification: Classification;
  /** LLM explanation (template fallback when the LLM fails); "" only when skipped (unchanged watch verdict). */
  explanation: string;
  extraChecks: ExtraCheck[];
}

/** One report's point on the per-host sparkline. */
export interface HostSample {
  at: number;
  ms?: number;
  ok: boolean;
  verdict: Verdict;
  colo?: string;
}

/** Public per-host view (GET /api/host/:host, badges). */
export interface HostHistory {
  host: string;
  samples: HostSample[];
  latest: { verdict: Verdict; at: number; reportId: string } | null;
}

export interface ReportSummary {
  id: string;
  host: string;
  createdAt: number;
  verdict: Verdict;
  confidence: number;
  trigger: RunTrigger;
}

// ── Watches & alerts ─────────────────────────────────────────────────

export interface Watch {
  id: string;
  host: string;
  url: string;
  intervalMinutes: number;
  /** Agent scheduleEvery() id, for cancelSchedule. */
  scheduleId: string;
  webhookUrl?: string;
  lastVerdict?: Verdict;
  lastCheckedAt?: number;
  lastReportId?: string;
  createdAt: number;
  /** A class change waiting for its confirm run. */
  pendingVerdict?: Verdict;
  pendingCount?: number;
  /** The open "down" alert, updated in place until recovery. */
  openIncidentId?: string;
  expect?: string;
  /** One-shot: delete the watch after the confirmed recovery alert. */
  until?: "recovered";
  /** Alerts suppressed until this epoch ms (P2). */
  mutedUntil?: number;
  /** Alert email recipient; sent only when env.EMAIL is bound (P2). */
  email?: string;
  /** The open incident's down alert was dropped by a mute, so its recovery is dropped too. */
  silentIncident?: boolean;
}

/** One row of /api/trends (TrendsDO). */
export interface TrendItem {
  host: string;
  verdict: Verdict;
  provider?: string;
  /** Distinct ASNs that reported this host recently. */
  asns: number;
  lastAt: number;
}

export interface UptimeStats {
  watchId: string;
  days: number;
  runs: number;
  upRuns: number;
  /** Runs excluded from the ratio (e.g. user_side / inconclusive). */
  excluded: number;
  /** upRuns / (runs - excluded), or null with no counted runs. */
  uptime: number | null;
}

export interface Alert {
  id: string;
  watchId: string;
  host: string;
  at: number;
  from?: Verdict;
  to: Verdict;
  reportId: string;
  summary: string;
  read: boolean;
  webhook: "none" | "sent" | "failed";
  kind?: "down" | "recovered";
  incidentId?: string;
}

// ── UserAgent synced state ───────────────────────────────────────────

export interface AgentState {
  user: NetInfo | null;
  /** App origin (e.g. "https://isitme.example.workers.dev") captured in onConnect, for absolute links in webhooks. */
  origin: string | null;
  /** Newest first, capped at 20. */
  runs: RunState[];
  watches: Watch[];
  /** Newest first, capped at 50. */
  alerts: Alert[];
  /** Newest first, capped at 50. Full reports live in SQL + TargetDO. */
  history: ReportSummary[];
}

export const INITIAL_AGENT_STATE: AgentState = {
  user: null,
  origin: null,
  runs: [],
  watches: [],
  alerts: [],
  history: []
};

// ── Workflow ─────────────────────────────────────────────────────────

export interface DiagnoseParams {
  runId: string;
  target: Target;
  user: NetInfo;
  trigger: RunTrigger;
  /** UserAgent name (device id, or "api"/"mcp"). Stored as report owner. */
  ownerId: string;
  wantsBrowser: boolean;
  watchId?: string;
  /** Hashed client IP for crowd dedupe (chat runs only). */
  voter?: string;
  /** For watch runs: explain is skipped when the new verdict equals this. */
  previousVerdict?: Verdict;
  expect?: string;
}

/** Payload of every `reportProgress` call. */
export interface DiagnoseProgress {
  step: StepName;
  state: StepState;
}

/** Payload of `step.reportComplete`. */
export interface DiagnoseResult {
  runId: string;
  report: Report;
  explainSkipped: boolean;
}

/** Output of the `diagnose` chat tool, `checkNow` RPC, /api/v1/check and MCP check_site. */
export type CheckOutcome =
  | {
      ok: true;
      runId: string;
      host: string;
      verdict: Verdict;
      subtype?: VerdictSubtype;
      confidence: number;
      signals: string[];
      /** ProviderInfo.name, when fingerprinted. */
      provider?: string;
      explanation: string;
      /** Path, e.g. "/r/example.com/<id>". */
      reportPath: string;
    }
  | {
      ok: false;
      runId?: string;
      host?: string;
      error: string;
    };

/** GET /api/v1/runs/:id and MCP get_check. */
export type RunPoll =
  | { status: "running"; runId: string; host?: string }
  | CheckOutcome;

/** @callable exportData() download. */
export interface ExportBundle {
  exportedAt: number;
  watches: Watch[];
  alerts: Alert[];
  history: ReportSummary[];
}

/** Messages the UserAgent sends with `this.broadcast` (besides state sync). */
export type AgentBroadcast =
  | { type: "alert"; alert: Alert }
  | { type: "extra-check"; reportId: string; host: string; check: ExtraCheck };
