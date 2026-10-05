<!--
  A result card, laid out like src/client/components/DiagnosisCard.tsx.
  With no props it renders the recorded example used by the home hero and as
  TryIt's fallback; TryIt passes a live outcome's fields instead.
-->
<script setup>
import { computed } from "vue";
import Verdict from "./Verdict.vue";
import { verdictInfo } from "./verdicts";
import { SITE_URL } from "./site";

const props = defineProps({
  host: { type: String, default: "github.com" },
  verdict: { type: String, default: "HEALTHY" },
  sub: { type: String, default: "" },
  confidence: { type: Number, default: 0.95 },
  /** Seconds the check took. */
  elapsed: { type: Number, default: 10.4 },
  signals: {
    type: Array,
    default: () => [
      "Cloudflare's edge (MXP) got HTTP 200 in 46ms",
      "5/5 regions reachable (median 61ms)",
      "DNS resolved to 1 address in 2ms",
      "Your browser could reach it in 495ms",
      "5 checks in the last 10 min, 0 failing",
      "No ongoing Radar outages or anomalies for your network",
      "All 5 outside probes reached it"
    ]
  },
  explanation: {
    type: String,
    default:
      "The site is reachable from all locations. Your browser could reach it in 495ms. All outside probes and regions also reached it successfully."
  },
  /** Path like "/r/github.com/<id>", or "" for no link. */
  reportPath: { type: String, default: "" },
  /** Small grey line under the card. */
  note: { type: String, default: "Example result — run a real one below." }
});

const tone = computed(() => `tone-${verdictInfo(props.verdict).tone}`);
const headline = computed(() => verdictInfo(props.verdict).headline);
</script>

<template>
  <article class="result-card" :class="tone">
    <header>
      <span class="host">{{ host }}</span>
      <span v-if="elapsed !== undefined" class="elapsed">
        {{ elapsed.toFixed(1) }}s
      </span>
      <span class="chip">
        <Verdict :v="verdict" :sub="sub" :confidence="confidence" />
      </span>
    </header>
    <div class="body">
      <h3 class="headline">{{ headline }}</h3>
      <ul v-if="signals.length" class="signals">
        <li v-for="(s, i) in signals" :key="i">
          <span class="tone-dot" />
          <span>{{ s }}</span>
        </li>
      </ul>
      <p v-if="explanation" class="explain">{{ explanation }}</p>
      <div class="tools">
        <a
          v-if="reportPath"
          :href="SITE_URL + reportPath"
          target="_blank"
          rel="noreferrer"
        >
          Full report
        </a>
        <span v-else class="btn">Full report</span>
      </div>
      <p v-if="note" class="note">{{ note }}</p>
    </div>
  </article>
</template>
