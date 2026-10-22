<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { audioAvailable, previewScore, type Playback } from "../audio/preview";
import { renderScore } from "../notation/renderScore";
import { melodyToScore } from "../practice/melodyPlayback";
import type { PlaybackQuestion } from "../practice/melodyTypes";
import { scoreFromPracticeStaff, type PracticeStaffPrompt } from "../practice/practiceScore";

/**
 * 练习题的谱面 + 试听。
 *
 * 单音 / 音程 / 和弦 / 音型题把谱面画出来，旋律题只提供播放；
 * 两者都复用现有的 `renderScore` 与 `previewScore`，不引入新的渲染管线。
 */
const props = withDefaults(
  defineProps<{
    /** 需要画在谱面上的音；旋律题没有谱面。 */
    staff?: PracticeStaffPrompt;
    /** 旋律听辨题的音频数据。 */
    melody?: PlaybackQuestion;
    /** 测试钩子前缀：practice / l3 / stage。 */
    prefix: string;
    bpm?: number;
  }>(),
  { staff: undefined, melody: undefined, bpm: undefined },
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

const playLabel = computed(() => (props.melody ? "播放旋律" : "听一听"));

// 挂载后再画第一次；题目切换时按 staff / melody 的变化重画。
// 不把 staffEl 放进 watch：ref 赋值时机在不同渲染路径下不稳定，容易画出空谱。
onMounted(drawStaff);

watch(
  [() => props.staff, () => props.melody],
  async () => {
    await nextTick();
    drawStaff();
  },
  { flush: "post" },
);

function drawStaff() {
  const element = staffEl.value;
  if (!element || !props.staff || !score.value) return;
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

function stop() {
  playback?.stop();
  playback = null;
  localPlaying.value = false;
}

onBeforeUnmount(stop);
</script>

<template>
  <div>
    <div v-if="staff" ref="staffEl" class="staff" :data-test="`${prefix}-staff`"></div>

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
        type="button"
        :disabled="!audioReady || !localPlaying"
        :data-test="`${prefix}-stop`"
        @click="stop"
      >
        停止
      </button>
      <span v-if="!audioReady" class="muted">当前浏览器没有可用的 Web Audio。</span>
    </div>
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

.muted {
  color: var(--pb-muted);
  font-size: 0.85rem;
}
</style>
