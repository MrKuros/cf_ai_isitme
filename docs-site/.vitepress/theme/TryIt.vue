<!--
  A live check against the deployed app's public API.
  /api/v1/check sends `access-control-allow-origin: *` (src/server.ts withCors),
  so the docs site can call it from the browser. Anything else — a rate limit,
  a bad host, no deployment yet — falls back to the recorded example.
-->
<script setup>
import { ref } from "vue";
import ResultCard from "./ResultCard.vue";
import { SITE_URL } from "./site";

const target = ref("github.com");
const busy = ref(false);
/** null = nothing run yet; false = fell back to the example. */
const result = ref(null);
const fallback = ref("");

// A sync check runs the whole workflow, which takes ~15-20s.
const TIMEOUT_MS = 45_000;

async function run() {
  busy.value = true;
  result.value = null;
  fallback.value = "";
  const started = performance.now();
  try {
    const res = await fetch(
      `${SITE_URL}/api/v1/check?url=${encodeURIComponent(target.value)}`,
      { signal: AbortSignal.timeout(TIMEOUT_MS) }
    );
    const body = await res.json();
    if (res.status === 429) {
      fallback.value =
        "The hosted demo is rate-limited right now, so here's a recorded example.";
    } else if (!body?.ok) {
      fallback.value = body?.error
        ? `The check couldn't run (${body.error}), so here's a recorded example.`
        : "The check couldn't run, so here's a recorded example.";
    } else {
      result.value = {
        host: body.host,
        verdict: body.verdict,
        sub: (body.subtype ?? "").replace(/_/g, " "),
        confidence: body.confidence,
        elapsed: (performance.now() - started) / 1000,
        signals: body.signals ?? [],
        explanation: body.explanation ?? "",
        reportPath: body.reportPath ?? ""
      };
    }
  } catch {
    fallback.value =
      "Couldn't reach the hosted demo, so here's a recorded example.";
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="tryit">
    <form @submit.prevent="run">
      <input
        v-model="target"
        type="text"
        inputmode="url"
        autocapitalize="off"
        spellcheck="false"
        aria-label="Site to check"
        placeholder="example.com"
      />
      <button type="submit" :disabled="busy || !target.trim()">
        {{ busy ? "Checking…" : "Check it" }}
      </button>
    </form>
    <p v-if="busy" class="fallback">
      Running all three vantage points — this takes about 20 seconds.
    </p>
    <div v-if="result || fallback" class="out">
      <p v-if="fallback" class="fallback">{{ fallback }}</p>
      <ResultCard v-if="result" v-bind="result" note="" />
      <ResultCard v-else note="" />
    </div>
  </div>
</template>
