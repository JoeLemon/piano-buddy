<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { startMetronome, type Playback } from "../audio/preview";
import { subscribeMidi } from "../midi/access";
import type { MidiNote, NotePulse } from "../midi/types";
import { matchMelodyNote } from "../practice/melodyMatch";
import type { PlaybackQuestion } from "../practice/melodyTypes";
import {
  beatAt,
  countInFor,
  gradeRhythm,
  planForMelody,
  rhythmMarks,
  rhythmSummary,
  type RhythmHit,
} from "../practice/rhythm";
import RhythmGrid from "./RhythmGrid.vue";

/**
 * 旋律跟弹：听一小节预备拍，然后按拍把旋律弹出来。
 *
 * 判两件事，而且分开说：音高对不对（`matchMelodyNote`，八度严格——谱面上
 * 写了哪个八度就该弹哪个），以及每个音落没落在拍上。弹错音不推进进度——
 * 跟弹的语义是顺着弹，混过去只会让后面一路错位。
 *
 * 输入有两个来源：自己订阅 MIDI（硬件与电脑键盘，任何页面都通），以及父级
 * 用 `pulse` 推上来的屏幕琴键按键。两者可能收到同一个事件对象，所以按引用
 * 去重——否则屏幕琴键一下会被判两次。
 */
const props = withDefaults(
  defineProps<{
    melody: PlaybackQuestion;
    /** 测试钩子前缀：practice / l3。 */
    prefix: string;
    /** 父级推送的一次按键。 */
    pulse?: NotePulse | null;
  }>(),
  { pulse: null },
);

/** 跑到最后一个音之后再多等两拍；再没动静就按漏音收尾。 */
const TAIL_BEATS = 2;

const plan = computed(() => planForMelody(props.melody));
const countIn = computed(() => countInFor(plan.value));
const total = computed(() => props.melody.melody.length);

const running = ref(false);
const started = ref(false);
const beat = ref(0);
const matched = ref(0);
const wrongAt = ref<number | null>(null);
const hits = ref<RhythmHit[]>([]);

let startedAt = 0;
let frame = 0;
let metronome: Playback | null = null;
let detach: (() => void) | null = null;
let disposed = false;

const finished = computed(() => matched.value >= total.value);
const countingIn = computed(() => running.value && beat.value < 0);
const countdown = computed(() => Math.max(1, Math.ceil(-beat.value)));

/** 实时结果：弹一个音就更一次，网格上当场看得见偏了多少。 */
const result = computed(() =>
  hits.value.length ? gradeRhythm(plan.value, hits.value, startedAt, countIn.value) : null,
);
const marks = computed(() => (result.value ? rhythmMarks(result.value) : []));

const status = computed(() => {
  if (!started.value) return `共 ${total.value} 个音 · ${plan.value.bpm} bpm`;
  if (countingIn.value) return `预备 ${countdown.value} 拍`;
  if (running.value) return `已跟对 ${matched.value} / ${total.value} 音`;
  return finished.value ? "跟完了" : "已停止";
});

const summary = computed(() => (result.value ? rhythmSummary(result.value) : ""));

/** rAF 在无头/测试环境里不一定存在，退到定时器，保证时钟照走。 */
function raf(callback: () => void): number {
  return typeof requestAnimationFrame === "function"
    ? requestAnimationFrame(() => callback())
    : (setTimeout(callback, 16) as unknown as number);
}

function cancel(id: number): void {
  if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(id);
  else clearTimeout(id);
}

async function start() {
  if (running.value) return;
  stopClock();

  hits.value = [];
  matched.value = 0;
  wrongAt.value = null;
  started.value = true;
  running.value = true;
  startedAt = performance.now();
  beat.value = -countIn.value;

  metronome = startMetronome(plan.value.bpm);
  frame = raf(tick);

  const stopListening = await subscribeMidi(onNote);
  if (disposed || !running.value) {
    stopListening();
    return;
  }
  detach = stopListening;
}

function tick() {
  if (!running.value) return;
  beat.value = beatAt(plan.value, startedAt, performance.now(), countIn.value);
  if (beat.value > plan.value.totalBeats + TAIL_BEATS) {
    stopClock();
    return;
  }
  frame = raf(tick);
}

function stopClock() {
  running.value = false;
  if (frame) {
    cancel(frame);
    frame = 0;
  }
  metronome?.stop();
  metronome = null;
  detach?.();
  detach = null;
}

/** 同一个事件可能既从订阅来、又从 pulse 来；按引用只处理一次。 */
const seen = new WeakSet<MidiNote>();

function onNote(note: MidiNote) {
  if (!running.value) return;
  if (seen.has(note)) return;
  seen.add(note);

  // 抬手只补时值，不影响进度。
  if (note.kind === "off") {
    recordRelease(note.midi, note.timeMs);
    return;
  }

  // 拍点按事件自己的时间戳算，不依赖渲染帧：帧率抖动不该变成判定误差。
  const at = beatAt(plan.value, startedAt, note.timeMs, countIn.value);
  if (at < 0) return;
  beat.value = at;

  const outcome = matchMelodyNote(props.melody, matched.value, note.midi);
  if (!outcome.correct) {
    wrongAt.value = matched.value;
    return;
  }

  wrongAt.value = null;
  hits.value = [...hits.value, { midi: note.midi, atMs: note.timeMs, slotIndex: matched.value }];
  matched.value = outcome.nextIndex;
  if (outcome.complete) stopClock();
}

/** 配到最近一次按下这个音且还没松的那一击上；旋律有重复音，从后往前才配得对。 */
function recordRelease(midi: number, offMs: number) {
  for (let index = hits.value.length - 1; index >= 0; index -= 1) {
    const hit = hits.value[index];
    if (hit.midi === midi && hit.offMs == null) {
      const next = [...hits.value];
      next[index] = { ...hit, offMs };
      hits.value = next;
      return;
    }
  }
}

watch(
  () => props.pulse,
  (pulse) => {
    if (pulse) onNote(pulse.note);
  },
);

onBeforeUnmount(() => {
  disposed = true;
  stopClock();
});
</script>

<template>
  <div class="follow" data-test="melody-follow">
    <div class="bar">
      <button type="button" :data-test="`${prefix}-follow`" :disabled="running" @click="start">
        {{ started && !running ? "再跟一次" : "跟弹" }}
      </button>
      <button
        v-if="running"
        type="button"
        :data-test="`${prefix}-follow-stop`"
        @click="stopClock"
      >
        停止
      </button>
      <span class="status" :data-test="`${prefix}-follow-status`">{{ status }}</span>
      <span v-if="wrongAt !== null && running && !countingIn" class="wrong">
        这个音不对，再找找
      </span>
    </div>

    <RhythmGrid
      v-if="started"
      :plan="plan"
      :beat="running ? beat : plan.totalBeats"
      :marks="marks"
      :finished="!running"
      :prefix="prefix"
    />

    <p v-if="started && !running" class="summary" :data-test="`${prefix}-follow-summary`">
      {{ summary }}
    </p>
    <p v-else-if="!started" class="hint">
      先听一小节预备拍，再看着谱面跟着网格把旋律弹出来。音高和八度都要对。
    </p>
  </div>
</template>

<style scoped>
.follow {
  margin: 0 0 var(--pb-space-3);
}

.bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--pb-space-2);
  margin: 0 0 var(--pb-space-2);
  font-size: 0.85rem;
}

button {
  padding: 0.45rem 0.8rem;
  border: 1px solid var(--pb-border);
  border-radius: var(--pb-radius);
  background: var(--pb-surface);
  color: var(--pb-ink);
  cursor: pointer;
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.status {
  color: var(--pb-muted);
  font-variant-numeric: tabular-nums;
}

.wrong {
  color: var(--pb-danger);
}

.summary {
  margin: 0;
  padding: 0.5rem 0.7rem;
  border-left: 3px solid var(--pb-ok);
  background: var(--pb-tip-bg);
  color: var(--pb-ink);
  font-size: 0.85rem;
  line-height: 1.5;
}

.hint {
  margin: 0;
  color: var(--pb-muted);
  font-size: 0.8rem;
  line-height: 1.5;
}
</style>
