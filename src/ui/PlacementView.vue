<script setup lang="ts">
import { computed, reactive, ref } from "vue";
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

const complete = computed(() => questions.every((question) => answers[question.key] !== null));

function choose(key: keyof Assessment, value: boolean) {
  answers[key] = value;
}

function submit() {
  if (!complete.value) {
    showMissing.value = true;
    return;
  }
  showMissing.value = false;
  emit("submit", {
    knowsTreble: answers.knowsTreble as boolean,
    knowsBass: answers.knowsBass as boolean,
    keepsPulse: answers.keepsPulse as boolean,
  });
}
</script>

<template>
  <div class="surface placement">
    <header>
      <h1>三道自评</h1>
      <p class="lead">只决定从哪一课开始，不会直接打开视奏。</p>
    </header>

    <ol class="questions">
      <li v-for="question in questions" :key="question.key" class="question">
        <p class="q-prompt">{{ question.prompt }}</p>
        <div class="segments" role="group" :aria-label="question.prompt">
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
        </div>
      </li>
    </ol>

    <footer class="foot">
      <p v-if="showMissing" class="note warn">三道都要选。</p>
      <button type="button" class="primary" data-test="submit" @click="submit">提交</button>
    </footer>
  </div>
</template>

<style scoped>
.placement {
  display: flex;
  flex-direction: column;
  gap: var(--pb-space-4);
}

header h1 {
  margin: 0 0 var(--pb-space-2);
}

header .lead {
  margin: 0;
}

.questions {
  display: grid;
  gap: var(--pb-space-3);
  margin: 0;
  padding: 0;
  list-style: none;
}

/* 宽屏三题并排：三道题一眼看全，不用上下扫 */
@media (min-width: 760px) {
  .questions {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

.question {
  display: flex;
  flex-direction: column;
  gap: var(--pb-space-2);
  padding: var(--pb-space-4);
  border: 1px solid var(--pb-border-soft);
  border-radius: var(--pb-radius);
  background: var(--pb-surface);
}

.q-prompt {
  margin: 0;
  font-weight: 600;
}

/* 分段控件贴着内容宽度，并压到卡片底部，三张卡的按钮横向对齐 */
.question .segments {
  align-self: flex-start;
}

.foot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: var(--pb-space-2) var(--pb-space-3);
  padding-top: var(--pb-space-2);
}

.foot .note {
  margin: 0;
  margin-right: auto;
}

.warn {
  color: var(--pb-warn);
}

.primary {
  padding: 0.6rem 1.2rem;
  border: 1px solid var(--pb-accent-2);
  border-radius: var(--pb-radius);
  background: var(--pb-accent-2);
  color: var(--pb-accent-text);
  font-weight: 600;
  cursor: pointer;
}
</style>
