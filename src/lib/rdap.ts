// RDAP registration data, used only to explain NXDOMAIN. Never a verdict driver.
import type { Evidence } from "../shared/types";

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null;
const str = (v: unknown, max = 200) =>
  typeof v === "string" ? v.slice(0, max) : undefined;

/** Pure: an RDAP domain object -> the fields we keep, or null when it isn't one. */
export function parseRdap(json: unknown): Evidence["rdap"] {
  if (!isObj(json)) return null;
  const events = Array.isArray(json.events) ? json.events.filter(isObj) : [];
  const expiresAt = str(
    events.find((e) => e.eventAction === "expiration")?.eventDate,
    40
  );
  const status = Array.isArray(json.status)
    ? json.status
        .map((s) => str(s, 60))
        .filter((s): s is string => !!s)
        .slice(0, 10)
    : [];
  let registrar: string | undefined;
  for (const e of Array.isArray(json.entities) ? json.entities : []) {
    if (!isObj(e) || !Array.isArray(e.roles) || !e.roles.includes("registrar"))
      continue;
    const props = Array.isArray(e.vcardArray) ? e.vcardArray[1] : undefined;
    const fn = Array.isArray(props)
      ? props.find((p) => Array.isArray(p) && p[0] === "fn")
      : undefined;
    registrar = str(fn?.[3]);
    if (registrar) break;
  }
  if (!expiresAt && !status.length && !registrar) return null;
  return {
    ...(expiresAt && { expiresAt }),
    ...(status.length && { status }),
    ...(registrar && { registrar })
  };
}

/** Never throws; null = unknown domain or rdap.org unavailable. */
export async function rdapLookup(domain: string): Promise<Evidence["rdap"]> {
  try {
    const res = await fetch(
      `https://rdap.org/domain/${encodeURIComponent(domain)}`,
      {
        headers: { accept: "application/rdap+json" },
        signal: AbortSignal.timeout(5000)
      }
    );
    if (!res.ok) {
      res.body?.cancel().catch(() => {});
      return null;
    }
    return parseRdap(await res.json());
  } catch {
    return null;
  }
}
