<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import type { Hand, Score } from "../domain/types";
import {
  grandMarkMapFromIds,
  markGrandStaffNotes,
  markMapFromIds,
  markStaffNotes,
} from "../notation/markStaff";
import { renderGrandScore, renderScore } from "../notation/renderScore";

const props = defineProps<{
  feedback: string;
  score: Score;
  hand: Hand | "BOTH";
  wrongPitchNoteIds: string[];
  lateNoteIds: string[];
  hasErrorBook: boolean;
  /** 复盘后的主按钮文案：曲库跟弹是「回到曲库」，视奏是「再看一条新的」。 */
  nextLabel?: string;
}>();

const emit = defineEmits<{
  next: [];
  "retry-error": [];
}>();

const staffEl = ref<HTMLElement | null>(null);
const grand = computed(() => props.score.hands.length === 2);

/** 练习总览：小节数量 + 简要错误描述（不用百分制）。 */
const summary = computed(() => {
  const measures = grand.value
    ? Math.max(
      props.score.staves.RH?.measures.length ?? 0,
      props.score.staves.LH?.measures.length ?? 0,
    )
    : props.score.staves[props.hand as Hand]?.measures.length ?? 0;
  return [
    `共 ${measures} 小节`,
    `错音 ${props.wrongPitchNoteIds.length} 处`,
    `节奏偏差 ${props.lateNoteIds.length} 处`,
  ].join(" · ");
});

watch(
  [staffEl, () => props.score, () => props.wrongPitchNoteIds, () => props.lateNoteIds],
  draw,
  { flush: "post" },
);
onMounted(draw);

function draw() {
  const el = staffEl.value;
  if (!el) return;
  if (grand.value) {
    renderGrandScore(el, props.score, true);
    markGrandStaffNotes(
      el,
      props.score,
      grandMarkMapFromIds(props.score, props.wrongPitchNoteIds, props.lateNoteIds),
    );
    return;
  }
  const hand = props.hand as Hand;
  renderScore(el, props.score, hand, true);
  markStaffNotes(el, props.score, hand, markMapFromIds(props.wrongPitchNoteIds, props.lateNoteIds));
}
</script>

<template>
  <div class="surface">
    <h1>复盘</h1>
    <p data-test="feedback">{{ feedback }}</p>
    <p class="summary" data-test="review-summary">{{ summary }}</p>
    <p class="legend">
      <span class="item"><span class="swatch pitch"></span>错音</span>
      <span class="item"><span class="swatch late"></span>偏晚</span>
    </p>
    <div ref="staffEl" class="staff" data-test="review-staff"></div>
    <div class="actions">
      <button type="button" class="primary" data-test="next-line" @click="emit('next')">
        {{ nextLabel ?? "再看一条新的" }}
      </button>
      <button
        v-if="hasErrorBook"
        type="button"
        data-test="retry-error"
        @click="emit('retry-error')"
      >
        练这条错题
      </button>
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

.summary {
  font-size: 0.9rem;
  font-variant-numeric: tabular-nums;
}

.legend {
  display: flex;
  gap: 1rem;
  font-size: 0.9rem;
}

.legend .item {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
}

.swatch {
  width: 0.7rem;
  height: 0.7rem;
  border-radius: 3px;
}

.swatch.pitch {
  background: var(--pb-pitch-mark);
}

.swatch.late {
  background: var(--pb-late-mark);
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
  background: var(--pb-accent-2);
  border-color: var(--pb-accent-2);
  color: var(--pb-accent-text);
}
</style>
