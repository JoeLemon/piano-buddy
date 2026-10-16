<script setup lang="ts">
import { whiteKeyMidis } from "../notation/renderScore";

defineProps<{
  highlightMidi: number | null;
}>();

const midis = whiteKeyMidis();
</script>

<template>
  <div class="keyboard" data-test="keyboard">
    <div
      v-for="midi in midis"
      :key="midi"
      class="white-key"
      :class="{ 'is-target': midi === highlightMidi }"
    />
  </div>
</template>

<style scoped>
.keyboard {
  display: flex;
  align-items: flex-end;
  gap: 2px;
  user-select: none;
}

.white-key {
  width: 28px;
  height: 120px;
  box-sizing: border-box;
  background: #fff;
  border: 1px solid var(--pb-border);
  border-radius: 0 0 4px 4px;
  box-shadow: inset 0 -2px 0 rgb(0 0 0 / 12%);
}

.white-key.is-target {
  background: var(--pb-accent);
}
</style>
