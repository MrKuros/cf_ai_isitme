// Probes from outside Cloudflare, via globalping.io. See docs/CONTRACTS.md.

import type {
  GlobalpingEvidence,
  GlobalpingHop,
  GlobalpingProbe,
  Target
} from "../shared/types";

export const GLOBALPING_API = "https://api.globalping.io/v1/measurements";

/** One probe per continent; `limit` takes the first N. */
const CONTINENTS = ["NA", "EU", "AS", "SA", "OC"];
const DEFAULT_LIMIT = 5;
/** Whole-step budget: one create plus the polls. */
const DEFAULT_TIMEOUT_MS = 8000;
const POLL_MS = 500;
/** Keep the evidence small: it is stored in reports and sent to the LLM. */
const MAX_HOPS = 12;
const MAX_ERR = 120;

// Loose shapes of the Globalping responses; every field is treated as optional.
interface RawHop {
  resolvedAddress?: string | null;
  resolvedHostname?: string | null;
  timings?: Array<{ rtt?: number | null }>;
}
interface RawEntry {
  probe?: {
    continent?: string | null;
    country?: string | null;
    city?: string | null;
    asn?: number | null;
    network?: string | null;
  };
  result?: {
    status?: string;
    statusCode?: number | null;
    rawOutput?: string | null;
    timings?: { total?: number | null } | null;
    hops?: RawHop[] | null;
  };
}
interface RawMeasurement {
  id?: string;
  status?: string;
  results?: RawEntry[];
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const trim = (s: string) => s.slice(0, MAX_ERR).trim();

/** Creates a measurement and polls it to completion. Returns null (with a reason in `errors`) on any failure. */
async function measure(
  body: object,
  deadline: number,
  errors: string[]
): Promise<RawMeasurement | null> {
  const left = () => Math.max(1, deadline - Date.now());
  try {
    const res = await fetch(GLOBALPING_API, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(left())
    });
    if (!res.ok) {
      errors.push(res.status === 429 ? "rate limited" : `HTTP ${res.status}`);
      return null;
    }
    const { id } = (await res.json()) as { id?: string };
    if (!id) {
      errors.push("no measurement id");
      return null;
    }
    for (;;) {
      if (Date.now() >= deadline) {
        errors.push("timed out waiting for probes");
        return null;
      }
      await new Promise((r) => setTimeout(r, Math.min(POLL_MS, left())));
      const poll = await fetch(`${GLOBALPING_API}/${id}`, {
        signal: AbortSignal.timeout(left())
      });
      if (!poll.ok) {
        errors.push(`poll HTTP ${poll.status}`);
        return null;
      }
      const m = (await poll.json()) as RawMeasurement;
      if (m?.status !== "in-progress") return { ...m, id };
    }
  } catch (e) {
    errors.push(trim(errMsg(e)));
    return null;
  }
}

function toProbe(e: RawEntry): GlobalpingProbe {
  const p = e.probe ?? {};
  const r = e.result ?? {};
  const code = typeof r.statusCode === "number" ? r.statusCode : undefined;
  const ms = typeof r.timings?.total === "number" ? r.timings.total : undefined;
  // Same rule as a ProbeResult: the target answered, and a 5xx is a failure.
  const ok = r.status === "finished" && code !== undefined && code < 500;
  return {
    ...(p.continent && { continent: trim(p.continent) }),
    ...(p.country && { country: trim(p.country) }),
    ...(p.city && { city: trim(p.city) }),
    ...(typeof p.asn === "number" && { asn: p.asn }),
    ...(p.network && { network: trim(p.network) }),
    ok,
    ...(ms !== undefined && { ms: Math.round(ms) }),
    ...(code !== undefined && { status: code }),
    ...(!ok && r.rawOutput && { error: trim(r.rawOutput.split("\n")[0]) })
  };
}

const toHops = (hops: RawHop[]): GlobalpingHop[] =>
  hops.slice(0, MAX_HOPS).map((h, i) => {
    const host = h.resolvedHostname ?? h.resolvedAddress;
    const rtt = h.timings?.[0]?.rtt;
    return {
      hop: i + 1,
      ...(host && { host }),
      ...(typeof rtt === "number" && { ms: Math.round(rtt * 10) / 10 })
    };
  });

/**
 * Independent probes of `target` from globalping.io.
 * Corroboration only: the result never enters the colo quorum (R6/R7) and never
 * changes a verdict. Never throws; returns `skipped: true` when nothing came back.
 */
export async function gatherGlobalping(
  target: Target,
  opts: { limit?: number; traceroute?: boolean; timeoutMs?: number } = {}
): Promise<GlobalpingEvidence> {
  const limit = Math.min(
    Math.max(Math.trunc(opts.limit ?? DEFAULT_LIMIT), 1),
    CONTINENTS.length
  );
  const deadline = Date.now() + (opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const errors: string[] = [];
  const url = new URL(target.url);

  const m = await measure(
    {
      type: "http",
      target: target.host,
      limit,
      locations: CONTINENTS.slice(0, limit).map((continent) => ({ continent })),
      measurementOptions: {
        protocol: url.protocol === "http:" ? "HTTP" : "HTTPS",
        ...(url.port && { port: Number(url.port) }),
        request: { method: "GET", path: url.pathname }
      }
    },
    deadline,
    errors
  );
  const probes = (m?.results ?? []).slice(0, limit).map(toProbe);
  if (!probes.length)
    return {
      skipped: true,
      skipReason: errors[0] ?? "no probe answered",
      probes: [],
      errors
    };

  // Second measurement on the same probes (`locations: <id>` keeps their order).
  // Off by default: a traceroute rarely finishes inside the step budget.
  if (opts.traceroute) {
    const tr = await measure(
      {
        type: "traceroute",
        target: target.host,
        locations: m!.id,
        measurementOptions: { protocol: "ICMP" }
      },
      deadline,
      errors
    );
    (tr?.results ?? []).forEach((e, i) => {
      const hops = toHops(e.result?.hops ?? []);
      if (probes[i] && hops.length) probes[i].hops = hops;
    });
  }

  return {
    skipped: false,
    probes,
    ...(m!.id && { measurementId: m!.id }),
    errors
  };
}
