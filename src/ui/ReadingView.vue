<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { startMetronome } from "../audio/preview";
import { generateL1 } from "../domain/generate";
import {
  currentLessonIndex,
  lessonAdvanceCopy,
  lessonGoalText,
  lessonStepLabel,
  lessonSteps,
} from "../domain/lessonProgress";
import { parsePitchLabel, pitchLabel, pitchToMidi } from "../domain/pitch";
import {
  recordFindKey,
  recordLineFinished,
  recordTap,
  type Profile,
} from "../domain/profile";
import type { Hand, NoteEvent, Score } from "../domain/types";
import { fingerFor, pitchesFor } from "../domain/vocabulary";
import { subscribeMidi, type MidiNote } from "../midi/access";
import {
  paintScoreProgress,
  scrollScoreToCursor,
  scoreProgressRatio,
} from "../notation/scorePaint";
import { renderScore } from "../notation/renderScore";
import KeyboardDiagram from "./KeyboardDiagram.vue";
import ScoreProgress from "./ScoreProgress.vue";

const props = defineProps<{
  profile: Profile;
  midiConnected: boolean;
}>();

const emit = defineEmits<{
  "update-profile": [profile: Profile];
  "connect-midi": [];
}>();

const TAP_CARD = "跟着节拍器敲任何一个键。只看间隔稳不稳。";
const LINE_LEAD = "弹出谱上的音。这个音弹对才进入下一音。";
const READING_TIPS = [
  "可以看键盘。",
  "这个阶段的目标是认准，不是连续视奏。",
  "认熟之后，视奏里才会出现这些音。",
];

const HINTS: Record<string, string> = {
  C4: "中央 C 写在高音谱下加一线，右手大拇指。",
  D4: "D 在中央 C 上面一个白键，高音谱下加一间，右手二指。",
  E4: "E 在高音谱第一线，右手三指。",
  F4: "F 在 E 上面一格，高音谱第一间，右手四指。",
  G4: "G 在高音谱第二线，右手五指。",
  C3: "低音 C 在低音谱第二间，左手五指。",
  D3: "D 在低音谱第三线，左手四指。",
  E3: "E 在低音谱第三间，左手三指。",
  F3: "F 在低音谱第四线，左手二指。",
  G3: "G 在低音谱第四间，左手大拇指。",
};

const RH_LABELS = pitchesFor("C", "RH").map((pitch) => pitchLabel(pitch));
const LH_LABELS = pitchesFor("C", "LH").map((pitch) => pitchLabel(pitch));

const profileState = ref<Profile>(props.profile);
const staffEl = ref<HTMLElement | null>(null);
const score = ref<Score | null>(null);
const hand = ref<Hand>("RH");
const targetLabel = ref<string | null>(null);
const hint = ref("");
const noteIndex = ref(0);
const lastTapMs = ref<number | null>(null);
const cycleIndex = ref(0);
const pendingQueueDrop = ref(false);
const advanceBanner = ref("");
const showTips = ref(!props.profile.seenReadingTips);

let midiToken = 0;
let stopMidi: (() => void) | null = null;
let pulse: { stop: () => void } | null = null;
let bannerTimer: ReturnType<typeof setTimeout> | null = null;
const correctIds = new Set<string>();
const wrongIds = new Set<string>();

const steps = lessonSteps();
const activeStep = computed(() => currentLessonIndex(profileState.value));
const goalText = computed(() => lessonGoalText(profileState.value));
const showsStaff = computed(() => isFind(profileState.value) || isLine(profileState.value));
const progress = computed(() => {
  const current = score.value;
  if (!current || !showsStaff.value) return 0;
  return scoreProgressRatio(current, hand.value, noteIndex.value);
});
watch(progress, applyPaint, { flush: "post" });
const cardText = computed(() => {
  const profile = profileState.value;
  if (profile.lessonId === "L1-1") return TAP_CARD;
  if (isFind(profile) && targetLabel.value) return hintFor(targetLabel.value);
  return "";
});
const lineLead = computed(() => (isLine(profileState.value) ? LINE_LEAD : ""));
const sounding = computed(() => (score.value ? soundingNotes(score.value, hand.value) : []));
const highlightMidi = computed(() => {
  const profile = profileState.value;
  if (isFind(profile) && targetLabel.value) return pitchToMidi(parsePitchLabel(targetLabel.value));
  if (isLine(profile)) return sounding.value[noteIndex.value]?.midi ?? null;
  return null;
});

// 传给键盘图：当前该用哪只手、哪根手指。没有目标音时不点亮任何一只（例如 L1-1 纯节奏课）。
const activeHand = computed<Hand | null>(() => (highlightMidi.value == null ? null : hand.value));
const activeFinger = computed<number | null>(() => {
  const profile = profileState.value;
  if (isFind(profile) && targetLabel.value) return fingerNumber(hand.value, targetLabel.value);
  if (isLine(profile)) return sounding.value[noteIndex.value]?.finger ?? null;
  return null;
});

function dismissTips() {
  showTips.value = false;
  if (profileState.value.seenReadingTips) return;
  commit({ ...profileState.value, seenReadingTips: true });
}

watch(
  () => [props.profile.lessonId, props.profile.lessonPhase] as const,
  (incoming, previous) => {
    if (!previous) {
      beginLesson();
      return;
    }
    if (incoming[0] === profileState.value.lessonId && incoming[1] === profileState.value.lessonPhase) return;
    profileState.value = props.profile;
    beginLesson();
  },
  { immediate: true },
);

watch(
  () => props.midiConnected,
  (connected) => {
    void syncMidi(connected);
    if (
      connected
      && pendingQueueDrop.value
      && targetLabel.value
      && profileState.value.weakPitchQueue[0] === targetLabel.value
    ) {
      pendingQueueDrop.value = false;
      commit({
        ...profileState.value,
        weakPitchQueue: profileState.value.weakPitchQueue.slice(1),
      });
    }
    syncPulse();
  },
  { immediate: true },
);

watch([score, staffEl, hand], drawStaff, { flush: "post" });

onBeforeUnmount(() => {
  midiToken += 1;
  stopMidi?.();
  stopMidi = null;
  pulse?.stop();
  pulse = null;
  if (bannerTimer) clearTimeout(bannerTimer);
});

function beginLesson() {
  hint.value = "";
  noteIndex.value = 0;
  lastTapMs.value = null;
  cycleIndex.value = 0;
  pendingQueueDrop.value = false;
  targetLabel.value = null;
  score.value = null;
  correctIds.clear();
  wrongIds.clear();
  if (isFind(profileState.value)) presentFind();
  else if (isLine(profileState.value)) presentLine();
  syncPulse();
}

function presentFind() {
  const profile = profileState.value;
  const nextHand = handFor(profile);
  hand.value = nextHand;
  correctIds.clear();
  wrongIds.clear();
  const labels = nextHand === "RH" ? RH_LABELS : LH_LABELS;
  const kept = profile.weakPitchQueue.filter((label) => labels.includes(label));
  const queued = kept[0];
  let next = profile;
  if (kept.length !== profile.weakPitchQueue.length) {
    next = { ...profile, weakPitchQueue: kept };
  }
  if (queued) {
    targetLabel.value = queued;
    if (props.midiConnected) {
      pendingQueueDrop.value = false;
      commit({ ...next, weakPitchQueue: kept.slice(1) });
    } else {
      pendingQueueDrop.value = true;
      if (next !== profile) commit(next);
    }
  } else {
    pendingQueueDrop.value = false;
    if (next !== profile) commit(next);
    targetLabel.value = labels[cycleIndex.value % labels.length];
    cycleIndex.value += 1;
  }
  const label = targetLabel.value;
  if (label) score.value = singleNoteScore(label, nextHand);
}

function presentLine(profile = profileState.value) {
  const nextHand = handFor(profile);
  hand.value = nextHand;
  correctIds.clear();
  wrongIds.clear();
  targetLabel.value = null;
  noteIndex.value = 0;
  hint.value = "";
  score.value = generateL1({ hand: nextHand, seed: profile.lastSeed, mode: "reading-lesson" });
}

function onNote(note: MidiNote) {
  if (!props.midiConnected || note.kind !== "on") return;
  const profile = profileState.value;
  if (profile.lessonId === "L1-1") onTap(note);
  else if (isFind(profile)) onFind(note);
  else if (isLine(profile)) onLine(note);
}

function onTap(note: MidiNote) {
  const gap = lastTapMs.value == null ? null : note.timeMs - lastTapMs.value;
  lastTapMs.value = note.timeMs;
  commit(recordTap(profileState.value, gap));
}

function onFind(note: MidiNote) {
  const label = targetLabel.value;
  if (!label) return;
  const correct = note.midi === pitchToMidi(parsePitchLabel(label));
  if (correct) {
    wrongIds.clear();
    correctIds.add("target");
    applyPaint();
  } else {
    wrongIds.add("target");
    applyPaint();
  }
  commit(recordFindKey(profileState.value, label, correct));
  if (!correct || !isFind(profileState.value)) return;
  presentFind();
}

function onLine(note: MidiNote) {
  const expected = sounding.value[noteIndex.value];
  if (!expected) return;
  if (note.midi !== expected.midi) {
    hint.value = hintFor(expected.label);
    wrongIds.add(expected.id);
    applyPaint();
    return;
  }
  hint.value = "";
  wrongIds.delete(expected.id);
  correctIds.add(expected.id);
  if (noteIndex.value + 1 < sounding.value.length) {
    noteIndex.value += 1;
    return;
  }
  const finished = recordLineFinished(profileState.value);
  commit({ ...finished, lastSeed: finished.lastSeed + 1 });
  if (isLine(profileState.value)) presentLine();
}

function commit(next: Profile) {
  if (sameProgress(profileState.value, next)) return;
  const fromLesson = profileState.value.lessonId;
  const lessonChanged = next.lessonId !== profileState.value.lessonId
    || next.lessonPhase !== profileState.value.lessonPhase;
  if (next.lessonId !== fromLesson) {
    const copy = lessonAdvanceCopy(fromLesson, next.lessonId);
    if (copy) showAdvance(copy);
  }
  profileState.value = next;
  emit("update-profile", next);
  if (lessonChanged) beginLesson();
}

function showAdvance(copy: string) {
  advanceBanner.value = copy;
  if (bannerTimer) clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => {
    advanceBanner.value = "";
    bannerTimer = null;
  }, 2000);
}

function sameProgress(current: Profile, next: Profile): boolean {
  return current.lessonId === next.lessonId
    && current.lessonPhase === next.lessonPhase
    && current.tapStreak === next.tapStreak
    && current.findCorrect === next.findCorrect
    && current.linesCompleted === next.linesCompleted
    && current.lastSeed === next.lastSeed
    && current.seenReadingTips === next.seenReadingTips
    && current.weakPitchQueue.length === next.weakPitchQueue.length
    && current.weakPitchQueue.every((label, index) => label === next.weakPitchQueue[index]);
}

function drawStaff() {
  const el = staffEl.value;
  if (!el) return;
  const current = score.value;
  if (!current || !showsStaff.value) {
    el.replaceChildren();
    return;
  }
  renderScore(el, current, hand.value, true);
  applyPaint();
}

/** 给当前谱面上色（弹过/弹对/弹错），并把水平滚动条推进到当前待弹音。 */
function applyPaint() {
  const el = staffEl.value;
  const current = score.value;
  if (!el || !current || !showsStaff.value) return;
  paintScoreProgress(el, current, hand.value, {
    playedCount: noteIndex.value,
    correctIds,
    wrongIds,
  });
  if (isLine(profileState.value)) scrollScoreToCursor(el, current, hand.value, noteIndex.value);
}

async function syncMidi(connected: boolean) {
  const token = ++midiToken;
  if (stopMidi) {
    stopMidi();
    stopMidi = null;
  }
  if (!connected) return;
  try {
    const stop = await subscribeMidi((note) => {
      if (token !== midiToken) return;
      onNote(note);
    });
    if (token !== midiToken) {
      stop();
      return;
    }
    stopMidi = stop;
  } catch {
    // Web MIDI missing or denied. The warning stays up via midiConnected.
  }
}

function syncPulse() {
  const want = props.midiConnected && profileState.value.lessonId === "L1-1";
  if (!want) {
    pulse?.stop();
    pulse = null;
    return;
  }
  if (!pulse) pulse = startMetronome(60);
}

function singleNoteScore(label: string, nextHand: Hand): Score {
  const pitch = parsePitchLabel(label);
  const note: NoteEvent = {
    id: "target",
    pitches: [pitch],
    duration: "w",
  };
  const finger = fingerNumber(nextHand, label);
  if (finger != null) note.fingers = [finger];
  return {
    id: `find-${label}`,
    mode: "reading-lesson",
    level: 1,
    meter: { beats: 4, beatValue: 4 },
    keySignature: "C",
    hands: [nextHand],
    bpm: 60,
    staves: {
      [nextHand]: {
        clef: nextHand === "RH" ? "treble" : "bass",
        measures: [{ notes: [note] }],
      },
    },
  };
}

function soundingNotes(current: Score, nextHand: Hand): { id: string; label: string; midi: number; finger: number | null }[] {
  const measures = current.staves[nextHand]?.measures ?? [];
  const notes: { id: string; label: string; midi: number; finger: number | null }[] = [];
  for (const measure of measures) {
    for (const event of measure.notes) {
      const pitch = event.pitches[0];
      if (!pitch || event.duration.endsWith("r")) continue;
      notes.push({ id: event.id, label: pitchLabel(pitch), midi: pitchToMidi(pitch), finger: event.fingers?.[0] ?? null });
    }
  }
  return notes;
}

function fingerNumber(nextHand: Hand, label: string): number | null {
  try {
    return fingerFor("C", nextHand, parsePitchLabel(label));
  } catch {
    return null;
  }
}

function hintFor(label: string): string {
  return HINTS[label] ?? `${label} 在这只手的五指位置里，用对应的手指弹。`;
}

function isFind(profile: Profile): boolean {
  return profile.lessonId === "L1-2"
    || (profile.lessonId === "L1-4" && profile.lessonPhase === "notes");
}

function isLine(profile: Profile): boolean {
  return profile.lessonId === "L1-3"
    || (profile.lessonId === "L1-4" && profile.lessonPhase === "lines");
}

function handFor(profile: Profile): Hand {
  return profile.lessonId === "L1-4" ? "LH" : "RH";
}
</script>

<template>
  <div class="surface">
    <ol class="progress" data-test="lesson-progress">
      <li
        v-for="(step, index) in steps"
        :key="step"
        :data-active="index === activeStep ? 'true' : 'false'"
        :data-done="index < activeStep ? 'true' : 'false'"
      >
        {{ lessonStepLabel(step) }}
      </li>
    </ol>
    <p v-if="goalText" class="goal" data-test="lesson-goal">{{ goalText }}</p>
    <p v-if="advanceBanner" class="banner" data-test="advance-banner">{{ advanceBanner }}</p>
    <div v-if="showTips" class="tips" data-test="reading-tips">
      <p v-for="tip in READING_TIPS" :key="tip">{{ tip }}</p>
      <button type="button" class="primary" data-test="dismiss-reading-tips" @click="dismissTips">
        知道了
      </button>
    </div>
    <div v-if="!midiConnected" class="connect-prompt">
      <p class="warn">请连接 MIDI 键盘。卡片可以先看。</p>
      <button type="button" class="connect" data-test="connect-midi" @click="emit('connect-midi')">
        连接 MIDI 键盘
      </button>
    </div>
    <p v-if="cardText" class="card">{{ cardText }}</p>
    <p v-if="lineLead" class="card">{{ lineLead }}</p>
    <p v-if="hint" class="hint">{{ hint }}</p>
    <div v-if="showsStaff" ref="staffEl" class="staff"></div>
    <ScoreProgress v-if="showsStaff" :value="progress" />
    <KeyboardDiagram :highlight-midi="highlightMidi" :active-hand="activeHand" :active-finger="activeFinger" :highlight-seq="noteIndex" />
  </div>
</template>

<style scoped>
.progress {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin: 0 0 0.75rem;
  padding: 0;
  list-style: none;
}

.progress li {
  padding: 0.25rem 0.55rem;
  border: 1px solid var(--pb-border-soft);
  border-radius: 999px;
  color: var(--pb-muted);
  font-size: 0.85rem;
}

.progress li[data-active="true"] {
  background: var(--pb-accent);
  border-color: var(--pb-accent);
  color: var(--pb-accent-text);
  font-weight: 600;
}

.progress li[data-done="true"] {
  color: var(--pb-ink);
}

.goal,
.banner,
.warn,
.card,
.hint,
.tips p {
  margin: 0 0 0.85rem;
  line-height: 1.5;
}

.goal {
  color: var(--pb-ink);
  font-weight: 600;
}

.banner {
  padding: 0.65rem 0.8rem;
  border-radius: var(--pb-radius);
  background: rgb(201 132 42 / 16%);
  color: var(--pb-ink);
}

.warn {
  color: var(--pb-warn);
}

.card,
.hint,
.tips p {
  color: var(--pb-muted);
}

.tips {
  margin: 0 0 1rem;
  padding: 0.9rem 1rem;
  border: 1px solid var(--pb-border-soft);
  border-radius: var(--pb-radius);
  background: var(--pb-tip-bg);
}

.primary {
  padding: 0.5rem 0.85rem;
  border: 1px solid var(--pb-accent);
  border-radius: var(--pb-radius);
  background: var(--pb-accent);
  color: var(--pb-accent-text);
  cursor: pointer;
}

.staff {
  overflow-x: auto;
  margin: 0 0 0.6rem;
  scrollbar-width: thin;
}

.connect-prompt {
  margin: 0 0 1rem;
}

.connect-prompt .warn {
  margin-bottom: 0.5rem;
}

.connect {
  padding: 0.55rem 0.9rem;
  border: 1px solid var(--pb-accent);
  border-radius: var(--pb-radius);
  background: var(--pb-accent);
  color: var(--pb-accent-text);
  cursor: pointer;
}
</style>
