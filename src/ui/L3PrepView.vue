<script setup lang="ts">
import { computed, ref } from "vue";
import { completeL3PrepLesson, type Profile } from "../domain/profile";
import {
  L3_PREP_LESSONS,
  createL3LessonQuestions,
  isPracticeAnswer,
  type L3PrepLesson,
  type PracticeQuestion,
} from "../practice";
import QuestionStaff from "./QuestionStaff.vue";

const props = defineProps<{
  profile: Profile;
  /** 测试可传固定 seed；真实页面每次进入用随机 seed。 */
  seed?: number;
}>();

const emit = defineEmits<{
  "update-profile": [profile: Profile];
}>();

const baseSeed = props.seed ?? Math.floor(Math.random() * 0xffffffff);
const firstIncomplete =
  L3_PREP_LESSONS.find((lesson) => !props.profile.l3PrepCompleted?.includes(lesson.id)) ??
  L3_PREP_LESSONS[0];

const selectedId = ref(firstIncomplete.id);
const session = ref(0);
const questions = ref<PracticeQuestion[]>(
  createL3LessonQuestions(selectedId.value, baseSeed),
);
const index = ref(0);
const selectedChoiceId = ref<string | null>(null);
const score = ref(0);
const finished = ref(false);
const passed = ref(false);
const localCompleted = ref<string[]>([]);

const lesson = computed(
  () => L3_PREP_LESSONS.find((item) => item.id === selectedId.value) ?? L3_PREP_LESSONS[0],
);
const current = computed(() => questions.value[index.value] ?? null);
const answered = computed(() => selectedChoiceId.value !== null);
const correct = computed(
  () =>
    current.value !== null &&
    selectedChoiceId.value !== null &&
    isPracticeAnswer(current.value, selectedChoiceId.value),
);
const correctChoice = computed(() =>
  current.value?.choices.find((choice) => choice.id === current.value?.answerId) ?? null,
);
const progressText = computed(() =>
  questions.value.length > 0 ? `第 ${index.value + 1} / ${questions.value.length} 题` : "没有题目",
);
const completedIds = computed(
  () => new Set([...(props.profile.l3PrepCompleted ?? []), ...localCompleted.value]),
);
const completedCount = computed(
  () => L3_PREP_LESSONS.filter((item) => completedIds.value.has(item.id)).length,
);
const lessonIndex = computed(() => L3_PREP_LESSONS.findIndex((item) => item.id === selectedId.value));
const nextLesson = computed(() => L3_PREP_LESSONS[lessonIndex.value + 1] ?? null);
const allDone = computed(() => completedCount.value === L3_PREP_LESSONS.length);

function isCompleted(lessonId: string): boolean {
  return completedIds.value.has(lessonId);
}

function selectLesson(next: L3PrepLesson) {
  selectedId.value = next.id;
  session.value += 1;
  questions.value = createL3LessonQuestions(next.id, baseSeed + session.value * 7919);
  index.value = 0;
  selectedChoiceId.value = null;
  score.value = 0;
  finished.value = false;
  passed.value = false;
}

function choose(choiceId: string) {
  if (!current.value || answered.value) return;
  selectedChoiceId.value = choiceId;
  if (isPracticeAnswer(current.value, choiceId)) score.value += 1;
}

function nextQuestion() {
  if (!answered.value) return;
  if (index.value >= questions.value.length - 1) {
    finish();
    return;
  }
  index.value += 1;
  selectedChoiceId.value = null;
}

function finish() {
  finished.value = true;
  passed.value = score.value >= lesson.value.passScore;
  if (!passed.value) return;

  const lessonId = lesson.value.id;
  localCompleted.value = [...new Set([...localCompleted.value, lessonId])];
  if (!props.profile.l3PrepCompleted?.includes(lessonId)) {
    // 组件可能在父级回写 props 之前就切到下一节；把本地已完成的节一起带上，
    // 避免后一次 emit 覆盖前一次。
    const base: Profile = {
      ...props.profile,
      l3PrepCompleted: [
        ...new Set([
          ...(props.profile.l3PrepCompleted ?? []),
          ...localCompleted.value.filter((id) => id !== lessonId),
        ]),
      ],
    };
    emit("update-profile", completeL3PrepLesson(base, lessonId));
  }
}

function restart() {
  selectLesson(lesson.value);
}

function goNextLesson() {
  if (nextLesson.value) selectLesson(nextLesson.value);
}
</script>

<template>
  <div class="surface l3" data-test="l3-prep">
    <p class="progress-line" data-test="l3-overall">
      已完成 {{ completedCount }} / {{ L3_PREP_LESSONS.length }} 节
      <span v-if="allDone"> · 全部完成</span>
    </p>

    <div class="lesson-list" data-test="l3-lessons">
      <button
        v-for="item in L3_PREP_LESSONS"
        :key="item.id"
        type="button"
        class="lesson-card"
        :class="{ active: item.id === selectedId, done: isCompleted(item.id) }"
        :aria-pressed="item.id === selectedId"
        :data-test="`l3-lesson-${item.id}`"
        @click="selectLesson(item)"
      >
        <strong>{{ item.title }}</strong>
        <span>{{ item.goal }}</span>
        <small>{{ isCompleted(item.id) ? "✓ 已完成" : `${item.questionCount} 题` }}</small>
      </button>
    </div>

    <section class="lesson" data-test="l3-current">
      <div class="lesson-head">
        <h2>{{ lesson.goal }}</h2>
      </div>
      <p class="intro">{{ lesson.intro }}</p>

      <section v-if="finished" class="summary" data-test="l3-summary">
        <h3 v-if="passed">本节完成：答对 {{ score }} / {{ questions.length }}</h3>
        <h3 v-else>还差一点：答对 {{ score }} / {{ questions.length }}</h3>
        <p class="muted">
          <template v-if="passed">
            已记入「学习中」，曲库的缺技能清单不会因此直接消失。
          </template>
          <template v-else>
            本节至少需要答对 {{ lesson.passScore }} 题。再看一遍解释，换一组题重来。
          </template>
        </p>
        <div class="summary-actions">
          <button type="button" class="primary" data-test="l3-restart" @click="restart">
            再答一组
          </button>
          <button
            v-if="passed && nextLesson"
            type="button"
            data-test="l3-next-lesson"
            @click="goNextLesson"
          >
            下一节：{{ nextLesson.title }}
          </button>
        </div>
      </section>

      <section v-else-if="current" class="quiz" data-test="l3-quiz">
        <div class="quiz-head">
          <p class="progress" data-test="l3-progress">{{ progressText }}</p>
        </div>

        <div class="prompt" data-test="l3-prompt">{{ current.prompt }}</div>
        <p class="hint">{{ current.hint }}</p>

        <QuestionStaff :staff="current.staff" :melody="current.melody" prefix="l3" />

        <div class="choices" data-test="l3-choices">
          <button
            v-for="choice in current.choices"
            :key="choice.id"
            type="button"
            :class="{
              correct: answered && choice.id === current.answerId,
              wrong: answered && choice.id === selectedChoiceId && !correct,
            }"
            :disabled="answered"
            data-test="l3-choice"
            @click="choose(choice.id)"
          >
            {{ choice.label }}
          </button>
        </div>

        <p
          v-if="answered"
          class="feedback"
          :class="{ ok: correct, bad: !correct }"
          data-test="l3-feedback"
        >
          <strong>{{ correct ? "答对了。" : "不对。" }}</strong>
          <span v-if="!correct"> 正确答案：{{ correctChoice?.label }}。</span>
          {{ current.explanation }}
        </p>

        <button
          v-if="answered"
          type="button"
          class="primary next"
          data-test="l3-next"
          @click="nextQuestion"
        >
          {{ index >= questions.length - 1 ? "看结果" : "下一题" }}
        </button>
      </section>
    </section>
  </div>
</template>

<style scoped>
h2,
h3 {
  margin: 0 0 0.5rem;
  font-family: var(--pb-font-display);
  font-weight: 600;
}

h2 {
  font-size: 1.3rem;
}

h3 {
  font-size: 1.1rem;
}

.lead,
.muted,
.hint,
.progress,
.intro,
.progress-line {
  color: var(--pb-muted);
}

.lead {
  margin: 0 0 0.8rem;
}

.progress-line {
  margin: 0 0 1rem;
  font-size: 0.9rem;
}

.lesson-list {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(8.2rem, 1fr));
  gap: 0.5rem;
  margin: 0 0 1.1rem;
}

.lesson-card {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  padding: 0.6rem 0.7rem;
  border: 1px solid var(--pb-border-soft);
  border-radius: var(--pb-radius);
  background: var(--pb-surface);
  color: var(--pb-ink);
  text-align: left;
  cursor: pointer;
}

.lesson-card.active {
  border-color: var(--pb-accent);
  box-shadow: 0 0 0 1px var(--pb-accent);
}

.lesson-card.done {
  background: var(--pb-ok-bg);
}

.lesson-card span,
.lesson-card small {
  color: var(--pb-muted);
  font-size: 0.82rem;
}

.lesson {
  padding: 0;
  border-top: 1px solid var(--pb-border-soft);
  padding-top: 1rem;
}

.lesson-head,
.quiz-head,
.summary-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

/* 只剩题号一个元素时靠右，和下面的大题面拉开层次 */
.quiz-head {
  justify-content: flex-end;
}


.intro {
  margin: 0.3rem 0 0.5rem;
  line-height: 1.6;
}

.quiz-head {
  margin-top: 0.3rem;
}

.progress {
  margin: 0;
  font-size: 0.85rem;
}

.prompt {
  margin: 0.7rem 0 0.25rem;
  font-family: var(--pb-font-display);
  font-size: clamp(1.5rem, 4.5vw, 2.1rem);
  font-weight: 600;
  line-height: 1.3;
  overflow-wrap: anywhere;
}

.hint {
  margin: 0 0 0.8rem;
}

.choices {
  display: grid;
  gap: 0.45rem;
}

@media (min-width: 720px) {
  .choices {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

.choices button {
  padding: 0.65rem 0.8rem;
  border: 1px solid var(--pb-border-soft);
  border-radius: var(--pb-radius);
  background: var(--pb-surface);
  color: var(--pb-ink);
  text-align: left;
  cursor: pointer;
}

.choices button.correct {
  border-color: var(--pb-ok);
  background: var(--pb-ok-bg);
}

.choices button.wrong {
  border-color: var(--pb-danger);
}

.feedback {
  margin: 0.8rem 0 0;
  padding: 0.65rem 0.75rem;
  border-left: 3px solid var(--pb-border-soft);
  background: var(--pb-tip-bg);
  line-height: 1.55;
}

.feedback.ok {
  border-left-color: var(--pb-ok);
}

.feedback.bad {
  border-left-color: var(--pb-danger);
}

.feedback strong {
  margin-right: 0.2rem;
}

.primary {
  padding: 0.55rem 0.9rem;
  border: 1px solid var(--pb-accent-2);
  border-radius: var(--pb-radius);
  background: var(--pb-accent-2);
  color: var(--pb-accent-text);
  cursor: pointer;
}

.next {
  margin-top: 0.8rem;
}

.summary {
  margin-top: 0.8rem;
  padding: 0.9rem;
  border: 1px solid var(--pb-border-soft);
  border-radius: var(--pb-radius);
}

.summary-actions {
  justify-content: flex-start;
  flex-wrap: wrap;
  margin-top: 0.8rem;
}

.summary-actions button:not(.primary) {
  padding: 0.55rem 0.9rem;
  border: 1px solid var(--pb-border);
  border-radius: var(--pb-radius);
  background: var(--pb-surface);
  color: var(--pb-ink);
  cursor: pointer;
}
</style>
