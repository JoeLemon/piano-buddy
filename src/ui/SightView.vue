<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { audioAvailable, previewScore, startMetronome } from "../audio/preview";
import { compare, type PlayedNote } from "../domain/compare";
import { generateL1 } from "../domain/generate";
import { generateL2 } from "../domain/generateL2";
import { pitchToMidi } from "../domain/pitch";
import {
  canEnterSight,
  canEnterSightLevel,
  pruneExhaustedErrorSnippet,
  registerSightUse,
  testBpmForLevel,
  type Profile,
} from "../domain/profile";
import { flattenScore } from "../domain/timeline";
import type { Hand, Score } from "../domain/types";
import { DURATION_BEATS } from "../domain/vocabulary";
import { subscribeMidi, type MidiNote } from "../midi/access";
import {
  grandProgressRatio,
  measureForSounding,
  measureForTimeline,
  paintGrandProgress,
  paintScoreProgress,
  scrollGrandToCursor,
  scrollScoreToCursor,
  scrollScoreToNote,
  scoreProgressRatio,
} from "../notation/scorePaint";
import { renderGrandScore, renderScore } from "../notation/renderScore";
import ScoreProgress from "./ScoreProgress.vue";

const PREPARE_SECONDS = 25;
const SIGHT_TIPS = ["弹错不要停，每条最多 2 遍。"];

const props = defineProps<{
  profile: Profile;
  midiConnected: boolean;
  forcedScore?: Score | null;
}>();

type SightTarget = { key: string; midi: number };

const emit = defineEmits<{
  "update-profile": [profile: Profile];
  finished: [payload: {
    score: Score;
    result: ReturnType<typeof compare>;
    hand: Hand | "BOTH";
    wrongPitchNoteIds: string[];
    lateNoteIds: string[];
  }];
}>();

const profileState = ref<Profile>({ ...props.profile });
const hand = ref<Hand>(canEnterSight(props.profile, "RH") ? "RH" : "LH");
const score = ref<Score | null>(null);
const phase = ref<"prepare" | "play" | "done">("prepare");
const secondsLeft = ref(PREPARE_SECONDS);
const preparing = ref(false);
const showFingers = ref(true);
/** L2 视奏是双手大谱表；其余都是单手。 */
const grand = computed(() => score.value?.hands.length === 2);
const level = computed<1 | 2>(() => (canEnterSightLevel(profileState.value, 2) ? 2 : 1));
const bpm = ref(testBpmForLevel(props.profile, canEnterSightLevel(props.profile, 2) ? 2 : 1));
const staffEl = ref<HTMLElement | null>(null);
const showTips = ref(!props.profile.seenSightTips);

const bothHands = canEnterSight(props.profile, "RH") && canEnterSight(props.profile, "LH");
const handChooser = computed(() => bothHands && !props.forcedScore && !grand.value);
const handLabel = computed(() => {
  if (grand.value) return "双手";
  return hand.value === "RH" ? "右手" : "左手";
});
const tempoLocked = () => phase.value !== "prepare";

let prepareTimer: ReturnType<typeof setInterval> | null = null;
let playTimer: ReturnType<typeof setTimeout> | null = null;
let preview: { stop: () => void } | null = null;
let metronome: { stop: () => void } | null = null;
let stopMidi: (() => void) | null = null;
let midiToken = 0;
let alive = true;
const playCursor = ref(0);
/** 「听一遍」跟随时的当前发声音序号；没有在预览时为 null。 */
const previewIndex = ref<number | null>(null);
/** 打开这条时还能练几遍（消耗式题库，最多 2 遍）。 */
const remainingPlays = ref(2);
let playStartedAt = 0;
let playBpm = bpm.value;
let played: PlayedNote[] = [];
const wrongIds = new Set<string>();
const correctIds = new Set<string>();
const noIds: ReadonlySet<string> = new Set<string>();

const paintIndex = computed(() =>
  previewIndex.value == null ? playCursor.value : previewIndex.value,
);

/** 待弹音序列。L2 双手按 flattenScore 顺序，键带手；L1 键就是音符 id。 */
const targets = computed<SightTarget[]>(() => (score.value ? targetsFor(score.value) : []));

const displayProgress = computed(() => {
  const current = score.value;
  if (!current) return 0;
  const count = previewIndex.value == null ? playCursor.value : previewIndex.value + 1;
  return grand.value
    ? grandProgressRatio(current, count)
    : scoreProgressRatio(current, hand.value, count);
});

const measureCount = computed(() => {
  const current = score.value;
  if (!current) return 0;
  return grand.value
    ? Math.max(current.staves.RH?.measures.length ?? 0, current.staves.LH?.measures.length ?? 0)
    : current.staves[hand.value]?.measures.length ?? 0;
});

const measureLabel = computed(() => {
  const current = score.value;
  if (!current) return "";
  const { current: index, total } = grand.value
    ? measureForTimeline(current, paintIndex.value)
    : measureForSounding(current, hand.value, paintIndex.value);
  return `第 ${index}/${total} 小节`;
});

const preparePercent = computed(() =>
  Math.round(((PREPARE_SECONDS - secondsLeft.value) / PREPARE_SECONDS) * 100),
);

watch([score, staffEl, hand, showFingers], drawStaff, { flush: "post" });
watch(() => props.midiConnected, syncPrepare);

onMounted(() => {
  openLine();
  syncPrepare();
  void syncMidi(props.midiConnected);
});

onBeforeUnmount(() => {
  alive = false;
  midiToken += 1;
  cleanupAudio();
  stopMidi?.();
  stopMidi = null;
});

function dismissTips() {
  showTips.value = false;
  if (profileState.value.seenSightTips) return;
  profileState.value = { ...profileState.value, seenSightTips: true };
  emit("update-profile", profileState.value);
}

function openLine() {
  if (props.forcedScore) {
    score.value = props.forcedScore;
    hand.value = props.forcedScore.hands[0] ?? hand.value;
    applyDefaultBpm(props.forcedScore);
    resetProgress();
    syncRemainingPlays();
    return;
  }
  let seed = profileState.value.lastSeed;
  let next = nextLine(seed);
  for (let guard = 0; (profileState.value.sightUses[next.id] ?? 0) >= 2 && guard < 30; guard += 1) {
    seed += 1;
    next = nextLine(seed);
  }
  score.value = next;
  applyDefaultBpm(next);
  resetProgress();
  syncRemainingPlays();
  if (seed !== profileState.value.lastSeed) {
    profileState.value = { ...profileState.value, lastSeed: seed };
    emit("update-profile", profileState.value);
  }
}

/** L2 通过后默认双手大谱表；否则还是单手 L1 视奏。 */
function nextLine(seed: number): Score {
  if (level.value === 2) {
    return generateL2({ seed, mode: "sight", shape: { kind: "sight" } });
  }
  return generateL1({ hand: hand.value, seed, mode: "sight" });
}

/** 换手位/换难度时回到该档默认速度；同一档内保留玩家自己调的速度。 */
function applyDefaultBpm(next: Score) {
  const nextLevel: 1 | 2 = next.level === 2 ? 2 : 1;
  if (score.value && score.value.level === next.level) return;
  bpm.value = testBpmForLevel(profileState.value, nextLevel);
}

/** 这条最多练 2 遍；打开时把「还能练几遍」记下来，供准备阶段显示。 */
function syncRemainingPlays() {
  const current = score.value;
  if (!current) {
    remainingPlays.value = 0;
    return;
  }
  remainingPlays.value = Math.max(0, 2 - (profileState.value.sightUses[current.id] ?? 0));
}

function resetProgress() {
  playCursor.value = 0;
  previewIndex.value = null;
  played = [];
  wrongIds.clear();
  correctIds.clear();
  const el = staffEl.value;
  if (el) {
    el.scrollLeft = 0;
    paintProgress();
  }
}

function syncPrepare() {
  if (phase.value !== "prepare") return;
  if (!props.midiConnected) {
    clearPrepare();
    secondsLeft.value = PREPARE_SECONDS;
    return;
  }
  startPrepare();
}

function startPrepare() {
  if (prepareTimer || phase.value !== "prepare" || !props.midiConnected || showTips.value) return;
  secondsLeft.value = PREPARE_SECONDS;
  preparing.value = true;
  prepareTimer = setInterval(() => {
    secondsLeft.value -= 1;
    if (secondsLeft.value > 0) return;
    clearPrepare();
    beginPlay();
  }, 1000);
}

function clearPrepare() {
  if (prepareTimer) clearInterval(prepareTimer);
  prepareTimer = null;
  preparing.value = false;
}

function beginPlay() {
  if (phase.value !== "prepare" || !score.value) return;
  clearPrepare();
  preview?.stop();
  preview = null;
  previewIndex.value = null;
  const registration = registerSightUse(profileState.value, score.value.id);
  if (!registration.allowed) {
    let next = { ...registration.profile, lastSeed: profileState.value.lastSeed + 1 };
    next = pruneExhaustedErrorSnippet(next, score.value.id);
    profileState.value = next;
    emit("update-profile", profileState.value);
    if (props.forcedScore) {
      phase.value = "done";
      return;
    }
    openLine();
    phase.value = "prepare";
    syncPrepare();
    return;
  }
  let next = registration.profile;
  next = pruneExhaustedErrorSnippet(next, score.value.id);
  profileState.value = next;
  emit("update-profile", profileState.value);
  phase.value = "play";
  resetProgress();
  playStartedAt = performance.now();
  playBpm = bpm.value;
  metronome?.stop();
  metronome = startMetronome(playBpm);
  playTimer = setTimeout(() => finishPlay(), lineMs(score.value, playBpm));
}

function finishPlay() {
  if (!alive || phase.value !== "play" || !score.value) return;
  phase.value = "done";
  if (playTimer) clearTimeout(playTimer);
  playTimer = null;
  metronome?.stop();
  metronome = null;
  targets.value.forEach((target, index) => {
    const hit = played[index];
    if (!hit || hit.midi !== target.midi) wrongIds.add(target.key);
  });
  paintProgress();
  const handValue: Hand | "BOTH" = grand.value ? "BOTH" : hand.value;
  const result = compare(score.value, handValue, played, playBpm);
  let next = pruneExhaustedErrorSnippet(profileState.value, score.value.id);
  if (next !== profileState.value) {
    profileState.value = next;
    emit("update-profile", next);
  }
  emit("finished", {
    score: score.value,
    result,
    hand: handValue,
    wrongPitchNoteIds: result.wrongPitchNoteIds,
    lateNoteIds: result.lateNoteIds,
  });
}

function onNote(note: MidiNote) {
  if (!props.midiConnected || note.kind !== "on" || phase.value !== "play" || !score.value) return;
  const target = targets.value[playCursor.value];
  if (!target) return;
  played.push({ midi: note.midi, timeMs: note.timeMs - playStartedAt });
  if (note.midi !== target.midi) wrongIds.add(target.key);
  else correctIds.add(target.key);
  playCursor.value += 1;
  paintProgress();
  scrollToCursor();
}

function paintProgress() {
  const el = staffEl.value;
  const current = score.value;
  if (!el || !current) return;
  const previewing = previewIndex.value != null;
  if (grand.value) {
    paintGrandProgress(el, current, {
      timelineCount: previewing ? previewIndex.value! + 1 : playCursor.value,
      correctKeys: previewing ? noIds : correctIds,
      wrongKeys: previewing ? noIds : wrongIds,
      activeKey: previewing ? targets.value[previewIndex.value!]?.key ?? null : null,
    });
    return;
  }
  const activeId = previewing ? targets.value[previewIndex.value!]?.key ?? null : null;
  paintScoreProgress(el, current, hand.value, {
    playedCount: previewing ? previewIndex.value! + 1 : playCursor.value,
    correctIds: previewing ? noIds : correctIds,
    wrongIds: previewing ? noIds : wrongIds,
    activeId,
  });
}

function scrollToCursor() {
  const el = staffEl.value;
  const current = score.value;
  if (!el || !current) return;
  if (grand.value) {
    scrollGrandToCursor(el, current, playCursor.value);
    return;
  }
  scrollScoreToCursor(el, current, hand.value, playCursor.value);
}

/** 「听一遍」：跟着播放把进度条和谱面游标一起往前走。 */
function listen() {
  if (phase.value !== "prepare" || !score.value) return;
  preview?.stop();
  preview = null;
  const current = score.value;
  const nextHand: Hand | "BOTH" = grand.value ? "BOTH" : hand.value;
  const playable = audioAvailable();
  previewIndex.value = playable ? 0 : null;
  paintProgress();
  preview = previewScore(current, nextHand, bpm.value, {
    onNote: (index) => {
      if (!alive || phase.value !== "prepare") return;
      previewIndex.value = index;
      paintProgress();
      const el = staffEl.value;
      if (!el) return;
      if (grand.value) scrollGrandToCursor(el, current, index);
      else scrollScoreToNote(el, current, nextHand as Hand, index);
    },
    onEnd: () => {
      if (!alive) return;
      previewIndex.value = null;
      paintProgress();
    },
  });
}

function onBpm(event: Event) {
  if (tempoLocked()) return;
  const next = Number((event.target as HTMLInputElement).value);
  if (!Number.isFinite(next)) return;
  bpm.value = Math.min(120, Math.max(40, Math.round(next)));
}

function chooseHand(next: Hand) {
  if (phase.value !== "prepare" || hand.value === next || props.forcedScore) return;
  if (!canEnterSight(profileState.value, next)) return;
  hand.value = next;
  preview?.stop();
  preview = null;
  clearPrepare();
  openLine();
  syncPrepare();
}

function drawStaff() {
  const el = staffEl.value;
  if (!el) return;
  const current = score.value;
  if (!current) {
    el.replaceChildren();
    return;
  }
  if (current.hands.length === 2) renderGrandScore(el, current, showFingers.value);
  else renderScore(el, current, hand.value, showFingers.value);
  paintProgress();
}

async function syncMidi(connected: boolean) {
  const token = ++midiToken;
  stopMidi?.();
  stopMidi = null;
  if (!connected) return;
  try {
    const stop = await subscribeMidi((note) => {
      if (!alive || token !== midiToken) return;
      onNote(note);
    });
    if (!alive || token !== midiToken) {
      stop();
      return;
    }
    stopMidi = stop;
  } catch {
    // warning via midiConnected
  }
}

watch(() => props.midiConnected, (connected) => {
  void syncMidi(connected);
});

watch(showTips, (open) => {
  if (!open) syncPrepare();
});

function cleanupAudio() {
  clearPrepare();
  if (playTimer) clearTimeout(playTimer);
  playTimer = null;
  preview?.stop();
  preview = null;
  metronome?.stop();
  metronome = null;
}

function targetsFor(current: Score): SightTarget[] {
  if (current.hands.length === 2) {
    return flattenScore(current).map((note) => ({ key: `${note.hand}:${note.id}`, midi: note.midi }));
  }
  return soundingEvents(current, hand.value);
}

function soundingEvents(current: Score, nextHand: Hand): SightTarget[] {
  const events: SightTarget[] = [];
  for (const measure of current.staves[nextHand]?.measures ?? []) {
    for (const note of measure.notes) {
      if (note.duration.endsWith("r") || note.pitches.length === 0) continue;
      const pitch = note.pitches[0];
      events.push({ key: note.id, midi: pitchToMidi(pitch) });
    }
  }
  return events;
}

function lineMs(current: Score, tempo: number): number {
  const hands: readonly Hand[] = current.hands.length === 2 ? ["RH", "LH"] : [hand.value];
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
  <div
    class="surface sight"
    :data-score-id="score?.id ?? ''"
    data-mode="sight"
    :data-preparing="preparing ? 'true' : 'false'"
  >
    <div v-if="showTips" class="tips" data-test="sight-tips">
      <p v-for="tip in SIGHT_TIPS" :key="tip">{{ tip }}</p>
      <button type="button" class="primary" data-test="dismiss-sight-tips" @click="dismissTips">
        知道了
      </button>
    </div>

    <p v-if="!midiConnected" class="warn" data-test="midi-wait">
      连接后才会开始准备。请连接 MIDI 键盘（右上角）。
    </p>

    <!-- 上：当前阶段。只放倒计时和剩余遍数，不再和一堆开关抢位置 -->
    <header class="sight-head">
      <div class="head-text">
        <p v-if="phase === 'prepare' && score" class="remaining" data-test="sight-remaining">
          这条还能练 {{ remainingPlays }} 遍
        </p>
        <p v-else class="remaining">{{ phase === "prepare" ? "" : "别停下，弹错也继续往下读。" }}</p>
      </div>
      <p
        v-if="phase === 'prepare' && midiConnected && !showTips"
        data-test="countdown"
        class="count"
      >
        {{ secondsLeft }}
      </p>
    </header>
    <div
      v-if="phase === 'prepare' && midiConnected && !showTips"
      class="prepare-bar"
      data-test="prepare-progress"
      role="progressbar"
      :aria-valuenow="preparePercent"
      aria-valuemin="0"
      aria-valuemax="100"
    >
      <div class="prepare-fill" :style="{ width: `${preparePercent}%` }"></div>
    </div>

    <p v-if="phase === 'prepare'" class="card">
      先不要动手。看看调号、拍号，左右手大概在哪一块，心里数一下节奏。
    </p>

    <!-- 中：谱面是主角，先给足宽度 -->
    <div ref="staffEl" class="staff"></div>
    <ScoreProgress
      v-if="score"
      :value="displayProgress"
      :label="measureLabel"
      :measures="measureCount"
    />

    <!-- 下：控制条。手 / 指法 / 速度 / 试听都收在这一行里 -->
    <div class="controls">
      <div class="control-row">
        <span class="control-label">手</span>
        <div v-if="handChooser" class="segments">
          <button
            type="button"
            data-test="hand-rh"
            :aria-pressed="hand === 'RH' ? 'true' : 'false'"
            @click="chooseHand('RH')"
          >
            右手
          </button>
          <button
            type="button"
            data-test="hand-lh"
            :aria-pressed="hand === 'LH' ? 'true' : 'false'"
            @click="chooseHand('LH')"
          >
            左手
          </button>
        </div>
        <p v-else class="hand" data-test="sight-hand">{{ handLabel }}</p>
      </div>

      <div class="control-row">
        <span class="control-label">指法</span>
        <div class="segments">
          <button
            type="button"
            data-test="show-fingers"
            :aria-pressed="showFingers ? 'true' : 'false'"
            @click="showFingers = true"
          >
            显示指法
          </button>
          <button
            type="button"
            data-test="hide-fingers"
            :aria-pressed="showFingers ? 'false' : 'true'"
            @click="showFingers = false"
          >
            隐藏指法（自测模式）
          </button>
        </div>
      </div>

      <label class="control-row tempo">
        <span class="control-label">速度</span>
        <input
          data-test="bpm"
          type="range"
          min="40"
          max="120"
          :value="bpm"
          :disabled="tempoLocked()"
          @input="onBpm"
        />
        <span class="tempo-value">{{ bpm }}</span>
      </label>

      <button v-if="phase === 'prepare'" type="button" class="primary preview" data-test="preview" @click="listen">
        听一遍
      </button>
    </div>

    <p class="remind">眼睛尽量保持看谱，不要盯着键盘</p>
  </div>
</template>

<style scoped>
.warn,
.remind,
.card,
.tips p {
  margin: 0 0 0.85rem;
  line-height: 1.5;
}

.warn {
  color: var(--pb-warn);
}

.remind {
  margin: 0.6rem 0 0;
  color: var(--pb-muted);
  font-size: 0.85rem;
}

.card,
.tips p {
  color: var(--pb-muted);
}

/* 阶段区：左边说明、右边倒计时，倒计时是准备阶段唯一的视觉焦点 */
.sight-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--pb-space-4);
}

.head-text .eyebrow {
  margin-bottom: 0.1rem;
}

.count {
  margin: 0;
  font-family: var(--pb-font-display);
  font-size: 2rem;
  font-variant-numeric: tabular-nums;
  line-height: 1;
}

.count.muted {
  color: var(--pb-muted);
}

.remaining {
  min-height: 1.2rem;
  margin: 0;
  color: var(--pb-muted);
  font-size: 0.85rem;
}

.prepare-bar {
  height: 0.3rem;
  margin: 0.65rem 0 0.85rem;
  border-radius: var(--pb-radius-pill);
  background: var(--pb-surface-2);
  overflow: hidden;
}

.prepare-fill {
  height: 100%;
  border-radius: var(--pb-radius-pill);
  background: var(--pb-accent-2);
  transition: width 1s linear;
}

.tips {
  margin: 0 0 var(--pb-space-4);
  padding: var(--pb-space-3) var(--pb-space-4);
  border: 1px solid var(--pb-border-soft);
  border-radius: var(--pb-radius);
  background: var(--pb-tip-bg);
}

.staff {
  overflow-x: auto;
  margin: var(--pb-space-2) 0 var(--pb-space-3);
  scrollbar-width: thin;
}

/* 控制条：一行放得下就不换行，窄屏自动折成两行 */
.controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--pb-space-2) var(--pb-space-4);
  margin: var(--pb-space-2) 0 0;
  padding: var(--pb-space-2) var(--pb-space-3);
  border: 1px solid var(--pb-border-soft);
  border-radius: var(--pb-radius);
  background: var(--pb-surface-2);
}

.control-row {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  margin: 0;
}

.control-label {
  color: var(--pb-muted);
  font-size: 0.76rem;
  letter-spacing: 0.04em;
}

.tempo input {
  width: clamp(5rem, 14vw, 9rem);
}

.tempo-value {
  min-width: 2ch;
  color: var(--pb-ink);
  font-size: 0.82rem;
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}

.hand {
  margin: 0;
  color: var(--pb-ink-2);
  font-size: 0.88rem;
  font-weight: 600;
}

.primary {
  padding: 0.5rem 1rem;
  border: 1px solid var(--pb-accent-2);
  border-radius: var(--pb-radius);
  background: var(--pb-accent-2);
  color: var(--pb-accent-text);
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
}

.preview {
  margin-left: auto;
}

</style>
