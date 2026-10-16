<script setup lang="ts">
import { blackKeyMidis, whiteKeyMidis } from "../notation/renderScore";

defineProps<{
  highlightMidi: number | null;
}>();

const whites = whiteKeyMidis();
const blackMidis = new Set(blackKeyMidis());
const blacks = whites.flatMap((midi, slot) => (blackMidis.has(midi + 1) ? [{ midi: midi + 1, slot }] : []));
</script>

<template>
  <div class="keyboard" data-test="keyboard">
    <div
      v-for="midi in whites"
      :key="midi"
      class="white-key"
      :class="{ 'is-target': midi === highlightMidi }"
    />
    <div
      v-for="key in blacks"
      :key="key.midi"
      class="black-key"
      :class="{ 'is-target': key.midi === highlightMidi }"
      :style="{ '--slot': String(key.slot) }"
    />
  </div>
</template>

<style scoped>
.keyboard {
  --white-w: 28px;
  --key-gap: 2px;
  --black-w: 18px;
  position: relative;
  display: flex;
  align-items: flex-end;
  gap: var(--key-gap);
  max-width: 100%;
  overflow-x: auto;
  user-select: none;
}

.white-key {
  flex: 0 0 var(--white-w);
  width: var(--white-w);
  height: 120px;
  box-sizing: border-box;
  background: #fff;
  border: 1px solid var(--pb-border);
  border-radius: 0 0 4px 4px;
  box-shadow: inset 0 -2px 0 rgb(0 0 0 / 12%);
}

.black-key {
  position: absolute;
  top: 0;
  left: calc(
    var(--slot) * (var(--white-w) + var(--key-gap)) + var(--white-w) + var(--key-gap) / 2 - var(--black-w) / 2
  );
  z-index: 1;
  width: var(--black-w);
  height: 74px;
  box-sizing: border-box;
  background: var(--pb-ink);
  border: 1px solid var(--pb-border);
  border-radius: 0 0 3px 3px;
  box-shadow: inset 0 -2px 0 rgb(0 0 0 / 35%);
  pointer-events: none;
}

.white-key.is-target,
.black-key.is-target {
  background: var(--pb-accent);
}
</style>
