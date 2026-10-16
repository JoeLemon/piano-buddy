<script setup lang="ts">
defineProps<{
  title?: string;
  midiConnected: boolean;
  showBack?: boolean;
}>();

const emit = defineEmits<{
  back: [];
}>();
</script>

<template>
  <section class="shell">
    <header class="bar">
      <button
        v-if="showBack"
        type="button"
        class="back"
        data-test="home"
        @click="emit('back')"
      >
        返回
      </button>
      <p
        class="midi"
        :data-connected="midiConnected ? 'true' : 'false'"
        data-test="midi-status"
      >
        <span v-if="midiConnected">MIDI 已连接</span>
        <span v-else>未连接 MIDI。用 Chrome 接上 USB 键盘后再弹。</span>
      </p>
    </header>
    <div class="panel">
      <h1 v-if="title">{{ title }}</h1>
      <slot />
    </div>
  </section>
</template>

<style scoped>
.shell {
  min-height: 100vh;
  background:
    radial-gradient(120% 80% at 10% 0%, rgb(201 132 42 / 12%), transparent 55%),
    var(--pb-bg);
  color: var(--pb-ink);
}

.bar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem 1rem;
  align-items: center;
  justify-content: space-between;
  max-width: 52rem;
  margin: 0 auto;
  padding: 1rem 1.25rem 0;
}

.back {
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--pb-muted);
  text-decoration: underline;
  text-underline-offset: 0.2rem;
  cursor: pointer;
}

.midi {
  margin: 0;
  color: var(--pb-muted);
  font-size: 0.95rem;
}

.midi[data-connected="false"] {
  color: var(--pb-warn);
}

.panel {
  max-width: 52rem;
  margin: 0 auto;
  padding: 1rem 1.25rem 2.5rem;
}

.panel > :deep(.surface) {
  background: var(--pb-surface);
  border: 1px solid rgb(42 51 68 / 12%);
  border-radius: var(--pb-radius);
  box-shadow: var(--pb-shadow);
  padding: 1.25rem 1.35rem 1.5rem;
}

h1 {
  margin: 0 0 0.75rem;
  font-family: var(--pb-font-display);
  font-size: 1.85rem;
  font-weight: 600;
  letter-spacing: -0.02em;
}
</style>
