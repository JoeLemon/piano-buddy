<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { keyToneOff, keyToneOn, keyToneStopAll } from "../audio/keyTone";
import {
  C_MARKS,
  PIANO_HIGH_MIDI,
  ZONES,
  clampScroll,
  slotForMidi,
  whiteKeys,
  zoneById,
  zoneScrollTarget,
  type PianoZone,
} from "../keyboard/layout";
import {
  activeZone,
  followMidi,
  heldKeyMidis,
  keyCapsFor,
  keyLabels,
  keyboardMode,
  setActiveZone,
} from "../midi/keyboard";
import type { MidiNote } from "../midi/types";

/** 只保留高亮音；电脑键位标注由全局开关（keyLabels）控制，手形示意图已移除。 */
const props = defineProps<{
  highlightMidi: number | null;
}>();

/** 鼠标 / 触摸点拨琴键时把音符交给视图，和 MIDI 走同一条路。 */
const emit = defineEmits<{ note: [note: MidiNote] }>();

/* ── 几何 ───────────────────────────────────────────────────────────── */

const WHITE_W = 38; // 白键宽（放大后仍留出横向滚动的余量）
const KEY_GAP = 2; // 键缝
const KEY_PITCH = WHITE_W + KEY_GAP; // 相邻白键中心的间距
const BLACK_W = 25;
const WHITE_TOTAL = 52; // 88 键琴的白键数，缩略图按它换算百分比

const whites = whiteKeys();
const blacks = computed(() =>
  whites.flatMap((midi, slot) =>
    // 白键 E、B 右侧没有黑键，用「下一个白键不是半音」判断。
    midi + 1 <= PIANO_HIGH_MIDI && !whites.includes(midi + 1) ? [{ midi: midi + 1, slot }] : [],
  ),
);

/** 当前音区的键帽标注表；没开标注时为空表，模板里直接判断有无。 */
const caps = computed(() => (keyLabels.value ? keyCapsFor(activeZone.value) : new Map<number, string>()));

/** 白键槽位 → 缩略图百分比几何（与全尺寸键盘同一套 slot 坐标）。 */
function miniWhiteStyle(slot: number) {
  return { left: `${(slot / WHITE_TOTAL) * 100}%`, width: `${100 / WHITE_TOTAL}%` };
}

function miniBlackStyle(slot: number) {
  const unit = 100 / WHITE_TOTAL;
  return { left: `${(slot + 1) * unit - unit * 0.31}%`, width: `${unit * 0.62}%` };
}

/** 音区在缩略图上的框：按白键段等比定位，左右各留 1px 让相邻边框分开。 */
function zoneStyle(zone: PianoZone) {
  const left = (zone.firstWhite / WHITE_TOTAL) * 100;
  const width = (zone.whiteCount / WHITE_TOTAL) * 100;
  return { left: `calc(${left}% + 1px)`, width: `calc(${width}% - 2px)` };
}

function pctOfWhite(index: number, offset = 0.5) {
  return `${((index + offset) / WHITE_TOTAL) * 100}%`;
}

/* ── 缩略图 / 视窗滑块 / 音区导航 ──────────────────────────────────── */

const scroller = ref<HTMLElement | null>(null);
const scrollX = ref(0);
const measuredWidth = ref(0);
const measuredContent = ref(0);
/** 缩略图在静止时压暗，滑动或选中音区时提亮（对齐迁移前练习器的行为）。 */
const thumbnailActive = ref(false);
/** 刚点过的音区，短暂显示更明显的选区框；用户手动滑动立即消失。 */
const selectedZoneId = ref<number | null>(null);

let idleTimer: ReturnType<typeof setTimeout> | null = null;
let selectedTimer: ReturnType<typeof setTimeout> | null = null;
/** 程序触发的滚动（点音区/数字键）不清选区框；用时间戳扛住平滑滚动的连续事件。 */
let programmaticAt = 0;

const contentWidth = computed(() => measuredContent.value || whites.length * KEY_PITCH);
const viewPortWidth = computed(() => measuredWidth.value || contentWidth.value * 0.45);

/** 毛玻璃滑块：按「可见范围 / 全宽」定宽，按滚动位置定位。 */
const viewportStyle = computed(() => {
  const width = Math.min(100, (viewPortWidth.value / contentWidth.value) * 100);
  const left = Math.min(100 - width, (scrollX.value / contentWidth.value) * 100);
  return { left: `${left}%`, width: `${width}%` };
});

function syncViewport(): void {
  const el = scroller.value;
  if (!el) return;
  scrollX.value = el.scrollLeft;
  measuredWidth.value = el.clientWidth;
  measuredContent.value = el.scrollWidth;
}

function scrollToLeft(left: number): void {
  const el = scroller.value;
  if (!el) return;
  const next = clampScroll(left, contentWidth.value, viewPortWidth.value);
  el.scrollLeft = next;
  syncViewport();
  // 没有布局的环境（测试 / SSR）里 scrollLeft 会被夹回 0，用目标值兜底，
  // 免得滑块跳回最左边。
  if (Math.abs(el.scrollLeft - next) > 1) scrollX.value = next;
}

/** 立即把某个音区滚到可视区中间（迁移前练习器同样是「立即跳转」，不做平滑）。 */
function focusZone(id: number): void {
  const zone = zoneById(id);
  programmaticAt = Date.now();
  scrollToLeft(zoneScrollTarget(zone, KEY_PITCH, viewPortWidth.value));
  markActivity();
  if (selectedTimer) clearTimeout(selectedTimer);
  selectedZoneId.value = zone.id;
  selectedTimer = setTimeout(() => {
    selectedZoneId.value = null;
    selectedTimer = null;
  }, 900);
}

function markActivity(): void {
  thumbnailActive.value = true;
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    thumbnailActive.value = false;
    idleTimer = null;
  }, 700);
}

/** 点音区：只定位，不发声、不作答。 */
function selectZone(zone: PianoZone): void {
  if (activeZone.value === zone.id) focusZone(zone.id); // 已经是激活音区，手动补一次定位
  else setActiveZone(zone.id); // 交给 activeZone 的 watcher 统一滚动
}

function onScroll(): void {
  const programmatic = Date.now() - programmaticAt < 150;
  syncViewport();
  markActivity();
  if (programmatic) return;
  selectedZoneId.value = null;
  if (selectedTimer) {
    clearTimeout(selectedTimer);
    selectedTimer = null;
  }
}

/** 把某个音滚进视野（已经可见就不动，避免练琴时来回跳）。 */
function revealMidi(midi: number): void {
  const slot = slotForMidi(midi);
  const left = slot * KEY_PITCH;
  const right = left + WHITE_W;
  const margin = KEY_PITCH * 2;
  if (left >= scrollX.value + margin && right <= scrollX.value + viewPortWidth.value - margin) return;
  scrollToLeft(left - (viewPortWidth.value - WHITE_W) / 2);
}

function onWheel(event: WheelEvent): void {
  if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return; // 横向滚动交给浏览器
  event.preventDefault();
  scrollToLeft(scrollX.value + event.deltaY);
}

// 高亮音换了：键盘图自动把音区调到位并滚到看得见的地方。
watch(
  () => props.highlightMidi,
  async (midi) => {
    if (midi == null) return;
    followMidi(midi);
    await nextTick();
    revealMidi(midi);
  },
  { immediate: true },
);

// 音区被数字键或缩略图切换时：上下联动 + 提亮缩略图 + 闪一下选区框。
watch(activeZone, (id) => {
  if (!scroller.value) return;
  focusZone(id);
});

/* ── 点拨 / 触摸弹奏 ───────────────────────────────────────────────── */

const pressedMidis = ref<number[]>([]);
let pointerActive = false;

function isPressed(midi: number): boolean {
  return pressedMidis.value.includes(midi) || heldKeyMidis.value.includes(midi);
}

function startNote(midi: number): void {
  if (pressedMidis.value.includes(midi)) return;
  pressedMidis.value = [...pressedMidis.value, midi];
  keyToneOn(midi);
  emit("note", { midi, timeMs: performance.now(), kind: "on", source: "screen" });
}

function stopNote(midi: number): void {
  if (!pressedMidis.value.includes(midi)) return;
  pressedMidis.value = pressedMidis.value.filter((item) => item !== midi);
  keyToneOff(midi);
  emit("note", { midi, timeMs: performance.now(), kind: "off", source: "screen" });
}

const isMouse = (event: PointerEvent) => event.pointerType === "mouse" || event.pointerType === "";

function onPointerDown(event: PointerEvent, midi: number): void {
  if (event.pointerType === "mouse" && event.button > 0) return;
  event.preventDefault();
  pointerActive = true;
  startNote(midi);
}

/** 按住拖动时滑过相邻琴键就换音，像手指在琴键上滑奏。只在鼠标上启用：
 *  触摸的手势要留给「横划平移键盘 / 竖划滚页面」。 */
function onPointerEnter(event: PointerEvent, midi: number): void {
  if (!pointerActive || !isMouse(event)) return;
  if (event.buttons === 0) {
    endPointer();
    return;
  }
  for (const held of [...pressedMidis.value]) {
    if (held !== midi) stopNote(held);
  }
  startNote(midi);
}

/** 指针离开某个键（滑奏到下一个键，或滑出键盘）就收掉这个音。 */
function onPointerLeave(midi: number): void {
  stopNote(midi);
}

function endPointer(): void {
  pointerActive = false;
  for (const midi of [...pressedMidis.value]) stopNote(midi);
}

let resizeObserver: ResizeObserver | null = null;

onMounted(() => {
  syncViewport();
  // 打开时先对准正在弹的那个音（没有目标音就对当前音区），
  // 窄屏上这决定了左手五指位会不会被裁掉一半。
  const midi = props.highlightMidi;
  if (midi != null) {
    scrollToLeft(slotForMidi(midi) * KEY_PITCH - (viewPortWidth.value - WHITE_W) / 2);
  } else {
    scrollToLeft(zoneScrollTarget(zoneById(activeZone.value), KEY_PITCH, viewPortWidth.value));
  }
  if (typeof ResizeObserver !== "undefined" && scroller.value) {
    resizeObserver = new ResizeObserver(() => syncViewport());
    resizeObserver.observe(scroller.value);
  }
  window.addEventListener("resize", syncViewport);
  window.addEventListener("pointerup", endPointer);
  window.addEventListener("pointercancel", endPointer);
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;
  if (idleTimer) clearTimeout(idleTimer);
  if (selectedTimer) clearTimeout(selectedTimer);
  window.removeEventListener("resize", syncViewport);
  window.removeEventListener("pointerup", endPointer);
  window.removeEventListener("pointercancel", endPointer);
  for (const midi of pressedMidis.value) {
    emit("note", { midi, timeMs: performance.now(), kind: "off", source: "screen" });
  }
  pressedMidis.value = [];
  keyToneStopAll();
});
</script>

<template>
  <div
    class="piano"
    data-test="keyboard"
    :data-keyboard-mode="String(keyboardMode)"
    :data-zone="String(activeZone)"
  >
    <!-- 上部：迷你键盘 + 7 个音区 + 毛玻璃视窗滑块（点音区只定位，不发声） -->
    <div
      class="overview"
      :class="{ 'is-active': thumbnailActive }"
      data-test="keyboard-zones"
      role="group"
      aria-label="钢琴音区导航"
    >
      <div class="mini" aria-hidden="true">
        <span v-for="(midi, slot) in whites" :key="`mw${midi}`" class="mini-white" :style="miniWhiteStyle(slot)" />
        <span v-for="key in blacks" :key="`mb${key.midi}`" class="mini-black" :style="miniBlackStyle(key.slot)" />
      </div>
      <span v-for="mark in C_MARKS" :key="`mc${mark.midi}`" class="mini-c" :style="{ left: pctOfWhite(mark.whiteIndex) }" aria-hidden="true">
        {{ mark.label }}
      </span>

      <button
        v-for="zone in ZONES"
        :key="zone.id"
        type="button"
        class="zone"
        :class="{ 'is-active': zone.id === activeZone, 'is-selected': zone.id === selectedZoneId }"
        :data-zone="zone.id"
        :style="zoneStyle(zone)"
        :aria-pressed="zone.id === activeZone ? 'true' : 'false'"
        :aria-label="`音区 ${zone.id}：${zone.name}`"
        @click="selectZone(zone)"
      >
        <span class="zone-name">{{ zone.name }}</span>
        <span v-if="keyboardMode" class="zone-key" aria-hidden="true">{{ zone.id }}</span>
      </button>

      <div
        class="viewport"
        :class="{ 'is-visible': thumbnailActive }"
        data-test="keyboard-viewport"
        :style="viewportStyle"
        aria-hidden="true"
      />
    </div>

    <!-- 下部：全尺寸琴键，横向滚动；点拨 / 触摸即发声 -->
    <div ref="scroller" class="keys" data-test="keyboard-keys" @scroll.passive="onScroll" @wheel="onWheel">
      <div class="keys-inner">
        <div
          v-for="midi in whites"
          :key="midi"
          class="white-key"
          :class="{ 'is-target': midi === highlightMidi, 'is-down': isPressed(midi) }"
          :data-midi="midi"
          @pointerdown="onPointerDown($event, midi)"
          @pointerenter="onPointerEnter($event, midi)"
          @pointerup="endPointer"
          @pointerleave="onPointerLeave(midi)"
          @pointercancel="endPointer"
        >
          <span v-if="caps.get(midi)" class="key-cap">{{ caps.get(midi) }}</span>
        </div>
        <div
          v-for="key in blacks"
          :key="key.midi"
          class="black-key"
          :class="{ 'is-target': key.midi === highlightMidi, 'is-down': isPressed(key.midi) }"
          :data-midi="key.midi"
          :style="{ '--slot': String(key.slot) }"
          @pointerdown="onPointerDown($event, key.midi)"
          @pointerenter="onPointerEnter($event, key.midi)"
          @pointerup="endPointer"
          @pointerleave="onPointerLeave(key.midi)"
          @pointercancel="endPointer"
        >
          <span v-if="caps.get(key.midi)" class="key-cap">{{ caps.get(key.midi) }}</span>
        </div>

        <!-- C 标注条：每个 C 写在琴键正下方，中央 C 加重 -->
        <div class="labels" aria-hidden="true">
          <span
            v-for="mark in C_MARKS"
            :key="`lc${mark.midi}`"
            class="c-label"
            :class="{ 'is-middle-c': mark.label === 'C4' }"
            :style="{ '--slot': String(mark.whiteIndex) }"
          >
            {{ mark.label }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.piano {
  --white-w: 38px;
  --key-gap: 2px;
  --black-w: 25px;
  --label-h: 16px;
  display: flex;
  flex-direction: column;
  gap: var(--pb-space-2);
  width: 100%;
  min-width: 0;
  user-select: none;
}

/* ── 缩略图：迷你键盘 + 7 个音区 ─────────────────────────────────── */

/* 三行：音区名（框内顶行）+ 迷你键盘 + C 标注；静止时压暗，滑动或选中音区时提亮 */
.overview {
  position: relative;
  height: 46px;
  opacity: 0.82;
  transition: opacity 0.18s ease;
}

.overview.is-active,
.overview:hover,
.overview:focus-within {
  opacity: 1;
}

/* 迷你键盘：白键铺满，黑键压在接缝上，全部按 slot 百分比定位 */
.mini {
  position: absolute;
  top: 12px;
  left: 0;
  right: 0;
  height: 22px;
  z-index: 0;
  overflow: hidden;
  border-radius: 0 0 4px 4px;
  background: rgb(15 38 32 / 45%);
}

.mini-white {
  position: absolute;
  top: 0;
  bottom: 0;
  box-sizing: border-box;
  border-right: 1px solid rgb(15 38 32 / 38%);
  background: rgb(242 238 226 / 94%);
}

.mini-black {
  position: absolute;
  top: 0;
  height: 13px;
  border-radius: 0 0 2px 2px;
  background: rgb(29 68 56 / 92%);
}

/* 缩略图上的 C 标注：在迷你键盘下方一行，缩略图和全尺寸琴键都能找到每个 C */
.mini-c {
  position: absolute;
  z-index: 3;
  top: 37px;
  color: rgb(242 238 226 / 58%);
  font-size: 0.5rem;
  line-height: 1;
  transform: translateX(-50%);
}

/* 音区框：浅色圆角矩形，框住音区名与这一段迷你键盘 */
.zone {
  position: absolute;
  z-index: 2;
  top: 0;
  height: 34px;
  padding: 0;
  border: 1px solid rgb(242 238 226 / 26%);
  border-radius: 7px;
  background: rgb(251 250 245 / 8%);
  color: rgb(242 238 226 / 62%);
  cursor: pointer;
  transition: border-color 0.16s ease, background 0.16s ease, color 0.16s ease;
}

/* 激活音区（D 键对应的那段）用金底金边，常驻 */
.zone.is-active {
  border-color: var(--pb-accent-2);
  background: rgb(201 164 92 / 26%);
  color: var(--pb-accent-2-strong);
}

/* 刚点过的音区：短暂更亮的选区框 */
.zone.is-selected {
  border-color: var(--pb-accent-2-strong);
  background: rgb(201 164 92 / 42%);
  color: var(--pb-ink);
  box-shadow: inset 0 0 0 1px rgb(255 255 255 / 18%);
}

/* 触屏不要粘住 hover 态，只在精确指针上给悬停反馈 */
@media (hover: hover) and (pointer: fine) {
  .zone:hover,
  .zone:focus-visible {
    border-color: var(--pb-accent-2-strong);
    background: rgb(201 164 92 / 34%);
    color: var(--pb-ink);
    outline: none;
  }
}

.zone-name {
  position: absolute;
  top: 1px;
  right: 0;
  left: 0;
  overflow: hidden;
  font-size: 0.5rem;
  font-weight: 600;
  line-height: 1;
  text-align: center;
  white-space: nowrap;
}

.zone-key {
  position: absolute;
  right: 3px;
  bottom: 1px;
  font-size: 0.45rem;
  line-height: 1;
  opacity: 0.6;
}

/* 毛玻璃滑块：代表全尺寸键盘当前显示的窗口。
   静止时只留一层很淡的底，滚动/切换音区时才提亮。 */
.viewport {
  position: absolute;
  z-index: 1;
  top: 0;
  bottom: 0;
  border: 1px solid rgb(242 238 226 / 45%);
  border-radius: 8px;
  background: rgb(251 250 245 / 9%);
  pointer-events: none;
  opacity: 0.72;
  backdrop-filter: blur(3px) saturate(1.1);
  -webkit-backdrop-filter: blur(3px) saturate(1.1);
  transition: left 0.08s linear, width 0.08s linear, opacity 0.14s ease, border-color 0.14s ease,
    background 0.14s ease, box-shadow 0.14s ease;
}

.viewport.is-visible {
  border-color: rgb(242 238 226 / 82%);
  background: rgb(251 250 245 / 18%);
  box-shadow: 0 2px 10px rgb(0 0 0 / 22%), inset 0 1px 0 rgb(255 255 255 / 20%);
  opacity: 1;
}

/* ── 全尺寸琴键 ──────────────────────────────────────────────────── */
.keys {
  position: relative;
  width: 100%;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: thin;
  scrollbar-color: rgb(242 238 226 / 32%) transparent;
}

.keys::-webkit-scrollbar {
  height: 8px;
}

.keys::-webkit-scrollbar-thumb {
  border-radius: var(--pb-radius-pill);
  background: rgb(242 238 226 / 32%);
}

.keys-inner {
  position: relative;
  display: flex;
  align-items: flex-end;
  gap: var(--key-gap);
  width: max-content;
  padding-bottom: var(--label-h);
}

.white-key {
  position: relative;
  flex: 0 0 var(--white-w);
  width: var(--white-w);
  height: 160px;
  box-sizing: border-box;
  background: var(--pb-key-white);
  border: 1px solid var(--pb-key-gap);
  border-radius: 0 0 4px 4px;
  box-shadow: inset 0 -2px 0 rgb(0 0 0 / 12%);
  /* 触摸：轻点即发声，横划交给浏览器平移键盘、竖划滚页面 */
  touch-action: manipulation;
  cursor: pointer;
}

.black-key {
  position: absolute;
  top: 0;
  left: calc(
    var(--slot) * (var(--white-w) + var(--key-gap)) + var(--white-w) + var(--key-gap) / 2 - var(--black-w) / 2
  );
  z-index: 1;
  width: var(--black-w);
  height: 100px;
  box-sizing: border-box;
  background: var(--pb-key-black);
  border: 1px solid var(--pb-key-gap);
  border-radius: 0 0 3px 3px;
  box-shadow: inset 0 -2px 0 rgb(0 0 0 / 35%);
  touch-action: manipulation;
  cursor: pointer;
}

/* 按下的键（鼠标 / 触摸 / 电脑键盘）用金色系压深，和「当前音」的高亮区分开 */
.white-key.is-down {
  background: var(--pb-accent-2-strong);
}

.black-key.is-down {
  background: var(--pb-accent-2);
}

/* 按压态用金色系：白键浅金、黑键深金，键帽文字同步转深绿保证可读 */
.white-key.is-target {
  background: var(--pb-accent-2);
}

.black-key.is-target {
  background: var(--pb-accent-2-strong);
}

.white-key.is-target .key-cap,
.black-key.is-target .key-cap,
.white-key.is-down .key-cap,
.black-key.is-down .key-cap {
  color: var(--pb-accent-text);
}

/* 电脑键位标注：白键深灰绿，黑键亮金（规范 §4.5） */
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

/* C 标注条：锁在每个白键正下方，中央 C 加重 */
.labels {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  height: var(--label-h);
  pointer-events: none;
}

.c-label {
  position: absolute;
  bottom: 3px;
  left: calc(var(--slot) * (var(--white-w) + var(--key-gap)) + var(--white-w) / 2);
  transform: translateX(-50%);
  color: rgb(242 238 226 / 64%);
  font-size: 0.6rem;
  font-weight: 600;
  line-height: 1;
}

/* 中央 C 是这套课程的原点，标得比其他 C 重一档 */
.c-label.is-middle-c {
  color: var(--pb-accent-2-strong);
  font-weight: 700;
}
</style>
