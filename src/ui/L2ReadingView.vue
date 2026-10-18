<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { generateL2, type L2Shape } from "../domain/generateL2";
import {
  FIND_GOAL,
  currentLessonIndex,
  lessonAdvanceCopy,
  lessonGoalText,
  lessonStepLabel,
  lessonSteps,
} from "../domain/lessonProgress";
import { parsePitchLabel, pitchLabel, pitchToMidi } from "../domain/pitch";
import { l2FindHand, recordL2FindKey, type Profile } from "../domain/profile";
import { flattenScore } from "../domain/timeline";
import type { Hand, PositionId, Score } from "../domain/types";
import { fingerFor, pitchesFor } from "../domain/vocabulary";
import { subscribeMidi, type MidiNote } from "../midi/access";
import {
  grandProgressRatio,
  paintGrandProgress,
  paintScoreProgress,
  scrollGrandToCursor,
  scrollScoreToCursor,
  scoreProgressRatio,
} from "../notation/scorePaint";
import { renderGrandScore, renderScore } from "../notation/renderScore";
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

const LINE_LEAD = "弹出谱上的音。这个音弹对才进入下一音。";
const LINE_GOAL = 2;
/** L2-1 is two right-hand lines, then L2-2. Left hand waits for a later lesson. */
const L2_1_HAND: Hand = "RH";

type PlayableId = "L2-1" | "L2-2" | "L2-3" | "L2-4" | "L2-5" | "L2-6";

const CARDS: Record<PlayableId, string> = {
  "L2-1": "一拍里有两个八分音，仍用这五个白键。",
  "L2-2": "右手一小节，左手一小节，不同时弹。",
  "L2-3": "两手节奏相同，或一只手拉长音、另一只手弹四分或八分。",
  "L2-4": "F 调有一个降号：谱上的 B 都弹黑键。这五个音是 F G A Bb C，先右手、再左手。",
  "L2-5": "G 调有一个升号：谱上的 F 都弹黑键。这段先在 G A B C D 这五个音上找。",
  "L2-6": "整段从 C 位挪到 D 位，一条里只挪一次，挪完不要来回找。",
};

const NEXT_LESSON: Record<PlayableId, NonNullable<Profile["lessonId"]>> = {
  "L2-1": "L2-2",
  "L2-2": "L2-3",
  "L2-3": "L2-4",
  "L2-4": "L2-5",
  "L2-5": "L2-6",
  "L2-6": "L2-test",
};

const FIND_LEAD = "弹出谱上的音。弹对就往下走，先右手、再左手。";

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

/** F 调 / G 调五指位的找键提示。 */
const KEY_HINTS: Record<"F" | "G", Record<string, string>> = {
  F: {
    F4: "F 在高音谱第一间，右手大拇指。",
    G4: "G 在高音谱第二线，右手二指。",
    A4: "A 在高音谱第二间，右手三指。",
    Bb4: "Bb 是高音谱第三线上的黑键，右手四指。",
    C5: "C5 在高音谱第三间，右手五指。",
    F3: "低音 F 在低音谱第四线，左手五指。",
    G3: "低音 G 在低音谱第四间，左手四指。",
    A3: "低音 A 在低音谱第五线，左手三指。",
    Bb3: "Bb 是低音谱第五线上方的黑键，左手二指。",
    C4: "中央 C 在低音谱上加一线，左手大拇指。",
  },
  G: {
    G4: "G 在高音谱第二线，右手大拇指。",
    A4: "A 在高音谱第二间，右手二指。",
    B4: "B 在高音谱第三线，右手三指。",
    C5: "C5 在高音谱第三间，右手四指。",
    D5: "D5 在高音谱第四线，右手五指。",
    G3: "低音 G 在低音谱第四间，左手五指。",
    A3: "低音 A 在低音谱第五线，左手四指。",
    B3: "低音 B 在低音谱第五线上方，左手三指。",
    C4: "中央 C 在低音谱上加一线，左手二指。",
    D4: "D4 比中央 C 高一个白键，左手大拇指。",
  },
};

const profileState = ref<Profile>(props.profile);
const staffEl = ref<HTMLElement | null>(null);
const score = ref<Score | null>(null);
const hand = ref<Hand>(L2_1_HAND);
const hint = ref("");
const noteIndex = ref(0);
const advanceBanner = ref("");
const correctKeys = new Set<string>();
const wrongKeys = new Set<string>();

let midiToken = 0;
let stopMidi: (() => void) | null = null;
let bannerTimer: ReturnType<typeof setTimeout> | null = null;

const steps = lessonSteps(2);
const activeStep = computed(() => currentLessonIndex(profileState.value));
const goalText = computed(() => lessonGoalText(profileState.value));
const playable = computed(() => isPlayable(profileState.value.lessonId));
const grand = computed(() => usesGrand(profileState.value.lessonId));
const cardText = computed(() => (playable.value ? CARDS[profileState.value.lessonId as PlayableId] : ""));
const findLesson = computed(() => isFindLessonId(profileState.value.lessonId));
const lineLead = computed(() => {
  if (!playable.value) return "";
  return findLesson.value ? FIND_LEAD : LINE_LEAD;
});
const sounding = computed(() => currentTargets());
const currentNote = computed(() => sounding.value[noteIndex.value] ?? null);
const highlightMidi = computed(() => currentNote.value?.midi ?? null);
const activeHand = computed<Hand | null>(() => currentNote.value?.hand ?? null);
const activeFinger = computed<number | null>(() => currentNote.value?.finger ?? null);
/** 琴键图上的手位：让手搭在这条短句真正在用的五个键上（F/G 位、平移后换位）。 */
const diagramPosition = computed<PositionId>(() => {
  const current = score.value;
  const note = currentNote.value;
  if (!current || !note) return "C";
  return positionForHand(current, note.hand, note.key);
});
const progress = computed(() => {
  const current = score.value;
  if (!current || !playable.value) return 0;
  return grand.value
    ? grandProgressRatio(current, noteIndex.value)
    : scoreProgressRatio(current, hand.value, noteIndex.value);
});
watch(progress, applyPaint, { flush: "post" });

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
  correctKeys.clear();
  wrongKeys.clear();
  if (isPlayable(profileState.value.lessonId)) presentLine();
}

function presentLine(profile = profileState.value) {
  const lessonId = profile.lessonId;
  if (!isPlayable(lessonId)) return;
  correctKeys.clear();
  wrongKeys.clear();
  noteIndex.value = 0;
  hint.value = "";
  hand.value = handFor(lessonId, profile);
  score.value = generateL2({
    seed: profile.lastSeed,
    mode: "reading-lesson",
    shape: shapeFor(lessonId, profile),
  });
}

function onNote(note: MidiNote) {
  if (!props.midiConnected || note.kind !== "on" || !isPlayable(profileState.value.lessonId)) return;
  const expected = sounding.value[noteIndex.value];
  if (!expected) return;
  if (note.midi !== expected.midi) {
    hint.value = hintFor(expected.label, profileState.value.lessonId, expected.hand);
    wrongKeys.add(expected.key);
    applyPaint();
    return;
  }
  hint.value = "";
  wrongKeys.delete(expected.key);
  correctKeys.add(expected.key);
  if (findLesson.value) {
    onFindNote();
    return;
  }
  if (noteIndex.value + 1 < sounding.value.length) {
    noteIndex.value += 1;
    return;
  }
  const before = profileState.value.lessonId;
  const finished = finishLine(profileState.value);
  commit({ ...finished, lastSeed: finished.lastSeed + 1 });
  if (profileState.value.lessonId === before) presentLine();
}

/** 找键课：每弹对一个记一次，一手满 8 个换另一只手，两只手都满就进下一课。 */
function onFindNote() {
  const before = profileState.value;
  const next = recordL2FindKey(before, true);
  const handChanged = l2FindHand(next) !== hand.value;
  const lessonChanged = next.lessonId !== before.lessonId;
  const progressed = handChanged || lessonChanged ? { ...next, lastSeed: next.lastSeed + 1 } : next;
  commit(progressed);
  if (lessonChanged) return; // commit 里已经换了新一课，并重新出谱
  if (handChanged) {
    showAdvance(`右手认够了。换左手再来 ${FIND_GOAL} 个。`);
    hand.value = l2FindHand(progressed);
    presentLine(progressed);
    return;
  }
  if (noteIndex.value + 1 < sounding.value.length) {
    noteIndex.value += 1;
    return;
  }
  presentLine(progressed);
}

function hintFor(label: string, lessonId: PlayableId, nextHand: Hand): string {
  if (lessonId === "L2-4" || lessonId === "L2-5") {
    const position = lessonId === "L2-4" ? "F" : "G";
    const special = KEY_HINTS[position][label];
    if (special) return special;
    const finger = fingerFor(position, nextHand, parsePitchLabel(label));
    return `${label} 还是这五个音里的一个，用${nextHand === "RH" ? "右手" : "左手"}第 ${finger} 指。`;
  }
  return HINTS[label] ?? `${label} 在这五个白键里。`;
}

function finishLine(profile: Profile): Profile {
  if (!isPlayable(profile.lessonId)) return profile;
  const linesCompleted = profile.linesCompleted + 1;
  if (linesCompleted < LINE_GOAL) return { ...profile, linesCompleted };
  return {
    ...profile,
    lessonId: NEXT_LESSON[profile.lessonId],
    lessonPhase: "notes",
    findCorrect: 0,
    linesCompleted: 0,
    tapStreak: 0,
  };
}

function commit(next: Profile) {
  if (sameProgress(profileState.value, next)) return;
  const lessonChanged = next.lessonId !== profileState.value.lessonId;
  const advanceCopy = lessonAdvanceCopy(profileState.value.lessonId, next.lessonId);
  if (lessonChanged && advanceCopy) showAdvance(advanceCopy);
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
  const lessonId = profileState.value.lessonId;
  if (!current || !isPlayable(lessonId)) {
    el.replaceChildren();
    return;
  }
  if (usesGrand(lessonId)) {
    renderGrandScore(el, current, true);
    applyPaint();
    return;
  }
  renderScore(el, current, hand.value, true);
  applyPaint();
}

/** 给谱面上色（弹过/弹对/弹错），并把滚动推进到当前待弹音。 */
function applyPaint() {
  const el = staffEl.value;
  const current = score.value;
  if (!el || !current || !playable.value) return;
  if (grand.value) {
    paintGrandProgress(el, current, {
      timelineCount: noteIndex.value,
      correctKeys,
      wrongKeys,
    });
    scrollGrandToCursor(el, current, noteIndex.value);
    return;
  }
  paintScoreProgress(el, current, hand.value, {
    playedCount: noteIndex.value,
    correctIds: correctKeys,
    wrongIds: wrongKeys,
  });
  scrollScoreToCursor(el, current, hand.value, noteIndex.value);
}

function isPlayable(lessonId: Profile["lessonId"]): lessonId is PlayableId {
  return (
    lessonId === "L2-1"
    || lessonId === "L2-2"
    || lessonId === "L2-3"
    || lessonId === "L2-4"
    || lessonId === "L2-5"
    || lessonId === "L2-6"
  );
}

function isFindLessonId(lessonId: Profile["lessonId"]): boolean {
  return lessonId === "L2-4" || lessonId === "L2-5";
}

/** L2-4 / L2-5 的谱是一只手一行，看手位决定画哪个谱表。 */
function usesGrand(lessonId: Profile["lessonId"]): boolean {
  return lessonId === "L2-2" || lessonId === "L2-3";
}

/** Even seeds share a rhythm. Odd seeds hold one hand. */
function togetherTexture(seed: number): "same" | "hold" {
  return seed % 2 === 0 ? "same" : "hold";
}

/** L2-6 一条换一只手，练两只手都挪。 */
function shiftHand(seed: number): Hand {
  return seed % 2 === 0 ? "RH" : "LH";
}

function shapeFor(lessonId: PlayableId, profile: Profile): L2Shape {
  if (lessonId === "L2-1") return { kind: "eighths-single", hand: L2_1_HAND };
  if (lessonId === "L2-2") return { kind: "alternate" };
  if (lessonId === "L2-3") return { kind: "together", texture: togetherTexture(profile.lastSeed) };
  if (lessonId === "L2-4") return { kind: "key-find", key: "F", hand: l2FindHand(profile) };
  if (lessonId === "L2-5") return { kind: "key-find", key: "G", hand: l2FindHand(profile) };
  return { kind: "shift-once", hand: shiftHand(profile.lastSeed) };
}

function handFor(lessonId: PlayableId, profile: Profile): Hand {
  if (lessonId === "L2-1") return L2_1_HAND;
  if (lessonId === "L2-4" || lessonId === "L2-5") return l2FindHand(profile);
  if (lessonId === "L2-6") return shiftHand(profile.lastSeed);
  return hand.value;
}

function currentTargets(): { key: string; label: string; midi: number; hand: Hand; finger: number | null }[] {
  const current = score.value;
  if (!current) return [];
  if (usesGrand(profileState.value.lessonId)) {
    return flattenScore(current).map((note) => ({
      key: `${note.hand}:${note.id}`,
      label: note.label,
      midi: note.midi,
      hand: note.hand,
      finger: note.finger,
    }));
  }
  return soundingNotes(current, hand.value);
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

function soundingNotes(current: Score, nextHand: Hand): { key: string; label: string; midi: number; hand: Hand; finger: number | null }[] {
  const notes: { key: string; label: string; midi: number; hand: Hand; finger: number | null }[] = [];
  for (const measure of current.staves[nextHand]?.measures ?? []) {
    for (const event of measure.notes) {
      const pitch = event.pitches[0];
      if (!pitch || event.duration.endsWith("r")) continue;
      notes.push({ key: event.id, label: pitchLabel(pitch), midi: pitchToMidi(pitch), hand: nextHand, finger: event.fingers?.[0] ?? null });
    }
  }
  return notes;
}

/** 琴键图上先试的手位顺序：C 位优先，再看平移后的 D 位与 F/G 位。 */
const DIAGRAM_POSITIONS: readonly PositionId[] = ["C", "D-shift", "F", "G"];

/**
 * 当前音该用哪个手位：既要包住这个音，还要和谱上印的指法对得上；
 * 同样合法的位里选能覆盖更多后续音的，这样一条短句挪位后图也跟着挪。
 */
function positionForHand(current: Score, nextHand: Hand, fromKey: string): PositionId {
  const notes = flattenScore(current).filter((entry) => entry.hand === nextHand);
  const index = notes.findIndex((entry) => entry.id === fromKey || `${entry.hand}:${entry.id}` === fromKey);
  const rest = index < 0 ? notes : notes.slice(index);
  const first = rest[0];
  if (!first) return "C";
  const pitch = parsePitchLabel(first.label);
  let best: { position: PositionId; weight: number } | null = null;
  for (const position of DIAGRAM_POSITIONS) {
    const set = new Set(pitchesFor(position, nextHand).map(pitchToMidi));
    if (!set.has(first.midi)) continue;
    let fingerMatch = 0;
    try {
      fingerMatch = fingerFor(position, nextHand, pitch) === first.finger ? 1 : 0;
    } catch {
      continue;
    }
    const coverage = rest.reduce((count, entry) => (set.has(entry.midi) ? count + 1 : count), 0);
    const weight = fingerMatch * 1000 + coverage;
    if (!best || weight > best.weight) best = { position, weight };
  }
  return best?.position ?? "C";
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
    <div v-if="!midiConnected" class="connect-prompt">
      <p class="warn">请连接 MIDI 键盘。卡片可以先看。</p>
      <button type="button" class="connect" data-test="connect-midi" @click="emit('connect-midi')">
        连接 MIDI 键盘
      </button>
    </div>
    <p v-if="cardText" class="card">{{ cardText }}</p>
    <p v-if="lineLead" class="card">{{ lineLead }}</p>
    <p v-if="hint" class="hint">{{ hint }}</p>
    <div v-if="playable" ref="staffEl" class="staff"></div>
    <ScoreProgress v-if="playable" :value="progress" />
    <KeyboardDiagram
      :highlight-midi="highlightMidi"
      :active-hand="activeHand"
      :active-finger="activeFinger"
      :highlight-seq="noteIndex"
      :position="diagramPosition"
    />
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
