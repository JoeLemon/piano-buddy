<script setup lang="ts">
import { computed } from "vue";
import { homeLessonLabel } from "../domain/lessonProgress";
import type { Profile } from "../domain/profile";

const props = defineProps<{
  profile: Profile;
  rightUnlocked: boolean;
  leftUnlocked: boolean;
}>();

const emit = defineEmits<{
  "open-reading": [];
  "open-sight": [];
  "open-placement": [];
  "open-error": [];
}>();

const bothLocked = computed(() => !props.rightUnlocked && !props.leftUnlocked);
const bothPassed = computed(() => props.rightUnlocked && props.leftUnlocked);
const hasErrors = computed(
  () => props.profile.errorSnippets.length > 0 && (props.rightUnlocked || props.leftUnlocked),
);
const lessonLabel = computed(() => homeLessonLabel(props.profile));

function openSight() {
  if (bothLocked.value) {
    emit("open-reading");
    return;
  }
  emit("open-sight");
}
</script>

<template>
  <div class="surface" data-test="home-surface">
    <p class="brand">Piano Buddy</p>
    <h1>识谱和视奏</h1>
    <p class="lead">视奏只用已经认过的音。</p>
    <p class="status" data-test="lesson-status">{{ lessonLabel }}</p>
    <p class="hands">
      右手{{ rightUnlocked ? "已解锁" : "未解锁" }} · 左手{{ leftUnlocked ? "已解锁" : "未解锁" }}
    </p>
    <button type="button" class="primary" data-test="reading" @click="emit('open-reading')">先认谱</button>
    <button type="button" data-test="sight" @click="openSight">5 分钟视奏</button>
    <button
      v-if="hasErrors"
      type="button"
      data-test="error-book"
      @click="emit('open-error')"
    >
      练一条错题
    </button>
    <p v-if="bothLocked" class="note">
      视奏里只会用到已经认过的五个音，先把它们认准。
    </p>
    <p v-if="bothPassed && !profile.l2Passed" class="note">
      L1 的音已经通过了。接下来是 L2：八分音符、双手，还有 F 调和 G 调。
    </p>
    <p v-if="profile.l2Passed" class="note" data-test="l2-done">
      L2 也过了。视奏现在是双手的。
    </p>
    <button type="button" class="quiet" data-test="placement" @click="emit('open-placement')">
      三道自评
    </button>
  </div>
</template>

<style scoped>
.brand {
  margin: 0 0 0.35rem;
  color: var(--pb-accent);
  font-family: var(--pb-font-display);
  font-size: 1.05rem;
  font-weight: 600;
  letter-spacing: 0.02em;
}

h1 {
  margin: 0 0 0.5rem;
  font-family: var(--pb-font-display);
  font-size: 1.85rem;
  font-weight: 600;
}

.lead,
.note,
.status,
.hands {
  margin: 0 0 0.85rem;
  color: var(--pb-muted);
}

.status {
  color: var(--pb-ink);
  font-weight: 600;
}

button {
  display: block;
  width: 100%;
  margin: 0 0 0.75rem;
  padding: 0.85rem 1rem;
  border: 1px solid var(--pb-border);
  border-radius: var(--pb-radius);
  background: var(--pb-surface);
  color: var(--pb-ink);
  text-align: left;
  cursor: pointer;
}

.primary,
button[data-test="sight"] {
  background: var(--pb-surface);
  font-weight: 600;
}

.primary {
  background: var(--pb-accent);
  color: var(--pb-accent-text);
  border-color: var(--pb-accent);
}

.quiet {
  width: auto;
  margin-top: 0.5rem;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--pb-muted);
  text-decoration: underline;
  text-underline-offset: 0.2rem;
}
</style>
