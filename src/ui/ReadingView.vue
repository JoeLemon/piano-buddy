<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { startMetronome } from "../audio/preview";
import { generateL1 } from "../domain/generate";
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
import { renderScore } from "../notation/renderScore";
import KeyboardDiagram from "./KeyboardDiagram.vue";

const props = defineProps<{
  profile: Profile;
  midiConnected: boolean;
}>();

const emit = defineEmits<{
  "update-profile": [profile: Profile];
}>();

const TAP_CARD = "跟着节拍器敲任何一个键。只看间隔稳不稳。";
const LINE_LEAD = "弹出谱上的音。这个音弹对才进入下一音。";

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

let midiToken = 0;
let stopMidi: (() => void) | null = null;
let pulse: { stop: () => void } | null = null;

const showsStaff = computed(() => isFind(profileState.value) || isLine(profileState.value));
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
});

function beginLesson() {
  hint.value = "";
  noteIndex.value = 0;
  lastTapMs.value = null;
  cycleIndex.value = 0;
  pendingQueueDrop.value = false;
  targetLabel.value = null;
  score.value = null;
  if (isFind(profileState.value)) presentFind();
  else if (isLine(profileState.value)) presentLine();
  syncPulse();
}

function presentFind() {
  const profile = profileState.value;
  const nextHand = handFor(profile);
  hand.value = nextHand;
  const queued = profile.weakPitchQueue[0];
  if (queued && readable(queued)) {
    targetLabel.value = queued;
    if (props.midiConnected) {
      pendingQueueDrop.value = false;
      commit({ ...profile, weakPitchQueue: profile.weakPitchQueue.slice(1) });
    } else {
      pendingQueueDrop.value = true;
    }
  } else {
    pendingQueueDrop.value = false;
    const labels = nextHand === "RH" ? RH_LABELS : LH_LABELS;
    targetLabel.value = labels[cycleIndex.value % labels.length];
    cycleIndex.value += 1;
  }
  const label = targetLabel.value;
  if (label) score.value = singleNoteScore(label, nextHand);
}

function presentLine(profile = profileState.value) {
  const nextHand = handFor(profile);
  hand.value = nextHand;
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
  commit(recordFindKey(profileState.value, label, correct));
  if (!correct || !isFind(profileState.value)) return;
  presentFind();
}

function onLine(note: MidiNote) {
  const expected = sounding.value[noteIndex.value];
  if (!expected) return;
  if (note.midi !== expected.midi) {
    hint.value = hintFor(expected.label);
    return;
  }
  hint.value = "";
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
  const lessonChanged = next.lessonId !== profileState.value.lessonId
    || next.lessonPhase !== profileState.value.lessonPhase;
  profileState.value = next;
  emit("update-profile", next);
  if (lessonChanged) beginLesson();
}

function sameProgress(current: Profile, next: Profile): boolean {
  return current.lessonId === next.lessonId
    && current.lessonPhase === next.lessonPhase
    && current.tapStreak === next.tapStreak
    && current.findCorrect === next.findCorrect
    && current.linesCompleted === next.linesCompleted
    && current.lastSeed === next.lastSeed
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

function soundingNotes(current: Score, nextHand: Hand): { label: string; midi: number }[] {
  const measures = current.staves[nextHand]?.measures ?? [];
  const notes: { label: string; midi: number }[] = [];
  for (const measure of measures) {
    for (const event of measure.notes) {
      const pitch = event.pitches[0];
      if (!pitch || event.duration.endsWith("r")) continue;
      notes.push({ label: pitchLabel(pitch), midi: pitchToMidi(pitch) });
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

function readable(label: string): boolean {
  try {
    parsePitchLabel(label);
    return true;
  } catch {
    return false;
  }
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
  <section class="reading">
    <div class="panel">
      <h1>识谱</h1>
      <p v-if="!midiConnected" class="warn">请连接 MIDI 键盘</p>
      <p v-if="cardText" class="card">{{ cardText }}</p>
      <p v-if="lineLead" class="card">{{ lineLead }}</p>
      <p v-if="hint" class="hint">{{ hint }}</p>
      <div v-if="showsStaff" ref="staffEl" class="staff"></div>
      <KeyboardDiagram :highlight-midi="highlightMidi" />
    </div>
  </section>
</template>

<style scoped>
.reading {
  min-height: 100vh;
  box-sizing: border-box;
  background: #faf7f1;
  color: #1c1c1c;
  color-scheme: light;
  font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
}

.panel {
  max-width: 52rem;
  margin: 0 auto;
  padding: 2rem 1.25rem;
}

h1 {
  margin: 0 0 0.5rem;
  font-size: 1.75rem;
  font-weight: 600;
}

.warn,
.card,
.hint {
  margin: 0 0 1rem;
  line-height: 1.5;
}

.warn {
  color: #8a3d12;
}

.card,
.hint {
  color: #3f3f3f;
}

.staff {
  overflow-x: auto;
  margin: 0 0 1rem;
}
</style>
