<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { audioAvailable, previewScore, type Playback } from "../audio/preview";
import type { NotePulse } from "../midi/types";
import { renderScore } from "../notation/renderScore";
import { melodyToScore } from "../practice/melodyPlayback";
import type { PlaybackQuestion } from "../practice/melodyTypes";
import {
  arpeggioScore,
  blockScore,
  scoreFromPracticeStaff,
  type PracticeStaffPrompt,
} from "../practice/practiceScore";
import MelodyFollow from "./MelodyFollow.vue";

/**
 * 练习题的谱面 + 试听。
 *
 * 所有题型都把谱面画出来：单音 / 音程 / 和弦 / 音型 / 进行题用 `staff`，
 * 旋律题的谱面由 `melodyStaff` 派生（主音和弦 + 分小节旋律），与试听
 * 音频同一份 IR。两者都复用现有的 `renderScore` 与 `previewScore`，
 * 不引入新的渲染管线。
 *
 * 试听有两种「织体」口径：和弦/进行题默认柱式、可听分解；分解和弦题
 * 默认分解、可听柱式。两个按钮放同一组音，帮学生听出「同一个和弦」
 * 与「织体不同」是两件事。
 */
const props = withDefaults(
  defineProps<{
    /** 需要画在谱面上的音；旋律题的谱面由 melodyStaff 派生，也走这里。 */
    staff?: PracticeStaffPrompt;
    /** 旋律听辨题的音频数据。 */
    melody?: PlaybackQuestion;
    /** 测试钩子前缀：practice / l3 / stage。 */
    prefix: string;
    bpm?: number;
    /** 先听再看时，答完前不显示谱面。 */
    showStaff?: boolean;
    /** 题目切换时自动播放（先听再看模式）。 */
    autoPlay?: boolean;
    /** 和弦/进行题显示「分解和弦」试听。 */
    chordListen?: boolean;
    /** 分解和弦题显示「柱式」试听（默认分解 → 听柱式）。 */
    blockListen?: boolean;
    /** 屏幕琴键按下的音符，转给旋律跟弹。 */
    pulse?: NotePulse | null;
  }>(),
  {
    staff: undefined,
    melody: undefined,
    bpm: undefined,
    showStaff: true,
    autoPlay: false,
    chordListen: false,
    blockListen: false,
    pulse: null,
  },
);

const staffEl = ref<HTMLElement | null>(null);
const localPlaying = ref(false);
let playback: Playback | null = null;

const audioReady = audioAvailable();

/** 谱面与音频共用同一份 Score，保证听到的和看到的是同一组音。 */
const score = computed(() => {
  if (props.melody) return melodyToScore(props.melody);
  if (props.staff) return scoreFromPracticeStaff(props.staff, props.prefix, props.bpm ?? 72);
  return null;
});

const arpeggio = computed(() => {
  if (!props.staff) return null;
  return arpeggioScore(props.staff, props.prefix, props.bpm ?? 72);
});

const block = computed(() => {
  if (!props.staff) return null;
  return blockScore(props.staff, props.prefix, props.bpm ?? 72);
});

const playLabel = computed(() => (props.melody ? "播放旋律" : "听一听"));

// 挂载后再画第一次；题目切换或「先听再看」揭晓时重画。
// 不把 staffEl 放进 watch：ref 赋值时机在不同渲染路径下不稳定，容易画出空谱。
onMounted(async () => {
  drawStaff();
  if (props.autoPlay) {
    await nextTick();
    play();
  }
});

watch(
  [() => props.staff, () => props.melody, () => props.showStaff],
  async () => {
    await nextTick();
    drawStaff();
  },
  { flush: "post" },
);

// 只在新题出现时自动播放；揭晓谱面（showStaff 变化）不重复播放。
watch(
  [() => props.staff, () => props.melody],
  async () => {
    if (!props.autoPlay) return;
    await nextTick();
    play();
  },
  { flush: "post" },
);

function drawStaff() {
  const element = staffEl.value;
  if (!element || !props.staff || !props.showStaff || !score.value) return;
  renderScore(element, score.value, "RH", false);
}

function play() {
  if (!score.value || !audioReady || localPlaying.value) return;
  stop();
  localPlaying.value = true;
  playback = previewScore(score.value, "RH", props.bpm ?? (props.melody ? 80 : 72), {
    onEnd: () => {
      localPlaying.value = false;
      playback = null;
    },
  });
}

function playArpeggio() {
  if (!arpeggio.value || !audioReady || localPlaying.value) return;
  stop();
  localPlaying.value = true;
  playback = previewScore(arpeggio.value, "RH", props.bpm ?? 72, {
    onEnd: () => {
      localPlaying.value = false;
      playback = null;
    },
  });
}

function playBlock() {
  if (!block.value || !audioReady || localPlaying.value) return;
  stop();
  localPlaying.value = true;
  playback = previewScore(block.value, "RH", props.bpm ?? 72, {
    onEnd: () => {
      localPlaying.value = false;
      playback = null;
    },
  });
}

function stop() {
  playback?.stop();
  playback = null;
  localPlaying.value = false;
}

onBeforeUnmount(stop);
</script>

<template>
  <div>
    <div v-if="staff && showStaff" ref="staffEl" class="staff" :data-test="`${prefix}-staff`"></div>

    <div v-if="score" class="audio-row">
      <button
        type="button"
        class="primary"
        :disabled="!audioReady || localPlaying"
        :data-test="`${prefix}-play`"
        @click="play"
      >
        {{ localPlaying ? "播放中…" : playLabel }}
      </button>
      <button
        v-if="chordListen"
        type="button"
        :disabled="!audioReady || localPlaying"
        :data-test="`${prefix}-arpeggio`"
        @click="playArpeggio"
      >
        分解
      </button>
      <button
        v-if="blockListen"
        type="button"
        :disabled="!audioReady || localPlaying"
        :data-test="`${prefix}-block`"
        @click="playBlock"
      >
        柱式
      </button>
      <button
        type="button"
        :disabled="!audioReady || !localPlaying"
        :data-test="`${prefix}-stop`"
        @click="stop"
      >
        停止
      </button>
      <span v-if="!audioReady" class="muted">当前浏览器没有可用的 Web Audio。</span>
    </div>

    <MelodyFollow v-if="melody" :melody="melody" :prefix="prefix" :pulse="pulse" />
  </div>
</template>

<style scoped>
.staff {
  margin: 0 0 var(--pb-space-3);
}

.audio-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--pb-space-2);
  margin: 0 0 var(--pb-space-3);
}

.primary {
  padding: 0.5rem 0.9rem;
  border: 1px solid var(--pb-accent-2);
  border-radius: var(--pb-radius);
  background: var(--pb-accent-2);
  color: var(--pb-accent-text);
  cursor: pointer;
}

.primary:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.audio-row button:not(.primary) {
  padding: 0.45rem 0.8rem;
  border: 1px solid var(--pb-border);
  border-radius: var(--pb-radius);
  background: var(--pb-surface);
  color: var(--pb-ink);
  cursor: pointer;
}

.muted {
  color: var(--pb-muted);
  font-size: 0.85rem;
}
</style>
