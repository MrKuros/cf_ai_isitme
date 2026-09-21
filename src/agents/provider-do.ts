import { DurableObject } from "cloudflare:workers";
import type { ProviderStats } from "../shared/types";

const MAX_AGE_MS = 60 * 60_000;

/**
 * One per provider id: env.PROVIDER_DO.getByName(provider.id). Latest result per host, 1h.
 * ponytail: no canary probes; add when attribution needs data without traffic.
 */
export class ProviderDO extends DurableObject<Env> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(
      "CREATE TABLE IF NOT EXISTS hits (host TEXT PRIMARY KEY, ok INTEGER, at INTEGER)"
    );
  }

  async record(host: string, ok: boolean, at: number): Promise<void> {
    this.sql.exec(
      "INSERT INTO hits (host, ok, at) VALUES (?, ?, ?) ON CONFLICT(host) DO UPDATE SET ok = excluded.ok, at = excluded.at",
      host,
      ok ? 1 : 0,
      at
    );
    this.sql.exec("DELETE FROM hits WHERE at < ?", Date.now() - MAX_AGE_MS);
  }

  /** Counts only, never hostnames. */
  async stats(excludeHost: string, windowMinutes = 10): Promise<ProviderStats> {
    const row = this.sql
      .exec<{ total: number; failing: number }>(
        "SELECT COUNT(*) AS total, COALESCE(SUM(1 - ok), 0) AS failing FROM hits WHERE host != ? AND at >= ?",
        excludeHost,
        Date.now() - windowMinutes * 60_000
      )
      .one();
    return {
      provider: this.ctx.id.name ?? "",
      windowMinutes,
      otherHosts: row.total,
      otherFailing: row.failing
    };
  }
}
