<script setup lang="ts">
import { computed, ref } from "vue";
import { initialProfile, type Profile } from "../domain/profile";
import {
  CONTENT_SOURCE,
  CURRICULUM_STAGES,
  PRACTICE_KINDS,
  PRACTICE_LABELS,
  SYMBOL_GROUPS,
  createCurriculumStageQuestions,
  createPracticeQuestions,
  isPracticeAnswer,
  practiceQuestionCount,
  type CurriculumStage,
  type PracticeKind,
  type PracticeOptions,
  type PracticeQuestion,
  type SymbolGroup,
} from "../practice";
import QuestionStaff from "./QuestionStaff.vue";

/**
 * 乐理练习页：一套答题流程 + 两条入口。
 *
 * - 自由练习：按题型（单音/符号/音程/和弦/临时升降/进行/音型/旋律）随时开一组；
 * - 专项题组：原来「主线闯关」的 10 组固定题量，作为自由练习的预设，不再锁定、
 *   不再写第二份进度。真正有先后顺序的理论课只在「学习 · L3 预备课」。
 *
 * 题目内容与生成规则都在 `src/practice/`，本视图只负责出题、作答和结果。
 */
const props = withDefaults(
  defineProps<{
    /** 测试可传固定 seed；真实页面每次进入用随机 seed。 */
    seed?: number;
    /** 错题本数量需要读档案；测试可不传。 */
    profile?: Profile;
  }>(),
  { seed: undefined, profile: undefined },
);

const emit = defineEmits<{
  /** 视奏与错题本属于练习分区，但在乐理练习之外单独进入。 */
  "open-sight": [];
  "open-error": [];
}>();

const baseSeed = props.seed ?? Math.floor(Math.random() * 0xffffffff);
const profile = computed(() => props.profile ?? initialProfile());
/** 错题本入口常驻，没有错题时只置灰并说明，避免入口忽隐忽现。 */
const errorCount = computed(() => profile.value.errorSnippets.length);
const hasErrors = computed(() => errorCount.value > 0);
const kind = ref<PracticeKind>("symbols");
const symbolGroup = ref<SymbolGroup | "all">("all");
const session = ref(0);
const presetId = ref<string | null>(null);

const preset = computed(
  () => CURRICULUM_STAGES.find((stage) => stage.id === presetId.value) ?? null,
);
const nextPreset = computed(() => {
  if (!preset.value) return null;
  const index = CURRICULUM_STAGES.findIndex((stage) => stage.id === preset.value?.id);
  return CURRICULUM_STAGES[index + 1] ?? null;
});

const questions = ref<PracticeQuestion[]>(
  createPracticeQuestions(kind.value, baseSeed, optionsFor(kind.value)),
);
const index = ref(0);
const selectedId = ref<string | null>(null);
const score = ref(0);
const finished = ref(false);

const current = computed(() => questions.value[index.value] ?? null);
const answered = computed(() => selectedId.value !== null);
const correct = computed(
  () => current.value !== null && selectedId.value !== null && isPracticeAnswer(current.value, selectedId.value),
);
const correctChoice = computed(() =>
  current.value?.choices.find((choice) => choice.id === current.value?.answerId) ?? null,
);
const progressText = computed(() =>
  questions.value.length > 0 ? `第 ${index.value + 1} / ${questions.value.length} 题` : "没有题目",
);

const tabs = computed(() =>
  PRACTICE_KINDS.map((value) => ({
    value,
    label: PRACTICE_LABELS[value],
    count: practiceQuestionCount(value, optionsFor(value)),
  })),
);

const groupChoices = computed<readonly (SymbolGroup | "all")[]>(() => ["all", ...SYMBOL_GROUPS]);

/** 符号分组只影响符号题；其它题型返回空范围。 */
function optionsFor(kindValue: PracticeKind): PracticeOptions {
  if (kindValue !== "symbols" || symbolGroup.value === "all") return {};
  return { symbolGroups: [symbolGroup.value] };
}

function createQuestions(nextKind: PracticeKind, seed: number): PracticeQuestion[] {
  return createPracticeQuestions(nextKind, seed, optionsFor(nextKind));
}

function resetQuiz() {
  index.value = 0;
  selectedId.value = null;
  score.value = 0;
  finished.value = false;
}

/** 自由练习：换题型或换符号分组后重新出题。 */
function start(nextKind: PracticeKind = kind.value) {
  presetId.value = null;
  kind.value = nextKind;
  session.value += 1;
  questions.value = createQuestions(nextKind, baseSeed + session.value * 7919);
  resetQuiz();
}

/** 专项题组：复用自由练习的答题流程，但题量与范围由关卡定义。 */
function startPreset(stage: CurriculumStage) {
  presetId.value = stage.id;
  kind.value = stage.kind;
  symbolGroup.value = "all";
  session.value += 1;
  questions.value = createCurriculumStageQuestions(stage.id, baseSeed + session.value * 7919);
  resetQuiz();
}

function selectGroup(group: SymbolGroup | "all") {
  symbolGroup.value = group;
  start("symbols");
}

function choose(choiceId: string) {
  if (!current.value || answered.value) return;
  selectedId.value = choiceId;
  if (isPracticeAnswer(current.value, choiceId)) score.value += 1;
}

function nextQuestion() {
  if (!answered.value) return;
  if (index.value >= questions.value.length - 1) {
    finish();
    return;
  }
  index.value += 1;
  selectedId.value = null;
}

function finish() {
  finished.value = true;
}

function restart() {
  if (preset.value) {
    startPreset(preset.value);
    return;
  }
  start(kind.value);
}

function goNextPreset() {
  if (nextPreset.value) startPreset(nextPreset.value);
}
</script>

<template>
  <div class="surface practice" data-test="practice">
    <div class="hub-links">
      <button type="button" class="hub-link" data-test="practice-sight" @click="emit('open-sight')">
        <span class="hub-title">5 分钟视奏</span>
        <span class="hub-desc">新谱看一遍就弹，练反应</span>
      </button>
      <button
        type="button"
        class="hub-link"
        data-test="practice-errors"
        :disabled="!hasErrors"
        @click="emit('open-error')"
      >
        <span class="hub-title">错题本</span>
        <span class="hub-desc">{{ hasErrors ? `${errorCount} 条待重练` : "暂无错题" }}</span>
      </button>
    </div>

    <div class="tabs" role="tablist" aria-label="练习类型">
      <button
        v-for="tab in tabs"
        :key="tab.value"
        type="button"
        role="tab"
        :class="{ active: kind === tab.value && !preset }"
        :aria-selected="kind === tab.value && !preset"
        :data-test="`practice-tab-${tab.value}`"
        :data-kind="tab.value"
        @click="start(tab.value)"
      >
        <span>{{ tab.label }}</span>
        <small>{{ tab.count }} 题</small>
      </button>
    </div>

    <div v-if="kind === 'symbols' && !preset" class="segments group-filter" role="group" aria-label="符号分组">
      <button
        v-for="group in groupChoices"
        :key="group"
        type="button"
        :aria-pressed="symbolGroup === group"
        :data-test="`practice-group-${group}`"
        @click="selectGroup(group)"
      >
        {{ group === "all" ? "全部" : group }}
      </button>
    </div>

    <section class="presets" data-test="practice-presets">
      <div class="presets-head">
        <h2>专项题组</h2>
        <p class="muted">按知识点选一组练，不锁定顺序，也不占课程进度。</p>
      </div>
      <div class="stage-list" data-test="practice-stages">
        <button
          v-for="stage in CURRICULUM_STAGES"
          :key="stage.id"
          type="button"
          class="stage-card"
          :class="{ active: stage.id === presetId }"
          :data-test="`practice-stage-${stage.id}`"
          @click="startPreset(stage)"
        >
          <strong>{{ stage.title }}</strong>
          <span>{{ stage.goal }}</span>
          <small>{{ stage.questionCount }} 题</small>
        </button>
      </div>
    </section>

    <section v-if="preset" class="stage-head" data-test="practice-stage-head">
      <h2>{{ preset.title }}</h2>
      <p class="stage-goal">{{ preset.goal }}</p>
      <p class="stage-guidance">{{ preset.guidance }}</p>
    </section>

    <section v-if="finished" class="summary" data-test="practice-summary">
      <h2>本组答对 {{ score }} / {{ questions.length }}</h2>
      <p class="muted">
        <template v-if="preset && score >= preset.passScore">
          这组达到了通过线。专项题组不写进度，想巩固就再来一组。
        </template>
        <template v-else-if="preset">
          这组还差一点（通过线 {{ preset.passScore }} 题）。再看一遍解释，换一组题重来。
        </template>
        <template v-else>
          {{ score === questions.length ? "全对，可以换一组或换一个类型。" : "错题下面会解释；再开一组会换题序和干扰项。" }}
        </template>
      </p>
      <div class="summary-actions">
        <button type="button" class="primary" data-test="practice-restart" @click="restart">
          再来一组
        </button>
        <button
          v-if="preset && nextPreset"
          type="button"
          data-test="practice-stage-next"
          @click="goNextPreset"
        >
          下一组：{{ nextPreset.title }}
        </button>
      </div>
    </section>

    <section v-else-if="current" class="quiz" data-test="practice-quiz">
      <div class="quiz-head">
        <p class="progress" data-test="practice-progress">{{ progressText }}</p>
      </div>

      <div class="prompt" data-test="practice-prompt">{{ current.prompt }}</div>
      <p class="hint">{{ current.hint }}</p>

      <QuestionStaff :staff="current.staff" :melody="current.melody" prefix="practice" />

      <div class="choices" data-test="practice-choices">
        <button
          v-for="choice in current.choices"
          :key="choice.id"
          type="button"
          :class="{
            correct: answered && choice.id === current.answerId,
            wrong: answered && choice.id === selectedId && !correct,
          }"
          :disabled="answered"
          data-test="practice-choice"
          @click="choose(choice.id)"
        >
          {{ choice.label }}
        </button>
      </div>

      <p
        v-if="answered"
        class="feedback"
        :class="{ ok: correct, bad: !correct }"
        data-test="practice-feedback"
      >
        <strong>{{ correct ? "答对了。" : "不对。" }}</strong>
        <span v-if="!correct"> 正确答案：{{ correctChoice?.label }}。</span>
        {{ current.explanation }}
      </p>

      <button
        v-if="answered"
        type="button"
        class="primary next"
        data-test="practice-next"
        @click="nextQuestion"
      >
        {{ index >= questions.length - 1 ? "看结果" : "下一题" }}
      </button>
    </section>

    <p class="source" data-test="practice-source">{{ CONTENT_SOURCE }}</p>
  </div>
</template>

<style scoped>
h1,
h2 {
  margin: 0 0 0.5rem;
  font-family: var(--pb-font-display);
  font-weight: 600;
}

h1 {
  font-size: 1.85rem;
}

h2 {
  font-size: 1.3rem;
}

.lead,
.muted,
.hint,
.progress,
.source,
.stage-goal,
.stage-guidance {
  color: var(--pb-muted);
}

.lead {
  margin: 0 0 1rem;
}

/* 练习分区里跨出乐理题的入口：视奏 / 错题本，用左侧强调条区分于普通按钮 */
.hub-links {
  display: grid;
  gap: var(--pb-space-2);
  margin: 0 0 var(--pb-space-4);
}

@media (min-width: 720px) {
  .hub-links {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

.hub-link {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  padding: var(--pb-space-3) var(--pb-space-4);
  border: 0;
  border-left: 3px solid var(--pb-accent);
  border-radius: var(--pb-radius);
  background: var(--pb-surface-2);
  color: var(--pb-ink);
  text-align: left;
  cursor: pointer;
}

.hub-link:disabled {
  opacity: 0.6;
  cursor: default;
}

.hub-title {
  font-size: 0.92rem;
  font-weight: 600;
}

.hub-desc {
  color: var(--pb-muted);
  font-size: 0.8rem;
  line-height: 1.45;
}

.tabs {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(6.5rem, 1fr));
  gap: 0.45rem;
  margin: 0 0 1.1rem;
}

.tabs button {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  padding: 0.55rem 0.65rem;
  border: 1px solid var(--pb-border-soft);
  border-radius: var(--pb-radius);
  background: var(--pb-surface);
  color: var(--pb-ink);
  text-align: left;
  cursor: pointer;
}

.tabs button.active {
  border-color: var(--pb-accent);
  box-shadow: 0 0 0 1px var(--pb-accent);
}

.tabs small {
  color: var(--pb-muted);
  font-size: 0.78rem;
}

.group-filter {
  margin: 0 0 var(--pb-space-4);
}

.presets {
  margin: 0 0 var(--pb-space-4);
  padding-top: var(--pb-space-3);
  border-top: 1px solid var(--pb-border-soft);
}

.presets-head {
  margin: 0 0 var(--pb-space-2);
}

.presets-head h2 {
  font-size: 1rem;
}

.presets-head p {
  margin: 0;
  font-size: 0.82rem;
}

/* 专项题组：窄屏两列，宽屏自动铺满 */
.stage-list {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
  gap: 0.5rem;
}

.stage-card {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  padding: 0.65rem 0.75rem;
  border: 1px solid var(--pb-border-soft);
  border-radius: var(--pb-radius);
  background: var(--pb-surface);
  color: var(--pb-ink);
  text-align: left;
  cursor: pointer;
}

.stage-card span {
  color: var(--pb-muted);
  font-size: 0.8rem;
  line-height: 1.4;
}

.stage-card small {
  color: var(--pb-muted);
  font-size: 0.72rem;
}

.stage-card.active {
  border-color: var(--pb-accent);
  box-shadow: 0 0 0 1px var(--pb-accent);
}

.stage-head {
  margin: 0 0 var(--pb-space-4);
  padding: var(--pb-space-3) var(--pb-space-4);
  border-left: 3px solid var(--pb-accent-2);
  border-radius: var(--pb-radius);
  background: var(--pb-accent-2-soft);
}

.stage-goal {
  margin: 0 0 0.35rem;
  font-size: 0.9rem;
}

.stage-guidance {
  margin: 0;
  font-size: 0.85rem;
  line-height: 1.55;
}

.quiz-head {
  display: flex;
  align-items: baseline;
  justify-content: flex-end;
  gap: 0.75rem;
}

.progress {
  margin: 0;
  font-size: 0.85rem;
}

.prompt {
  margin: 0.7rem 0 0.25rem;
  font-family: var(--pb-font-display);
  font-size: clamp(1.7rem, 5vw, 2.5rem);
  font-weight: 600;
  line-height: 1.2;
  overflow-wrap: anywhere;
}

.hint {
  margin: 0 0 0.9rem;
}

.choices {
  display: grid;
  gap: 0.5rem;
}

/* 宽屏两列：四个选项一次看全，不用滚 */
@media (min-width: 720px) {
  .choices {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

.choices button {
  padding: 0.7rem 0.85rem;
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
  margin: 0.85rem 0 0;
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
  padding: 1rem;
  border: 1px solid var(--pb-border-soft);
  border-radius: var(--pb-radius);
}

.summary-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--pb-space-2);
  margin-top: var(--pb-space-3);
}

.summary-actions button:not(.primary) {
  padding: 0.55rem 0.9rem;
  border: 1px solid var(--pb-border);
  border-radius: var(--pb-radius);
  background: var(--pb-surface);
  color: var(--pb-ink);
  cursor: pointer;
}

.source {
  margin: 1.2rem 0 0;
  font-size: 0.8rem;
  line-height: 1.5;
}
</style>
