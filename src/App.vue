<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { startMetronome } from "./audio/preview";
import { compare, type CompareResult, type PlayedNote } from "./domain/compare";
import { feedbackText, sightFeedbackText } from "./domain/feedback";
import { generateL1 } from "./domain/generate";
import { generateL2 } from "./domain/generateL2";
import { pitchToMidi } from "./domain/pitch";
import {
  applyAssessment,
  applyL2TestResult,
  applyTestResult,
  canEnterSight,
  initialProfile,
  pruneExhaustedErrorSnippet,
  routeAfterAssessment,
  startL2IfReady,
  testBpmForLevel,
  type Assessment,
  type Profile,
} from "./domain/profile";
import { flattenScore } from "./domain/timeline";
import type { Hand, Score } from "./domain/types";
import { DURATION_BEATS } from "./domain/vocabulary";
import {
  connectBleMidi,
  isBleSupported,
  keyboardMode,
  subscribeBleState,
  subscribeMidi,
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
import PlacementView from "./ui/PlacementView.vue";
import L2ReadingView from "./ui/L2ReadingView.vue";
import ReadingView from "./ui/ReadingView.vue";
import ReviewView from "./ui/ReviewView.vue";
import SightView from "./ui/SightView.vue";
import ScoreProgress from "./ui/ScoreProgress.vue";

type Screen = "loading" | "home" | "placement" | "reading" | "sight" | "review" | "test";

const profile = ref<Profile>(initialProfile());
const screen = ref<Screen>("loading");
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
const testLevel = ref<1 | 2>(1);
const activeTestHand = ref<Hand>("RH");
const testFeedback = ref("");
const testPhase = ref<"play" | "feedback">("play");
const testListening = ref(false);
const testComplete = ref(false);
const testStaffEl = ref<HTMLElement | null>(null);
/** L2 过关是双手一条，界面手势说「双手」。 */
const testGrand = computed(() => testLevel.value === 2);
const testHandLabel = computed(() => {
  if (testGrand.value) return "双手";
  return activeTestHand.value === "RH" ? "右手" : "左手";
});

const shellTitle = computed(() => {
  switch (screen.value) {
    case "home":
      return undefined;
    case "placement":
      return undefined;
    case "reading":
      return "识谱";
    case "sight":
      return "视奏";
    case "review":
      return undefined;
    case "test":
      return "过关测试";
    default:
      return undefined;
  }
});

const showBack = computed(
  () => screen.value === "reading"
    || screen.value === "sight"
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
let testPlayed: PlayedNote[] = [];
let testWrong = new Set<string>();
const testCorrect = new Set<string>();
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

function onOpenReading() {
  if (!profile.value.lessonId) {
    screen.value = "placement";
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
    startTest(hands);
    return;
  }
  if (profile.value.lessonId === "L2-test") {
    startL2Test();
    return;
  }
  if (profile.value.lessonId.startsWith("L2")) {
    forcedScore.value = null;
    screen.value = "reading";
    return;
  }
  if (profile.value.l1RightPassed && profile.value.l1LeftPassed) {
    // 两手都过了，回到识谱就进 L2 第一课，而不是重新练 L1。
    enterL2Reading();
    return;
  }
  forcedScore.value = null;
  screen.value = "reading";
}

/** 进 L2：先把课位推到 L2-1（已经进过就原地不动）。 */
function enterL2Reading() {
  const next = startL2IfReady(profile.value);
  if (next.lessonId !== profile.value.lessonId) persist(next);
  forcedScore.value = null;
  screen.value = "reading";
}

function onOpenSight() {
  if (!canEnterSight(profile.value, "RH") && !canEnterSight(profile.value, "LH")) {
    onOpenReading();
    return;
  }
  forcedScore.value = null;
  sightSession.value += 1;
  screen.value = "sight";
}

function onOpenError() {
  const snippet = profile.value.errorSnippets[0];
  if (!snippet) return;
  if (!canEnterSight(profile.value, "RH") && !canEnterSight(profile.value, "LH")) return;
  forcedScore.value = snippet;
  sightSession.value += 1;
  screen.value = "sight";
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
  persist({ ...profile.value, lastSeed: profile.value.lastSeed + 1 });
  review.value = null;
  forcedScore.value = null;
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
  testProgress.value = 0;
  testCursor = 0;
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
  testProgress.value = 0;
  testCursor = 0;
  void armTestInput();
}

function continueAfterFeedback() {
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
  const clockHand: Hand | "BOTH" = testLevel.value === 2 ? "BOTH" : activeTestHand.value;
  const ms = lineMs(testScore.value, clockHand, testClockBpm);
  testTimer = setTimeout(() => finishTestHand(), ms);
}

/** 待弹音序列。L1 只看当前手，L2 两手按拍点合在一起；key 是谱面上色的键。 */
function testTargets(): { key: string; midi: number }[] {
  const current = testScore.value;
  if (!current) return [];
  if (testLevel.value === 2) {
    return flattenScore(current).map((note) => ({ key: `${note.hand}:${note.id}`, midi: note.midi }));
  }
  return soundingEvents(current, activeTestHand.value).map((event) => ({ key: event.id, midi: event.midi }));
}

function onTestNote(note: MidiNote) {
  if (!testClockOn || note.kind !== "on" || testPhase.value !== "play" || !testScore.value) return;
  const event = testTargets()[testCursor];
  if (!event) return;
  testPlayed.push({ midi: note.midi, timeMs: note.timeMs - testStartedAt });
  if (note.midi !== event.midi) testWrong.add(event.key);
  else testCorrect.add(event.key);
  testCursor += 1;
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
  const targets = testTargets();
  targets.forEach((target, index) => {
    const hit = testPlayed[index];
    if (!hit || hit.midi !== target.midi) testWrong.add(target.key);
  });
  testCursor = targets.length;
  syncTestProgress();
  paintTestProgress();
  haltTestClock();
  if (testGrand.value) {
    const result = compare(testScore.value, "BOTH", testPlayed, testClockBpm);
    testResults.value = [...testResults.value, result];
    persist(applyL2TestResult(profile.value, result));
    testComplete.value = true;
    testFeedback.value = feedbackText(result, 2, "RH");
    return;
  }
  const hand = activeTestHand.value;
  const result = compare(testScore.value, hand, testPlayed, testClockBpm);
  testResults.value = [...testResults.value, result];
  testFeedback.value = feedbackText(result, 1, hand);
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

function soundingEvents(current: Score, hand: Hand): { id: string; midi: number }[] {
  const events: { id: string; midi: number }[] = [];
  for (const measure of current.staves[hand]?.measures ?? []) {
    for (const note of measure.notes) {
      if (note.duration.endsWith("r") || note.pitches.length === 0) continue;
      const pitch = note.pitches[0];
      events.push({ id: note.id, midi: pitchToMidi(pitch) });
    }
  }
  return events;
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
      :title="shellTitle"
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
      @back="goHome"
      @connect-midi="connectMidi"
      @toggle-theme="toggleTheme"
      @toggle-metronome="toggleMetronome"
      @metronome-bpm="setMetronomeBpm"
      @toggle-keyboard="toggleKeyboardMode"
    >
      <HomeView
        v-if="screen === 'home'"
        :profile="profile"
        :right-unlocked="canEnterSight(profile, 'RH')"
        :left-unlocked="canEnterSight(profile, 'LH')"
        @open-reading="onOpenReading"
        @open-sight="onOpenSight"
        @open-error="onOpenError"
        @open-placement="onOpenPlacement"
      />
      <PlacementView v-else-if="screen === 'placement'" @submit="onAssessment" />
      <L2ReadingView
        v-else-if="screen === 'reading' && profile.lessonId?.startsWith('L2')"
        :profile="profile"
        :midi-connected="midiConnected"
        @update-profile="onProfile"
        @connect-midi="connectMidi"
      />
      <ReadingView
        v-else-if="screen === 'reading'"
        :profile="profile"
        :midi-connected="midiConnected"
        @update-profile="onProfile"
        @connect-midi="connectMidi"
      />
      <SightView
        v-else-if="screen === 'sight'"
        :key="sightSession"
        :profile="profile"
        :midi-connected="midiConnected"
        :forced-score="forcedScore"
        @update-profile="onProfile"
        @finished="onSightFinished"
        @connect-midi="connectMidi"
      />
      <ReviewView
        v-else-if="screen === 'review' && review"
        :feedback="review.feedback"
        :score="review.score"
        :hand="review.hand"
        :wrong-pitch-note-ids="review.wrongPitchNoteIds"
        :late-note-ids="review.lateNoteIds"
        :has-error-book="profile.errorSnippets.length > 0"
        @next="onReviewNext"
        @home="goHome"
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
        <div v-if="!midiConnected" class="connect-prompt">
          <p class="warn">请连接 MIDI 键盘</p>
          <button type="button" class="primary" data-test="connect-midi" @click="connectMidi">
            连接 MIDI 键盘
          </button>
        </div>
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
  border: 1px solid var(--pb-accent);
  border-radius: var(--pb-radius);
  background: var(--pb-accent);
  color: var(--pb-accent-text);
  cursor: pointer;
}

.connect-prompt {
  margin: 0 0 1rem;
}

.connect-prompt .warn {
  margin-bottom: 0.5rem;
}
</style>
