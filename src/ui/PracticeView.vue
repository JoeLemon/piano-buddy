<script setup lang="ts">
import { computed, ref } from "vue";
import { completeCurriculumStage, initialProfile, type Profile } from "../domain/profile";
import {
  CONTENT_SOURCE,
  CURRICULUM_STAGES,
  PRACTICE_KINDS,
  PRACTICE_LABELS,
  SYMBOL_GROUPS,
  createCurriculumStageQuestions,
  createPracticeQuestions,
  curriculumStageState,
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
 * 乐理练习页：两种模式共用同一套答题流程。
 *
 * - 自由练习：按题型（单音/符号/音程/和弦/临时升降/进行/音型/旋律）随时开一组；
 * - 主线闯关：按关卡顺序解锁，每关固定题量，通过后写入 Profile。
 *
 * 题目内容与生成规则都在 `src/practice/`，本视图只负责模式、进度和作答。
 */
type PracticeMode = "free" | "stages";

const props = withDefaults(
  defineProps<{
    /** 测试可传固定 seed；真实页面每次进入用随机 seed。 */
    seed?: number;
    /** 主线进度需要读写档案；测试可不传。 */
    profile?: Profile;
    /** 从首页「主线闯关」进入时直接打开关卡模式。 */
    initialMode?: PracticeMode;
  }>(),
  { seed: undefined, profile: undefined, initialMode: "free" },
);

const emit = defineEmits<{
  "open-l3": [];
  "update-profile": [profile: Profile];
}>();

const baseSeed = props.seed ?? Math.floor(Math.random() * 0xffffffff);
const profile = computed(() => props.profile ?? initialProfile());
const mode = ref<PracticeMode>(props.initialMode);
const kind = ref<PracticeKind>("symbols");
const symbolGroup = ref<SymbolGroup | "all">("all");
const session = ref(0);
const localCompleted = ref<string[]>([]);

const completedStageIds = computed(
  () => new Set([...(profile.value.curriculumCompleted ?? []), ...localCompleted.value]),
);

/** 第一个「当前可闯」的关卡：第一关或上一关已通过。 */
const firstOpenStage = computed(
  () =>
    CURRICULUM_STAGES.find(
      (stage, index) => curriculumStageState([...completedStageIds.value], index) === "current",
    ) ?? CURRICULUM_STAGES[0],
);

const selectedStageId = ref(firstOpenStage.value.id);
const selectedStage = computed(
  () => CURRICULUM_STAGES.find((stage) => stage.id === selectedStageId.value) ?? CURRICULUM_STAGES[0],
);

const questions = ref<PracticeQuestion[]>(
  mode.value === "stages"
    ? createCurriculumStageQuestions(selectedStageId.value, baseSeed)
    : createPracticeQuestions(kind.value, baseSeed, optionsFor(kind.value)),
);
const index = ref(0);
const selectedId = ref<string | null>(null);
const score = ref(0);
const finished = ref(false);
/** 主线模式下的通过状态；自由练习不看通过线。 */
const passed = ref(false);

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

const nextStage = computed(() => {
  const currentIndex = CURRICULUM_STAGES.findIndex((stage) => stage.id === selectedStageId.value);
  return CURRICULUM_STAGES[currentIndex + 1] ?? null;
});

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
  passed.value = false;
}

/** 自由练习：换题型或换符号分组后重新出题。 */
function start(nextKind: PracticeKind = kind.value) {
  mode.value = "free";
  kind.value = nextKind;
  session.value += 1;
  questions.value = createQuestions(nextKind, baseSeed + session.value * 7919);
  resetQuiz();
}

/** 主线闯关：切到某一关并重新出题。 */
function startStage(stage: CurriculumStage) {
  mode.value = "stages";
  selectedStageId.value = stage.id;
  session.value += 1;
  questions.value = createCurriculumStageQuestions(stage.id, baseSeed + session.value * 7919);
  resetQuiz();
}

function setMode(next: PracticeMode) {
  if (next === mode.value) return;
  if (next === "stages") {
    startStage(firstOpenStage.value);
    return;
  }
  start(kind.value);
}

function selectGroup(group: SymbolGroup | "all") {
  symbolGroup.value = group;
  start("symbols");
}

function stageState(stage: CurriculumStage, stageIndex: number) {
  return curriculumStageState([...completedStageIds.value], stageIndex);
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
  if (mode.value !== "stages") return;
  passed.value = score.value >= selectedStage.value.passScore;
  if (passed.value) recordStage(selectedStage.value.id);
}

/** 通关写入 Profile；本地列表兜住父级回写 props 之前的连续闯关。 */
function recordStage(stageId: string) {
  localCompleted.value = [...new Set([...localCompleted.value, stageId])];
  const currentProfile = profile.value;
  if (currentProfile.curriculumCompleted?.includes(stageId)) return;

  const merged: Profile = {
    ...currentProfile,
    curriculumCompleted: [
      ...new Set([
        ...(currentProfile.curriculumCompleted ?? []),
        ...localCompleted.value.filter((id) => id !== stageId),
      ]),
    ],
  };
  emit("update-profile", completeCurriculumStage(merged, stageId));
}

function restart() {
  if (mode.value === "stages") {
    startStage(selectedStage.value);
    return;
  }
  start(kind.value);
}

function goNextStage() {
  if (nextStage.value) startStage(nextStage.value);
}
</script>

<template>
  <div class="surface practice" data-test="practice">
    <div class="segments mode-switch" role="group" aria-label="练习模式">
      <button
        type="button"
        :aria-pressed="mode === 'stages'"
        data-test="practice-mode-stages"
        @click="setMode('stages')"
      >
        主线闯关
      </button>
      <button
        type="button"
        :aria-pressed="mode === 'free'"
        data-test="practice-mode-free"
        @click="setMode('free')"
      >
        自由练习
      </button>
    </div>

    <template v-if="mode === 'free'">
      <button type="button" class="l3-link" data-test="practice-l3" @click="emit('open-l3')">
        <span class="l3-title">L3 预备课</span>
        <span class="l3-desc">单音 / 符号 / 音程 / 和弦 / 进行 / 音型 / 听调性 · 9 节</span>
      </button>

      <div class="tabs" role="tablist" aria-label="练习类型">
        <button
          v-for="tab in tabs"
          :key="tab.value"
          type="button"
          role="tab"
          :class="{ active: kind === tab.value }"
          :aria-selected="kind === tab.value"
          :data-test="`practice-tab-${tab.value}`"
          :data-kind="tab.value"
          @click="start(tab.value)"
        >
          <span>{{ tab.label }}</span>
          <small>{{ tab.count }} 题</small>
        </button>
      </div>

      <div v-if="kind === 'symbols'" class="segments group-filter" role="group" aria-label="符号分组">
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
    </template>

    <template v-else>
      <div class="stage-list" data-test="practice-stages">
        <button
          v-for="(stage, stageIndex) in CURRICULUM_STAGES"
          :key="stage.id"
          type="button"
          class="stage-card"
          :class="{ active: stage.id === selectedStageId, done: stageState(stage, stageIndex) === 'done' }"
          :disabled="stageState(stage, stageIndex) === 'locked'"
          :data-state="stageState(stage, stageIndex)"
          :data-test="`practice-stage-${stage.id}`"
          @click="startStage(stage)"
        >
          <strong>{{ stage.title }}</strong>
          <span>{{ stage.goal }}</span>
          <small v-if="stageState(stage, stageIndex) === 'done'">✓ 已通过</small>
          <small v-else-if="stageState(stage, stageIndex) === 'locked'">未解锁</small>
          <small v-else>{{ stage.questionCount }} 题</small>
        </button>
      </div>

      <section class="stage-head">
        <h2>{{ selectedStage.title }}</h2>
        <p class="stage-goal">{{ selectedStage.goal }}</p>
        <p class="stage-guidance">{{ selectedStage.guidance }}</p>
      </section>
    </template>

    <section v-if="finished" class="summary" data-test="practice-summary">
      <template v-if="mode === 'stages'">
        <h2 v-if="passed">本关通过：答对 {{ score }} / {{ questions.length }}</h2>
        <h2 v-else>还差一点：答对 {{ score }} / {{ questions.length }}</h2>
        <p class="muted">
          <template v-if="passed">通关已记录；下一关会按顺序解锁。</template>
          <template v-else>本关至少需要答对 {{ selectedStage.passScore }} 题。再看一遍解释，换一组题重来。</template>
        </p>
        <div class="summary-actions">
          <button
            v-if="passed && nextStage"
            type="button"
            class="primary"
            data-test="practice-stage-next"
            @click="goNextStage"
          >
            下一关：{{ nextStage.title }}
          </button>
          <button type="button" data-test="practice-restart" @click="restart">再答一组</button>
        </div>
      </template>
      <template v-else>
        <h2>本组答对 {{ score }} / {{ questions.length }}</h2>
        <p class="muted">
          {{ score === questions.length ? "全对，可以换一组或换一个类型。" : "错题下面会解释；再开一组会换题序和干扰项。" }}
        </p>
        <button type="button" class="primary" data-test="practice-restart" @click="restart">
          再来一组
        </button>
      </template>
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

.mode-switch {
  margin: 0 0 var(--pb-space-4);
}

.l3-link {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  width: 100%;
  margin: 0 0 var(--pb-space-4);
  padding: var(--pb-space-3) var(--pb-space-4);
  border: 0;
  border-left: 3px solid var(--pb-accent);
  border-radius: var(--pb-radius);
  background: var(--pb-surface-2);
  color: var(--pb-ink);
  text-align: left;
  cursor: pointer;
}

.l3-title {
  font-size: 0.92rem;
  font-weight: 600;
}

.l3-desc {
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

/* 主线关卡：窄屏两列，宽屏自动铺满 */
.stage-list {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
  gap: 0.5rem;
  margin: 0 0 var(--pb-space-4);
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

.stage-card.done small {
  color: var(--pb-ok);
}

.stage-card:disabled {
  cursor: not-allowed;
  opacity: 0.55;
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

.source {
  margin: 1.2rem 0 0;
  font-size: 0.8rem;
  line-height: 1.5;
}
</style>
