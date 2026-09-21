import type {
  RadarAnomaly,
  RadarBgpEvent,
  RadarEvidence,
  RadarInput,
  RadarOutage
} from "../shared/types";

const BASE = "https://api.cloudflare.com/client/v4/radar/";
// Keep the evidence small: it is stored in reports and sent to the LLM.
const MAX_ITEMS = 5;

// Loose shapes of the Radar responses; every field is treated as optional.
interface RawOutage {
  id?: string;
  description?: string;
  startDate?: string;
  endDate?: string | null;
  outage?: { outageCause?: string; outageType?: string };
}
interface RawAnomaly {
  uuid?: string;
  status?: string;
  type?: string;
  startDate?: string;
  endDate?: string | null;
}
interface RawHijack {
  id?: number | string;
  min_hijack_ts?: string;
  max_hijack_ts?: string;
  confidence_score?: number;
  hijacker_asn?: number;
  victim_asns?: number[];
  prefixes?: string[];
  is_stale?: boolean;
}
interface RawLeak {
  id?: number | string;
  min_ts?: string;
  max_ts?: string;
  detected_ts?: string;
  finished?: boolean;
  leak_asn?: number;
  leak_seg?: number[];
}

async function radar<T>(token: string, path: string): Promise<T> {
  const res = await fetch(
    BASE + path + (path.includes("?") ? "&" : "?") + "format=json",
    {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000)
    }
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json()) as { success?: boolean; result?: T };
  if (!body.success || !body.result) throw new Error("unsuccessful response");
  return body.result;
}

const trim = (s: string | undefined, n = 160) =>
  s && s.length > n ? s.slice(0, n - 1) + "…" : s;
const newestFirst = <T extends { startDate?: string; startedAt?: string }>(
  a: T,
  b: T
) =>
  (b.startDate ?? b.startedAt ?? "").localeCompare(
    a.startDate ?? a.startedAt ?? ""
  );

/** Never throws. No token -> { skipped: true, skipReason: "no RADAR_TOKEN" }. */
export async function gatherRadar(
  env: Pick<Env, "RADAR_TOKEN">,
  input: RadarInput
): Promise<RadarEvidence> {
  const empty = { outages: [], anomalies: [], bgp: [], errors: [] };
  const token = env.RADAR_TOKEN;
  if (!token) return { skipped: true, skipReason: "no RADAR_TOKEN", ...empty };

  const { targetIp, userAsn, userCountry } = input;
  const scopes: Array<{
    scope: "asn" | "country";
    param: string;
    asn?: number;
    location?: string;
  }> = [];
  if (userAsn)
    scopes.push({ scope: "asn", param: `asn=${userAsn}`, asn: userAsn });
  if (userCountry && /^[A-Z]{2}$/.test(userCountry)) {
    scopes.push({
      scope: "country",
      param: `location=${userCountry}`,
      location: userCountry
    });
  }
  if (!scopes.length && !targetIp) {
    return { skipped: true, skipReason: "nothing to look up", ...empty };
  }

  const errors: string[] = [];
  let calls = 0;
  let failures = 0;
  const attempt = async <T>(path: string): Promise<T | null> => {
    calls++;
    try {
      return await radar<T>(token, path);
    } catch (e) {
      failures++;
      const reason =
        e instanceof Error
          ? e.name === "TimeoutError"
            ? "timed out"
            : e.message
          : String(e);
      errors.push(
        `${path.replace("dateRange=1d&", "")}: ${reason}`.slice(0, 200)
      );
      return null;
    }
  };

  const outageCalls = scopes.map(async (s) => {
    const r = await attempt<{ annotations?: RawOutage[] }>(
      `annotations/outages?dateRange=1d&${s.param}`
    );
    return (r?.annotations ?? []).map((o) => ({ s, o }));
  });
  const anomalyCalls = scopes.map(async (s) => {
    const r = await attempt<{ trafficAnomalies?: RawAnomaly[] }>(
      `traffic_anomalies?dateRange=1d&status=VERIFIED&${s.param}`
    );
    return (r?.trafficAnomalies ?? []).map((a) => ({ s, a }));
  });
  const targetCall = (async (): Promise<
    Pick<RadarEvidence, "targetAsn" | "targetAsName" | "bgp">
  > => {
    if (!targetIp) return { bgp: [] };
    const r = await attempt<{ asn?: { asn?: number; name?: string } }>(
      `entities/asns/ip?ip=${encodeURIComponent(targetIp)}`
    );
    const asn = r?.asn?.asn;
    if (!asn) return { bgp: [] };
    const [hijacks, leaks] = await Promise.all([
      attempt<{ events?: RawHijack[] }>(
        `bgp/hijacks/events?involvedAsn=${asn}&dateRange=1d`
      ),
      attempt<{ events?: RawLeak[] }>(
        `bgp/leaks/events?involvedAsn=${asn}&dateRange=1d`
      )
    ]);
    const bgp: RadarBgpEvent[] = [
      ...(hijacks?.events ?? [])
        .filter((h) => !h.is_stale)
        .map((h) => ({
          kind: "hijack" as const,
          id: String(h.id ?? ""),
          startedAt: h.min_hijack_ts ?? "",
          endedAt: h.max_hijack_ts ?? null,
          confidence: h.confidence_score,
          asns: [
            ...new Set(
              [h.hijacker_asn, ...(h.victim_asns ?? [])].filter(
                (x): x is number => !!x
              )
            )
          ],
          prefixes: (h.prefixes ?? []).slice(0, 5)
        })),
      ...(leaks?.events ?? []).map((l) => ({
        kind: "leak" as const,
        id: String(l.id ?? ""),
        startedAt: l.min_ts ?? l.detected_ts ?? "",
        endedAt: l.finished ? (l.max_ts ?? null) : null,
        asns: [
          ...new Set(
            [l.leak_asn, ...(l.leak_seg ?? [])].filter((x): x is number => !!x)
          )
        ],
        prefixes: []
      }))
    ];
    return {
      targetAsn: asn,
      targetAsName: trim(r?.asn?.name, 80),
      bgp: bgp.sort(newestFirst).slice(0, MAX_ITEMS)
    };
  })();

  const [outageLists, anomalyLists, target] = await Promise.all([
    Promise.all(outageCalls),
    Promise.all(anomalyCalls),
    targetCall
  ]);

  // The ASN and country queries can return the same annotation; keep the first (ASN-scoped) copy.
  const seen = new Set<string>();
  const outages: RadarOutage[] = outageLists
    .flat()
    .filter(({ o }) => {
      const key = o.id ?? `${o.startDate}|${o.description}`;
      return seen.has(key) ? false : (seen.add(key), true);
    })
    .map(({ s, o }) => ({
      scope: s.scope,
      ...(s.asn && { asn: s.asn }),
      ...(s.location && { location: s.location }),
      cause: o.outage?.outageCause,
      outageType: o.outage?.outageType,
      description: trim(o.description),
      startDate: o.startDate ?? "",
      endDate: o.endDate ?? null
    }))
    .sort(newestFirst)
    .slice(0, MAX_ITEMS);

  const anomalies: RadarAnomaly[] = anomalyLists
    .flat()
    .map(({ s, a }) => ({
      scope: s.scope,
      ...(s.asn && { asn: s.asn }),
      ...(s.location && { location: s.location }),
      status: a.status,
      type: a.type,
      startDate: a.startDate ?? "",
      endDate: a.endDate ?? null
    }))
    .sort(newestFirst)
    .slice(0, MAX_ITEMS);

  const allFailed = calls > 0 && failures === calls;
  return {
    skipped: allFailed,
    ...(allFailed && { skipReason: "all Radar calls failed" }),
    ...target,
    outages,
    anomalies,
    errors
  };
}
