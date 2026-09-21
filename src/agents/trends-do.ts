import { DurableObject } from "cloudflare:workers";
import {
  TRENDS_LIST_SQL,
  TRENDS_SCHEMA,
  TRENDS_WINDOW_MS
} from "../lib/history";
import { WATCH_IDLE_MS } from "../lib/alerts";
import type { TrendItem, Verdict } from "../shared/types";

const TRENDS_MAX_ROWS = 10_000;

/**
 * Singleton: env.TRENDS_DO.getByName("global"). Callers record non-HEALTHY runs only.
 * Also holds the per-IP watch claims, the one count that must span every device agent.
 */
export class TrendsDO extends DurableObject<Env> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(TRENDS_SCHEMA);
    this.sql.exec("CREATE INDEX IF NOT EXISTS trends_at ON trends(at)");
    this.sql.exec(
      "CREATE TABLE IF NOT EXISTS watch_claims (id TEXT PRIMARY KEY, voter TEXT NOT NULL, at INTEGER NOT NULL)"
    );
  }

  /** Claims a watch slot for `voter` (hashed IP); false when it already holds `max`. `id` = "<agent>:<watchId>". */
  async claimWatch(voter: string, id: string, max: number): Promise<boolean> {
    const now = Date.now();
    // A live watch's device reconnected (touchWatches) within WATCH_IDLE_MS; older claims belong to expired watches.
    this.sql.exec(
      "DELETE FROM watch_claims WHERE at < ?",
      now - WATCH_IDLE_MS - 86_400_000
    );
    const held = this.sql
      .exec<{ n: number }>(
        "SELECT COUNT(*) AS n FROM watch_claims WHERE voter = ? AND id != ?",
        voter,
        id
      )
      .one().n;
    if (held >= max) return false;
    this.sql.exec(
      "INSERT OR REPLACE INTO watch_claims (id, voter, at) VALUES (?, ?, ?)",
      id,
      voter,
      now
    );
    return true;
  }

  async touchWatches(ids: string[]): Promise<void> {
    for (const id of ids)
      this.sql.exec(
        "UPDATE watch_claims SET at = ? WHERE id = ?",
        Date.now(),
        id
      );
  }

  async releaseWatch(id: string): Promise<void> {
    this.sql.exec("DELETE FROM watch_claims WHERE id = ?", id);
  }

  async record(item: {
    host: string;
    verdict: Verdict;
    provider?: string;
    asn?: number;
  }): Promise<void> {
    const now = Date.now();
    this.sql.exec(
      "INSERT INTO trends (host, verdict, provider, asn, at) VALUES (?, ?, ?, ?, ?)",
      item.host,
      item.verdict,
      item.provider ?? null,
      item.asn ?? null,
      now
    );
    this.sql.exec("DELETE FROM trends WHERE at < ?", now - TRENDS_WINDOW_MS);
    this.sql.exec(
      "DELETE FROM trends WHERE rowid NOT IN (SELECT rowid FROM trends ORDER BY at DESC LIMIT ?)",
      TRENDS_MAX_ROWS
    );
  }

  async list(): Promise<TrendItem[]> {
    type Row = {
      host: string;
      verdict: Verdict;
      provider: string | null;
      last_at: number;
      asns: number;
    };
    return this.sql
      .exec<Row>(TRENDS_LIST_SQL, Date.now() - TRENDS_WINDOW_MS)
      .toArray()
      .map((r) => ({
        host: r.host,
        verdict: r.verdict,
        ...(r.provider && { provider: r.provider }),
        asns: r.asns,
        lastAt: r.last_at
      }));
  }
}
