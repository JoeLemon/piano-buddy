<script setup lang="ts">
import { computed } from "vue";
import type { Profile } from "../domain/profile";
import { learningPath } from "../domain/nextStep";
import { L3_PREP_LESSONS } from "../practice";

/**
 * 「学习」分区落地页。
 *
 * 这里只放有先后顺序的课程线：识谱主线（L1 认谱 → L2 双手）、L3 和弦识谱课、
 * L3 乐理预备课。乐理题组、主线闯关、视奏这些随时可做的内容属于「练习」，
 * 不在本页出现；过关测试是识谱主线上的流程节点，由 App 按档案状态自动接入，
 * 也不做独立入口。
 */
const props = defineProps<{
  profile: Profile;
}>();

const emit = defineEmits<{
  "open-reading": [];
  "open-l3-reading": [];
  "open-l3": [];
}>();

/** 四段路径只用于判断当前学到哪，本页不重复画时间线。 */
const path = computed(() => learningPath(props.profile));
const l1Stage = computed(() => path.value.find((stage) => stage.id === "L1"));
const l2Stage = computed(() => path.value.find((stage) => stage.id === "L2"));
const l2Done = computed(() => props.profile.l2Passed);
const l3Done = computed(() => props.profile.l3PrepCompleted.length);
const l3Total = L3_PREP_LESSONS.length;
const l3ReadingDone = computed(() => props.profile.l3Passed);
const l3ReadingStarted = computed(() => props.profile.lessonId?.startsWith("L3R") ?? false);

/** 识谱主线的状态文案：只写当前所处的那一段，不列全程。 */
const readingState = computed(() => {
  if (l2Done.value) return "L1 / L2 已过关";
  if (l1Stage.value?.state === "done" || l2Stage.value?.state === "current") return "正在学 L2";
  return l1Stage.value?.state === "current" ? "正在学 L1" : "待开始";
});

/** 已过 L2 时点进去是回看最后一课，而不是重新考试。 */
const readingCta = computed(() => {
  if (l2Done.value) return "回看 L2";
  return props.profile.lessonId ? "继续当前课" : "开始第一课";
});

const l3ReadingState = computed(() => {
  if (l3ReadingDone.value) return "已过关";
  if (l3ReadingStarted.value) return "正在学";
  if (l2Done.value) return "可以开始";
  return "先过 L2";
});

const l3ReadingCta = computed(() => {
  if (l3ReadingDone.value) return "回看 L3";
  if (l3ReadingStarted.value) return "继续 L3 和弦";
  return "开始 L3 和弦";
});
</script>

<template>
  <div class="surface learn" data-test="learn">
    <h1>学习</h1>

    <div class="lines">
      <section class="line" data-test="learn-reading-line">
        <header class="line-head">
          <h2>识谱主线</h2>
          <span class="state" data-test="learn-reading-state">{{ readingState }}</span>
        </header>
        <p class="desc">L1 认谱 → L2 八分音符与双手 → 过关测试。</p>
        <button type="button" class="primary" data-test="learn-reading" @click="emit('open-reading')">
          {{ readingCta }}
        </button>
      </section>

      <section class="line" data-test="learn-l3-reading-line">
        <header class="line-head">
          <h2>L3 和弦</h2>
          <span class="state" data-test="learn-l3-reading-state">{{ l3ReadingState }}</span>
        </header>
        <p class="desc">双音 → 右手三和弦 → 左手三和弦 → 临时升降 → L3 过关。</p>
        <button
          type="button"
          class="primary"
          data-test="learn-l3-reading"
          :disabled="!l2Done"
          @click="emit('open-l3-reading')"
        >
          {{ l3ReadingCta }}
        </button>
      </section>

      <section class="line" data-test="learn-l3-line">
        <header class="line-head">
          <h2>乐理预备课</h2>
          <span class="state" data-test="learn-l3-state">{{ l3Done }}/{{ l3Total }} 节</span>
        </header>
        <p class="desc">单音 / 符号 / 音程 / 和弦 / 进行 / 音型 / 听调性。</p>
        <button type="button" class="primary" data-test="learn-l3" @click="emit('open-l3')">
          {{ l3Done > 0 ? "继续 L3 预备课" : "进入 L3 预备课" }}
        </button>
      </section>
    </div>
  </div>
</template>

<style scoped>
.learn {
  display: flex;
  flex-direction: column;
  gap: var(--pb-space-4);
}

.learn h1 {
  margin: 0;
}

.lines {
  display: grid;
  gap: var(--pb-space-3);
}

@media (min-width: 760px) {
  /* 宽屏并排三条课程线；窄屏仍然单列，避免卡片被压成一条字 */
  .lines {
    grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
    gap: var(--pb-space-4);
  }
}

.line {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--pb-space-2);
  padding: var(--pb-space-4);
  border: 1px solid var(--pb-border-soft);
  border-radius: var(--pb-radius);
  background: var(--pb-surface);
}

.line-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--pb-space-3);
  width: 100%;
}

.line-head h2 {
  margin: 0;
  font-size: 1rem;
}

.state {
  padding: 0.05rem 0.4rem;
  border-radius: var(--pb-radius-sm);
  background: var(--pb-accent-2-soft);
  color: var(--pb-accent-2-strong);
  font-size: 0.75rem;
  white-space: nowrap;
}

.desc {
  margin: 0;
  color: var(--pb-muted);
  font-size: 0.85rem;
  line-height: 1.5;
}

.primary {
  margin-top: auto;
  padding: 0.5rem 0.9rem;
  border: 1px solid var(--pb-accent-2);
  border-radius: var(--pb-radius);
  background: var(--pb-accent-2);
  color: var(--pb-accent-text);
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
}

.primary:disabled {
  opacity: 0.55;
  cursor: default;
}
</style>
