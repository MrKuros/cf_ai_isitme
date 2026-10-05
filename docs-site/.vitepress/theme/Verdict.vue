<!-- The verdict chip, as the app draws it (ui.tsx VerdictBadge). -->
<script setup>
import { computed } from "vue";
import { verdictInfo } from "./verdicts";

const props = defineProps({
  /** One of the twelve verdict names, e.g. "DOWN_GLOBAL". */
  v: { type: String, required: true },
  /** Subtype label, shown after a middot. */
  sub: { type: String, default: "" },
  /** 0..1; shown as a percentage when given. */
  confidence: { type: Number, default: undefined }
});

const info = computed(() => verdictInfo(props.v));
</script>

<template>
  <span class="verdict-chip" :class="`tone-${info.tone}`">
    <span class="tone-dot" />
    {{ info.label }}
    <span v-if="sub" class="sub">· {{ sub }}</span>
    <span v-if="confidence !== undefined" class="conf">
      {{ Math.round(confidence * 100) }}%
    </span>
  </span>
</template>
