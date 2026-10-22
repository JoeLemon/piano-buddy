<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { startMetronome } from "./audio/preview";
import { compare, type CompareResult, type PlayedNote } from "./domain/compare";
import { feedbackText, sightFeedbackText } from "./domain/feedback";
import { generateL1 } from "./domain/generate";
import { generateL2 } from "./domain/generateL2";
import { generateL3 } from "./domain/generateL3";
import { recordPractice } from "./domain/practiceLog";
import {
  applyAssessment,
  applyL2TestResult,
  applyL3TestResult,
  applyTestResult,
  canEnterL3,
  canEnterSight,
  initialProfile,
  jumpToLesson,
  pruneExhaustedErrorSnippet,
  routeAfterAssessment,
  startL2IfReady,
  startL3IfReady,
  testBpmForLevel,
  type Assessment,
  type LessonId,
  type PracticeKind,
  type Profile,
} from "./domain/profile";
import { scoreBeats } from "./domain/scoreBeats";
import { scoreEvents } from "./domain/scoreEvents";
import type { Hand, Score } from "./domain/types";
import { DURATION_BEATS } from "./domain/vocabulary";
import {
  connectBleMidi,
  isBleSupported,
  keyLabels,
  keyboardMode,
  subscribeBleState,
  subscribeMidi,
  toggleKeyLabels,
  toggleKeyboardMode,
  type MidiNote,
} from "./midi/access";
import { renderGrandScore, renderScore } from "./notation/renderScore";
import {
  grandProgressRatio,
  paintGrandProgress,
  paintScoreProgress,
  scrollGrandToCursor,
  scrollScoreToCursor,
  scoreProgressRatio,
} from "./notation/scorePaint";
import { loadProfile, saveProfile } from "./storage/db";
import AppShell from "./ui/AppShell.vue";
import HomeView from "./ui/HomeView.vue";
import LearnView from "./ui/LearnView.vue";
import MeView from "./ui/MeView.vue";
import PlacementView from "./ui/PlacementView.vue";
import L2ReadingView from "./ui/L2ReadingView.vue";
import L3ReadingView from "./ui/L3ReadingView.vue";
import L3PrepView from "./ui/L3PrepView.vue";
import PracticeView from "./ui/PracticeView.vue";
import ReadingView from "./ui/ReadingView.vue";
import RepertoireView from "./ui/RepertoireView.vue";
import ReviewView from "./ui/ReviewView.vue";
import SightView from "./ui/SightView.vue";
import ScoreProgress from "./ui/ScoreProgress.vue";

type Screen =
  | "loading"
  | "home"
  | "placement"
  | "reading"
  | "sight"
  | "repertoire"
  | "practice"
  | "l3"
  | "review"
  | "test"
  /** 学习分区落地页：识谱主线 + L3 预备两条课程线。 */
  | "learn"
  /** 我的分区落地页：自评、进度概览、设置。 */
  | "me";

const profile = ref<Profile>(initialProfile());
const screen = ref<Screen>("loading");
/**
 * 沉浸页的返回目标：只记录一级分区落地页（今日/学习/练习/曲库/我的）。
 * 过关、复盘这类流程内切屏不会覆盖它，因此从课程进入过关再返回，仍回到最初的分区页。
 */
const returnTo = ref<Screen>("home");
/** 壳层实例：供「我的」页直接拉起设置抽屉，避免再复制一套设置 UI。 */
const shellRef = ref<{ openSettings: () => void } | null>(null);
const webMidiConnected = ref(false);
const bleDevice = ref<string | null>(null);
const midiError = ref<string | null>(null);
const midiConnected = computed(
  () => webMidiConnected.value || bleDevice.value !== null || keyboardMode.value,
);
const secureContext = computed(() => typeof window !== "undefined" && window.isSecureContext === true);
const webMidiAvailable = computed(
  () => typeof navigator !== "undefined" && typeof navigator.requestMIDIAccess === "function",
);
const bleAvailable = computed(() => isBleSupported());
const theme = ref<"light" | "dark">(readInitialTheme());
const sightSession = ref(0);
const forcedScore = ref<Score | null>(null);
/** 视奏/跟弹的来源，决定复盘后回哪里。 */
const sightOrigin = ref<"sight" | "repertoire" | "error">("sight");
/** 从曲库缺技能直达 L3 预备课时，打开的那一节。 */
const l3Focus = ref<string | null>(null);
const metronomeOn = ref(false);
const metronomeBpm = ref(readMetronomeBpm());
let metronomePlayback: { stop: () => void } | null = null;
const review = ref<{
  feedback: string;
  score: Score;
  hand: Hand | "BOTH";
  wrongPitchNoteIds: string[];
  lateNoteIds: string[];
} | null>(null);

const testHands = ref<Hand[]>([]);
const testIndex = ref(0);
const testResults = ref<CompareResult[]>([]);
const testScore = ref<Score | null>(null);
const testLevel = ref<1 | 2 | 3>(1);
const activeTestHand = ref<Hand>("RH");
const testFeedback = ref("");
const testPhase = ref<"play" | "feedback">("play");
const testListening = ref(false);
const testComplete = ref(false);
const testStaffEl = ref<HTMLElement | null>(null);
/** L2/L3 过关是双手一条，界面手势说「双手」。 */
const testGrand = computed(() => testLevel.value !== 1);
const testHandLabel = computed(() => {
  if (testGrand.value) return "双手";
  return activeTestHand.value === "RH" ? "右手" : "左手";
});

const shellTitle = computed(() => {
  switch (screen.value) {
    case "home":
      return undefined;
    case "placement":
      return "自评";
    case "reading":
      return "识谱";
    case "sight":
      return "视奏";
    case "repertoire":
      return "选一首曲子";
    case "practice":
      return "练习";
    case "l3":
      return "L3 预备课";
    case "review":
      return "复盘";
    case "test":
      return "过关测试";
    case "learn":
    case "me":
      // 两个分区页自带 h1，壳层不再重复出标题。
      return undefined;
    default:
      return undefined;
  }
});

/** 面包屑里的上一级：让用户始终知道自己站在哪个分区。首页不带分区，直接显示品牌。 */
const shellSection = computed(() => {
  switch (screen.value) {
    case "home":
    case "placement":
      return undefined;
    case "learn":
    case "reading":
    case "test":
    case "l3":
      return "学习";
    case "practice":
    case "sight":
    case "review":
      return "练习";
    case "repertoire":
      return "曲库";
    case "me":
      return "我的";
    default:
      return undefined;
  }
});

/** 这些页面自己带 h1（三道自评 / 选一首曲子 / 复盘 / 学习 / 我的），壳就不再重复出一行标题。 */
const shellShowHeading = computed(
  () => screen.value !== "placement"
    && screen.value !== "repertoire"
    && screen.value !== "review"
    && screen.value !== "learn"
    && screen.value !== "me",
);

/**
 * 一级导航按「行为」分区：今日决定做什么，学习有先后，练习随时可做，
 * 曲库是内容，我的放档案与设置。过关/复盘属于流程内页，不进导航。
 */
const NAV_SECTIONS = [
  { id: "today", label: "今日" },
  { id: "learn", label: "学习" },
  { id: "practice", label: "练习" },
  { id: "library", label: "曲库" },
  { id: "me", label: "我的" },
] as const;

const activeSection = computed(() => {
  switch (screen.value) {
    case "home":
    case "placement":
      return "today";
    case "learn":
    case "reading":
    case "test":
    case "l3":
      return "learn";
    case "practice":
    case "sight":
    case "review":
      return "practice";
    case "repertoire":
      return "library";
    case "me":
      return "me";
    default:
      return "today";
  }
});

/** 识别谱、视奏、过关、复盘属于「沉浸模式」：藏掉导航，避免误点走开。 */
const navSections = computed(() => {
  const immersive = screen.value === "reading"
    || screen.value === "sight"
    || screen.value === "test"
    || screen.value === "review";
  return immersive ? [] : NAV_SECTIONS;
});

/** 只有一级分区落地页能成为返回目标；流程页（自评/过关/复盘）不记来路。 */
const SECTION_SCREENS = new Set<Screen>(["home", "learn", "practice", "repertoire", "me"]);

/**
 * 从一级分区进入流程页时只记来源，切屏交给流程函数自己完成。
 * 过关测试由 startTest/startL2Test 接管，所以这里不能直接改 screen。
 */
function recordReturn() {
  if (SECTION_SCREENS.has(screen.value)) returnTo.value = screen.value;
}

/**
 * 用户主动进入某一页时调用：如果当前正停在一级分区，就把它记作返回目标。
 * 沉浸页之间、流程页之间的切换不覆盖来路，避免返回键越退越远。
 */
function navigateTo(next: Screen) {
  if (next === screen.value) return;
  recordReturn();
  screen.value = next;
}

/** 返回：回到进入当前页之前的分区页；没有记录时回今日。 */
function onBack() {
  stopTestAudio();
  review.value = null;
  forcedScore.value = null;
  screen.value = returnTo.value;
}

function onNavigate(id: string) {
  switch (id) {
    case "today":
      goHome();
      return;
    case "learn":
      onOpenLearn();
      return;
    case "practice":
      onOpenPractice();
      return;
    case "library":
      onOpenRepertoire();
      return;
    case "me":
      navigateTo("me");
  }
}

const showBack = computed(
  () => screen.value === "reading"
    || screen.value === "sight"
    || screen.value === "repertoire"
    || screen.value === "practice"
    || screen.value === "l3"
    || screen.value === "review"
    || screen.value === "test",
);

let testMidiToken = 0;
let testStopMidi: (() => void) | null = null;
let testMetronome: { stop: () => void } | null = null;
let testTimer: ReturnType<typeof setTimeout> | null = null;
let testClockOn = false;
let testStartedAt = 0;
let testClockBpm = 60;
let testCursor = 0;
/** 当前要按的「拍」下标；与 testCursor（事件数）分开，因为一拍可能有两个事件。 */
let testTargetIndex = 0;
let testPlayed: PlayedNote[] = [];
let testWrong = new Set<string>();
const testCorrect = new Set<string>();
/** 和弦过关时先攒够这一组要按的键，再整组判定。 */
let testChordBuffer: number[] = [];
const testProgress = ref(0);
let midiWatchStop: (() => void) | null = null;
let bleStateStop: (() => void) | null = null;

watch([testScore, testStaffEl, activeTestHand], drawTestStaff, { flush: "post" });
watch(testProgress, paintTestProgress, { flush: "post" });
watch(midiConnected, (connected) => {
  if (!connected) {
    if (testPhase.value === "play") haltTestClock();
    return;
  }
  if (screen.value === "test" && testPhase.value === "play") void armTestInput();
});

watch(theme, (value) => applyTheme(value), { immediate: true });

function readInitialTheme(): "light" | "dark" {
  try {
    const saved = localStorage.getItem("piano-buddy-theme");
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    // ignore
  }
  if (typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches) {
    return "dark";
  }
  return "light";
}

function applyTheme(value: "light" | "dark") {
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("data-theme", value);
  }
  try {
    localStorage.setItem("piano-buddy-theme", value);
  } catch {
    // ignore
  }
}

function toggleTheme() {
  theme.value = theme.value === "dark" ? "light" : "dark";
}

function readMetronomeBpm(): number {
  try {
    const saved = Number(localStorage.getItem("piano-buddy-metronome-bpm"));
    if (Number.isFinite(saved) && saved >= 40 && saved <= 200) return Math.round(saved);
  } catch {
    // ignore
  }
  return 80;
}

function persistMetronomeBpm(bpm: number) {
  try {
    localStorage.setItem("piano-buddy-metronome-bpm", String(bpm));
  } catch {
    // ignore
  }
}

function syncMetronomePlayback() {
  metronomePlayback?.stop();
  metronomePlayback = null;
  if (metronomeOn.value) metronomePlayback = startMetronome(metronomeBpm.value);
}

watch(metronomeOn, syncMetronomePlayback);
watch(metronomeBpm, (bpm) => {
  persistMetronomeBpm(bpm);
  if (metronomeOn.value) syncMetronomePlayback();
});

function toggleMetronome() {
  metronomeOn.value = !metronomeOn.value;
}

function setMetronomeBpm(value: number) {
  if (!Number.isFinite(value)) return;
  metronomeBpm.value = Math.round(Math.min(200, Math.max(40, value)));
}

onMounted(async () => {
  try {
    profile.value = await loadProfile();
  } catch {
    profile.value = initialProfile();
  }
  screen.value = profile.value.assessment ? "home" : "placement";
  void watchMidi();
  bleStateStop = subscribeBleState((deviceName) => {
    bleDevice.value = deviceName;
  });
});

onBeforeUnmount(() => {
  stopTestAudio();
  metronomePlayback?.stop();
  metronomePlayback = null;
  midiWatchStop?.();
  midiWatchStop = null;
  bleStateStop?.();
  bleStateStop = null;
});

function persist(next: Profile) {
  const snapshot = JSON.parse(JSON.stringify(next)) as Profile;
  profile.value = snapshot;
  void saveProfile(snapshot);
}

/** 记录练习时长的页面；其他页面（今天/学习/我的/自评）不计入。 */
const PRACTICE_KIND_BY_SCREEN: Partial<Record<Screen, PracticeKind>> = {
  reading: "reading",
  sight: "sight",
  test: "test",
  practice: "theory",
  l3: "theory",
  repertoire: "repertoire",
};

/** 停留不足 15 秒的页面当作「只是点进来看看」，不写进练习记录。 */
const MIN_PRACTICE_MS = 15000;

let screenEnteredAt = Date.now();

/**
 * 在页面之间切换时结算上一个页面：把停留时长写成一条练习记录。
 * 单次上限与按天聚合交给 practiceLog，这里只负责「哪一段算练习」。
 */
watch(screen, (next, previous) => {
  const now = Date.now();
  const kind = previous ? PRACTICE_KIND_BY_SCREEN[previous] : undefined;
  if (kind) {
    const ms = now - screenEnteredAt;
    if (ms >= MIN_PRACTICE_MS) {
      persist(recordPractice(profile.value, kind, ms, screenEnteredAt));
    }
  }
  screenEnteredAt = now;
});

function onOpenReading() {
  if (!profile.value.lessonId) {
    navigateTo("placement");
    return;
  }
  if (profile.value.lessonId === "L1-test") {
    if (profile.value.l1RightPassed && profile.value.l1LeftPassed) {
      enterL2Reading();
      return;
    }
    const hands: Hand[] = profile.value.l1RightPassed
      ? ["LH"]
      : profile.value.l1LeftPassed
        ? ["RH"]
        : ["RH", "LH"];
    recordReturn();
    startTest(hands);
    return;
  }
  if (profile.value.lessonId === "L2-test") {
    if (profile.value.l2Passed) {
      // 已经过了 L2 还点「先认谱」，是想回看，不是想重考；回到最后一课而不是再考一次。
      persist({ ...profile.value, lessonId: "L2-6", lessonPhase: "notes", findCorrect: 0, linesCompleted: 0 });
      forcedScore.value = null;
      navigateTo("reading");
      return;
    }
    recordReturn();
    startL2Test();
    return;
  }
  if (profile.value.lessonId.startsWith("L3R")) {
    if (profile.value.lessonId === "L3R-test") {
      if (profile.value.l3Passed) {
        // 已经过了 L3 还点进来，是回看，不是重考。
        persist({ ...profile.value, lessonId: "L3R-4", lessonPhase: "notes", findCorrect: 0, linesCompleted: 0 });
        forcedScore.value = null;
        navigateTo("reading");
        return;
      }
      recordReturn();
      startL3Test();
      return;
    }
    forcedScore.value = null;
    navigateTo("reading");
    return;
  }
  if (profile.value.lessonId.startsWith("L2")) {
    forcedScore.value = null;
    navigateTo("reading");
    return;
  }
  if (profile.value.l1RightPassed && profile.value.l1LeftPassed) {
    // 两手都过了，回到识谱就进 L2 第一课，而不是重新练 L1。
    enterL2Reading();
    return;
  }
  forcedScore.value = null;
  navigateTo("reading");
}

/** 进 L2：先把课位推到 L2-1（已经进过就原地不动）。 */
function enterL2Reading() {
  const next = startL2IfReady(profile.value);
  if (next.lessonId !== profile.value.lessonId) persist(next);
  forcedScore.value = null;
  navigateTo("reading");
}

/** L3 和弦识谱入口：L2 过关才真正开课；已过 L3 则回看最后一课。 */
function onOpenL3Reading() {
  if (!profile.value.assessment) {
    navigateTo("placement");
    return;
  }
  if (!canEnterL3(profile.value)) {
    onOpenReading();
    return;
  }
  // 课位停在 L3 过关节点时，交给 onOpenReading 决定是重考还是回看。
  if (profile.value.lessonId === "L3R-test") {
    onOpenReading();
    return;
  }
  if (profile.value.l3Passed) {
    persist({ ...profile.value, lessonId: "L3R-4", lessonPhase: "notes", findCorrect: 0, linesCompleted: 0 });
    forcedScore.value = null;
    navigateTo("reading");
    return;
  }
  const next = startL3IfReady(profile.value);
  if (next.lessonId !== profile.value.lessonId) persist(next);
  forcedScore.value = null;
  navigateTo("reading");
}

function onOpenSight() {
  if (!canEnterSight(profile.value, "RH") && !canEnterSight(profile.value, "LH")) {
    onOpenReading();
    return;
  }
  forcedScore.value = null;
  sightOrigin.value = "sight";
  sightSession.value += 1;
  navigateTo("sight");
}

function onOpenError() {
  const snippet = profile.value.errorSnippets[0];
  if (!snippet) return;
  if (!canEnterSight(profile.value, "RH") && !canEnterSight(profile.value, "LH")) return;
  forcedScore.value = snippet;
  sightOrigin.value = "error";
  sightSession.value += 1;
  navigateTo("sight");
}

function onOpenRepertoire() {
  navigateTo("repertoire");
}

/** 曲库「跟弹本段」：把切好的片段当视奏谱打开，但保留曲库来路。 */
function onFollowScore(payload: { score: Score; hand: Hand | "BOTH"; title: string }) {
  forcedScore.value = payload.score;
  sightOrigin.value = "repertoire";
  sightSession.value += 1;
  navigateTo("sight");
}

/** 曲库缺技能直达：只改课位，不清已通过的 L1/L2/L3。 */
function onOpenLesson(lessonId: LessonId) {
  // 曲库可以先点 L3 技能，但没 L2 过关时仍然先回识谱主线。
  if (lessonId.startsWith("L3R") && !canEnterL3(profile.value)) {
    onOpenReading();
    return;
  }
  persist(jumpToLesson(profile.value, lessonId));
  forcedScore.value = null;
  navigateTo("reading");
}

/** 曲库缺技能直达乐理预备课：打开指定那一节。 */
function onOpenTheory(lessonId: string) {
  l3Focus.value = lessonId;
  navigateTo("l3");
}

/** 学习分区落地页：没有自评就没有课程线，先回自评。 */
function onOpenLearn() {
  if (!profile.value.assessment) {
    navigateTo("placement");
    return;
  }
  navigateTo("learn");
}

function onOpenPractice() {
  navigateTo("practice");
}

function onOpenL3() {
  l3Focus.value = null;
  navigateTo("l3");
}

function onOpenPlacement() {
  screen.value = "placement";
}

function onAssessment(assessment: Assessment) {
  const route = routeAfterAssessment(assessment);
  const next = applyAssessment(profile.value, assessment);
  persist(next);
  if (route.kind === "lesson") {
    screen.value = "reading";
    return;
  }
  startTest(route.hands);
}

function onProfile(next: Profile) {
  const previous = profile.value;
  persist(next);
  if (next.lessonId === "L1-test" && previous.lessonId !== "L1-test") {
    if (next.l1RightPassed && next.l1LeftPassed) {
      screen.value = "home";
      return;
    }
    const hands: Hand[] = next.l1RightPassed ? ["LH"] : next.l1LeftPassed ? ["RH"] : ["RH", "LH"];
    startTest(hands);
    return;
  }
  if (next.lessonId === "L2-test" && previous.lessonId !== "L2-test") {
    startL2Test();
    return;
  }
  if (next.lessonId === "L3R-test" && previous.lessonId !== "L3R-test") {
    startL3Test();
  }
}

function onSightFinished(payload: {
  score: Score;
  result: CompareResult;
  hand: Hand | "BOTH";
  wrongPitchNoteIds: string[];
  lateNoteIds: string[];
}) {
  let next = profile.value;
  if (payload.result.pitchErrors > 0 || payload.result.rhythmBreaks > 0) {
    if (!next.errorSnippets.some((item) => item.id === payload.score.id)) {
      next = { ...next, errorSnippets: [...next.errorSnippets, payload.score] };
    }
  }
  next = pruneExhaustedErrorSnippet(next, payload.score.id);
  persist(next);
  review.value = {
    feedback: sightFeedbackText(payload.result),
    score: payload.score,
    hand: payload.hand,
    wrongPitchNoteIds: payload.wrongPitchNoteIds,
    lateNoteIds: payload.lateNoteIds,
  };
  forcedScore.value = null;
  screen.value = "review";
}

function onReviewNext() {
  if (sightOrigin.value === "repertoire") {
    review.value = null;
    forcedScore.value = null;
    sightOrigin.value = "sight";
    screen.value = "repertoire";
    return;
  }
  persist({ ...profile.value, lastSeed: profile.value.lastSeed + 1 });
  review.value = null;
  forcedScore.value = null;
  sightOrigin.value = "sight";
  sightSession.value += 1;
  screen.value = "sight";
}

function onReviewRetryError() {
  const snippet = profile.value.errorSnippets.find((item) => item.id === review.value?.score.id)
    ?? profile.value.errorSnippets[0];
  review.value = null;
  if (!snippet) {
    screen.value = "home";
    return;
  }
  forcedScore.value = snippet;
  sightOrigin.value = "error";
  sightSession.value += 1;
  screen.value = "sight";
}

function goHome() {
  stopTestAudio();
  review.value = null;
  forcedScore.value = null;
  screen.value = profile.value.assessment ? "home" : "placement";
}

function startTest(hands: Hand[]) {
  stopTestAudio();
  testLevel.value = 1;
  testHands.value = [...hands];
  testIndex.value = 0;
  testResults.value = [];
  testComplete.value = false;
  testFeedback.value = "";
  beginTestHand();
  screen.value = "test";
}

/** L2 过关：一条新的双手 4 小节，比 L1 慢，通过后解锁 L2 视奏。 */
function startL2Test() {
  stopTestAudio();
  testLevel.value = 2;
  testHands.value = ["RH", "LH"];
  testIndex.value = 0;
  testResults.value = [];
  testComplete.value = false;
  testFeedback.value = "";
  activeTestHand.value = "RH";
  const seed = profile.value.lastSeed;
  testScore.value = generateL2({ seed, mode: "reading-test", shape: { kind: "test" } });
  persist({ ...profile.value, lastSeed: seed + 1 });
  testPlayed = [];
  testWrong = new Set();
  testCorrect.clear();
  testChordBuffer = [];
  testProgress.value = 0;
  testCursor = 0;
  testTargetIndex = 0;
  testPhase.value = "play";
  screen.value = "test";
  void armTestInput();
}

/** L3 过关：双手 + 三和弦 + 临时升降；通过后解锁 L3 视奏与曲库闭环。 */
function startL3Test() {
  stopTestAudio();
  testLevel.value = 3;
  testHands.value = ["RH", "LH"];
  testIndex.value = 0;
  testResults.value = [];
  testComplete.value = false;
  testFeedback.value = "";
  activeTestHand.value = "RH";
  const seed = profile.value.lastSeed;
  testScore.value = generateL3({ seed, mode: "reading-test", shape: { kind: "test" } });
  persist({ ...profile.value, lastSeed: seed + 1 });
  testPlayed = [];
  testWrong = new Set();
  testCorrect.clear();
  testChordBuffer = [];
  testProgress.value = 0;
  testCursor = 0;
  testTargetIndex = 0;
  testPhase.value = "play";
  screen.value = "test";
  void armTestInput();
}

function beginTestHand() {
  const hand = testHands.value[testIndex.value];
  if (!hand) return;
  stopTestAudio();
  activeTestHand.value = hand;
  const seed = profile.value.lastSeed;
  testScore.value = generateL1({ hand, seed, mode: "reading-test" });
  persist({ ...profile.value, lastSeed: seed + 1 });
  testFeedback.value = "";
  testPhase.value = "play";
  testPlayed = [];
  testWrong = new Set();
  testCorrect.clear();
  testChordBuffer = [];
  testProgress.value = 0;
  testCursor = 0;
  testTargetIndex = 0;
  void armTestInput();
}

function continueAfterFeedback() {
  if (testLevel.value === 3) {
    if (profile.value.l3Passed) {
      goHome();
      return;
    }
    startL3Test();
    return;
  }
  if (testLevel.value === 2) {
    if (profile.value.l2Passed) {
      goHome();
      return;
    }
    startL2Test();
    return;
  }
  if (!testComplete.value) {
    testIndex.value += 1;
    beginTestHand();
    return;
  }
  if (profile.value.lessonId === "L1-4") {
    screen.value = "reading";
    return;
  }
  if (profile.value.l1RightPassed && profile.value.l1LeftPassed) {
    persist(startL2IfReady(profile.value));
    screen.value = "home";
    return;
  }
  startTest([...testHands.value]);
}

function haltTestClock() {
  testClockOn = false;
  testListening.value = false;
  testMetronome?.stop();
  testMetronome = null;
  if (testTimer) clearTimeout(testTimer);
  testTimer = null;
}

function stopTestAudio() {
  testMidiToken += 1;
  testStopMidi?.();
  testStopMidi = null;
  haltTestClock();
}

async function armTestInput() {
  const token = ++testMidiToken;
  testStopMidi?.();
  testStopMidi = null;
  if (!midiConnected.value || testPhase.value !== "play" || !testScore.value) return;
  try {
    const stop = await subscribeMidi((note) => {
      if (token !== testMidiToken) return;
      onTestNote(note);
    });
    if (token !== testMidiToken) {
      stop();
      return;
    }
    testStopMidi = stop;
    testListening.value = true;
    startTestClock();
  } catch {
    if (token === testMidiToken) testListening.value = false;
  }
}

function startTestClock() {
  if (testClockOn || testPhase.value !== "play" || !testScore.value) return;
  testClockOn = true;
  testStartedAt = performance.now();
  testClockBpm = testBpmForLevel(profile.value, testLevel.value);
  testMetronome?.stop();
  testMetronome = startMetronome(testClockBpm);
  const clockHand: Hand | "BOTH" = testGrand.value ? "BOTH" : activeTestHand.value;
  const ms = lineMs(testScore.value, clockHand, testClockBpm);
  testTimer = setTimeout(() => finishTestHand(), ms);
}

/**
 * 待弹序列。L1 只看当前手，L2/L3 两手按拍点合在一起。
 *
 * L3 双手谱里左手和弦常与右手旋律同一拍起音，所以这里按「拍」而不是按事件
 * 分组：keys 是这一拍所有事件在谱面上对应的上色键，ids 用于回写错误。
 */
function testTargets(): { keys: string[]; ids: string[]; midis: number[] }[] {
  const current = testScore.value;
  if (!current) return [];
  const both = testGrand.value;
  const events = scoreEvents(current, both ? "BOTH" : activeTestHand.value);
  const keyFor = (hand: string, id: string) => (both ? `${hand}:${id}` : id);
  // 没有和弦时保持「一拍一个音」的旧行为（L2 双手同拍也是逐音按键）。
  if (!events.some((event) => event.midis.length > 1)) {
    return events.map((event) => ({
      keys: [keyFor(event.hand, event.id)],
      ids: [event.id],
      midis: event.midis,
    }));
  }
  return scoreBeats(events).map((beat) => ({
    keys: beat.events.map((event) => keyFor(event.hand, event.id)),
    ids: beat.ids,
    midis: beat.midis,
  }));
}

function onTestNote(note: MidiNote) {
  if (!testClockOn || note.kind !== "on" || testPhase.value !== "play" || !testScore.value) return;
  const target = testTargets()[testTargetIndex];
  if (!target) return;
  testPlayed.push({ midi: note.midi, timeMs: note.timeMs - testStartedAt });
  if (target.midis.length === 1) {
    const key = target.keys[0];
    if (note.midi === target.midis[0]) testCorrect.add(key);
    else testWrong.add(key);
    testCursor += target.keys.length;
    testTargetIndex += 1;
    advanceTestPaint();
    return;
  }

  // 和弦/双手同拍：先攒够这一拍要按的键数，再整组做集合比较。
  testChordBuffer.push(note.midi);
  if (testChordBuffer.length < target.midis.length) {
    advanceTestPaint();
    return;
  }
  const pressed = new Set(testChordBuffer);
  const ok = pressed.size === target.midis.length && target.midis.every((midi) => pressed.has(midi));
  target.keys.forEach((key) => (ok ? testCorrect : testWrong).add(key));
  testChordBuffer = [];
  testCursor += target.keys.length;
  testTargetIndex += 1;
  advanceTestPaint();
}

function advanceTestPaint() {
  syncTestProgress();
  paintTestProgress();
  scrollToTestCursor();
}

function syncTestProgress() {
  const current = testScore.value;
  if (!current) {
    testProgress.value = 0;
    return;
  }
  testProgress.value = testGrand.value
    ? grandProgressRatio(current, testCursor)
    : scoreProgressRatio(current, activeTestHand.value, testCursor);
}

function scrollToTestCursor() {
  const el = testStaffEl.value;
  const current = testScore.value;
  if (!el || !current) return;
  if (testGrand.value) {
    scrollGrandToCursor(el, current, testCursor);
    return;
  }
  scrollScoreToCursor(el, current, activeTestHand.value, testCursor);
}

function finishTestHand() {
  if (testPhase.value !== "play" || !testScore.value) return;
  testPhase.value = "feedback";
  testChordBuffer = [];
  haltTestClock();
  if (testGrand.value) {
    const result = compare(testScore.value, "BOTH", testPlayed, testClockBpm);
    testResults.value = [...testResults.value, result];
    const targets = testTargets();
    const wrong = new Set(result.wrongPitchNoteIds);
    targets.forEach((target) => {
      const bad = target.ids.some((id) => wrong.has(id));
      target.keys.forEach((key) => (bad ? testWrong : testCorrect).add(key));
    });
    testCursor = targets.reduce((count, target) => count + target.keys.length, 0);
    syncTestProgress();
    paintTestProgress();
    if (testLevel.value === 3) {
      persist(applyL3TestResult(profile.value, result));
      testFeedback.value = feedbackText(result, 3, "RH");
    } else {
      persist(applyL2TestResult(profile.value, result));
      testFeedback.value = feedbackText(result, 2, "RH");
    }
    testComplete.value = true;
    return;
  }
  const hand = activeTestHand.value;
  const result = compare(testScore.value, hand, testPlayed, testClockBpm);
  testResults.value = [...testResults.value, result];
  testFeedback.value = feedbackText(result, 1, hand);
  const targets = testTargets();
  const wrong = new Set(result.wrongPitchNoteIds);
  targets.forEach((target) => {
    const bad = target.ids.some((id) => wrong.has(id));
    target.keys.forEach((key) => (bad ? testWrong : testCorrect).add(key));
  });
  testCursor = targets.reduce((count, target) => count + target.keys.length, 0);
  syncTestProgress();
  paintTestProgress();
  if (testIndex.value === testHands.value.length - 1) {
    persist(applyTestResult(profile.value, [...testHands.value], testResults.value));
    testComplete.value = true;
  }
}

function drawTestStaff() {
  const el = testStaffEl.value;
  const current = testScore.value;
  if (!el) return;
  if (!current) {
    el.replaceChildren();
    return;
  }
  if (testGrand.value) {
    renderGrandScore(el, current, true);
    paintTestProgress();
    return;
  }
  renderScore(el, current, activeTestHand.value, true);
  paintTestProgress();
}

function paintTestProgress() {
  const el = testStaffEl.value;
  const current = testScore.value;
  if (!el || !current) return;
  if (testGrand.value) {
    paintGrandProgress(el, current, {
      timelineCount: testCursor,
      correctKeys: testCorrect,
      wrongKeys: testWrong,
    });
    return;
  }
  paintScoreProgress(el, current, activeTestHand.value, {
    playedCount: testCursor,
    correctIds: testCorrect,
    wrongIds: testWrong,
  });
}

async function watchMidi() {
  if (typeof navigator.requestMIDIAccess !== "function") {
    webMidiConnected.value = false;
    return;
  }
  try {
    const access = await navigator.requestMIDIAccess();
    const update = () => {
      let connected = false;
      access.inputs.forEach((input) => {
        if (input.state === "connected") connected = true;
      });
      webMidiConnected.value = connected;
    };
    update();
    access.addEventListener("statechange", update);
    midiWatchStop = () => access.removeEventListener("statechange", update);
  } catch {
    webMidiConnected.value = false;
  }
}

function describeMidiError(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message || "";
    if (/not paired/i.test(message)) {
      return "设备未配对：请先在系统（Windows）蓝牙设置里配对该设备，再回来连接";
    }
    switch (error.name) {
      case "NotFoundError":
        return "未找到设备：请让键盘进入配对模式（指示灯闪烁）后，重新点连接";
      case "SecurityError":
        return "安全上下文不可用（需要 HTTPS 或 localhost）";
      case "NotAllowedError":
        return "蓝牙权限被拒绝";
      case "AbortError":
        return "连接已取消";
      default:
        return error.message || error.name;
    }
  }
  return String(error);
}

async function connectMidi() {
  midiError.value = null;
  // Prefer Web Bluetooth: it is the only way to reach BLE MIDI devices (e.g. a
  // Bluetooth digital piano) from Chrome on Windows and Android, because
  // Windows exposes BLE MIDI only via WinRT, which Chrome's Web MIDI (winmm)
  // cannot see. USB MIDI is picked up automatically by watchMidi() instead.
  if (isBleSupported()) {
    try {
      await connectBleMidi();
      midiError.value = null;
      return;
    } catch (error) {
      // User cancelled the chooser or pairing failed; fall through to Web MIDI.
      midiError.value = describeMidiError(error);
    }
  }
  // Fallback: Web MIDI (USB MIDI) for desktop Chrome/Edge.
  if (typeof navigator.requestMIDIAccess === "function") {
    await watchMidi();
  }
}

function lineMs(current: Score, hand: Hand | "BOTH", tempo: number): number {
  const hands: readonly Hand[] = hand === "BOTH" ? ["RH", "LH"] : [hand];
  const beats = Math.max(
    ...hands.map((next) =>
      (current.staves[next]?.measures ?? []).reduce(
        (sum, measure) => sum + measure.notes.reduce((inner, note) => inner + DURATION_BEATS[note.duration], 0),
        0,
      ),
    ),
  );
  return Math.round(beats * (60000 / tempo));
}
</script>

<template>
  <main class="app">
    <p v-if="screen === 'loading'" class="loading">正在读取档案</p>
    <AppShell
      v-else
      ref="shellRef"
      :title="shellTitle"
      :section="shellSection"
      :show-heading="shellShowHeading"
      :sections="navSections"
      :active-section="activeSection"
      :midi-connected="midiConnected"
      :midi-device-name="bleDevice"
      :web-midi-connected="webMidiConnected"
      :secure-context="secureContext"
      :web-midi-available="webMidiAvailable"
      :ble-available="bleAvailable"
      :midi-error="midiError"
      :show-back="showBack"
      :theme="theme"
      :metronome-on="metronomeOn"
      :metronome-bpm="metronomeBpm"
      :keyboard-mode="keyboardMode"
      :key-labels="keyLabels"
      @back="onBack"
      @connect-midi="connectMidi"
      @toggle-theme="toggleTheme"
      @toggle-metronome="toggleMetronome"
      @metronome-bpm="setMetronomeBpm"
      @toggle-keyboard="toggleKeyboardMode"
      @toggle-key-labels="toggleKeyLabels"
      @navigate="onNavigate"
    >
      <HomeView
        v-if="screen === 'home'"
        :profile="profile"
        :right-unlocked="canEnterSight(profile, 'RH')"
        :left-unlocked="canEnterSight(profile, 'LH')"
        @open-reading="onOpenReading"
        @open-l3-reading="onOpenL3Reading"
        @open-sight="onOpenSight"
        @open-repertoire="onOpenRepertoire"
        @open-practice="onOpenPractice"
        @open-error="onOpenError"
        @open-placement="onOpenPlacement"
      />
      <PlacementView v-else-if="screen === 'placement'" @submit="onAssessment" />
      <LearnView
        v-else-if="screen === 'learn'"
        :profile="profile"
        @open-reading="onOpenReading"
        @open-l3-reading="onOpenL3Reading"
        @open-l3="onOpenL3"
      />
      <MeView
        v-else-if="screen === 'me'"
        :profile="profile"
        @open-placement="onOpenPlacement"
        @open-settings="shellRef?.openSettings()"
      />
      <L2ReadingView
        v-else-if="screen === 'reading' && profile.lessonId?.startsWith('L2')"
        :profile="profile"
        :midi-connected="midiConnected"
        @update-profile="onProfile"
      />
      <L3ReadingView
        v-else-if="screen === 'reading' && profile.lessonId?.startsWith('L3R')"
        :profile="profile"
        :midi-connected="midiConnected"
        @update-profile="onProfile"
      />
      <ReadingView
        v-else-if="screen === 'reading'"
        :profile="profile"
        :midi-connected="midiConnected"
        @update-profile="onProfile"
      />
      <SightView
        v-else-if="screen === 'sight'"
        :key="sightSession"
        :profile="profile"
        :midi-connected="midiConnected"
        :forced-score="forcedScore"
        :practice-mode="sightOrigin === 'repertoire'"
        @update-profile="onProfile"
        @finished="onSightFinished"
      />
      <RepertoireView
        v-else-if="screen === 'repertoire'"
        :profile="profile"
        @open-reading="onOpenReading"
        @open-lesson="onOpenLesson"
        @open-theory="onOpenTheory"
        @follow-score="onFollowScore"
      />
      <PracticeView
        v-else-if="screen === 'practice'"
        :profile="profile"
        @update-profile="onProfile"
        @open-sight="onOpenSight"
        @open-error="onOpenError"
      />
      <L3PrepView
        v-else-if="screen === 'l3'"
        :profile="profile"
        :initial-lesson-id="l3Focus ?? undefined"
        @update-profile="onProfile"
      />
      <ReviewView
        v-else-if="screen === 'review' && review"
        :feedback="review.feedback"
        :score="review.score"
        :hand="review.hand"
        :wrong-pitch-note-ids="review.wrongPitchNoteIds"
        :late-note-ids="review.lateNoteIds"
        :has-error-book="profile.errorSnippets.length > 0"
        :next-label="sightOrigin === 'repertoire' ? '回到曲库' : '再看一条新的'"
        @next="onReviewNext"
        @retry-error="onReviewRetryError"
      />
      <div
        v-else-if="screen === 'test'"
        class="surface"
        data-test="pass-test"
        :data-hand="testGrand ? 'BOTH' : activeTestHand"
        :data-level="testLevel"
        :data-hands="testHands.join(',')"
        :data-mode="testScore?.mode"
        :data-score-id="testScore?.id"
        :data-listening="testListening ? 'true' : 'false'"
      >
        <p v-if="!midiConnected" class="warn">请连接 MIDI 键盘（右上角）</p>
        <p class="hand" data-test="test-hand">{{ testHandLabel }}</p>
        <div ref="testStaffEl" class="staff"></div>
        <ScoreProgress v-if="testScore" :value="testProgress" />
        <p v-if="testFeedback" data-test="feedback">{{ testFeedback }}</p>
        <button v-if="testFeedback" type="button" class="primary" data-test="continue" @click="continueAfterFeedback">
          继续
        </button>
      </div>
    </AppShell>
  </main>
</template>

<style scoped>
.app {
  min-height: 100vh;
}

.loading {
  margin: 0;
  padding: 2rem 1.25rem;
  color: var(--pb-muted);
}

.warn,
.hand {
  margin: 0 0 1rem;
  line-height: 1.5;
}

.warn {
  color: var(--pb-warn);
}

.hand {
  color: var(--pb-muted);
}

.staff {
  overflow-x: auto;
  margin: 0 0 0.6rem;
  scrollbar-width: thin;
}

.primary {
  padding: 0.55rem 0.9rem;
  border: 1px solid var(--pb-accent-2);
  border-radius: var(--pb-radius);
  background: var(--pb-accent-2);
  color: var(--pb-accent-text);
  cursor: pointer;
}
</style>
