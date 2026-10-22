<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { generateL3, type L3Shape } from "../domain/generateL3";
import {
  currentLessonIndex,
  lessonAdvanceCopy,
  lessonGoalText,
  lessonStepLabel,
  lessonSteps,
} from "../domain/lessonProgress";
import { recordL3Line, type Profile } from "../domain/profile";
import { scoreEvents } from "../domain/scoreEvents";
import type { Hand, Score } from "../domain/types";
import { subscribeMidi, type MidiNote } from "../midi/access";
import {
  paintScoreProgress,
  scrollScoreToCursor,
  scoreProgressRatio,
} from "../notation/scorePaint";
import { renderScore } from "../notation/renderScore";
import KeyboardDiagram from "./KeyboardDiagram.vue";
import ScoreProgress from "./ScoreProgress.vue";

/**
 * L3 识谱课：第一次出现「同时按多个键」。
 *
 * 与 L2 相同的「弹对才往下走」流程，但一个事件可能有两三个音：要按齐这一组
 * 才算过。L3 过关（双手带和弦）由 App 的过关流程接管，本视图只做 4 节单手课。
 */
const props = defineProps<{
  profile: Profile;
  midiConnected: boolean;
}>();

const emit = defineEmits<{
  "update-profile": [profile: Profile];
}>();

const LINE_LEAD = "按谱面同时按下这一组音；按齐了才进入下一组。";

type PlayableId = "L3R-1" | "L3R-2" | "L3R-3" | "L3R-4";

const CARDS: Record<PlayableId, string> = {
  "L3R-1": "两个音一起按。先看清两个符头分别在什么线/间上。",
  "L3R-2": "右手三和弦：根音、三音、五音同时按下，用 1、3、5 指。",
  "L3R-3": "左手三和弦：同样三个音，换成左手的 5、3、1 指。",
  "L3R-4": "临时升降只在本小节内生效；升号、降号和还原号都要看清。",
};

const profileState = ref<Profile>(props.profile);
const staffEl = ref<HTMLElement | null>(null);
const score = ref<Score | null>(null);
const hand = ref<Hand>("RH");
const hint = ref("");
const noteIndex = ref(0);
const advanceBanner = ref("");
/** 当前和弦已经按下的音，按满这一组再判定。 */
const chordBuffer = ref<Set<number>>(new Set());
const correctKeys = new Set<string>();
const wrongKeys = new Set<string>();

let midiToken = 0;
let stopMidi: (() => void) | null = null;
let bannerTimer: ReturnType<typeof setTimeout> | null = null;

const steps = lessonSteps(3);
const activeStep = computed(() => currentLessonIndex(profileState.value));
const goalText = computed(() => lessonGoalText(profileState.value));
const playable = computed(() => isPlayable(profileState.value.lessonId));
const cardText = computed(() => (playable.value ? CARDS[profileState.value.lessonId as PlayableId] : ""));
const targets = computed(() => currentTargets());
const currentTarget = computed(() => targets.value[noteIndex.value] ?? null);
const highlightMidi = computed(() => currentTarget.value?.midis[0] ?? null);
const progress = computed(() => {
  const current = score.value;
  if (!current || !playable.value) return 0;
  return scoreProgressRatio(current, hand.value, noteIndex.value);
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
  chordBuffer.value = new Set();
  correctKeys.clear();
  wrongKeys.clear();
  if (isPlayable(profileState.value.lessonId)) presentLine();
}

function presentLine(profile = profileState.value) {
  const lessonId = profile.lessonId;
  if (!isPlayable(lessonId)) return;
  correctKeys.clear();
  wrongKeys.clear();
  chordBuffer.value = new Set();
  noteIndex.value = 0;
  hint.value = "";
  const shape = shapeFor(lessonId, profile);
  hand.value = shape.kind === "triad" ? shape.hand : handFor(lessonId, profile);
  score.value = generateL3({
    seed: profile.lastSeed,
    mode: "reading-lesson",
    shape,
  });
}

function onNote(note: MidiNote) {
  const local = note.source === "screen";
  if ((!props.midiConnected && !local) || note.kind !== "on" || !isPlayable(profileState.value.lessonId)) return;
  const expected = currentTarget.value;
  if (!expected) return;
  if (!expected.midis.includes(note.midi)) {
    hint.value = `这一组要按 ${expected.labels.join(" + ")}。再看一眼每个符头的位置。`;
    wrongKeys.add(expected.key);
    applyPaint();
    return;
  }
  hint.value = "";
  wrongKeys.delete(expected.key);
  chordBuffer.value.add(note.midi);
  if (chordBuffer.value.size < expected.midis.length) {
    applyPaint();
    return;
  }
  correctKeys.add(expected.key);
  chordBuffer.value = new Set();
  if (noteIndex.value + 1 < targets.value.length) {
    noteIndex.value += 1;
    applyPaint();
    return;
  }
  // 已过关后回看：只练不推进，避免又把人送回 L3 过关测试。
  if (profileState.value.l3Passed) {
    presentLine();
    return;
  }
  const before = profileState.value.lessonId;
  const finished = recordL3Line(profileState.value);
  commit({ ...finished, lastSeed: finished.lastSeed + 1 });
  if (profileState.value.lessonId === before) presentLine();
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
    && current.linesCompleted === next.linesCompleted
    && current.lastSeed === next.lastSeed;
}

function drawStaff() {
  const el = staffEl.value;
  const current = score.value;
  const lessonId = profileState.value.lessonId;
  if (!el) return;
  if (!current || !isPlayable(lessonId)) {
    el.replaceChildren();
    return;
  }
  renderScore(el, current, hand.value, true);
  applyPaint();
}

function applyPaint() {
  const el = staffEl.value;
  const current = score.value;
  if (!el || !current || !playable.value) return;
  const active = currentTarget.value;
  paintScoreProgress(el, current, hand.value, {
    playedCount: noteIndex.value,
    correctIds: correctKeys,
    wrongIds: wrongKeys,
    activeId: active?.key ?? null,
  });
  scrollScoreToCursor(el, current, hand.value, noteIndex.value);
}

function isPlayable(lessonId: Profile["lessonId"]): lessonId is PlayableId {
  return lessonId === "L3R-1"
    || lessonId === "L3R-2"
    || lessonId === "L3R-3"
    || lessonId === "L3R-4";
}

/** 双音与临时升降一条换一只手，三和弦课固定手别。 */
function handFor(lessonId: PlayableId, profile: Profile): Hand {
  if (lessonId === "L3R-2") return "RH";
  if (lessonId === "L3R-3") return "LH";
  return profile.lastSeed % 2 === 0 ? "RH" : "LH";
}

function shapeFor(lessonId: PlayableId, profile: Profile): L3Shape {
  if (lessonId === "L3R-1") return { kind: "interval", hand: handFor(lessonId, profile) };
  if (lessonId === "L3R-2") return { kind: "triad", hand: "RH" };
  if (lessonId === "L3R-3") return { kind: "triad", hand: "LH" };
  return { kind: "accidental", hand: handFor(lessonId, profile) };
}

function currentTargets(): {
  key: string;
  labels: string[];
  midis: number[];
  hand: Hand;
  fingers: (number | null)[];
}[] {
  const current = score.value;
  if (!current) return [];
  return scoreEvents(current, hand.value).map((event) => ({
    key: event.id,
    labels: event.labels,
    midis: event.midis,
    hand: event.hand,
    fingers: event.fingers,
  }));
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
    // Web MIDI missing or denied; screen keyboard still works.
  }
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
    <p v-if="!midiConnected" class="warn">请连接 MIDI 键盘（右上角）。卡片可以先看。</p>
    <p v-if="profileState.l3Passed" class="card" data-test="l3-review">
      已过关，当前是回看模式：只练不推进，不会重新触发过关测试。
    </p>
    <p v-if="cardText" class="card">{{ cardText }}</p>
    <p v-if="playable" class="card">{{ LINE_LEAD }}</p>
    <p v-if="hint" class="hint">{{ hint }}</p>
    <div v-if="playable" ref="staffEl" class="staff"></div>
    <ScoreProgress v-if="playable" :value="progress" />
    <div class="keyboard-panel">
      <KeyboardDiagram :highlight-midi="highlightMidi" @note="onNote" />
    </div>
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
  border-radius: var(--pb-radius-pill);
  color: var(--pb-muted);
  font-size: 0.85rem;
}

.progress li[data-active="true"] {
  background: var(--pb-accent-2);
  border-color: var(--pb-accent-2);
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
  background: var(--pb-accent-2-soft);
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

.keyboard-panel {
  width: 100%;
  box-sizing: border-box;
  margin: var(--pb-space-3) 0 0;
  padding: var(--pb-space-2) var(--pb-space-3);
  border: 1px solid var(--pb-key-gap);
  border-radius: var(--pb-radius);
  background: var(--pb-bg-deep);
}
</style>
