<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { previewScore, startMetronome } from "../audio/preview";
import { compare, type PlayedNote } from "../domain/compare";
import { generateL1 } from "../domain/generate";
import { pitchToMidi } from "../domain/pitch";
import { canEnterSight, registerSightUse, testBpm, type Profile } from "../domain/profile";
import type { Hand, Score } from "../domain/types";
import { DURATION_BEATS } from "../domain/vocabulary";
import { subscribeMidi, type MidiNote } from "../midi/access";
import { renderScore } from "../notation/renderScore";

const PREPARE_SECONDS = 25;

const props = defineProps<{
  profile: Profile;
  midiConnected: boolean;
}>();

const emit = defineEmits<{
  "update-profile": [profile: Profile];
  finished: [payload: { score: Score; result: ReturnType<typeof compare>; hand: Hand; wrongNoteIds: string[] }];
}>();

const profileState = ref<Profile>({ ...props.profile });
const hand = ref<Hand>(canEnterSight(props.profile, "RH") ? "RH" : "LH");
const score = ref<Score | null>(null);
const phase = ref<"prepare" | "play" | "done">("prepare");
const secondsLeft = ref(PREPARE_SECONDS);
const preparing = ref(false);
const showFingers = ref(true);
const bpm = ref(testBpm(props.profile));
const staffEl = ref<HTMLElement | null>(null);

const bothHands = canEnterSight(props.profile, "RH") && canEnterSight(props.profile, "LH");

let prepareTimer: ReturnType<typeof setInterval> | null = null;
let playTimer: ReturnType<typeof setTimeout> | null = null;
let preview: { stop: () => void } | null = null;
let metronome: { stop: () => void } | null = null;
let stopMidi: (() => void) | null = null;
let midiToken = 0;
let alive = true;
let cursor = 0;
let playStartedAt = 0;
let playBpm = bpm.value;
let played: PlayedNote[] = [];
const wrongIds = new Set<string>();

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

function openLine() {
  let seed = profileState.value.lastSeed;
  let next = generateL1({ hand: hand.value, seed, mode: "sight" });
  for (let guard = 0; (profileState.value.sightUses[next.id] ?? 0) >= 2 && guard < 30; guard += 1) {
    seed += 1;
    next = generateL1({ hand: hand.value, seed, mode: "sight" });
  }
  score.value = next;
  cursor = 0;
  played = [];
  wrongIds.clear();
  if (seed !== profileState.value.lastSeed) {
    profileState.value = { ...profileState.value, lastSeed: seed };
    emit("update-profile", profileState.value);
  }
}

function syncPrepare() {
  if (phase.value !== "prepare") return;
  if (!props.midiConnected) {
    clearPrepare();
    return;
  }
  startPrepare();
}

function startPrepare() {
  if (prepareTimer || phase.value !== "prepare" || !props.midiConnected) return;
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
  const registration = registerSightUse(profileState.value, score.value.id);
  if (!registration.allowed) {
    profileState.value = { ...registration.profile, lastSeed: profileState.value.lastSeed + 1 };
    emit("update-profile", profileState.value);
    openLine();
    phase.value = "prepare";
    syncPrepare();
    return;
  }
  profileState.value = registration.profile;
  emit("update-profile", profileState.value);
  phase.value = "play";
  cursor = 0;
  played = [];
  wrongIds.clear();
  playStartedAt = performance.now();
  playBpm = bpm.value;
  metronome?.stop();
  metronome = startMetronome(playBpm);
  playTimer = setTimeout(() => finishPlay(), lineMs(score.value, hand.value, playBpm));
}

function finishPlay() {
  if (!alive || phase.value !== "play" || !score.value) return;
  phase.value = "done";
  if (playTimer) clearTimeout(playTimer);
  playTimer = null;
  metronome?.stop();
  metronome = null;
  const events = soundingEvents(score.value, hand.value);
  events.forEach((event, index) => {
    const hit = played[index];
    if (!hit || hit.midi !== event.midi) wrongIds.add(event.id);
  });
  paintWrong();
  emit("finished", {
    score: score.value,
    result: compare(score.value, hand.value, played, playBpm),
    hand: hand.value,
    wrongNoteIds: [...wrongIds],
  });
}

function onNote(note: MidiNote) {
  if (!props.midiConnected || note.kind !== "on" || phase.value !== "play" || !score.value) return;
  const event = soundingEvents(score.value, hand.value)[cursor];
  if (!event) return;
  played.push({ midi: note.midi, timeMs: note.timeMs - playStartedAt });
  if (note.midi !== event.midi) wrongIds.add(event.id);
  cursor += 1;
  paintWrong();
}

function listen() {
  if (phase.value !== "prepare" || !score.value) return;
  preview?.stop();
  preview = previewScore(score.value, hand.value, bpm.value);
}

function onBpm(event: Event) {
  const next = Number((event.target as HTMLInputElement).value);
  if (!Number.isFinite(next)) return;
  bpm.value = Math.min(120, Math.max(40, Math.round(next)));
}

function chooseHand(next: Hand) {
  if (phase.value !== "prepare" || hand.value === next) return;
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
  renderScore(el, current, hand.value, showFingers.value);
  paintWrong();
}

function paintWrong() {
  const el = staffEl.value;
  const current = score.value;
  if (!el || !current) return;
  markWrongNotes(el, current, hand.value, wrongIds);
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
    // The warning stays up through midiConnected.
  }
}

watch(() => props.midiConnected, (connected) => {
  void syncMidi(connected);
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

function soundingEvents(current: Score, nextHand: Hand): { id: string; midi: number }[] {
  const events: { id: string; midi: number }[] = [];
  for (const measure of current.staves[nextHand]?.measures ?? []) {
    for (const note of measure.notes) {
      if (note.duration.endsWith("r") || note.pitches.length === 0) continue;
      const pitch = note.pitches[0];
      events.push({ id: note.id, midi: pitchToMidi(pitch) });
    }
  }
  return events;
}

function lineMs(current: Score, nextHand: Hand, tempo: number): number {
  const beats = (current.staves[nextHand]?.measures ?? []).reduce(
    (sum, measure) => sum + measure.notes.reduce((inner, note) => inner + DURATION_BEATS[note.duration], 0),
    0,
  );
  return Math.round(beats * (60000 / tempo));
}

function markWrongNotes(element: HTMLElement, current: Score, nextHand: Hand, ids: ReadonlySet<string>) {
  const groups = Array.from(element.querySelectorAll(".vf-stavenote"));
  const notes = (current.staves[nextHand]?.measures ?? []).flatMap((measure) => measure.notes);
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
  <section
    class="sight"
    :data-score-id="score?.id ?? ''"
    data-mode="sight"
    :data-preparing="preparing ? 'true' : 'false'"
  >
    <div class="panel">
      <h1>视奏</h1>
      <p v-if="!midiConnected" class="warn">请连接 MIDI 键盘</p>
      <p class="remind">眼睛尽量保持看谱，不要盯着键盘</p>
      <p v-if="phase === 'prepare'" class="card">先不要动手。看看调号、拍号，左右手大概在哪一块，心里数一下节奏。</p>
      <p v-if="phase === 'prepare'" data-test="countdown" class="count">{{ secondsLeft }}</p>
      <div v-if="bothHands" class="hands">
        <button type="button" data-test="hand-rh" :aria-pressed="hand === 'RH' ? 'true' : 'false'" @click="chooseHand('RH')">右手</button>
        <button type="button" data-test="hand-lh" :aria-pressed="hand === 'LH' ? 'true' : 'false'" @click="chooseHand('LH')">左手</button>
      </div>
      <p v-else class="hand">{{ hand === "RH" ? "右手" : "左手" }}</p>
      <div class="fingers">
        <button type="button" data-test="show-fingers" :aria-pressed="showFingers ? 'true' : 'false'" @click="showFingers = true">显示指法</button>
        <button type="button" data-test="hide-fingers" :aria-pressed="showFingers ? 'false' : 'true'" @click="showFingers = false">隐藏指法（自测模式）</button>
      </div>
      <label class="tempo">
        速度
        <input data-test="bpm" type="range" min="40" max="120" :value="bpm" @input="onBpm" />
        <span>{{ bpm }}</span>
      </label>
      <div ref="staffEl" class="staff"></div>
      <button v-if="phase === 'prepare'" type="button" data-test="preview" @click="listen">听一遍</button>
    </div>
  </section>
</template>

<style scoped>
.sight {
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
.remind,
.card,
.hand,
.tempo {
  margin: 0 0 1rem;
  line-height: 1.5;
}

.warn {
  color: #8a3d12;
}

.remind,
.card,
.hand {
  color: #3f3f3f;
}

.count {
  margin: 0 0 1rem;
  font-size: 1.5rem;
}

.hands,
.fingers,
.tempo {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
}

.tempo {
  color: #3f3f3f;
}

.tempo input {
  flex: 1;
  min-width: 8rem;
}

button {
  padding: 0.55rem 0.9rem;
  border: 1px solid #2a2a2a;
  border-radius: 4px;
  background: #fff;
  color: #1c1c1c;
  font: inherit;
  cursor: pointer;
}

button[aria-pressed="true"],
button[data-test="preview"] {
  background: #f3c84b;
}

.staff {
  overflow-x: auto;
  margin: 0 0 1rem;
}

.staff :deep([data-wrong] path) {
  fill: #8a3d12;
  stroke: #8a3d12;
}
</style>
