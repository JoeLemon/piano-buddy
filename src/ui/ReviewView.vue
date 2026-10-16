<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import type { Hand, Score } from "../domain/types";
import { markMapFromIds, markStaffNotes } from "../notation/markStaff";
import { renderScore } from "../notation/renderScore";

const props = defineProps<{
  feedback: string;
  score: Score;
  hand: Hand;
  wrongPitchNoteIds: string[];
  lateNoteIds: string[];
  hasErrorBook: boolean;
}>();

const emit = defineEmits<{
  next: [];
  home: [];
  "retry-error": [];
}>();

const staffEl = ref<HTMLElement | null>(null);

watch(
  [staffEl, () => props.score, () => props.wrongPitchNoteIds, () => props.lateNoteIds],
  draw,
  { flush: "post" },
);
onMounted(draw);

function draw() {
  const el = staffEl.value;
  if (!el) return;
  renderScore(el, props.score, props.hand, true);
  markStaffNotes(
    el,
    props.score,
    props.hand,
    markMapFromIds(props.wrongPitchNoteIds, props.lateNoteIds),
  );
}
</script>

<template>
  <div class="surface">
    <h1>复盘</h1>
    <p data-test="feedback">{{ feedback }}</p>
    <p class="legend">
      <span class="pitch">错音</span>
      <span class="late">偏晚</span>
    </p>
    <div ref="staffEl" class="staff" data-test="review-staff"></div>
    <div class="actions">
      <button type="button" class="primary" data-test="next-line" @click="emit('next')">
        再看一条新的
      </button>
      <button
        v-if="hasErrorBook"
        type="button"
        data-test="retry-error"
        @click="emit('retry-error')"
      >
        练这条错题
      </button>
      <button type="button" data-test="review-home" @click="emit('home')">回首页</button>
    </div>
  </div>
</template>

<style scoped>
h1 {
  margin: 0 0 0.5rem;
  font-family: var(--pb-font-display);
  font-size: 1.85rem;
  font-weight: 600;
}

p {
  margin: 0 0 1rem;
  color: var(--pb-muted);
}

.legend {
  display: flex;
  gap: 1rem;
  font-size: 0.9rem;
}

.pitch {
  color: var(--pb-pitch-mark);
}

.late {
  color: var(--pb-late-mark);
}

.staff {
  overflow-x: auto;
  margin: 0 0 1rem;
}

.staff :deep([data-wrong] path) {
  fill: var(--pb-pitch-mark);
  stroke: var(--pb-pitch-mark);
}

.staff :deep([data-late] path) {
  fill: var(--pb-late-mark);
  stroke: var(--pb-late-mark);
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
}

button {
  padding: 0.55rem 0.9rem;
  border: 1px solid var(--pb-border);
  border-radius: var(--pb-radius);
  background: var(--pb-surface);
  color: var(--pb-ink);
  cursor: pointer;
}

.primary {
  background: var(--pb-accent);
  border-color: var(--pb-accent);
  color: var(--pb-accent-text);
}
</style>
