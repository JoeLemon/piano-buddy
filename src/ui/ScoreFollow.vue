<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { startMetronome, type Playback } from "../audio/preview";
import type { Hand, Score } from "../domain/types";
import { followMidi, subscribeMidi } from "../midi/access";
import type { MidiNote, NotePulse } from "../midi/types";
import {
  barOfBeat,
  beatAt,
  countInFor,
  gradeRhythm,
  offsetText,
  planForScore,
  rhythmMarks,
  rhythmSummary,
  type RhythmHit,
} from "../practice/rhythm";
import KeyboardDiagram from "./KeyboardDiagram.vue";
import RhythmGrid from "./RhythmGrid.vue";

/**
 * 曲库跟弹：把一段真实的乐谱放到节拍网格上，弹一个音判一个音。
 *
 * 和视奏的区别是口径：视奏要求「弹错也不要停」，弹完再来一次复盘；跟弹
 * 是练这一段，所以弹错就停在原地等你补齐——但整拍漏过去不算死锁，
 * 到了下一拍的起点会自动往前走，否则一漏音就整段的节奏全废。
 *
 * 判三件事，分开说：
 * - 音高：这一拍要按的音都按齐了没有（和弦、双手同拍都算一个位置）；
 * - 拍点：起手落在拍线上还是抢了/拖了；
 * - 多弹：不属于这一段的音只提示、不计分，免得一两次手滑毁掉整段结论。
 */
const props = withDefaults(
  defineProps<{
    score: Score;
    hand?: Hand | "BOTH";
    /** 跟弹速度；不传就用谱面自己的 BPM。 */
    bpm?: number | null;
    /** 测试钩子前缀。 */
    prefix?: string;
    /** 父级推送的一次按键（屏幕琴键走这条支路；测试也用它）。 */
    pulse?: NotePulse | null;
  }>(),
  { hand: "BOTH", bpm: null, prefix: "score-follow", pulse: null },
);

const emit = defineEmits<{
  /** 跟完一遍。父级可以据此切到下一段。 */
  done: [payload: { onCount: number; total: number }];
}>();

/** 最后一个音之后再等两拍；再没动静就收尾。 */
const TAIL_BEATS = 2;

const plan = computed(() =>
  planForScore(props.score, props.hand, props.bpm ?? props.score.bpm),
);
const countIn = computed(() => countInFor(plan.value));
const total = computed(() => plan.value.slots.length);

const running = ref(false);
const started = ref(false);
const beat = ref(0);
/** 当前要按的位置（槽位）；等于 total 表示弹完了。 */
const slotIndex = ref(0);
const hits = ref<RhythmHit[]>([]);
const strays = ref(0);

let startedAt = 0;
let frame = 0;
let metronome: Playback | null = null;
let detach: (() => void) | null = null;
let disposed = false;

const countingIn = computed(() => running.value && beat.value < 0);
const countdown = computed(() => Math.max(1, Math.ceil(-beat.value)));
const finished = computed(() => started.value && !running.value);

const result = computed(() =>
  hits.value.length || finished.value
    ? gradeRhythm(plan.value, hits.value, startedAt, countIn.value)
    : null,
);
const marks = computed(() => (result.value ? rhythmMarks(result.value) : []));

/**
 * 已经按齐的音不再往回判，只画「当前这个位置」还要按哪几个键。
 * 高亮交给琴键图，眼睛不用在网格和键盘之间来回找。
 */
const pendingMidis = computed(() => {
  const slot = plan.value.slots[slotIndex.value];
  if (!slot) return [];
  const pressed = new Set(
    hits.value.filter((hit) => hit.slotIndex === slotIndex.value).map((hit) => hit.midi),
  );
  return slot.midis.filter((midi) => !pressed.has(midi));
});
const highlightMidi = computed(() => (running.value ? pendingMidis.value[0] ?? null : null));

const status = computed(() => {
  if (!started.value) return `共 ${total.value} 个位置 · ${plan.value.bpm} BPM`;
  if (countingIn.value) return `预备 ${countdown.value} 拍`;
  if (running.value) return `已到 ${Math.min(slotIndex.value + 1, total.value)} / ${total.value}`;
  return slotIndex.value >= total.value ? "跟完了" : "已停止";
});

const summary = computed(() => {
  const value = result.value;
  if (!value) return "";
  const base = rhythmSummary(value);
  // 多弹的音不参与打分，但要说一声，否则「明明弹了却没算」会让人困惑。
  return strays.value > 0 ? `${base}另外多弹了 ${strays.value} 个音，没有计入。` : base;
});

/** 偏得最多的几个位置，最多说三条；网格已经画出来了，文字只补「哪一拍」。 */
const detail = computed(() => {
  const value = result.value;
  if (!value) return [];
  return value.steps
    .filter((step) => step.quality === "off")
    .slice(0, 3)
    .map((step) => {
      const slot = plan.value.slots[step.slotIndex];
      const { bar, inBar } = barOfBeat(plan.value, slot.startBeat);
      return `第 ${bar} 小节第 ${inBar} 拍：${offsetText(step.offsetBeat ?? 0)}`;
    });
});

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
  strays.value = 0;
  slotIndex.value = 0;
  started.value = true;
  running.value = true;
  startedAt = performance.now();
  beat.value = -countIn.value;

  metronome = startMetronome(plan.value.bpm);
  frame = raf(tick);
  followMidi(plan.value.slots[0]?.midis[0] ?? 0);

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
  skipMissed();
  frame = raf(tick);
}

/**
 * 已经过去的槽位直接放行。
 *
 * 判定窗口到「下一个位置开始」为止：弹晚了还能算给上一个音，但拖过一整拍
 * 就认漏——否则一个音没弹，后面每个音都会顶到这个位置上，整段错位。
 */
function skipMissed() {
  while (slotIndex.value < total.value) {
    const next = plan.value.slots[slotIndex.value + 1];
    const deadline = next ? next.startBeat : plan.value.totalBeats;
    if (beat.value < deadline) break;
    slotIndex.value += 1;
  }
  // 整段都放行完了就是收尾时刻，不用等下一帧。
  if (slotIndex.value >= total.value && beat.value >= plan.value.totalBeats) finish();
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

function finish() {
  stopClock();
  const value = result.value;
  if (value) emit("done", { onCount: value.onCount, total: value.total });
}

/** 同一个事件可能既从订阅来、又从 pulse 来；按引用只处理一次。 */
const seen = new WeakSet<MidiNote>();

function onNote(note: MidiNote) {
  if (!running.value) return;
  if (seen.has(note)) return;
  seen.add(note);

  // 抬手只补时值，不改变进度：按没按够是音长的事，和第几个音无关。
  if (note.kind === "off") {
    recordRelease(note.midi, note.timeMs);
    return;
  }

  // 拍点用事件自己的时间戳算，不依赖渲染帧：帧率抖动不该变成判定误差。
  const at = beatAt(plan.value, startedAt, note.timeMs, countIn.value);
  if (at < 0) return;
  // 第一个音落下去就说明预备拍已经听完，别等下一帧才从「预备」里出来。
  beat.value = Math.max(beat.value, at);

  const slot = plan.value.slots[slotIndex.value];
  if (!slot) return;

  if (!slot.midis.includes(note.midi)) {
    strays.value += 1;
    return;
  }

  hits.value = [...hits.value, { midi: note.midi, atMs: note.timeMs, slotIndex: slotIndex.value }];
  advance();
}

/**
 * 把抬手时刻补到「最近一次按下这个音且还没松」的那一击上。
 *
 * MIDI 的 note-on/off 本来就是按音高配对的，所以不能限定当前槽位：
 * 初学者常按住一个音等下一个音，抬手时进度早就往前走了。同一个音在旋律里
 * 重复出现也没关系——从后往前找，先配到的一定是后按的那一次。
 */
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

/** 这一拍的音按齐了就往前走，可能连续走好几个空位。 */
function advance() {
  while (slotIndex.value < total.value) {
    const slot = plan.value.slots[slotIndex.value];
    const pressed = new Set(
      hits.value.filter((hit) => hit.slotIndex === slotIndex.value).map((hit) => hit.midi),
    );
    if (!slot.midis.every((midi) => pressed.has(midi))) return;
    slotIndex.value += 1;
  }
  finish();
}

watch(
  () => props.pulse,
  (pulse) => {
    if (pulse) onNote(pulse.note);
  },
);

// 换段、换手、换速度都要从头开始：半截的判定结果对不上新谱子。
watch(
  () => [props.score, props.hand, props.bpm],
  () => {
    stopClock();
    started.value = false;
    hits.value = [];
    strays.value = 0;
    slotIndex.value = 0;
    beat.value = 0;
  },
);

onBeforeUnmount(() => {
  disposed = true;
  stopClock();
});
</script>

<template>
  <div
    class="follow"
    data-test="score-follow"
    :data-score-id="score.id"
    :data-slots="total"
  >
    <div class="bar">
      <button
        type="button"
        class="primary"
        :data-test="`${prefix}-start`"
        :disabled="running"
        @click="start"
      >
        {{ started ? "再跟一遍" : "开始跟弹" }}
      </button>
      <button v-if="running" type="button" :data-test="`${prefix}-stop`" @click="finish">
        停止
      </button>
      <span class="status" :data-test="`${prefix}-status`">{{ status }}</span>
      <span v-if="running && !countingIn && pendingMidis.length > 1" class="hint-inline">
        这一拍要一起按
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

    <div v-if="started && !running" class="verdict" data-test="`${prefix}-verdict`">
      <p class="summary" :data-test="`${prefix}-summary`">{{ summary }}</p>
      <ul v-if="detail.length" class="detail" :data-test="`${prefix}-detail`">
        <li v-for="line in detail" :key="line">{{ line }}</li>
      </ul>
    </div>
    <p v-else-if="!started" class="hint">
      先听一小节预备拍，再跟着网格把这一段的音按出来；左右手同一个位置的音要一起按。
    </p>

    <div class="keyboard-panel">
      <KeyboardDiagram :highlight-midi="highlightMidi" @note="onNote" />
    </div>
  </div>
</template>

<style scoped>
.follow {
  margin: var(--pb-space-3) 0;
  padding: var(--pb-space-3);
  border: 1px solid var(--pb-border-soft);
  border-radius: var(--pb-radius);
  background: var(--pb-surface-2);
}

/*
 * 面板本身是次级块（比卡片深一档），网格轨道就要反回来用卡片色，
 * 否则两条米色叠在一起，看不出「一格一拍」的边界。
 */
.follow :deep(.grid) {
  background: var(--pb-surface);
  border: 1px solid var(--pb-border-soft);
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
  border: 1px solid var(--pb-border-soft);
  border-radius: var(--pb-radius);
  background: var(--pb-surface);
  color: var(--pb-ink);
  cursor: pointer;
}

button.primary {
  border-color: var(--pb-accent-2);
  background: var(--pb-accent-2);
  color: var(--pb-accent-text);
  font-weight: 600;
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.status {
  color: var(--pb-muted);
  font-variant-numeric: tabular-nums;
}

.hint-inline {
  color: var(--pb-accent);
  font-size: 0.78rem;
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

.detail {
  margin: 0.4rem 0 0;
  padding: 0 0 0 1.1rem;
  color: var(--pb-muted);
  font-size: 0.8rem;
  line-height: 1.6;
}

.hint {
  margin: 0;
  color: var(--pb-muted);
  font-size: 0.8rem;
  line-height: 1.5;
}

/* 琴键放深色面板里，和课程页、乐理页的键盘区同一个视觉 */
.keyboard-panel {
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  margin-top: var(--pb-space-2);
  padding: var(--pb-space-2) var(--pb-space-3);
  border: 1px solid var(--pb-key-gap);
  border-radius: var(--pb-radius);
  background: var(--pb-bg-deep);
  overflow: hidden;
}
</style>
