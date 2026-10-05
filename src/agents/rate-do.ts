import { DurableObject } from "cloudflare:workers";
import { hit, prune, type Window } from "../lib/window";

/**
 * Per-client rate limiter (R19). One object per hashed IP, so every request from a
 * client meets the same counter wherever it lands.
 *
 * Replaces env.RATE_LIMITER: the platform binding deployed fine but never refused a
 * request in production (60 requests to one colo, zero 429s), and a limiter that
 * cannot be observed to work is not a limiter.
 *
 * ponytail: counters live in memory and reset if the object is evicted. That costs an
 * idle client one extra window after an eviction, which is cheaper than a storage
 * write per request. Move to ctx.storage if abuse survives eviction.
 */
export class RateDO extends DurableObject {
  #windows = new Map<string, Window>();

  /** True when this request is over the limit. */
  async over(key: string, limit: number, periodMs: number): Promise<boolean> {
    const now = Date.now();
    prune(this.#windows, now, periodMs);
    const { ok, next } = hit(this.#windows.get(key), now, limit, periodMs);
    this.#windows.set(key, next);
    return !ok;
  }
}
