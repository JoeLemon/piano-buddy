<script setup lang="ts">
import { computed } from "vue";
import { canEnterSight, type Profile } from "../domain/profile";
import { formatMinutes, practiceSummary } from "../domain/practiceLog";
import { L3_PREP_LESSONS } from "../practice";

/**
 * 「我的」分区落地页。
 *
 * 原来散落在两处的个人入口收到这里：首页页脚的「重做三道自评」、顶栏的设置抽屉。
 * 顶栏齿轮仍然保留，作为任何页面都能触达的快捷方式；本页的设置按钮复用同一个抽屉，
 * 不复制第二套设置 UI。
 */
const props = defineProps<{
  profile: Profile;
}>();

const emit = defineEmits<{
  "open-placement": [];
  "open-settings": [];
}>();

const l3Total = L3_PREP_LESSONS.length;
const practice = computed(() => practiceSummary(props.profile));

/** 只手过关时的状态文案，和首页站姿保持一致。 */
function handText(): string {
  const right = props.profile.l1RightPassed ? "右手 ✓" : "右手待过";
  const left = props.profile.l1LeftPassed ? "左手 ✓" : "左手待过";
  return `${right} · ${left}`;
}

function l2Text(): string {
  if (props.profile.l2Passed) return "已过关";
  if (props.profile.l1RightPassed && props.profile.l1LeftPassed) return "未过关";
  return "未解锁";
}

function l3Text(): string {
  if (props.profile.l3Passed) return "已过关";
  if (props.profile.l2Passed) return "可以开始";
  return "未解锁";
}

const sightReady = computed(
  () => canEnterSight(props.profile, "RH") || canEnterSight(props.profile, "LH"),
);

/** 档案概览：只读、只列已经存在的事实，不改写任何状态。 */
const rows = computed(() => [
  { label: "自评", value: props.profile.assessment ? "已完成" : "未完成" },
  { label: "L1 认谱", value: handText() },
  { label: "L2 双手", value: l2Text() },
  { label: "L3 和弦", value: l3Text() },
  { label: "L3 预备", value: `${props.profile.l3PrepCompleted.length}/${l3Total}` },
  { label: "视奏", value: sightReady.value ? "已解锁" : "未解锁" },
]);

const practiceRows = computed(() => [
  { label: "今日练习", value: `${practice.value.todayCount} 条 · ${formatMinutes(practice.value.todayMs)}` },
  { label: "连续练习", value: `${practice.value.streak} 天` },
  { label: "累计练习", value: `${practice.value.totalCount} 条 · ${formatMinutes(practice.value.totalMs)}` },
]);
</script>

<template>
  <div class="surface me" data-test="me">
    <h1>我的</h1>

    <section class="section" data-test="me-practice">
      <h2>练习记录</h2>
      <dl class="stats">
        <div v-for="row in practiceRows" :key="row.label" class="stat">
          <dt>{{ row.label }}</dt>
          <dd>{{ row.value }}</dd>
        </div>
      </dl>
    </section>

    <section class="section">
      <h2>学习进度</h2>
      <dl class="stats" data-test="me-stats">
        <div v-for="row in rows" :key="row.label" class="stat">
          <dt>{{ row.label }}</dt>
          <dd>{{ row.value }}</dd>
        </div>
      </dl>
    </section>

    <div class="actions">
      <button type="button" class="primary" data-test="me-placement" @click="emit('open-placement')">
        {{ profile.assessment ? "重做三道自评" : "开始三道自评" }}
      </button>
      <button type="button" class="quiet" data-test="me-settings" @click="emit('open-settings')">
        打开设置
      </button>
    </div>
  </div>
</template>

<style scoped>
.me {
  display: flex;
  flex-direction: column;
  gap: var(--pb-space-4);
}

.me h1 {
  margin: 0;
}

.section {
  display: flex;
  flex-direction: column;
  gap: var(--pb-space-2);
}

.section h2 {
  margin: 0;
  font-size: 1rem;
}

.stats {
  display: grid;
  gap: 0;
  margin: 0;
  border: 1px solid var(--pb-border-soft);
  border-radius: var(--pb-radius);
  overflow: hidden;
}

.stat {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--pb-space-3);
  padding: var(--pb-space-3) var(--pb-space-4);
  background: var(--pb-surface);
}

.stat + .stat {
  border-top: 1px solid var(--pb-border-soft);
}

.stat dt {
  color: var(--pb-muted);
  font-size: 0.88rem;
}

.stat dd {
  margin: 0;
  color: var(--pb-ink);
  font-size: 0.88rem;
  font-weight: 600;
  text-align: right;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--pb-space-3);
}

.primary {
  padding: 0.5rem 0.9rem;
  border: 1px solid var(--pb-accent-2);
  border-radius: var(--pb-radius);
  background: var(--pb-accent-2);
  color: var(--pb-accent-text);
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
}

.quiet {
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--pb-muted);
  font-size: 0.85rem;
  text-decoration: underline;
  text-underline-offset: 0.2rem;
  cursor: pointer;
}
</style>
