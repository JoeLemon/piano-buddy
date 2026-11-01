<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { midiLabel, pitchClassName } from "../practice/playAnswer";
import { barOfBeat, type RhythmMark, type RhythmPlan } from "../practice/rhythm";

/**
 * 节拍网格：把「什么时候弹」画出来。
 *
 * 只有一维时间轴，没有第二种读法：横向是拍，每一格一拍，粗线是小节线；
 * 上方金点是目标音该落在哪一拍，下方圆点是实际弹的拍点。两者对不上
 * 时偏差一眼看得见——这比一句「你晚了」有用得多。
 *
 * 预备拍期间整体压暗并显示倒数，让人听清速度再进来。
 */
const props = withDefaults(
  defineProps<{
    plan: RhythmPlan;
    /** 当前拍；负极表示还在预备拍里。 */
    beat: number;
    /** 每个音的实际落点；漏掉的音不在数组里。 */
    marks?: readonly RhythmMark[];
    /** 已经弹完了：这时才把漏掉的音标出来，进行中标会误导。 */
    finished?: boolean;
    /**
     * 当前该按的位置（槽位下标）。
     *
     * 不从 `beat` 反推：漏音时时钟照常往前走，进度却停在原地，两者会错开，
     * 照着时钟展开就成了「下一拍的和弦」。所以由知道进度的调用方给。
     */
    activeSlot?: number;
    /**
     * `activeSlot` 上还差哪几个键。
     *
     * 不传（`undefined`）表示调用方不跟踪按键状态，这时只列音名、不标已按；
     * 传空数组表示这一拍已经按齐了。
     */
    remaining?: readonly number[];
    /** 测试钩子前缀。 */
    prefix?: string;
  }>(),
  { marks: () => [], finished: false, activeSlot: undefined, remaining: undefined, prefix: "rhythm" },
);

/** 每拍的基础宽度：四/八分音符够用，十六分音符再按密度加宽。 */
const BASE_BEAT_W = 44;
/** 相邻槽位至少留这么宽，音名才不会叠在一起（「C+1」约 21px）。 */
const MIN_SLOT_W = 24;

/**
 * 每拍宽度：按最小的槽位间隔加宽。
 *
 * 十六分音符一拍有四个槽位，仍用 44px 的话相邻音名只隔 11px，会和和弦
 * 的「+1」叠成一团；三连音同理。稀疏谱面保持原宽度，密集谱面才展开。
 */
const beatW = computed(() => {
  let minGap = 1;
  for (let index = 1; index < props.plan.slots.length; index += 1) {
    const gap = props.plan.slots[index]!.startBeat - props.plan.slots[index - 1]!.startBeat;
    if (gap > 0 && gap < minGap) minGap = gap;
  }
  return Math.max(BASE_BEAT_W, Math.ceil(MIN_SLOT_W / minGap));
});

/**
 * 首尾各留半拍。
 *
 * 音名、落点、游标都以拍线为中心（`translateX(-50%)`），第 0 拍的标签
 * 会有一半落在轨道外面被裁掉；留出半拍正好容下它。
 */
const pad = computed(() => beatW.value / 2);

const lane = ref<HTMLElement | null>(null);

/** 画到整数拍就够：半个拍子的尾巴由音名标签自己定位。 */
const beatCount = computed(() => Math.max(1, Math.ceil(props.plan.totalBeats)));

const barStarts = computed(() => {
  const fixed = props.plan.measureStarts;
  if (fixed && fixed.length > 0) {
    // 弱起曲子的首小节只有一两拍，按 beatsPerBar 硬乘会从小节二起整体偏。
    return fixed.filter((beat) => beat < beatCount.value);
  }
  const starts: number[] = [];
  for (let beat = 0; beat < beatCount.value; beat += 1) {
    if (beat % props.plan.beatsPerBar === 0) starts.push(beat);
  }
  return starts;
});

const countingIn = computed(() => props.beat < 0);
/** 预备拍倒数：还剩几拍进来。 */
const countdown = computed(() => Math.ceil(-props.beat));

/**
 * 格子上的拍号。弱起曲子的首小节从后面几拍开始（4/4 弱起一声进在第 4 拍），
 * 直接按 `beat % beatsPerBar` 会把它标成第 1 拍，跟谱面对不上。
 */
const beatNos = computed(() =>
  Array.from({ length: beatCount.value }, (_, beat) => barOfBeat(props.plan, beat).inBar),
);

/** 游标位置：预备拍期间钉在 0，不往左跑出画布。 */
const cursorX = computed(() => {
  const beat = Math.min(Math.max(props.beat, 0), props.plan.totalBeats);
  return beat * beatW.value;
});

/**
 * 一格要显示的主音：多音位置取最高音（就是旋律那一声），其余用 +N 交代个数。
 * 和弦把三四个音名都写在这一格上会糊成一片，连隔壁格子的数字都盖住。
 * 具体是哪几个键由下方的展开条交代——那里带八度，因为跟弹判定是八度严格的。
 */
const mainMidi = (index: number): number | null => {
  const slot = props.plan.slots[index];
  if (!slot || slot.midis.length === 0) return null;
  return slot.midis.reduce((top, midi) => (midi > top ? midi : top), slot.midis[0]!);
};

const noteLabel = (index: number): string => {
  const midi = mainMidi(index);
  // 轨道上只写音级：一格才几十像素，带八度会挤成两个字宽。
  return midi == null ? "" : pitchClassName(midi);
};

/**
 * 这一拍还要多按几个键（不含主音）。写成「+3」而不是「×4」：
 * ×4 容易被读成「这个音弹四次」，+3 就是「另外还有三个键」。
 */
const extraCount = (index: number): number => {
  const slot = props.plan.slots[index];
  return slot && slot.midis.length > 1 ? slot.midis.length - 1 : 0;
};

/**
 * 当前这一拍如果不止一个音，把它摊开列出来。
 *
 * 轨道里只写「主音 +N」是因为格子窄；到了要按的时候，学生必须知道另外
 * 几个键到底是哪几个——尤其四音和弦，靠猜是猜不出来的。
 */
const activeChord = computed(() => {
  if (props.finished || props.activeSlot == null) return null;
  const slot = props.plan.slots[props.activeSlot];
  return slot && slot.midis.length > 1 ? slot : null;
});

/** 已经按下去的音；调用方不跟踪按键状态时是空集，所有音都按「还没按」显示。 */
const pressed = computed(() => {
  const chord = activeChord.value;
  if (!chord || props.remaining === undefined) return new Set<number>();
  const left = new Set(props.remaining);
  return new Set(chord.midis.filter((midi) => !left.has(midi)));
});

/** 弹完之后回头看：哪些位置一句话都没落地。 */
const missed = computed(() => {
  if (!props.finished) return [];
  const landed = new Set(props.marks.map((mark) => mark.slotIndex));
  return props.plan.slots
    .map((slot, index) => ({ slot, index }))
    .filter((entry) => !landed.has(entry.index));
});

// 游标走到可视区右侧之外时把轨道推过去，让它一直看得见。
// 直接改 scrollLeft（不用 scrollIntoView），避免整页跟着跳。
watch(
  () => props.beat,
  () => {
    const element = lane.value;
    if (!element) return;
    const cursor = cursorX.value;
    const left = element.scrollLeft;
    const right = left + element.clientWidth;
    if (cursor > right - beatW.value || cursor < left) {
      element.scrollLeft = Math.max(0, cursor - element.clientWidth + beatW.value);
    }
  },
);
</script>

<template>
  <div
    class="rhythm"
    :class="{ counting: countingIn }"
    :data-test="`${prefix}-grid`"
    :style="{ '--beat-w': `${beatW}px` }"
  >
    <div ref="lane" class="lane">
      <div class="grid" :style="{ width: `${beatCount * beatW + pad * 2}px` }">
        <div
          v-for="beat in beatCount"
          :key="beat"
          class="cell"
          :class="{
            bar: barStarts.includes(beat - 1),
            past: props.beat >= beat - 1,
          }"
          :style="{ left: `${(beat - 1) * beatW + pad}px` }"
        >
          <span class="cell-no">{{ beatNos[beat - 1] }}</span>
        </div>

        <span
          v-for="(slot, index) in plan.slots"
          :key="`n${index}`"
          class="note"
          :class="{ chord: slot.midis.length > 1 }"
          :style="{ left: `${slot.startBeat * beatW + pad}px` }"
          :data-midi="mainMidi(index) ?? ''"
        >
          <span class="name">
            {{ noteLabel(index) }}<em v-if="extraCount(index)" class="extra">+{{ extraCount(index) }}</em>
          </span>
        </span>

        <span
          v-for="mark in marks"
          :key="`m${mark.slotIndex}`"
          class="mark"
          :class="mark.quality"
          :style="{ left: `${mark.atBeat * beatW + pad}px` }"
          :data-test="`${prefix}-mark-${mark.slotIndex}`"
        ></span>

        <span
          v-for="entry in missed"
          :key="`x${entry.index}`"
          class="missed"
          :style="{ left: `${entry.slot.startBeat * beatW + pad}px` }"
          :data-test="`${prefix}-missed-${entry.index}`"
        ></span>

        <div
          v-if="!countingIn && !finished"
          class="cursor"
          :style="{ left: `${cursorX + pad}px` }"
          :data-test="`${prefix}-cursor`"
        ></div>

        <div v-if="countingIn" class="countdown" :data-test="`${prefix}-countdown`">
          <strong>{{ countdown }}</strong>
          <span>预备</span>
        </div>
      </div>
    </div>

    <!-- 放在轨道外面：轨道横向滚动时这一行要一直看得见 -->
    <div
      v-if="activeChord"
      class="chord-hint"
      :class="{ counting: countingIn }"
      :data-test="`${prefix}-chord-hint`"
    >
      <span class="lead">{{ pressed.size ? "还差" : "一起按" }}</span>
      <span
        v-for="midi in activeChord.midis"
        :key="midi"
        class="key"
        :class="{ done: pressed.has(midi) }"
        :data-midi="midi"
      >{{ midiLabel(midi) }}</span>
    </div>
  </div>
</template>

<style scoped>
.rhythm {
  margin: 0 0 var(--pb-space-3);
}

.lane {
  overflow-x: auto;
  overflow-y: hidden;
  padding: 0.35rem 0 0.5rem;
}

.grid {
  position: relative;
  height: 4.1rem;
  /* 拍数少时也铺满一整行，看起来像一条轨道，而不是角落里的小方块 */
  min-width: calc(100% - 1rem);
  margin: 0 0.5rem;
  border-radius: var(--pb-radius);
  background: var(--pb-surface-2);
}

.cell {
  position: absolute;
  top: 0;
  bottom: 0;
  width: var(--beat-w);
  border-left: 1px solid var(--pb-border-soft);
}

/* 小节线：整条轨道唯一的强分隔，一眼能数出「第几小节」 */
.cell.bar {
  border-left: 2px solid color-mix(in srgb, var(--pb-ink) 55%, transparent);
}

.cell.past {
  background: color-mix(in srgb, var(--pb-accent-2) 9%, transparent);
}

.cell-no {
  position: absolute;
  top: 0.1rem;
  left: 0.35rem;
  color: var(--pb-muted);
  font-size: 0.68rem;
  font-variant-numeric: tabular-nums;
}

/* 目标音：金色小点 + 音级，中心压在拍线上——和落点、游标同一个基准，
   三者对不齐就说明音真的没落在拍上，看起来才可信 */
.note {
  position: absolute;
  top: 1.4rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.1rem;
  color: var(--pb-ink);
  font-size: 0.74rem;
  line-height: 1.1;
  white-space: nowrap;
  transform: translateX(-50%);
  pointer-events: none;
  transition: opacity 0.18s ease;
}

/* 预备拍还没轮到弹，先把音名收起来，免得抢走倒数的注意力 */
.rhythm.counting .note {
  opacity: 0;
}

/* 和弦/双手同拍：主音后跟一个 +N，交代这一格还要多按几个键。
   `.note` 是纵向排的（点在上、音名在下），所以音名和 ×N 要包一层行内盒子，
   否则 +N 会自己占一行、被网格底边裁掉。 */
.note.chord {
  font-size: 0.68rem;
  letter-spacing: -0.02em;
}

.note .name {
  display: inline-flex;
  align-items: baseline;
  justify-content: center;
}

.note .extra {
  margin-left: 0.1em;
  color: var(--pb-muted);
  font-size: 0.9em;
  font-style: normal;
}

.note::before {
  content: "";
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--pb-accent-2);
}

/* 实际弹的落点：绿色在拍上，红色偏了 */
.mark {
  position: absolute;
  top: 3.1rem;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  transform: translateX(-50%);
}

.mark.on {
  background: var(--pb-ok);
}

.mark.off {
  background: var(--pb-danger);
}

/* 漏掉的音：空心灰圈，和「弹错了」的红点分开 */
.missed {
  position: absolute;
  top: 3.1rem;
  width: 8px;
  height: 8px;
  border: 1.5px solid var(--pb-muted);
  border-radius: 50%;
  transform: translateX(-50%);
  opacity: 0.7;
}

.cursor {
  position: absolute;
  top: 0.9rem;
  bottom: 0.2rem;
  width: 2px;
  margin-left: -1px;
  background: var(--pb-accent);
  pointer-events: none;
}

.countdown {
  position: absolute;
  inset: 0;
  z-index: 2;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.1rem;
  border-radius: var(--pb-radius);
  background: color-mix(in srgb, var(--pb-surface-2) 88%, transparent);
  color: var(--pb-muted);
  font-size: 0.7rem;
  letter-spacing: 0.08em;
  pointer-events: none;
}

.countdown strong {
  color: var(--pb-ink);
  font-family: var(--pb-font-display);
  font-size: 1.9rem;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}

/*
 * 当前这一拍要一起按的键。
 *
 * 不放进格子：一格只有一两拍宽，三四个音名挤进去会互相盖住，也会盖住
 * 隔壁格子的拍号。单独一行横排，带八度写清楚——四音和弦里 C4 与 C5
 * 音级相同，不写八度就等于没说。
 */
.chord-hint {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.3rem;
  padding: 0 0.15rem;
  font-size: 0.74rem;
  line-height: 1.4;
}

.chord-hint .lead {
  color: var(--pb-muted);
  letter-spacing: 0.02em;
}

/*
 * 预备拍里也留着：四音和弦要靠这四拍把手摆好，藏起来等于没有准备时间。
 * 但整体退到后面，别跟倒数数字抢注意力。
 */
.chord-hint.counting {
  opacity: 0.55;
}

.chord-hint .key {
  padding: 0 0.36rem;
  border: 1px solid var(--pb-border);
  border-radius: 999px;
  background: var(--pb-surface-2);
  color: var(--pb-ink);
  font-variant-numeric: tabular-nums;
  transition:
    color 0.12s ease,
    border-color 0.12s ease,
    opacity 0.12s ease;
}

/* 已经按下去的键淡出打勾，剩下几个一目了然 */
.chord-hint .key.done {
  border-color: color-mix(in srgb, var(--pb-ok) 45%, transparent);
  color: var(--pb-ok);
  opacity: 0.6;
}

.chord-hint .key.done::before {
  content: "✓";
  margin-right: 0.18em;
  font-size: 0.9em;
}
</style>
