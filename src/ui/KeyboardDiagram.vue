<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { pitchToMidi } from "../domain/pitch";
import type { Hand, PositionId } from "../domain/types";
import { pitchesFor } from "../domain/vocabulary";
import { keyCapFor, keyboardMode } from "../midi/keyboard";
import { blackKeyMidis, whiteKeyMidis } from "../notation/renderScore";

// 高亮的琴键（现有能力），加上正在弹的那只手与手指（新增）。
// activeHand / activeFinger / highlightSeq 缺省为 null/0，保持只传 highlightMidi 的旧调用兼容。
const props = withDefaults(
  defineProps<{
    highlightMidi: number | null;
    activeHand?: Hand | null;
    activeFinger?: number | null;
    /** 乐谱指针对应的音符序号，每次前进都会 +1；用它重触“按键”动画（连续重复音也会动）。 */
    highlightSeq?: number;
    /** 手位：决定两只手搭在哪五个白键上（C 五指位 / F / G / D 位）。 */
    position?: PositionId;
  }>(),
  { activeHand: null, activeFinger: null, highlightSeq: 0, position: "C" },
);

// 当前音变化时重触发一次按压动画，让双手“跟着乐谱”逐个按下。
const pressing = ref(false);
watch(
  () => props.highlightSeq,
  async () => {
    pressing.value = false;
    await nextTick();
    pressing.value = true;
  },
);

const whites = whiteKeyMidis();
const blackMidis = new Set(blackKeyMidis());
const blacks = whites.flatMap((midi, slot) => (blackMidis.has(midi + 1) ? [{ midi: midi + 1, slot }] : []));

/**
 * 两只手叠在键盘上的示意：
 * - 每只手占 5 个白键槽位，槽位由手位的第一根手指所在白键决定：
 *   C 位左手在 C3–G3（槽位 0–4）、右手在 C4–G4（槽位 7–11）；
 *   F 位右手前移到 F4–C5（槽位 8–12），G 位再前一个白键。
 * - digits 是键盘上从左到右的手指编号：右手 1–5 递增（大拇指在左），
 *   左手 5–1 递减（大拇指在右）。手位换了、指序不变。
 */
const HANDS: readonly { side: Hand; start: number; digits: readonly number[] }[] = [
  { side: "RH", start: 7, digits: [1, 2, 3, 4, 5] },
  { side: "LH", start: 0, digits: [5, 4, 3, 2, 1] },
];

/** 当前手位下某只手最低那个白键的槽位（手位第一个音总是白键）。 */
function handStart(side: Hand): number {
  const lowest = pitchesFor(props.position, side)[0];
  const white = whiteKeyMidis();
  const slot = white.indexOf(pitchToMidi({ ...lowest, alteration: 0 }));
  if (slot >= 0) return slot;
  return HANDS.find((hand) => hand.side === side)?.start ?? 0;
}

// 手形 SVG 的几何参数（单位：viewBox 内像素）。WHITE_W/KEY_GAP 与下方 CSS 的
// --white-w/--key-gap 保持一致，保证每根手指中心与对应的白键中心逐列对齐。
const WHITE_W = 28; // 白键宽
const KEY_GAP = 2; // 键缝
const KEY_PITCH = WHITE_W + KEY_GAP; // 相邻白键中心的间距
const HAND_W = 5 * WHITE_W + 4 * KEY_GAP; // 单只手跨 5 个白键的总宽
const HAND_H = 100; // 手形图高度
const PALM_Y = 68; // 手掌顶边（也是手指根部）的 y
const PALM_R = 16; // 手掌底角圆角半径

// 各手指的形状参数。tipY 越小手指越长；baseW/tipW 是根部/指尖宽度。
// 中指最长、食指/无名指次之，小指较短，拇指短而粗——接近真实手型比例。
const FINGER_GEOM: Readonly<Record<number, { tipY: number; baseW: number; tipW: number }>> = {
  1: { tipY: 34, baseW: 28, tipW: 22 }, // 拇指
  2: { tipY: 12, baseW: 24, tipW: 15 }, // 食指
  3: { tipY: 6, baseW: 24, tipW: 15 }, // 中指（最长）
  4: { tipY: 16, baseW: 24, tipW: 15 }, // 无名指
  5: { tipY: 28, baseW: 22, tipW: 14 }, // 小指
};

// 单根手指的轮廓路径：指根平接手掌、两侧向内收窄、指尖圆弧，形似自然手指。
function fingerPath(cx: number, digit: number): string {
  const { tipY, baseW, tipW } = FINGER_GEOM[digit];
  const tipR = tipW / 2;
  const tipShoulderY = tipY + tipR;
  return [
    `M ${cx - baseW / 2} ${PALM_Y}`,
    `L ${cx - tipR} ${tipShoulderY}`,
    `A ${tipR} ${tipR} 0 0 1 ${cx + tipR} ${tipShoulderY}`,
    `L ${cx + baseW / 2} ${PALM_Y}`,
    "Z",
  ].join(" ");
}

// 手掌轮廓：顶边平直（接手指），两个底角圆润。
const PALM_PATH = [
  `M 0 ${PALM_Y}`,
  `H ${HAND_W}`,
  `V ${HAND_H - PALM_R}`,
  `Q ${HAND_W} ${HAND_H} ${HAND_W - PALM_R} ${HAND_H}`,
  `H ${PALM_R}`,
  `Q 0 ${HAND_H} 0 ${HAND_H - PALM_R}`,
  "Z",
].join(" ");

// 两只手在键盘上的布局。digits 已是两手各自从左到右的指序，i 为列号；
// 每根手指中心对齐第 start+i 个白键中心。
const hands = computed(() =>
  HANDS.map((hand) => ({
    side: hand.side,
    start: handStart(hand.side),
    fingers: hand.digits.map((digit, i) => {
      const cx = i * KEY_PITCH + WHITE_W / 2;
      return { digit, cx, d: fingerPath(cx, digit), labelY: FINGER_GEOM[digit].tipY + 14 };
    }),
  })),
);

/** 某只手是否整体淡出，让视线集中在正在用的那只手上。 */
function isDimmed(side: Hand): boolean {
  return props.activeHand != null && props.activeHand !== side;
}

/** 某一根手指是否为当前要按的那根。 */
function isActiveFinger(side: Hand, digit: number): boolean {
  return props.activeHand === side && props.activeFinger === digit;
}
</script>

<template>
  <div class="keyboard" data-test="keyboard" :data-keyboard-mode="String(keyboardMode)" :class="{ 'is-pressing': pressing }">
    <div
      v-for="midi in whites"
      :key="midi"
      class="white-key"
      :class="{ 'is-target': midi === highlightMidi }"
    >
      <span v-if="keyboardMode" class="key-cap">{{ keyCapFor(midi) }}</span>
    </div>
    <div
      v-for="key in blacks"
      :key="key.midi"
      class="black-key"
      :class="{ 'is-target': key.midi === highlightMidi }"
      :style="{ '--slot': String(key.slot) }"
    >
      <span v-if="keyboardMode" class="key-cap">{{ keyCapFor(key.midi) }}</span>
    </div>
    <svg
      v-for="hand in hands"
      :key="hand.side"
      class="hand"
      :class="{ 'is-dim': isDimmed(hand.side) }"
      :data-hand="hand.side"
      :viewBox="`0 0 ${HAND_W} ${HAND_H}`"
      :width="HAND_W"
      :height="HAND_H"
      :style="{ '--hand-start': String(hand.start) }"
    >
      <path class="palm" :d="PALM_PATH" />
      <g
        v-for="finger in hand.fingers"
        :key="finger.digit"
        class="finger"
        :class="{ 'is-active': isActiveFinger(hand.side, finger.digit) }"
        :data-finger="finger.digit"
      >
        <path class="finger-shape" :d="finger.d" />
        <text class="finger-label" :x="finger.cx" :y="finger.labelY" text-anchor="middle">{{ finger.digit }}</text>
      </g>
    </svg>
  </div>
</template>

<style scoped>
.keyboard {
  --white-w: 28px;
  --key-gap: 2px;
  --black-w: 18px;
  position: relative;
  display: flex;
  align-items: flex-end;
  gap: var(--key-gap);
  max-width: 100%;
  overflow-x: auto;
  user-select: none;
}

.white-key {
  flex: 0 0 var(--white-w);
  width: var(--white-w);
  height: 120px;
  box-sizing: border-box;
  position: relative;
  background: var(--pb-key-white);
  border: 1px solid var(--pb-key-gap);
  border-radius: 0 0 4px 4px;
  box-shadow: inset 0 -2px 0 rgb(0 0 0 / 12%);
}

.black-key {
  position: absolute;
  top: 0;
  left: calc(
    var(--slot) * (var(--white-w) + var(--key-gap)) + var(--white-w) + var(--key-gap) / 2 - var(--black-w) / 2
  );
  z-index: 1;
  width: var(--black-w);
  height: 74px;
  box-sizing: border-box;
  background: var(--pb-key-black);
  border: 1px solid var(--pb-key-gap);
  border-radius: 0 0 3px 3px;
  box-shadow: inset 0 -2px 0 rgb(0 0 0 / 35%);
  pointer-events: none;
}

/* 按压态用金色系：白键浅金、黑键深金，键帽文字同步转深绿保证可读 */
.white-key.is-target {
  background: var(--pb-accent-2);
}

.black-key.is-target {
  background: var(--pb-accent-2-strong);
}

.white-key.is-target .key-cap,
.black-key.is-target .key-cap {
  color: var(--pb-accent-text);
}

/* 模拟键盘模式的键位标注：白键深灰绿，黑键亮金（规范 §4.5） */
.white-key .key-cap {
  position: absolute;
  top: 3px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 0.6rem;
  line-height: 1;
  color: var(--pb-key-cap);
}

.black-key .key-cap {
  position: absolute;
  bottom: 4px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 0.55rem;
  line-height: 1;
  font-weight: 600;
  color: var(--pb-accent-2-strong);
}

/* 两只手：SVG 手形图，从玩家侧伸出搭在琴键上。手宽与 5 个白键严格一致，
   每根手指中心对齐对应白键中心，因此逐列跟键。 */
.hand {
  position: absolute;
  bottom: 0;
  left: calc(var(--hand-start) * (var(--white-w) + var(--key-gap)));
  z-index: 2;
  overflow: visible;
  pointer-events: none;
  transition: opacity 0.15s ease;
}

.hand.is-dim {
  opacity: 0.38;
}

.palm {
  fill: var(--pb-hand);
  stroke: var(--pb-hand-line);
  stroke-width: 1;
}

.finger {
  /* SVG 元素默认以 viewBox 原点做变换，改用 fill-box 让按压动画绕指根下压 */
  transform-box: fill-box;
  transform-origin: center bottom;
}

.finger-shape {
  fill: var(--pb-hand);
  stroke: var(--pb-hand-line);
  stroke-width: 1;
}

.finger-label {
  fill: var(--pb-hand-ink);
  font-size: 12px;
  font-weight: 600;
  pointer-events: none;
  user-select: none;
}

/* 当前手指：跟随「当前音」的金色语言，与按下的琴键同色系 */
.finger.is-active .finger-shape {
  fill: var(--pb-accent-2);
  stroke: var(--pb-accent-2);
}

.finger.is-active .finger-label {
  fill: var(--pb-accent-text);
}

/* 跟随乐谱的按键动画：随音符推进，当前手指下压、目标琴键轻沉，再回弹。 */
.white-key,
.black-key {
  transform-origin: bottom center;
}

@keyframes finger-press {
  0% { transform: scaleY(1); }
  40% { transform: scaleY(0.85); }
  100% { transform: scaleY(1); }
}

@keyframes key-press {
  0% { transform: scaleY(1); }
  40% { transform: scaleY(0.96); }
  100% { transform: scaleY(1); }
}

.keyboard.is-pressing .finger.is-active {
  animation: finger-press 0.25s ease;
}

.keyboard.is-pressing .white-key.is-target,
.keyboard.is-pressing .black-key.is-target {
  animation: key-press 0.25s ease;
}
</style>