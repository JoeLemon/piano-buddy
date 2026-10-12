<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { startMetronome } from "./audio/preview";
import { compare, type CompareResult, type PlayedNote } from "./domain/compare";
import { feedbackText } from "./domain/feedback";
import { generateL1 } from "./domain/generate";
import { pitchToMidi } from "./domain/pitch";
import {
  applyAssessment,
  applyTestResult,
  canEnterSight,
  initialProfile,
  routeAfterAssessment,
  testBpm,
  type Assessment,
  type Profile,
} from "./domain/profile";
import type { Hand, Score } from "./domain/types";
import { DURATION_BEATS } from "./domain/vocabulary";
import { subscribeMidi, type MidiNote } from "./midi/access";
import { renderScore } from "./notation/renderScore";
import { loadProfile, saveProfile } from "./storage/db";
import HomeView from "./ui/HomeView.vue";
import PlacementView from "./ui/PlacementView.vue";
import ReadingView from "./ui/ReadingView.vue";
import ReviewView from "./ui/ReviewView.vue";
import SightView from "./ui/SightView.vue";

type Screen = "loading" | "home" | "placement" | "reading" | "sight" | "review" | "test";

const profile = ref<Profile>(initialProfile());
const screen = ref<Screen>("loading");
const midiConnected = ref(false);
const sightSession = ref(0);
const review = ref<{ feedback: string; score: Score; hand: Hand; wrongNoteIds: string[] } | null>(null);

const testHands = ref<Hand[]>([]);
const testIndex = ref(0);
const testResults = ref<CompareResult[]>([]);
const testScore = ref<Score | null>(null);
const activeTestHand = ref<Hand>("RH");
const testFeedback = ref("");
const testPhase = ref<"play" | "feedback">("play");
const testListening = ref(false);
const testComplete = ref(false);
const testStaffEl = ref<HTMLElement | null>(null);

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
let midiWatchStop: (() => void) | null = null;

watch([testScore, testStaffEl, activeTestHand], drawTestStaff, { flush: "post" });
watch(midiConnected, (connected) => {
  if (!connected) {
    if (testPhase.value === "play") haltTestClock();
    return;
  }
  if (screen.value === "test" && testPhase.value === "play") void armTestInput();
});

onMounted(async () => {
  try {
    profile.value = await loadProfile();
  } catch {
    profile.value = initialProfile();
  }
  screen.value = profile.value.assessment ? "home" : "placement";
  void watchMidi();
});

onBeforeUnmount(() => {
  stopTestAudio();
  midiWatchStop?.();
  midiWatchStop = null;
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
  if (profile.value.lessonId === "L1-test" && !(profile.value.l1RightPassed && profile.value.l1LeftPassed)) {
    const hands: Hand[] = profile.value.l1RightPassed
      ? ["LH"]
      : profile.value.l1LeftPassed
        ? ["RH"]
        : ["RH", "LH"];
    startTest(hands);
    return;
  }
  screen.value = "reading";
}

function onOpenSight() {
  if (!canEnterSight(profile.value, "RH") && !canEnterSight(profile.value, "LH")) {
    onOpenReading();
    return;
  }
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
  }
}

function onSightFinished(payload: { score: Score; result: CompareResult; hand: Hand; wrongNoteIds: string[] }) {
  let next = profile.value;
  if (payload.result.pitchErrors > 0 || payload.result.rhythmBreaks > 0) {
    if (!next.errorSnippets.some((item) => item.id === payload.score.id)) {
      next = { ...next, errorSnippets: [...next.errorSnippets, payload.score] };
    }
  }
  persist(next);
  review.value = {
    feedback: feedbackText(payload.result, 1, payload.hand),
    score: payload.score,
    hand: payload.hand,
    wrongNoteIds: payload.wrongNoteIds,
  };
  screen.value = "review";
}

function onReviewNext() {
  persist({ ...profile.value, lastSeed: profile.value.lastSeed + 1 });
  review.value = null;
  sightSession.value += 1;
  screen.value = "sight";
}

function goHome() {
  stopTestAudio();
  review.value = null;
  screen.value = profile.value.assessment ? "home" : "placement";
}

function startTest(hands: Hand[]) {
  stopTestAudio();
  testHands.value = [...hands];
  testIndex.value = 0;
  testResults.value = [];
  testComplete.value = false;
  testFeedback.value = "";
  beginTestHand();
  screen.value = "test";
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
  testCursor = 0;
  void armTestInput();
}

function continueAfterFeedback() {
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
  testClockBpm = testBpm(profile.value);
  testMetronome?.stop();
  testMetronome = startMetronome(testClockBpm);
  const ms = lineMs(testScore.value, activeTestHand.value, testClockBpm);
  testTimer = setTimeout(() => finishTestHand(), ms);
}

function onTestNote(note: MidiNote) {
  if (!testClockOn || note.kind !== "on" || testPhase.value !== "play" || !testScore.value) return;
  const event = soundingEvents(testScore.value, activeTestHand.value)[testCursor];
  if (!event) return;
  testPlayed.push({ midi: note.midi, timeMs: note.timeMs - testStartedAt });
  if (note.midi !== event.midi) testWrong.add(event.id);
  testCursor += 1;
  paintTestWrong();
}

function finishTestHand() {
  if (testPhase.value !== "play" || !testScore.value) return;
  testPhase.value = "feedback";
  const hand = activeTestHand.value;
  const events = soundingEvents(testScore.value, hand);
  events.forEach((event, index) => {
    const hit = testPlayed[index];
    if (!hit || hit.midi !== event.midi) testWrong.add(event.id);
  });
  paintTestWrong();
  haltTestClock();
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
  renderScore(el, current, activeTestHand.value, true);
  paintTestWrong();
}

function paintTestWrong() {
  const el = testStaffEl.value;
  const current = testScore.value;
  if (!el || !current) return;
  markWrongNotes(el, current, activeTestHand.value, testWrong);
}

async function watchMidi() {
  if (typeof navigator.requestMIDIAccess !== "function") {
    midiConnected.value = false;
    return;
  }
  try {
    const access = await navigator.requestMIDIAccess();
    const update = () => {
      let connected = false;
      access.inputs.forEach((input) => {
        if (input.state === "connected") connected = true;
      });
      midiConnected.value = connected;
    };
    update();
    access.addEventListener("statechange", update);
    midiWatchStop = () => access.removeEventListener("statechange", update);
  } catch {
    midiConnected.value = false;
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

function lineMs(current: Score, hand: Hand, tempo: number): number {
  const beats = (current.staves[hand]?.measures ?? []).reduce(
    (sum, measure) => sum + measure.notes.reduce((inner, note) => inner + DURATION_BEATS[note.duration], 0),
    0,
  );
  return Math.round(beats * (60000 / tempo));
}

function markWrongNotes(element: HTMLElement, current: Score, hand: Hand, ids: ReadonlySet<string>) {
  const groups = Array.from(element.querySelectorAll(".vf-stavenote"));
  const notes = (current.staves[hand]?.measures ?? []).flatMap((measure) => measure.notes);
  notes.forEach((note, index) => {
    const group = groups[index];
    if (!group || !ids.has(note.id)) return;
    group.setAttribute("data-wrong", "true");
    const paths = group.querySelectorAll("path");
    for (let pathIndex = 0; pathIndex < paths.length; pathIndex += 1) {
      const path = paths.item(pathIndex);
      if (!path) continue;
      path.setAttribute("fill", "#8a3d12");
      path.setAttribute("stroke", "#8a3d12");
    }
  });
}
</script>

<template>
  <main class="app">
    <p v-if="screen === 'loading'" class="loading">正在读取档案</p>
    <HomeView
      v-else-if="screen === 'home'"
      :right-unlocked="canEnterSight(profile, 'RH')"
      :left-unlocked="canEnterSight(profile, 'LH')"
      @open-reading="onOpenReading"
      @open-sight="onOpenSight"
      @open-placement="onOpenPlacement"
    />
    <PlacementView v-else-if="screen === 'placement'" @submit="onAssessment" />
    <div v-else-if="screen === 'reading'" class="shell">
      <button type="button" class="back" data-test="home" @click="goHome">返回</button>
      <ReadingView :profile="profile" :midi-connected="midiConnected" @update-profile="onProfile" />
    </div>
    <div v-else-if="screen === 'sight'" class="shell">
      <button type="button" class="back" data-test="home" @click="goHome">返回</button>
      <SightView
        :key="sightSession"
        :profile="profile"
        :midi-connected="midiConnected"
        @update-profile="onProfile"
        @finished="onSightFinished"
      />
    </div>
    <div v-else-if="screen === 'review' && review" class="shell">
      <button type="button" class="back" data-test="home" @click="goHome">返回</button>
      <ReviewView
        :feedback="review.feedback"
        :score="review.score"
        :hand="review.hand"
        :wrong-note-ids="review.wrongNoteIds"
        @next="onReviewNext"
      />
    </div>
    <section
      v-else-if="screen === 'test'"
      class="test"
      data-test="pass-test"
      :data-hand="activeTestHand"
      :data-hands="testHands.join(',')"
      :data-mode="testScore?.mode"
      :data-score-id="testScore?.id"
      :data-listening="testListening ? 'true' : 'false'"
    >
      <button type="button" class="back" data-test="home" @click="goHome">返回</button>
      <div class="panel">
        <h1>过关测试</h1>
        <p v-if="!midiConnected" class="warn">请连接 MIDI 键盘</p>
        <p class="hand">{{ activeTestHand === "RH" ? "右手" : "左手" }}</p>
        <div ref="testStaffEl" class="staff"></div>
        <p v-if="testFeedback" data-test="feedback">{{ testFeedback }}</p>
        <button v-if="testFeedback" type="button" data-test="continue" @click="continueAfterFeedback">继续</button>
      </div>
    </section>
  </main>
</template>

<style scoped>
.app {
  min-height: 100vh;
  background: #faf7f1;
  color: #1c1c1c;
  color-scheme: light;
  font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
}

.loading,
.back {
  margin: 0;
}

.back {
  display: inline-block;
  margin: 1rem 1.25rem 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: #3f3f3f;
  font: inherit;
  text-decoration: underline;
  text-underline-offset: 0.2rem;
  cursor: pointer;
}

.test {
  min-height: 100vh;
}

.panel {
  max-width: 52rem;
  margin: 0 auto;
  padding: 1rem 1.25rem 2rem;
}

h1 {
  margin: 0 0 0.5rem;
  font-size: 1.75rem;
  font-weight: 600;
}

.warn,
.hand {
  margin: 0 0 1rem;
  line-height: 1.5;
}

.warn {
  color: #8a3d12;
}

.hand,
.panel p {
  color: #3f3f3f;
}

.staff {
  overflow-x: auto;
  margin: 0 0 1rem;
}

button[data-test="continue"] {
  padding: 0.55rem 0.9rem;
  border: 1px solid #2a2a2a;
  border-radius: 4px;
  background: #f3c84b;
  color: #1c1c1c;
  font: inherit;
  cursor: pointer;
}

.staff :deep([data-wrong] path) {
  fill: #8a3d12;
  stroke: #8a3d12;
}
</style>
