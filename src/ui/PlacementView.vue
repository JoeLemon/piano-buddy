<script setup lang="ts">
import { reactive, ref } from "vue";
import type { Assessment } from "../domain/profile";

const emit = defineEmits<{
  submit: [assessment: Assessment];
}>();

const questions: { key: keyof Assessment; prompt: string }[] = [
  { key: "knowsTreble", prompt: "认识高音谱吗？" },
  { key: "knowsBass", prompt: "认识低音谱吗？" },
  { key: "keepsPulse", prompt: "跟得上拍吗？" },
];

const answers = reactive<Record<keyof Assessment, boolean | null>>({
  knowsTreble: null,
  knowsBass: null,
  keepsPulse: null,
});

const showMissing = ref(false);

function choose(key: keyof Assessment, value: boolean) {
  answers[key] = value;
}

function submit() {
  if (answers.knowsTreble === null || answers.knowsBass === null || answers.keepsPulse === null) {
    showMissing.value = true;
    return;
  }
  showMissing.value = false;
  emit("submit", {
    knowsTreble: answers.knowsTreble,
    knowsBass: answers.knowsBass,
    keepsPulse: answers.keepsPulse,
  });
}
</script>

<template>
  <section class="placement">
    <div class="panel">
      <h1>三道自评</h1>
      <p class="lead">只用来决定从哪一课开始，不会直接打开视奏。</p>
      <fieldset v-for="question in questions" :key="question.key">
        <legend>{{ question.prompt }}</legend>
        <button
          type="button"
          :data-test="`${question.key}-yes`"
          :aria-pressed="answers[question.key] === true"
          @click="choose(question.key, true)"
        >
          会
        </button>
        <button
          type="button"
          :data-test="`${question.key}-no`"
          :aria-pressed="answers[question.key] === false"
          @click="choose(question.key, false)"
        >
          还不会
        </button>
      </fieldset>
      <p v-if="showMissing" class="note">三道都要选。</p>
      <button type="button" data-test="submit" @click="submit">提交</button>
    </div>
  </section>
</template>

<style scoped>
.placement {
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
}

.lead,
.note {
  margin: 0 0 1rem;
  color: #3f3f3f;
  line-height: 1.5;
}

fieldset {
  margin: 0 0 1rem;
  padding: 0;
  border: 0;
}

legend {
  margin-bottom: 0.5rem;
  padding: 0;
}

fieldset button,
button[data-test="submit"] {
  margin: 0 0.5rem 0 0;
  padding: 0.55rem 0.9rem;
  border: 1px solid #2a2a2a;
  border-radius: 4px;
  background: #fff;
  color: #1c1c1c;
  font: inherit;
  cursor: pointer;
}

button[aria-pressed="true"] {
  background: #f3c84b;
}

button[data-test="submit"] {
  display: block;
  margin-top: 0.25rem;
  background: #f3c84b;
}
</style>
