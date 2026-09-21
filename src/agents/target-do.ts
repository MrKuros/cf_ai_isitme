import { DurableObject } from "cloudflare:workers";
import { dohLookup, egressColo, guardUrl, httpProbe } from "../lib/probes";
import { baselineOf, statusLagOf } from "../lib/history";
import { gatherRadar } from "../lib/radar";
import { DAY_MS, expireBefore } from "../lib/retention";
import {
  canSubstitute,
  confirmSick,
  mergeExtraCheck
} from "../lib/target-rules";
import {
  CF_STATUS_URL,
  fetchStatusPage,
  statusPageUrl
} from "../lib/statuspage";
import {
  PROBE_CACHE_TTL_S,
  REGIONS,
  VERDICT_CLASS,
  type CrowdCheck,
  type CrowdStats,
  type DnsResult,
  type Evidence,
  type ExtraCheck,
  type HostHistory,
  type ProbeResult,
  type RadarEvidence,
  type RadarInput,
  type RegionProbe,
  type Report,
  type StatusPageInfo,
  type Verdict
} from "../shared/types";

const CHECK_MAX_AGE_MS = 60 * 60 * 1000;
const CROWD_WINDOW_MS = 10 * 60 * 1000;
const CHECK_MAX_ROWS = 500;
/** Real edge/regions probe runs per host per minute; past it, callers get the freshest result for any path. */
const PROBE_BUDGET = 12;
const SAMPLE_MAX_ROWS = 2000;
/** Points returned for the sparkline: 24h at a 5-minute watch. */
const HISTORY_POINTS = 288;

type BucketRow = {
  key: string | number;
  as_name: string | null;
  total: number;
  failing: number;
};

/**
 * One instance per hostname: env.TARGET_DO.getByName(host).
 * Probe methods are coalesced: an in-flight promise map + PROBE_CACHE_TTL_S cache,
 * keyed by method + args. N concurrent callers -> one probe run.
 */
export class TargetDO extends DurableObject<Env> {
  private inflight = new Map<string, Promise<unknown>>();
  private cache = new Map<string, { at: number; value: unknown }>();
  private probeRuns: number[] = [];
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS checks (
      at INTEGER, ok INTEGER, ms REAL, asn INTEGER, as_name TEXT, country TEXT, colo TEXT, source TEXT
    )`);
    this.sql.exec("CREATE INDEX IF NOT EXISTS checks_at ON checks(at)");
    try {
      this.sql.exec("ALTER TABLE checks ADD COLUMN voter TEXT");
    } catch {
      // column already exists
    }
    this.sql.exec(`CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY, owner_id TEXT, created_at INTEGER, json TEXT
    )`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS samples (
      at INTEGER, ms REAL, ok INTEGER, verdict TEXT, colo TEXT, report_id TEXT
    )`);
    this.sql.exec("CREATE INDEX IF NOT EXISTS samples_at ON samples(at)");
  }

  // ponytail: in-memory only, so eviction drops the cache; fine for a 60s TTL
  private memo<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const now = Date.now();
    for (const [k, c] of this.cache) {
      if (now - c.at >= PROBE_CACHE_TTL_S * 1000) this.cache.delete(k);
    }
    const hit = this.cache.get(key);
    if (hit) return Promise.resolve(hit.value as T);
    const running = this.inflight.get(key);
    if (running) return running as Promise<T>;

    console.log(`[TargetDO ${this.ctx.id.name ?? "?"}] probe run ${key}`);
    const p = fn()
      .then((value) => {
        this.cache.set(key, { at: Date.now(), value });
        return value;
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  /**
   * Caps real probe fan-outs per host: unique paths can't each buy a fresh edge + 5-region run.
   * ponytail: over budget, a different path's result (same `expect`) stands in; fine for "is the host up".
   * `exact` callers (the R5e root check, the www alt) never take a stand-in.
   */
  private budgeted<T>(
    kind: "edge" | "regions",
    url: string,
    fn: () => Promise<T>,
    exact = false
  ): Promise<T> {
    const key = `${kind}:${url}`;
    const now = Date.now();
    const fresh = (at: number) => now - at < PROBE_CACHE_TTL_S * 1000;
    this.probeRuns = this.probeRuns.filter((t) => now - t < 60_000);
    const cached = this.cache.get(key);
    if (
      !exact &&
      (!cached || !fresh(cached.at)) &&
      !this.inflight.has(key) &&
      this.probeRuns.length >= PROBE_BUDGET
    ) {
      let best: { at: number; value: unknown } | undefined;
      for (const [k, c] of this.cache) {
        if (
          canSubstitute(key, k, c.value) &&
          fresh(c.at) &&
          (!best || c.at > best.at)
        )
          best = c;
      }
      if (best) return Promise.resolve(best.value as T);
      for (const [k, p] of this.inflight) {
        // ponytail: an in-flight stand-in can't be checked for `refused` before it settles; the run then errors as blocked
        if (canSubstitute(key, k)) return p as Promise<T>;
      }
    }
    return this.memo(key, () => {
      this.probeRuns.push(Date.now());
      return fn();
    });
  }

  async dns(host: string): Promise<{ dns: DnsResult; dnsAlt: DnsResult }> {
    return this.memo(`dns:${host}`, async () => {
      const [cf, google] = await Promise.all([
        dohLookup(host, { resolver: "cloudflare" }),
        dohLookup(host, { resolver: "google" })
      ]);
      // Both lookups failing is our problem, not the domain's: throw so it isn't cached and the step retries.
      if (cf.rcode === -1 && google.rcode === -1)
        throw new Error(cf.error ?? "DoH lookup failed");
      return cf.rcode === -1
        ? { dns: google, dnsAlt: cf }
        : { dns: cf, dnsAlt: google };
    });
  }

  /** `exact`: never answer with another path's result when over budget. */
  async edge(
    url: string,
    expect?: string,
    exact = false
  ): Promise<ProbeResult> {
    return this.budgeted(
      "edge",
      withExpect(url, expect),
      async () => {
        const [r, colo] = await Promise.all([
          // A fresh id per probe: the run id is the public report id and must not reach the target.
          httpProbe(url, {
            hopGuard: guardUrl,
            checkId: crypto.randomUUID(),
            expect
          }),
          egressColo()
        ]);
        return { ...r, colo };
      },
      exact
    );
  }

  async regions(url: string, expect?: string): Promise<RegionProbe[]> {
    return this.budgeted("regions", withExpect(url, expect), async () => {
      const settled = await Promise.allSettled(
        REGIONS.map((r) =>
          this.env.PROBE_DO.getByName(`probe-${r}`, {
            locationHint: r
          }).probe(url, r, undefined, expect)
        )
      );
      // A ProbeDO that failed is missing evidence, not a failed region (R6).
      const probes = settled.map((s, i): RegionProbe => {
        if (s.status === "fulfilled") return s.value;
        console.warn(
          `[TargetDO] probe ${REGIONS[i]} rejected`,
          String(s.reason)
        );
        return {
          region: REGIONS[i],
          ok: false,
          ms: 0,
          noData: true,
          error: "probe unavailable"
        };
      });
      return confirmSick(probes);
    });
  }

  async radar(input: RadarInput): Promise<RadarEvidence> {
    return this.memo(`radar:${JSON.stringify(input)}`, () =>
      gatherRadar(this.env, input)
    );
  }

  async statusPage(host: string): Promise<StatusPageInfo | null> {
    return this.memo(`status:${host}`, async () => {
      const s = statusPageUrl(host);
      return s ? fetchStatusPage(s.url, s.source) : null;
    });
  }

  async cfStatus(): Promise<StatusPageInfo | null> {
    return this.memo("cfstatus", () =>
      fetchStatusPage(CF_STATUS_URL, "curated")
    );
  }

  async recordCheck(check: CrowdCheck): Promise<void> {
    // One row per voter per window, so a single client can't outvote everyone else.
    if (check.voter) {
      this.sql.exec(
        "DELETE FROM checks WHERE voter = ? AND at >= ?",
        check.voter,
        Date.now() - CROWD_WINDOW_MS
      );
    }
    this.sql.exec(
      "INSERT INTO checks (at, ok, ms, asn, as_name, country, colo, source, voter) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      check.at,
      check.ok ? 1 : 0,
      check.ms ?? null,
      check.asn ?? null,
      check.asName ?? null,
      check.country ?? null,
      check.colo ?? null,
      check.source,
      check.voter ?? null
    );
    this.sql.exec(
      "DELETE FROM checks WHERE at < ?",
      Date.now() - CHECK_MAX_AGE_MS
    );
    this.sql.exec(
      "DELETE FROM checks WHERE rowid NOT IN (SELECT rowid FROM checks ORDER BY at DESC LIMIT ?)",
      CHECK_MAX_ROWS
    );
  }

  async crowdStats(
    windowMinutes = CROWD_WINDOW_MS / 60_000
  ): Promise<CrowdStats> {
    const since = Date.now() - windowMinutes * 60_000;
    const totals = this.sql
      .exec<{ total: number; failing: number }>(
        "SELECT COUNT(*) AS total, COALESCE(SUM(1 - ok), 0) AS failing FROM checks WHERE at >= ?",
        since
      )
      .one();
    // Only browser rows describe the user's network; edge rows are Cloudflare's vantage.
    const buckets = (col: "asn" | "country") =>
      this.sql
        .exec<BucketRow>(
          `SELECT ${col} AS key, MAX(as_name) AS as_name, COUNT(*) AS total, SUM(1 - ok) AS failing
           FROM checks WHERE at >= ? AND source = 'browser' AND ${col} IS NOT NULL
           GROUP BY ${col} ORDER BY failing DESC, total DESC LIMIT 10`,
          since
        )
        .toArray();
    return {
      windowMinutes,
      total: totals.total,
      failing: totals.failing,
      byAsn: buckets("asn").map((r) => ({
        asn: Number(r.key),
        ...(r.as_name ? { asName: r.as_name } : {}),
        total: r.total,
        failing: r.failing
      })),
      byCountry: buckets("country").map((r) => ({
        country: String(r.key),
        total: r.total,
        failing: r.failing
      }))
    };
  }

  async saveReport(report: Report, ownerId: string): Promise<void> {
    // Idempotent: a retried workflow step must not wipe appended extraChecks or add a second sample.
    const { rowsWritten } = this.sql.exec(
      "INSERT INTO reports (id, owner_id, created_at, json) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO NOTHING",
      report.id,
      ownerId,
      report.createdAt,
      JSON.stringify(report)
    );
    if (rowsWritten) {
      const edge = report.evidence.edge;
      this.sql.exec(
        "INSERT INTO samples (at, ms, ok, verdict, colo, report_id) VALUES (?, ?, ?, ?, ?, ?)",
        report.createdAt,
        edge?.ms ?? null,
        VERDICT_CLASS[report.classification.verdict] !== "down" ? 1 : 0,
        report.classification.verdict,
        edge?.colo ?? null,
        report.id
      );
      this.pruneSamples();
    }
    if ((await this.ctx.storage.getAlarm()) === null)
      await this.ctx.storage.setAlarm(Date.now() + DAY_MS);
  }

  private pruneSamples() {
    this.sql.exec("DELETE FROM samples WHERE at < ?", Date.now() - DAY_MS);
    this.sql.exec(
      "DELETE FROM samples WHERE rowid NOT IN (SELECT rowid FROM samples ORDER BY at DESC LIMIT ?)",
      SAMPLE_MAX_ROWS
    );
  }

  /** N9: median ms of this colo's non-down samples over 24h; null below 10 samples. SQL only. */
  async baseline(colo: string): Promise<Evidence["baseline"]> {
    const ms = this.sql
      .exec<{ ms: number }>(
        "SELECT ms FROM samples WHERE colo = ? AND at >= ? AND ok = 1 AND ms IS NOT NULL",
        colo,
        Date.now() - DAY_MS
      )
      .toArray()
      .map((r) => r.ms);
    return baselineOf(colo, ms);
  }

  /** N10: first failure of the current streak vs the vendor incident. `failingNowAt` = the unsaved run failed. */
  async statusLag(
    statusPage: StatusPageInfo | null,
    failingNowAt?: number
  ): Promise<Evidence["statusLag"]> {
    const rows = this.sql
      .exec<{ at: number; ok: number }>(
        "SELECT at, ok FROM samples ORDER BY at DESC LIMIT ?",
        SAMPLE_MAX_ROWS
      )
      .toArray()
      .map((r) => ({ at: r.at, ok: r.ok === 1 }));
    return statusLagOf(rows, statusPage, failingNowAt);
  }

  /** R17: expired reports keep a json-NULL tombstone row so reads can say "expired" instead of "not found". */
  async alarm(): Promise<void> {
    this.sql.exec(
      "UPDATE reports SET json = NULL WHERE created_at < ? AND json IS NOT NULL",
      expireBefore(Date.now())
    );
    this.pruneSamples();
    const live = this.sql
      .exec<{ n: number }>(
        "SELECT (SELECT COUNT(*) FROM reports WHERE json IS NOT NULL) + (SELECT COUNT(*) FROM samples) AS n"
      )
      .one().n;
    if (live) await this.ctx.storage.setAlarm(Date.now() + DAY_MS);
  }

  /** Live report json, or null for unknown / expired (tombstoned or past TTL but not yet swept). */
  private liveRow(id: string) {
    return this.sql
      .exec<{ owner_id: string; json: string }>(
        "SELECT owner_id, json FROM reports WHERE id = ? AND json IS NOT NULL AND created_at >= ?",
        id,
        expireBefore(Date.now())
      )
      .toArray()[0];
  }

  async getReport(id: string): Promise<Report | null> {
    const row = this.liveRow(id);
    if (!row) return null;
    const report = JSON.parse(row.json) as Report;
    // `voter` is a dedupe key, never public.
    report.extraChecks = report.extraChecks.map(({ voter: _, ...c }) => c);
    return report;
  }

  /** SQL only, never probes (R19). */
  async hostHistory(): Promise<HostHistory> {
    type Row = {
      at: number;
      ms: number | null;
      ok: number;
      verdict: Verdict;
      colo: string | null;
      report_id: string;
    };
    const rows = this.sql
      .exec<Row>(
        "SELECT at, ms, ok, verdict, colo, report_id FROM samples WHERE at >= ? ORDER BY at DESC LIMIT ?",
        Date.now() - DAY_MS,
        HISTORY_POINTS
      )
      .toArray();
    const newest = rows[0];
    return {
      host: this.ctx.id.name ?? "",
      samples: rows.reverse().map((r) => ({
        at: r.at,
        ...(r.ms !== null && { ms: r.ms }),
        ok: r.ok === 1,
        verdict: r.verdict,
        ...(r.colo && { colo: r.colo })
      })),
      latest: newest
        ? { verdict: newest.verdict, at: newest.at, reportId: newest.report_id }
        : null
    };
  }

  async getReportStatus(
    id: string
  ): Promise<{ report: Report } | { expired: true } | null> {
    const report = await this.getReport(id);
    if (report) return { report };
    const known = this.sql
      .exec("SELECT 1 FROM reports WHERE id = ?", id)
      .toArray().length;
    return known ? { expired: true } : null;
  }

  /** One check per voter (a re-check replaces theirs); "full" once the report holds MAX_EXTRA_CHECKS. */
  async appendExtraCheck(
    reportId: string,
    check: ExtraCheck,
    voter: string
  ): Promise<{ ownerId: string } | "full" | null> {
    const row = this.liveRow(reportId);
    if (!row) return null;
    const report = JSON.parse(row.json) as Report;
    const merged = mergeExtraCheck(report.extraChecks ?? [], {
      ...check,
      voter
    });
    if (!merged) return "full";
    report.extraChecks = merged;
    this.sql.exec(
      "UPDATE reports SET json = ? WHERE id = ?",
      JSON.stringify(report),
      reportId
    );
    return { ownerId: row.owner_id };
  }
}

const withExpect = (url: string, expect?: string) =>
  expect ? `${url}\u0000${expect}` : url;
