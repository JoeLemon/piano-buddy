<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import type { Hand, Score } from "../domain/types";
import { renderScore } from "../notation/renderScore";

const props = defineProps<{
  feedback: string;
  score: Score;
  hand: Hand;
  wrongNoteIds: string[];
}>();

const emit = defineEmits<{
  next: [];
}>();

const staffEl = ref<HTMLElement | null>(null);

watch([staffEl, () => props.score, () => props.wrongNoteIds], draw, { flush: "post" });
onMounted(draw);

function draw() {
  const el = staffEl.value;
  if (!el) return;
  renderScore(el, props.score, props.hand, true);
  const ids = new Set(props.wrongNoteIds);
  const groups = Array.from(el.querySelectorAll(".vf-stavenote"));
  const notes = (props.score.staves[props.hand]?.measures ?? []).flatMap((measure) => measure.notes);
  notes.forEach((note, index) => {
    const group = groups[index];
    if (!group || !ids.has(note.id)) return;
    group.setAttribute("data-wrong", "true");
    const paths = group.querySelectorAll("path");
    for (let pathIndex = 0; pathIndex < paths.length; pathIndex += 1) {
      const path = paths.item(pathIndex);
      if (!path) continue;
      path.setAttribute("fill", "#8a3d12");
      path.setAttribute("stroke", "#8a3d12");
    }
  });
}
</script>

<template>
  <section class="review">
    <div class="panel">
      <h1>复盘</h1>
      <p data-test="feedback">{{ feedback }}</p>
      <div ref="staffEl" class="staff"></div>
      <button type="button" data-test="next-line" @click="emit('next')">再看一条新的</button>
    </div>
  </section>
</template>

<style scoped>
.review {
  min-height: 100vh;
  box-sizing: border-box;
  background: #faf7f1;
  color: #1c1c1c;
  color-scheme: light;
  font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
}

.panel {
  max-width: 52rem;
  margin: 0 auto;
  padding: 2rem 1.25rem;
}

h1 {
  margin: 0 0 0.5rem;
  font-size: 1.75rem;
  font-weight: 600;
}

p {
  margin: 0 0 1rem;
  color: #3f3f3f;
  line-height: 1.5;
}

button {
  padding: 0.55rem 0.9rem;
  border: 1px solid #2a2a2a;
  border-radius: 4px;
  background: #f3c84b;
  color: #1c1c1c;
  font: inherit;
  cursor: pointer;
}

.staff {
  overflow-x: auto;
  margin: 0 0 1rem;
}

.staff :deep([data-wrong] path) {
  fill: #8a3d12;
  stroke: #8a3d12;
}
</style>
