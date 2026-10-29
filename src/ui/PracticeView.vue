<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  initialProfile,
  practiceAccuracy,
  recordPracticeAnswer,
  recordTheoryResult,
  type Profile,
  type TheoryProgress,
} from "../domain/profile";
import { CHORD_CATALOG } from "../practice/chordCatalog";
import { INTERVAL_CATALOG } from "../practice/intervalCatalog";
import {
  CONTENT_SOURCE,
  CHORD_LABELS,
  KEY_LABELS,
  NOTE_RANGES,
  PLAYBACK_KEYS,
  PRACTICE_KINDS,
  PRACTICE_LABELS,
  PROGRESSIONS,
  SYMBOL_GROUPS,
  THEORY_CHAPTERS,
  createCurriculumStageQuestions,
  createPracticeQuestions,
  findStage,
  gradeRhythm,
  isPracticeAnswer,
  judgePlay,
  midiLabel,
  nextTheoryNode,
  ON_BEAT_TOLERANCE,
  pitchClassName,
  planForPattern,
  playHintFor,
  playTargetFor,
  playTargetText,
  practiceQuestionCount,
  stageListFor,
  theoryChapterDone,
  theoryChapterNodes,
  theoryNodeState,
  type CurriculumStage,
  type NoteRange,
  type PlaybackKey,
  type PracticeKind,
  type PracticeOptions,
  type PracticeQuestion,
  type RhythmHit,
  type SymbolGroup,
  type TheoryChapterId,
  type TheoryNode,
} from "../practice";
import { keyboardMode, subscribeMidi, type MidiNote } from "../midi/access";
import type { NotePulse } from "../midi/types";
import KeyboardDiagram from "./KeyboardDiagram.vue";
import QuestionStaff from "./QuestionStaff.vue";

/**
 * 乐理练习页：一套答题流程 + 两条入口。
 *
 * - 自由练习：按题型（单音/符号/音程/和弦/临时升降/进行/音型/旋律）随时开一组；
 * - 专项题组：原来「主线闯关」的 10 组固定题量，作为自由练习的预设，不再锁定、
 *   不再写第二份进度。真正有先后顺序的理论课只在「学习 · L3 预备课」。
 *
 * 作答方式有两种：选选项，或直接在琴上弹（`playAnswer.ts` 判题）。
 * 弹奏作答只对「谱面本身就是答案」的题型开放，其余题型自动回落到选项。
 *
 * 题目内容与生成规则都在 `src/practice/`，本视图只负责出题、作答和结果。
 */
const props = withDefaults(
  defineProps<{
    /** 测试可传固定 seed；真实页面每次进入用随机 seed。 */
    seed?: number;
    /** 错题本数量需要读档案；测试可不传。 */
    profile?: Profile;
    /** MIDI 键盘是否可用；只有连上（或开了模拟键盘）才订阅硬件音符。 */
    midiConnected?: boolean;
    /** 从曲库「去上课」等入口带过来的关卡 id；进入后直接开这一关。 */
    focusStageId?: string;
  }>(),
  { seed: undefined, profile: undefined, midiConnected: false, focusStageId: undefined },
);

const emit = defineEmits<{
  /** 视奏与错题本属于练习分区，但在乐理练习之外单独进入。 */
  "open-sight": [];
  "open-error": [];
  /** 乐理地图里的 L3 节点直达对应预备课。 */
  "open-theory": [lessonId: string];
  /** 关卡通过后把最高分写回档案。 */
  "update-profile": [profile: Profile];
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

/** 练习范围。数组为空代表「全部」，但 UI 会阻止取消最后一个选项。 */
const noteRangeId = ref<string>("all");
const includeSharps = ref(false);
const includeFlats = ref(false);
const intervalIds = ref<string[]>(INTERVAL_CATALOG.map((item) => item.id));
const chordTypeIds = ref<string[]>(CHORD_CATALOG.map((item) => item.id));
const progressionIds = ref<string[]>(PROGRESSIONS.map((item) => item.id));
const playbackKeys = ref<PlaybackKey[]>([...PLAYBACK_KEYS]);
const melodySource = ref<"bank" | "random">("bank");

/** 先听再看 / 连续出题 / 当前题是否已经揭晓谱面。 */
const listenFirst = ref(false);
const endless = ref(false);
const revealed = ref(true);
const answeredTotal = ref(0);
const correctTotal = ref(0);

const preset = computed(() => findStage(presetId.value) ?? null);
const nextPreset = computed(() => {
  if (!preset.value) return null;
  const list = stageListFor(preset.value.id);
  const index = list.findIndex((stage) => stage.id === preset.value?.id);
  return list[index + 1] ?? null;
});

const questions = ref<PracticeQuestion[]>(
  createPracticeQuestions(kind.value, baseSeed, optionsFor(kind.value)),
);

/**
 * 从曲库「去上课」带关卡 id 进来：直接开这一关。
 *
 * 关卡写进 presetId，之后的流程（写进度、下一关、再来一组）与点地图
 * 节点完全一致，不另开一条状态路径。挂载后才应用——setup 期调用会撞上
 * 尚未初始化的 ref（index 等的 TDZ）。
 */
function applyFocusStage(stageId: string | undefined): void {
  if (!stageId) return;
  const stage = findStage(stageId);
  if (stage) startPreset(stage);
}

onMounted(() => applyFocusStage(props.focusStageId));
watch(() => props.focusStageId, applyFocusStage);
const index = ref(0);
const selectedId = ref<string | null>(null);
const score = ref(0);
const finished = ref(false);

/* ── 作答方式：选项 / 弹琴 ──────────────────────────────────────────── */

type AnswerMode = "choices" | "keys";
const ANSWER_MODE_KEY = "piano-buddy-practice-answer";

function readAnswerMode(): AnswerMode {
  try {
    return localStorage.getItem(ANSWER_MODE_KEY) === "keys" ? "keys" : "choices";
  } catch {
    return "choices";
  }
}

const answerMode = ref<AnswerMode>(readAnswerMode());
/**
 * 本轮弹过的音与时刻（每次换题清空）。
 *
 * 音高由 `judgePlay` 从这份序列推导；时刻只在音型题里用，答完后换算成
 * 节拍结论。两者共用一份数据，不会出现「判了 4 个音却只记了 3 个时刻」。
 */
const playHits = ref<RhythmHit[]>([]);
const playedMidis = computed(() => playHits.value.map((hit) => hit.midi));

/**
 * 屏幕琴键按下的音符，转给旋律跟弹。
 *
 * 跟弹自己也会订阅 MIDI，但它看不到屏幕琴键的点击；这里补上这条支路，
 * 组件内按事件对象引用去重，所以同一下不会被判两次。
 */
const notePulse = ref<NotePulse | null>(null);
let pulseSeq = 0;
const answered = ref(false);
const answeredCorrect = ref(false);

const current = computed(() => questions.value[index.value] ?? null);
const correct = computed(() => answeredCorrect.value);

/** 当前题的弹奏目标；不能弹的题型是 null。 */
const playTarget = computed(() => (current.value ? playTargetFor(current.value) : null));
/** 只有「开了弹奏」且「这道题确实能弹」时才走键盘作答。 */
const keysMode = computed(() => answerMode.value === "keys" && playTarget.value !== null);
const playJudge = computed(() =>
  playTarget.value ? judgePlay(playTarget.value, playedMidis.value) : null,
);

/** 音型题第一下按键的时刻；节奏以它为第 0 拍。 */
const playStartedAt = ref(0);
/** 音型题的时间轴；单音、音程、和弦没有节奏可判。 */
const patternPlan = computed(() => (playTarget.value ? planForPattern(playTarget.value) : null));
const playRhythm = computed(() => {
  if (!patternPlan.value || playHits.value.length < 2) return null;
  return gradeRhythm(patternPlan.value, playHits.value, playStartedAt.value, 0);
});
/** 答完后的一句话节奏结论；不影响对错，只说明时值弹得怎么样。 */
const playRhythmText = computed(() => {
  const result = playRhythm.value;
  if (!result) return "";
  if (result.onCount === result.total) return `节拍：${result.total} 个音都在拍上。`;

  const mean = result.meanOffset;
  const drift =
    mean !== null && Math.abs(mean) > ON_BEAT_TOLERANCE
      ? mean > 0
        ? "整体偏晚。"
        : "整体偏早。"
      : "";
  return `节拍：${result.onCount} / ${result.total} 个音在拍上。${drift}`;
});
const playedText = computed(() =>
  playedMidis.value.length === 0 ? "（还没弹）" : playedMidis.value.map(midiLabel).join(" · "),
);
const answerText = computed(() => (playTarget.value ? playTargetText(playTarget.value) : ""));
const playTip = computed(() => {
  if (!playTarget.value) return "";
  // 先听再看时谱面还藏着，这时说的是「听出来的音」，不是「谱面上的音」。
  if (listenFirst.value && !revealed.value) return "先听，再在琴上把听到的音弹出来。";
  return playHintFor(playTarget.value);
});

/** 单音题里「音名对了、八度不对」是最常见的错法，单独点出来比只说"不对"有用。 */
const octaveSlip = computed(() => {
  const target = playTarget.value;
  const judge = playJudge.value;
  if (!target || !judge || judge.state !== "wrong" || judge.stray === null) return false;
  if (target.midis.length !== 1) return false;
  return pitchClassName(target.midis[0]) === pitchClassName(judge.stray);
});

const deviceHint = computed(() => {
  // midiConnected 把「开了模拟键盘」也算进来了，所以先判电脑键盘，免得说有 MIDI 设备。
  if (keyboardMode.value) return "电脑键盘已打开：A 行白键、Q 行黑键，屏幕琴键也能点。";
  if (props.midiConnected) return "MIDI 键盘和屏幕琴键都能作答。";
  return "点屏幕琴键就能作答；连上 MIDI 键盘，或在设置里打开模拟键盘，也能直接弹。";
});

function setAnswerMode(mode: AnswerMode) {
  if (answerMode.value === mode) return;
  answerMode.value = mode;
  try {
    localStorage.setItem(ANSWER_MODE_KEY, mode);
  } catch {
    // 存不下就只保留本页状态
  }
  // 已经用选项答过的题，切到弹琴后键盘仍会出现（可以对照答案按一按），
  // 但不再接受新的作答——一道题只算一次分。
}
const correctChoice = computed(() =>
  current.value?.choices.find((choice) => choice.id === current.value?.answerId) ?? null,
);
const accuracy = computed(() =>
  answeredTotal.value === 0 ? 0 : Math.round((correctTotal.value / answeredTotal.value) * 100),
);

/**
 * 当前题型的累计正确率（跨所有练习组）。
 *
 * 和上面的本组正确率是两个口径：上面这组答得如何，这里这个类型历来答得如何。
 * 没答过的题型不显示这行。
 */
const kindStat = computed(() => {
  const item = profile.value.practiceStats[kind.value];
  if (!item || item.answered <= 0) return null;
  return {
    percent: practiceAccuracy(profile.value.practiceStats, kind.value) ?? 0,
    correct: item.correct,
    answered: item.answered,
  };
});
const progressText = computed(() => {
  if (questions.value.length === 0) return "没有题目";
  if (endless.value) {
    return `第 ${index.value + 1} 题 · 已答 ${answeredTotal.value} · 正确率 ${accuracy.value}%`;
  }
  return `第 ${index.value + 1} / ${questions.value.length} 题`;
});

const tabs = computed(() =>
  PRACTICE_KINDS.map((value) => ({
    value,
    label: PRACTICE_LABELS[value],
    count: practiceQuestionCount(value, optionsFor(value)),
  })),
);

const groupChoices = computed<readonly (SymbolGroup | "all")[]>(() => ["all", ...SYMBOL_GROUPS]);
const noteRange = computed<NoteRange>(
  () => NOTE_RANGES.find((item) => item.id === noteRangeId.value) ?? NOTE_RANGES[0],
);

/** 一条理论进度；旧档案的 L3 完成记录也并进来，避免地图漏显示。 */
const theoryProgress = computed<TheoryProgress>(() => {
  const stored = profile.value.theoryPath;
  return {
    completed: [
      ...new Set([...(stored?.completed ?? []), ...(profile.value.l3PrepCompleted ?? [])]),
    ],
    best: { ...(stored?.best ?? {}) },
  };
});

function chapterNodes(chapter: TheoryChapterId): readonly TheoryNode[] {
  return theoryChapterNodes(chapter);
}

function chapterDone(chapter: TheoryChapterId): number {
  return theoryChapterDone(theoryProgress.value, chapter);
}

function nodeState(node: TheoryNode) {
  return theoryNodeState(theoryProgress.value, node);
}

function nodeBest(node: TheoryNode): number {
  return theoryProgress.value.best[node.id] ?? 0;
}

/** 当前建议练的那一关，地图上给它一个金圈，学生不必自己判断「下一个练什么」。 */
const nextNodeId = computed(() => nextTheoryNode(theoryProgress.value)?.id ?? null);

function chapterPercent(chapter: TheoryChapterId): string {
  const total = chapterNodes(chapter).length;
  if (total === 0) return "0%";
  return `${Math.round((chapterDone(chapter) / total) * 100)}%`;
}

/** 节点圆圈里写什么：过了就打勾，其余写序号。 */
function markerFor(node: TheoryNode, index: number): string {
  return nodeState(node) === "done" ? "✓" : String(index + 1);
}

function previousNode(node: TheoryNode): TheoryNode | null {
  const siblings = chapterNodes(node.chapter);
  const index = siblings.findIndex((item) => item.id === node.id);
  return index > 0 ? siblings[index - 1] : null;
}

/** 节点右侧那行小字：过了给最高分，锁着说清卡在哪一关，没锁给题量与通过线。 */
function nodeMeta(node: TheoryNode): string {
  const state = nodeState(node);
  if (state === "done") {
    const best = nodeBest(node);
    return best > 0 ? `最高 ${best} / ${node.questionCount}` : "已通过";
  }
  if (state === "locked") {
    const previous = previousNode(node);
    return previous ? `先过「${previous.title}」` : "先完成上一关";
  }
  return `${node.questionCount} 题 · 通过线 ${node.passScore}`;
}

/** 点击地图节点：基础关与 L4 关直接开题，L3 节点回到对应的预备课。 */
function openNode(node: TheoryNode) {
  if (nodeState(node) === "locked") return;
  if (node.lessonId) {
    emit("open-theory", node.lessonId);
    return;
  }
  const stage = findStage(node.id);
  if (stage) startPreset(stage);
}

/** 当前题型对应的练习范围；没有限制时返回空对象。 */
function optionsFor(kindValue: PracticeKind): PracticeOptions {
  switch (kindValue) {
    case "symbols":
      return symbolGroup.value === "all" ? {} : { symbolGroups: [symbolGroup.value] };
    case "notes": {
      const accidentals = includeSharps.value || includeFlats.value;
      if (noteRangeId.value === "all" && !accidentals) return {};
      return {
        noteRange: { low: noteRange.value.low, high: noteRange.value.high },
        includeSharps: includeSharps.value,
        includeFlats: includeFlats.value,
      };
    }
    case "intervals":
      return { intervalIds: intervalIds.value };
    case "chords":
      return { chordTypeIds: chordTypeIds.value };
    case "progressions":
      return { progressionIds: progressionIds.value };
    case "melodies":
      return { playbackKeys: playbackKeys.value, melodySource: melodySource.value };
    default:
      return {};
  }
}

function createQuestions(nextKind: PracticeKind, seed: number): PracticeQuestion[] {
  return createPracticeQuestions(nextKind, seed, optionsFor(nextKind));
}

function resetQuiz() {
  index.value = 0;
  score.value = 0;
  answeredTotal.value = 0;
  correctTotal.value = 0;
  finished.value = false;
  resetQuestion();
}

/** 清掉「这一题」的作答状态：选项、弹过的音、对错、是否揭晓谱面。 */
function resetQuestion() {
  selectedId.value = null;
  playHits.value = [];
  answered.value = false;
  answeredCorrect.value = false;
  revealed.value = !listenFirst.value;
}

/** 自由练习：换题型或换练习范围后重新出题。 */
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

/** 范围改动后，如果正在做同一题型就重开一组，避免题目与选项不一致。 */
function restartKind(nextKind: PracticeKind) {
  if (!preset.value && kind.value === nextKind) start(nextKind);
}

function setNoteRange(id: string) {
  noteRangeId.value = id;
  restartKind("notes");
}

function toggleSharps() {
  includeSharps.value = !includeSharps.value;
  restartKind("notes");
}

function toggleFlats() {
  includeFlats.value = !includeFlats.value;
  restartKind("notes");
}

/** 至少保留一个选项；取消最后一个时保持原样。 */
function toggleInterval(id: string) {
  if (intervalIds.value.includes(id) && intervalIds.value.length === 1) return;
  intervalIds.value = intervalIds.value.includes(id)
    ? intervalIds.value.filter((item) => item !== id)
    : [...intervalIds.value, id];
  restartKind("intervals");
}

function toggleChordType(id: string) {
  if (chordTypeIds.value.includes(id) && chordTypeIds.value.length === 1) return;
  chordTypeIds.value = chordTypeIds.value.includes(id)
    ? chordTypeIds.value.filter((item) => item !== id)
    : [...chordTypeIds.value, id];
  restartKind("chords");
}

function toggleProgression(id: string) {
  if (progressionIds.value.includes(id) && progressionIds.value.length === 1) return;
  progressionIds.value = progressionIds.value.includes(id)
    ? progressionIds.value.filter((item) => item !== id)
    : [...progressionIds.value, id];
  restartKind("progressions");
}

function togglePlaybackKey(key: PlaybackKey) {
  if (playbackKeys.value.includes(key) && playbackKeys.value.length === 1) return;
  playbackKeys.value = playbackKeys.value.includes(key)
    ? playbackKeys.value.filter((item) => item !== key)
    : [...playbackKeys.value, key];
  restartKind("melodies");
}

function selectAllIntervals() {
  intervalIds.value = INTERVAL_CATALOG.map((item) => item.id);
  restartKind("intervals");
}

function selectAllPlaybackKeys() {
  playbackKeys.value = [...PLAYBACK_KEYS];
  restartKind("melodies");
}

function setMelodySource(source: "bank" | "random") {
  melodySource.value = source;
  restartKind("melodies");
}

function setListenFirst() {
  listenFirst.value = !listenFirst.value;
  if (!listenFirst.value) {
    revealed.value = true;
    return;
  }
  // 启用「先听再看」：谱面先藏起来，答完调性再照谱跟弹，不让调性直接从谱上数出来。
  revealed.value = answered.value;
}

function revealNow() {
  revealed.value = true;
}

/** 选项作答：点一个选项就定分。 */
function choose(choiceId: string) {
  if (!current.value || answered.value) return;
  selectedId.value = choiceId;
  settleAnswer(isPracticeAnswer(current.value, choiceId));
}

/**
 * 弹奏作答：每弹一个音判一次，弹完（或弹错）才算答完。
 *
 * 屏幕琴键和 MIDI 键盘都走这里——`source` 只决定声音从哪来，不影响判题。
 */
function onPlayNote(note: MidiNote) {
  // 跟弹与作答是两条独立的练习：答完、或题型不支持弹奏时，跟弹照样要收到音。
  if (note.kind === "on") {
    pulseSeq += 1;
    notePulse.value = { seq: pulseSeq, note };
  }
  if (note.kind !== "on" || answered.value) return;
  if (!keysMode.value || !playTarget.value) return;

  if (playHits.value.length === 0) playStartedAt.value = note.timeMs;
  playHits.value = [...playHits.value, { midi: note.midi, atMs: note.timeMs }];
  const judge = judgePlay(playTarget.value, playedMidis.value);
  if (judge.state === "pending") return;
  settleAnswer(judge.state === "correct");
}

/** 记分 + 揭晓谱面：选项和弹奏共用，保证两条路的口径完全一致。 */
function settleAnswer(ok: boolean) {
  answered.value = true;
  answeredCorrect.value = ok;
  answeredTotal.value += 1;
  if (ok) {
    score.value += 1;
    correctTotal.value += 1;
  }
  // 答一题记一笔：按题型累计正确率，只写计数不写过关（关卡结论仍由 finish 出）。
  // 父组件把每次 emit 顺序应用回 props，快速连答也不会丢。
  if (props.profile) {
    const next = recordPracticeAnswer(props.profile, kind.value, ok);
    if (next !== props.profile) emit("update-profile", next);
  }
  // 答完即揭谱：旋律题答完调性就要照着同一份谱面跟弹，没有理由再等。
  if (listenFirst.value && !revealed.value) revealed.value = true;
}

/* ── MIDI 硬件订阅 ──────────────────────────────────────────────────── */

let stopMidi: (() => void) | null = null;
let midiToken = 0;

async function syncMidi(connected: boolean) {
  const token = ++midiToken;
  stopMidi?.();
  stopMidi = null;
  if (!connected) return;
  try {
    const stop = await subscribeMidi((note) => {
      if (token !== midiToken) return;
      onPlayNote(note);
    });
    if (token !== midiToken) {
      stop();
      return;
    }
    stopMidi = stop;
  } catch {
    // 设备不可用时静默失败：屏幕琴键和选项作答都还能用。
  }
}

watch(
  () => props.midiConnected,
  (connected) => {
    void syncMidi(connected);
  },
);

onMounted(() => {
  void syncMidi(props.midiConnected);
});

onBeforeUnmount(() => {
  midiToken += 1;
  stopMidi?.();
  stopMidi = null;
});

function nextQuestion() {
  if (!answered.value) return;
  if (index.value >= questions.value.length - 1) {
    if (endless.value) {
      questions.value = [
        ...questions.value,
        ...createQuestions(
          kind.value,
          baseSeed + session.value * 7919 + questions.value.length + 1,
        ),
      ];
      index.value += 1;
      resetQuestion();
      return;
    }
    finish();
    return;
  }
  index.value += 1;
  resetQuestion();
}

function finish() {
  finished.value = true;
  if (!preset.value || !props.profile) return;
  const next = recordTheoryResult(
    props.profile,
    preset.value.id,
    score.value,
    preset.value.passScore,
  );
  if (next !== props.profile) emit("update-profile", next);
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

    <section v-if="!preset" class="options" data-test="practice-options">
      <div class="option-toggles">
        <button
          type="button"
          :aria-pressed="listenFirst"
          data-test="practice-listen-first"
          @click="setListenFirst"
        >
          {{ listenFirst ? "先听再看：开" : "先听再看：关" }}
        </button>
        <button
          type="button"
          :aria-pressed="endless"
          data-test="practice-endless"
          @click="endless = !endless"
        >
          {{ endless ? "连续出题：开" : "连续出题：关" }}
        </button>
      </div>

      <div v-if="kind === 'notes'" class="option-block" data-test="practice-note-options">
        <span class="option-label">音域</span>
        <div class="segments">
          <button
            v-for="range in NOTE_RANGES"
            :key="range.id"
            type="button"
            :aria-pressed="noteRangeId === range.id"
            :data-test="`practice-note-range-${range.id}`"
            @click="setNoteRange(range.id)"
          >
            {{ range.label }}
          </button>
        </div>
        <label>
          <input
            type="checkbox"
            :checked="includeSharps"
            data-test="practice-note-sharps"
            @change="toggleSharps"
          />
          升号
        </label>
        <label>
          <input
            type="checkbox"
            :checked="includeFlats"
            data-test="practice-note-flats"
            @change="toggleFlats"
          />
          降号
        </label>
      </div>

      <details v-if="kind === 'intervals'" class="option-block" data-test="practice-interval-options">
        <summary>音程范围（{{ intervalIds.length }} / {{ INTERVAL_CATALOG.length }}）</summary>
        <div class="option-grid">
          <label v-for="item in INTERVAL_CATALOG" :key="item.id">
            <input
              type="checkbox"
              :checked="intervalIds.includes(item.id)"
              :data-test="`practice-interval-${item.id}`"
              @change="toggleInterval(item.id)"
            />
            {{ item.abbr }}
          </label>
        </div>
        <button type="button" class="option-action" data-test="practice-interval-all" @click="selectAllIntervals">
          全选
        </button>
      </details>

      <div v-if="kind === 'chords'" class="option-block" data-test="practice-chord-options">
        <span class="option-label">和弦类型</span>
        <div class="option-grid">
          <label v-for="item in CHORD_CATALOG" :key="item.id">
            <input
              type="checkbox"
              :checked="chordTypeIds.includes(item.id)"
              :data-test="`practice-chord-${item.id}`"
              @change="toggleChordType(item.id)"
            />
            {{ CHORD_LABELS[item.id] ?? item.id }}
          </label>
        </div>
      </div>

      <div v-if="kind === 'progressions'" class="option-block" data-test="practice-progression-options">
        <span class="option-label">进行</span>
        <div class="option-grid">
          <label v-for="item in PROGRESSIONS" :key="item.id">
            <input
              type="checkbox"
              :checked="progressionIds.includes(item.id)"
              :data-test="`practice-progression-${item.id}`"
              @change="toggleProgression(item.id)"
            />
            {{ item.chords.join(" → ") }}
          </label>
        </div>
      </div>

      <div v-if="kind === 'melodies'" class="option-block" data-test="practice-melody-options">
        <span class="option-label">调性</span>
        <div class="option-grid">
          <label v-for="key in PLAYBACK_KEYS" :key="key">
            <input
              type="checkbox"
              :checked="playbackKeys.includes(key)"
              :data-test="`practice-key-${key}`"
              @change="togglePlaybackKey(key)"
            />
            {{ KEY_LABELS[key] }}
          </label>
        </div>
        <button type="button" class="option-action" data-test="practice-key-all" @click="selectAllPlaybackKeys">
          全选
        </button>
        <div class="segments">
          <button
            type="button"
            :aria-pressed="melodySource === 'bank'"
            data-test="practice-melody-source-bank"
            @click="setMelodySource('bank')"
          >
            题库
          </button>
          <button
            type="button"
            :aria-pressed="melodySource === 'random'"
            data-test="practice-melody-source-random"
            @click="setMelodySource('random')"
          >
            随机
          </button>
        </div>
      </div>
    </section>

    <section class="presets" data-test="practice-presets">
      <div class="presets-head">
        <h2>乐理地图</h2>
        <p class="muted">
          一条路径：基础十关按顺序点亮，每关是一组专项题组；L3 预备课作为第二章随时复习。
        </p>
      </div>
      <div class="chapters" data-test="practice-stages">
        <section
          v-for="chapter in THEORY_CHAPTERS"
          :key="chapter.id"
          class="chapter"
          :data-test="`practice-chapter-${chapter.id}`"
        >
          <header class="chapter-head">
            <h3>{{ chapter.title }}</h3>
            <span class="chapter-count">
              {{ chapterDone(chapter.id) }} / {{ chapterNodes(chapter.id).length }}
            </span>
          </header>
          <div class="chapter-meter" aria-hidden="true">
            <span :style="{ width: chapterPercent(chapter.id) }"></span>
          </div>
          <p class="chapter-desc">{{ chapter.description }}</p>
          <ol class="rail">
            <li
              v-for="(node, position) in chapterNodes(chapter.id)"
              :key="node.id"
              class="stage"
              :data-state="nodeState(node)"
              :data-next="node.id === nextNodeId"
            >
              <span class="marker" aria-hidden="true">{{ markerFor(node, position) }}</span>
              <button
                type="button"
                class="stage-body"
                :class="{ active: node.id === presetId }"
                :disabled="nodeState(node) === 'locked'"
                :data-test="`practice-stage-${node.id}`"
                @click="openNode(node)"
              >
                <span class="stage-row">
                  <span class="stage-name">{{ node.title }}</span>
                  <span class="stage-meta">{{ nodeMeta(node) }}</span>
                </span>
                <span class="stage-caption">{{ node.goal }}</span>
              </button>
            </li>
          </ol>
        </section>
      </div>
    </section>

    <section v-if="preset" class="stage-head" data-test="practice-stage-head">
      <h2>{{ preset.title }}</h2>
      <p class="stage-goal">{{ preset.goal }}</p>
      <p class="stage-guidance">{{ preset.guidance }}</p>
    </section>

    <section v-if="!finished && current" class="answer-mode" data-test="practice-answer-mode">
      <span class="option-label">作答</span>
      <div class="segments" role="group" aria-label="作答方式">
        <button
          type="button"
          :aria-pressed="answerMode === 'choices'"
          data-test="practice-answer-choices"
          @click="setAnswerMode('choices')"
        >
          选项
        </button>
        <button
          type="button"
          :aria-pressed="answerMode === 'keys'"
          data-test="practice-answer-keys"
          @click="setAnswerMode('keys')"
        >
          弹琴
        </button>
      </div>
      <span v-if="answerMode === 'keys' && !playTarget" class="mode-note" data-test="practice-answer-fallback">
        这类题没有唯一该弹的音，仍用选项作答。
      </span>
    </section>

    <section v-if="finished" class="summary" data-test="practice-summary">
      <h2>本组答对 {{ score }} / {{ questions.length }}</h2>
      <p class="muted" data-test="practice-summary-accuracy">
        正确率 {{ accuracy }}%（{{ correctTotal }} / {{ answeredTotal }}）
      </p>
      <p v-if="kindStat" class="muted" data-test="practice-kind-accuracy">
        这个类型累计正确率 {{ kindStat.percent }}%（{{ kindStat.correct }} / {{ kindStat.answered }}）
      </p>
      <p class="muted">
        <template v-if="preset && score >= preset.passScore">
          这关过了，最高分已经记进乐理地图。想巩固就再来一组。
        </template>
        <template v-else-if="preset">
          这组还差一点（通过线 {{ preset.passScore }} 题）。对照下面的判读步骤再看一遍，换一组题重来。
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
        <button
          v-if="listenFirst && !revealed && current.staff"
          type="button"
          class="reveal"
          data-test="practice-reveal"
          @click="revealNow"
        >
          看谱
        </button>
        <span v-if="listenFirst && !revealed && current.staff" class="listen-hint" data-test="practice-listen-hint">
          先听，答完自动显示谱面
        </span>
        <p v-if="answeredTotal > 0" class="accuracy" data-test="practice-accuracy">
          正确率 {{ accuracy }}%（{{ correctTotal }} / {{ answeredTotal }}）
        </p>
        <p v-if="kindStat" class="accuracy kind" data-test="practice-kind-accuracy">
          这个类型累计 {{ kindStat.percent }}%（{{ kindStat.correct }} / {{ kindStat.answered }}）
        </p>
        <p class="progress" data-test="practice-progress">{{ progressText }}</p>
      </div>

      <div class="prompt" :class="{ 'is-hidden': keysMode }" data-test="practice-prompt">
        {{ current.prompt }}
      </div>
      <p class="hint">{{ keysMode ? playTip : current.hint }}</p>

      <QuestionStaff
        :staff="current.staff"
        :melody="current.melody"
        prefix="practice"
        :show-staff="revealed"
        :auto-play="listenFirst && !revealed"
        :chord-listen="current.kind === 'chords' || current.kind === 'progressions'"
        :block-listen="current.kind === 'broken'"
        :pulse="notePulse"
      />

      <div v-if="keysMode" class="play" data-test="practice-play">
        <div class="play-head">
          <span v-if="!answered" class="play-count" data-test="practice-play-progress">
            已弹 {{ playJudge?.matched ?? 0 }} / {{ playTarget?.midis.length ?? 0 }}
          </span>
          <span
            v-for="(midi, position) in playedMidis"
            :key="`${position}-${midi}`"
            class="play-chip"
            :class="{ stray: playTarget && !playTarget.midis.includes(midi) }"
          >
            {{ midiLabel(midi) }}
          </span>
        </div>
        <p class="play-device">{{ deviceHint }}</p>
        <div class="keyboard-panel">
          <KeyboardDiagram
            :highlight-midi="answered && playTarget ? playTarget.midis[0] : null"
            @note="onPlayNote"
          />
        </div>
      </div>

      <div v-else class="choices" data-test="practice-choices">
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

      <section
        v-if="answered"
        class="feedback"
        :class="{ ok: correct, bad: !correct }"
        data-test="practice-feedback"
      >
        <header class="feedback-head">
          <span class="feedback-mark" aria-hidden="true">{{ correct ? "✓" : "✕" }}</span>
          <strong>{{ correct ? "答对了" : "不对" }}</strong>
          <span v-if="!correct && !keysMode" class="feedback-answer">
            正确答案 <b>{{ correctChoice?.label }}</b>
          </span>
        </header>
        <p v-if="keysMode" class="feedback-play" data-test="practice-play-verdict">
          <template v-if="correct">你弹的是 {{ playedText }}，一个不多一个不少。</template>
          <template v-else>
            谱面是 <b>{{ answerText }}</b>，你弹的是 {{ playedText }}<template v-if="octaveSlip">——音名对了，八度不对</template>。
          </template>
        </p>
        <p v-if="keysMode && playRhythmText" class="feedback-rhythm" data-test="practice-play-rhythm">
          {{ playRhythmText }}
        </p>
        <p class="feedback-summary">{{ current.explanation }}</p>
        <ol v-if="current.explanationSteps?.length" class="feedback-steps">
          <li v-for="(step, position) in current.explanationSteps" :key="position">{{ step }}</li>
        </ol>
      </section>

      <button
        v-if="answered"
        type="button"
        class="primary next"
        data-test="practice-next"
        @click="nextQuestion"
      >
        {{ endless || index < questions.length - 1 ? "下一题" : "看结果" }}
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

/* 练习范围：默认收起次要选项，只把两个模式开关放在最上面 */
.options {
  display: grid;
  gap: var(--pb-space-2);
  margin: 0 0 var(--pb-space-4);
  padding: var(--pb-space-3);
  border: 1px solid var(--pb-border-soft);
  border-radius: var(--pb-radius);
  background: var(--pb-surface-2);
}

.option-toggles {
  display: flex;
  flex-wrap: wrap;
  gap: var(--pb-space-2);
}

.option-toggles button,
.option-action {
  padding: 0.45rem 0.75rem;
  border: 1px solid var(--pb-border);
  border-radius: var(--pb-radius);
  background: var(--pb-surface);
  color: var(--pb-ink);
  cursor: pointer;
}

.option-toggles button[aria-pressed="true"] {
  border-color: var(--pb-accent);
  box-shadow: 0 0 0 1px var(--pb-accent);
}

.option-block {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--pb-space-2);
  font-size: 0.85rem;
}

.option-block summary {
  cursor: pointer;
  color: var(--pb-ink);
}

.option-label {
  color: var(--pb-muted);
  font-size: 0.8rem;
}

/* 作答方式：一个动作一个入口，选项和弹琴并排在题目上方 */
.answer-mode {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--pb-space-2);
  margin: 0 0 0.75rem;
}

.mode-note {
  color: var(--pb-muted);
  font-size: 0.78rem;
  line-height: 1.4;
}

.option-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem 0.75rem;
  width: 100%;
}

.option-grid label {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  color: var(--pb-ink);
  font-size: 0.82rem;
}

.options .segments {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 0.3rem;
}

.options .segments button {
  padding: 0.35rem 0.6rem;
  border: 1px solid var(--pb-border-soft);
  border-radius: var(--pb-radius);
  background: var(--pb-surface);
  color: var(--pb-ink);
  cursor: pointer;
  font-size: 0.8rem;
}

.options .segments button[aria-pressed="true"] {
  border-color: var(--pb-accent);
  box-shadow: 0 0 0 1px var(--pb-accent);
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

/* 乐理地图：一条竖轴串起关卡，节点用序号 / ✓ / 虚线框表示状态 */
.chapters {
  display: grid;
  gap: var(--pb-space-3);
}

.chapter {
  padding: var(--pb-space-3);
  border: 1px solid var(--pb-border-soft);
  border-radius: var(--pb-radius);
  background: var(--pb-surface);
}

.chapter-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.5rem;
}

.chapter-head h3 {
  margin: 0;
  font-size: 0.95rem;
}

.chapter-count {
  color: var(--pb-muted);
  font-size: 0.78rem;
  font-variant-numeric: tabular-nums;
}

.chapter-meter {
  height: 3px;
  margin: 0.4rem 0 0.5rem;
  border-radius: 999px;
  background: var(--pb-surface-2);
  overflow: hidden;
}

.chapter-meter > span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--pb-accent);
  transition: width 240ms ease;
}

.chapter-desc {
  margin: 0 0 var(--pb-space-2);
  color: var(--pb-muted);
  font-size: 0.78rem;
  line-height: 1.5;
}

.rail {
  margin: 0;
  padding: 0;
  list-style: none;
}

.stage {
  position: relative;
  padding: 0 0 0.45rem 2.1rem;
  margin-left: 0.75rem;
  border-left: 2px solid var(--pb-border);
}

/* 走过的那一段路染成绿色，地图一眼能看出练到哪 */
.stage[data-state="done"] {
  border-left-color: var(--pb-ok);
}

.stage:last-child {
  padding-bottom: 0;
  border-left-color: transparent;
}

.marker {
  position: absolute;
  left: -0.85rem;
  top: 0;
  display: grid;
  place-items: center;
  width: 1.6rem;
  height: 1.6rem;
  border: 1px solid var(--pb-border);
  border-radius: 50%;
  background: var(--pb-surface);
  color: var(--pb-muted);
  font-size: 0.72rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.stage[data-state="done"] .marker {
  border-color: var(--pb-ok);
  background: var(--pb-ok);
  color: #fff;
}

/* 当前建议练的那一关：金圈，指路而不强制 */
.stage[data-state="available"][data-next="true"] .marker {
  border-color: var(--pb-accent);
  color: var(--pb-accent);
  box-shadow: 0 0 0 3px var(--pb-accent-soft);
}

.stage[data-state="locked"] .marker {
  border-style: dashed;
}

.stage-body {
  display: grid;
  gap: 0.1rem;
  width: 100%;
  padding: 0.3rem 0.5rem;
  border: 1px solid transparent;
  border-radius: var(--pb-radius);
  background: none;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

/* 标题在左、题量贴右，把横向空间用起来，纵向才能压紧成一条路 */
.stage-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.75rem;
}

.stage-body:hover:not(:disabled) {
  border-color: var(--pb-border);
  background: var(--pb-tip-bg);
}

.stage-body.active {
  border-color: var(--pb-accent);
  background: var(--pb-accent-soft);
}

.stage-body:disabled {
  cursor: default;
}

.stage-name {
  color: var(--pb-ink);
  font-size: 0.9rem;
  font-weight: 600;
  line-height: 1.35;
}

.stage[data-state="locked"] .stage-name {
  color: var(--pb-muted);
  font-weight: 500;
}

.stage-caption {
  color: var(--pb-muted);
  font-size: 0.78rem;
  line-height: 1.45;
}

.stage-meta {
  flex: none;
  color: var(--pb-muted);
  font-size: 0.72rem;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.stage[data-state="done"] .stage-meta {
  color: var(--pb-ok);
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
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: flex-end;
  gap: 0.75rem;
}

.progress {
  margin: 0;
  font-size: 0.85rem;
}

.accuracy,
.listen-hint {
  margin: 0;
  color: var(--pb-muted);
  font-size: 0.8rem;
}

.reveal {
  padding: 0.35rem 0.65rem;
  border: 1px solid var(--pb-border);
  border-radius: var(--pb-radius);
  background: var(--pb-surface);
  color: var(--pb-ink);
  cursor: pointer;
}

.prompt {
  margin: 0.7rem 0 0.25rem;
  font-family: var(--pb-font-display);
  font-size: clamp(1.7rem, 5vw, 2.5rem);
  font-weight: 600;
  line-height: 1.2;
  overflow-wrap: anywhere;
}

/* 弹奏时题面文字就是答案，只留给读屏；视觉上让位给谱面 */
.prompt.is-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  white-space: nowrap;
  border: 0;
  clip-path: inset(50%);
}


.hint {
  margin: 0 0 0.9rem;
}

.choices {
  display: grid;
  gap: 0.5rem;
}

/* ── 弹奏作答 ─────────────────────────────────────────────────────── */

.play {
  display: grid;
  /* 琴键靠内部横向滚动，容器必须能被压缩，否则 grid 会按内容撑到 2000px 以外 */
  grid-template-columns: minmax(0, 1fr);
  gap: 0.5rem;
  min-width: 0;
}

.play-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem;
  min-height: 1.6rem;
}

.play-count {
  margin-right: 0.15rem;
  color: var(--pb-muted);
  font-size: 0.78rem;
  font-variant-numeric: tabular-nums;
}

/* 弹过的音：按下的顺序排开，一眼看出还差几个 */
.play-chip {
  padding: 0.1rem 0.45rem;
  border: 1px solid var(--pb-border-soft);
  border-radius: var(--pb-radius-pill);
  background: var(--pb-surface);
  color: var(--pb-ink);
  font-size: 0.78rem;
  font-variant-numeric: tabular-nums;
}

.play-chip.stray {
  border-color: var(--pb-danger);
  background: color-mix(in srgb, var(--pb-danger) 14%, var(--pb-surface));
  color: var(--pb-danger);
}

.play-device {
  margin: 0;
  color: var(--pb-muted);
  font-size: 0.75rem;
  line-height: 1.45;
}

/* 琴键放深色面板里，和课程页的键盘区同一个视觉 */
.keyboard-panel {
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  margin-top: 0.15rem;
  padding: var(--pb-space-2) var(--pb-space-3);
  border: 1px solid var(--pb-key-gap);
  border-radius: var(--pb-radius);
  background: var(--pb-bg-deep);
  overflow: hidden;
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
  padding: 0.7rem 0.85rem;
  border-left: 3px solid var(--pb-border-soft);
  border-radius: 0 var(--pb-radius) var(--pb-radius) 0;
  background: var(--pb-tip-bg);
  line-height: 1.55;
}

.feedback.ok {
  border-left-color: var(--pb-ok);
  background: var(--pb-ok-bg);
}

.feedback.bad {
  border-left-color: var(--pb-danger);
  background: color-mix(in srgb, var(--pb-danger) 9%, var(--pb-surface));
}

.feedback-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.45rem;
  margin-bottom: 0.35rem;
}

.feedback-mark {
  font-size: 0.82rem;
  font-weight: 700;
}

/* 弹奏作答的对账单：谱面是哪些音、自己弹了哪些音 */
.feedback-play {
  margin: 0 0 0.4rem;
  font-size: 0.85rem;
  line-height: 1.55;
}

/* 时值结论比音高结论弱一级：它是附加观察，不是判分依据 */
.feedback-rhythm {
  margin: 0 0 0.4rem;
  color: var(--pb-muted);
  font-size: 0.8rem;
  font-variant-numeric: tabular-nums;
}

.feedback.ok .feedback-mark {
  color: var(--pb-ok);
}

.feedback.bad .feedback-mark {
  color: var(--pb-danger);
}

.feedback-head strong {
  font-size: 0.95rem;
}

.feedback-answer {
  color: var(--pb-muted);
  font-size: 0.85rem;
}

.feedback-answer b {
  color: var(--pb-ink);
  font-weight: 600;
}

.feedback-summary {
  margin: 0;
  color: var(--pb-ink);
  font-size: 0.9rem;
}

/* 判读步骤：先看什么、再数什么，一条一行便于对照谱面 */
.feedback-steps {
  margin: 0.45rem 0 0;
  padding-left: 1.1rem;
  color: var(--pb-ink-2);
  font-size: 0.85rem;
  line-height: 1.6;
}

.feedback-steps li + li {
  margin-top: 0.15rem;
}

.feedback-steps li::marker {
  color: var(--pb-muted);
  font-variant-numeric: tabular-nums;
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
