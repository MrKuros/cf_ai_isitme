import type { ExtraCheck, RegionProbe } from "../shared/types";

/** Friends' checks kept per report; past it new ones are refused, never evicting older ones. */
export const MAX_EXTRA_CHECKS = 20;

const expectOf = (key: string) => key.split("\u0000")[1] ?? "";
const refused = (v: unknown) =>
  [v].flat().some((p) => !!(p as { refused?: string } | null)?.refused);

/**
 * Over budget: can the probe cached under `candidate` stand in for `key`? Same kind, same `expect`,
 * and not a result that a redirect refusal would turn into a failed run.
 */
export function canSubstitute(
  key: string,
  candidate: string,
  value?: unknown
): boolean {
  const kind = key.slice(0, key.indexOf(":") + 1);
  return (
    candidate.startsWith(kind) &&
    expectOf(candidate) === expectOf(key) &&
    (value === undefined || !refused(value))
  );
}

/** One entry per voter (a re-check replaces theirs); null when the report is full. */
export function mergeExtraCheck(
  checks: ExtraCheck[],
  check: ExtraCheck
): ExtraCheck[] | null {
  const rest = check.voter
    ? checks.filter((c) => c.voter !== check.voter)
    : checks;
  return rest.length >= MAX_EXTRA_CHECKS ? null : [...rest, check];
}

/**
 * R6: a region's sick tally only counts while other regions see the target fine (>= 3 ok).
 * In a provider-wide outage every region's tally fills with failures that are real.
 * A no-connectivity result (noData) stays excluded either way.
 */
export function confirmSick(probes: RegionProbe[]): RegionProbe[] {
  if (probes.filter((p) => p.ok && !p.noData).length >= 3) return probes;
  return probes.map(({ vantageSick, ...p }) =>
    p.noData && vantageSick ? { ...p, vantageSick } : p
  );
}
