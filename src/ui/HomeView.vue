<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{
  rightUnlocked: boolean;
  leftUnlocked: boolean;
}>();

const emit = defineEmits<{
  "open-reading": [];
  "open-sight": [];
  "open-placement": [];
}>();

const bothLocked = computed(() => !props.rightUnlocked && !props.leftUnlocked);
const bothPassed = computed(() => props.rightUnlocked && props.leftUnlocked);

function openSight() {
  if (bothLocked.value) {
    emit("open-reading");
    return;
  }
  emit("open-sight");
}
</script>

<template>
  <section class="home">
    <div class="panel">
      <h1>识谱和视奏</h1>
      <p class="lead">视奏只用已经认过的音。</p>
      <button type="button" data-test="reading" @click="emit('open-reading')">先认谱</button>
      <button type="button" data-test="sight" @click="openSight">5 分钟视奏</button>
      <p v-if="bothLocked" class="note">先认识这五个音，视奏里只会用到它们。</p>
      <p v-if="bothPassed" class="note">L1 的音已经通过了。</p>
      <button type="button" class="quiet" data-test="placement" @click="emit('open-placement')">三道自评</button>
    </div>
  </section>
</template>

<style scoped>
.home {
  min-height: 100vh;
  box-sizing: border-box;
  background: #faf7f1;
  color: #1c1c1c;
  color-scheme: light;
  font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
}

.panel {
  max-width: 24rem;
  margin: 0 auto;
  padding: 2rem 1.25rem;
}

h1 {
  margin: 0 0 0.5rem;
  font-size: 1.75rem;
  font-weight: 600;
  letter-spacing: 0;
}

.lead,
.note {
  margin: 0 0 1rem;
  color: #3f3f3f;
  line-height: 1.5;
}

button {
  display: block;
  width: 100%;
  margin: 0 0 0.75rem;
  padding: 0.85rem 1rem;
  border: 1px solid #2a2a2a;
  border-radius: 4px;
  background: #fff;
  color: #1c1c1c;
  font: inherit;
  font-size: 1rem;
  text-align: left;
  cursor: pointer;
}

button[data-test="reading"] {
  background: #f3c84b;
}

.quiet {
  width: auto;
  margin-top: 0.5rem;
  padding: 0;
  border: 0;
  background: transparent;
  color: #3f3f3f;
  text-decoration: underline;
  text-underline-offset: 0.2rem;
}
</style>
