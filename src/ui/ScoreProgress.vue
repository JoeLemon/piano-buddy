<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{
  value: number;
  /** 可选：进度条右侧的小字，例如「第 2/4 小节」。 */
  label?: string;
  /** 可选：小节数，> 1 时在进度条上画出小节刻度。 */
  measures?: number;
}>();

const percent = computed(() => {
  const value = Number(props.value);
  const ratio = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
  return Math.round(ratio * 100);
});

const ticks = computed(() => {
  const measures = Number(props.measures);
  if (!Number.isFinite(measures) || measures < 2) return [];
  const count = Math.floor(measures);
  return Array.from({ length: count - 1 }, (_unused, index) => ((index + 1) / count) * 100);
});
</script>

<template>
  <div class="progress-row">
    <div
      class="score-progress"
      data-test="score-progress"
      role="progressbar"
      :aria-valuenow="percent"
      aria-valuemin="0"
      aria-valuemax="100"
    >
      <div class="fill" :style="{ width: `${percent}%` }"></div>
      <span v-for="tick in ticks" :key="tick" class="tick" :style="{ left: `${tick}%` }"></span>
    </div>
    <span v-if="label" class="label" data-test="score-progress-label">{{ label }}</span>
  </div>
</template>

<style scoped>
.progress-row {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  margin: 0 0 1rem;
}

.score-progress {
  position: relative;
  flex: 1;
  min-width: 0;
  height: 0.4rem;
  border-radius: var(--pb-radius-pill);
  background: var(--pb-border-soft);
  overflow: hidden;
}

/* 练习完成度：填充用香槟金点缀色，是规范里少数允许大面积用金的位置 */
.fill {
  height: 100%;
  border-radius: var(--pb-radius-pill);
  background: var(--pb-accent-2);
  transition: width 160ms ease-out;
}

.tick {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  transform: translateX(-1px);
  background: var(--pb-muted);
  opacity: 0.35;
}

.label {
  flex: none;
  font-size: 0.85rem;
  color: var(--pb-muted);
  font-variant-numeric: tabular-nums;
}
</style>
