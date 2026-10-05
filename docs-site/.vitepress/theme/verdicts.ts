/**
 * Labels, headlines and tones for the twelve verdicts.
 *
 * ponytail: a deliberate copy of `VERDICTS` in `src/client/components/ui.tsx`.
 * That module imports React, Phosphor icons and Tailwind classes, none of
 * which belong in a VitePress build. Keep the two in sync by hand; the list
 * only changes when `Verdict` in `src/shared/types.ts` does.
 */
export type Tone = "good" | "warn" | "bad" | "you" | "dns" | "idle";

export const VERDICTS: Record<
  string,
  { label: string; headline: string; tone: Tone }
> = {
  HEALTHY: {
    label: "Healthy",
    headline: "It's up. Not you, not them.",
    tone: "good"
  },
  SLOW: { label: "Slow", headline: "It's up, but slow.", tone: "warn" },
  DOWN_GLOBAL: {
    label: "Down everywhere",
    headline: "It's down from everywhere we checked.",
    tone: "bad"
  },
  DOWN_REGIONAL: {
    label: "Down in some regions",
    headline: "It's down in some parts of the world.",
    tone: "warn"
  },
  DNS_FAILURE: {
    label: "DNS failure",
    headline: "The name doesn't resolve.",
    tone: "dns"
  },
  LIKELY_YOUR_NETWORK: {
    label: "Likely your network",
    headline: "It's probably you.",
    tone: "you"
  },
  ISP_OUTAGE: {
    label: "ISP/regional outage",
    headline: "Looks like your ISP or regional network.",
    tone: "you"
  },
  UPSTREAM_OUTAGE: {
    label: "Upstream outage",
    headline: "Their network provider is having trouble.",
    tone: "bad"
  },
  BLOCKED: {
    label: "Blocks bots",
    headline: "It's up, but it blocks automated checks.",
    tone: "warn"
  },
  TLS_ERROR: {
    label: "Certificate error",
    headline: "It's up, but its certificate is broken.",
    tone: "bad"
  },
  PARTIAL: {
    label: "Partly broken",
    headline: "It answers, but the page looks broken.",
    tone: "warn"
  },
  INCONCLUSIVE: {
    label: "Inconclusive",
    headline: "We couldn't tell.",
    tone: "idle"
  }
};

/** Unknown names degrade instead of breaking the build. */
export const verdictInfo = (v: string) =>
  VERDICTS[v] ?? { label: v, headline: v, tone: "idle" as Tone };
