/** Fixed-window counters for the rate limiter (R19). Pure, so it is testable without a DO. */

export type Window = { start: number; count: number };

/**
 * Decides one request against a fixed window. Fixed rather than sliding because a
 * burst twice the limit across a boundary is cheaper to accept than a per-request
 * timestamp list.
 */
export function hit(
  prev: Window | undefined,
  now: number,
  limit: number,
  periodMs: number
): { ok: boolean; next: Window; retryAfter: number } {
  const fresh = !prev || now - prev.start >= periodMs;
  const start = fresh ? now : prev.start;
  const count = (fresh ? 0 : prev.count) + 1;
  return {
    ok: count <= limit,
    next: { start, count },
    retryAfter: Math.max(1, Math.ceil((start + periodMs - now) / 1000))
  };
}

/** Drops windows that have expired, so an idle object does not grow forever. */
export function prune(
  windows: Map<string, Window>,
  now: number,
  periodMs: number
): void {
  for (const [key, w] of windows)
    if (now - w.start >= periodMs) windows.delete(key);
}
