<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { generateL2 } from "../domain/generateL2";
import {
  currentLessonIndex,
  lessonGoalText,
  lessonStepLabel,
  lessonSteps,
} from "../domain/lessonProgress";
import { pitchLabel, pitchToMidi } from "../domain/pitch";
import type { Profile } from "../domain/profile";
import type { Hand, Score } from "../domain/types";
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

const EIGHTH_CARD = "一拍里有两个八分音，仍用这五个白键。";
const LINE_LEAD = "弹出谱上的音。这个音弹对才进入下一音。";
const ADVANCE_COPY = "八分音符过了。接下来练双手交替。";
const LINE_GOAL = 2;
/** L2-1 is two right-hand lines, then L2-2. Left hand waits for a later lesson. */
const L2_1_HAND: Hand = "RH";

const HINTS: Record<string, string> = {
  C4: "中央 C 写在高音谱下加一线，右手大拇指。",
  D4: "D 在中央 C 上面一个白键，高音谱下加一间，右手二指。",
  E4: "E 在高音谱第一线，右手三指。",
  F4: "F 在 E 上面一格，高音谱第一间，右手四指。",
  G4: "G 在高音谱第二线，右手五指。",
};

const profileState = ref<Profile>(props.profile);
const staffEl = ref<HTMLElement | null>(null);
const score = ref<Score | null>(null);
const hand = ref<Hand>(L2_1_HAND);
const hint = ref("");
const noteIndex = ref(0);
const advanceBanner = ref("");

let midiToken = 0;
let stopMidi: (() => void) | null = null;
let bannerTimer: ReturnType<typeof setTimeout> | null = null;

const steps = lessonSteps(2);
const activeStep = computed(() => currentLessonIndex(profileState.value));
const goalText = computed(() => lessonGoalText(profileState.value));
const onEighths = computed(() => profileState.value.lessonId === "L2-1");
const cardText = computed(() => (onEighths.value ? EIGHTH_CARD : ""));
const lineLead = computed(() => (onEighths.value ? LINE_LEAD : ""));
const sounding = computed(() => (score.value ? soundingNotes(score.value, hand.value) : []));
const highlightMidi = computed(() => sounding.value[noteIndex.value]?.midi ?? null);

watch(
  () => props.profile.lessonId,
  (incoming, previous) => {
    if (previous === undefined) {
      beginLesson();
      return;
    }
    if (incoming === profileState.value.lessonId) return;
    profileState.value = props.profile;
    beginLesson();
  },
  { immediate: true },
);

watch(
  () => props.midiConnected,
  (connected) => {
    void syncMidi(connected);
  },
  { immediate: true },
);

watch([score, staffEl, hand], drawStaff, { flush: "post" });

onBeforeUnmount(() => {
  midiToken += 1;
  stopMidi?.();
  stopMidi = null;
  if (bannerTimer) clearTimeout(bannerTimer);
});

function beginLesson() {
  hint.value = "";
  noteIndex.value = 0;
  score.value = null;
  if (onEighths.value) presentLine();
}

function presentLine(profile = profileState.value) {
  hand.value = L2_1_HAND;
  noteIndex.value = 0;
  hint.value = "";
  score.value = generateL2({
    seed: profile.lastSeed,
    mode: "reading-lesson",
    shape: { kind: "eighths-single", hand: L2_1_HAND },
  });
}

function onNote(note: MidiNote) {
  if (!props.midiConnected || note.kind !== "on" || !onEighths.value) return;
  const expected = sounding.value[noteIndex.value];
  if (!expected) return;
  if (note.midi !== expected.midi) {
    hint.value = HINTS[expected.label] ?? `${expected.label} 在这五个白键里。`;
    return;
  }
  hint.value = "";
  if (noteIndex.value + 1 < sounding.value.length) {
    noteIndex.value += 1;
    return;
  }
  const finished = finishEighthLine(profileState.value);
  commit({ ...finished, lastSeed: finished.lastSeed + 1 });
  if (profileState.value.lessonId === "L2-1") presentLine();
}

function finishEighthLine(profile: Profile): Profile {
  if (profile.lessonId !== "L2-1") return profile;
  const linesCompleted = profile.linesCompleted + 1;
  if (linesCompleted < LINE_GOAL) return { ...profile, linesCompleted };
  return {
    ...profile,
    lessonId: "L2-2",
    lessonPhase: "notes",
    findCorrect: 0,
    linesCompleted: 0,
    tapStreak: 0,
  };
}

function commit(next: Profile) {
  if (sameProgress(profileState.value, next)) return;
  const lessonChanged = next.lessonId !== profileState.value.lessonId;
  if (lessonChanged && next.lessonId === "L2-2") showAdvance(ADVANCE_COPY);
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
    && current.linesCompleted === next.linesCompleted
    && current.lastSeed === next.lastSeed
    && current.findCorrect === next.findCorrect
    && current.tapStreak === next.tapStreak;
}

function drawStaff() {
  const el = staffEl.value;
  if (!el) return;
  const current = score.value;
  if (!current || !onEighths.value) {
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

function soundingNotes(current: Score, nextHand: Hand): { label: string; midi: number }[] {
  const notes: { label: string; midi: number }[] = [];
  for (const measure of current.staves[nextHand]?.measures ?? []) {
    for (const event of measure.notes) {
      const pitch = event.pitches[0];
      if (!pitch || event.duration.endsWith("r")) continue;
      notes.push({ label: pitchLabel(pitch), midi: pitchToMidi(pitch) });
    }
  }
  return notes;
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
    <p v-if="!midiConnected" class="warn">请连接 MIDI 键盘。卡片可以先看。</p>
    <p v-if="cardText" class="card">{{ cardText }}</p>
    <p v-if="lineLead" class="card">{{ lineLead }}</p>
    <p v-if="hint" class="hint">{{ hint }}</p>
    <div v-if="onEighths" ref="staffEl" class="staff"></div>
    <KeyboardDiagram :highlight-midi="highlightMidi" />
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
  border: 1px solid rgb(42 51 68 / 18%);
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
.hint {
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
.hint {
  color: var(--pb-muted);
}

.staff {
  overflow-x: auto;
  margin: 0 0 1rem;
}
</style>
