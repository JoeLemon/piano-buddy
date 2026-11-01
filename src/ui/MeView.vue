<script setup lang="ts">
import { computed, ref } from "vue";
import { canEnterSight, practiceStatsTotals, type Profile } from "../domain/profile";
import {
  formatClock,
  formatMinutes,
  practiceHistory,
  practiceSummary,
} from "../domain/practiceLog";
import { buildPracticeMetrics, metricsFilename } from "../domain/metrics";
import { backupFilename, exportProfileBackup, parseProfileBackup } from "../storage/backup";
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
  "replace-profile": [profile: Profile];
}>();

const l3Total = L3_PREP_LESSONS.length;
const practice = computed(() => practiceSummary(props.profile));
/** 最近 7 天的逐条记录：汇总数字回答「练了多少」，这里回答「练了什么」。 */
const history = computed(() => practiceHistory(props.profile, 7));
/** 最近 30 天的本地指标；只读档案，不上传。 */
const metrics = computed(() => buildPracticeMetrics(props.profile));

const backupInput = ref<HTMLInputElement | null>(null);
const backupError = ref("");
const backupNotice = ref("");
const metricsError = ref("");
const metricsNotice = ref("");
const pendingProfile = ref<Profile | null>(null);
const pendingSummary = computed(() => {
  const next = pendingProfile.value;
  if (!next) return "";
  return `${next.practiceLog.length} 条练习记录 · ${next.assessment ? "已完成自评" : "未完成自评"}`;
});

function pickBackup() {
  backupInput.value?.click();
}

async function onBackupFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  backupError.value = "";
  backupNotice.value = "";
  pendingProfile.value = null;
  try {
    const result = parseProfileBackup(await file.text());
    if (!result.ok) {
      backupError.value = result.errors.join("；");
      return;
    }
    pendingProfile.value = result.profile;
  } catch (error) {
    backupError.value = error instanceof Error ? error.message : "读取档案失败";
  } finally {
    input.value = "";
  }
}

function confirmBackup() {
  if (!pendingProfile.value) return;
  emit("replace-profile", pendingProfile.value);
  backupNotice.value = "已导入学习档案。";
  backupError.value = "";
  pendingProfile.value = null;
}

function cancelBackup() {
  pendingProfile.value = null;
  backupNotice.value = "";
}

function downloadBackup() {
  backupError.value = "";
  backupNotice.value = "";
  try {
    const text = exportProfileBackup(props.profile);
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = backupFilename();
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    // 立刻 revoke 在部分浏览器会打断下载，等一拍再释放。
    if (typeof URL.revokeObjectURL === "function") {
      setTimeout(() => URL.revokeObjectURL(url), 0);
    }
    backupNotice.value = "已导出学习档案。";
  } catch (error) {
    backupError.value = error instanceof Error ? error.message : "导出档案失败";
  }
}

function downloadMetrics() {
  metricsError.value = "";
  metricsNotice.value = "";
  try {
    const text = JSON.stringify(metrics.value, null, 2);
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = metricsFilename();
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    if (typeof URL.revokeObjectURL === "function") {
      setTimeout(() => URL.revokeObjectURL(url), 0);
    }
    metricsNotice.value = "已导出练习指标。";
  } catch (error) {
    metricsError.value = error instanceof Error ? error.message : "导出指标失败";
  }
}

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

const practiceRows = computed(() => {
  const stats = practiceStatsTotals(props.profile.practiceStats);
  const quiz =
    stats.answered === 0
      ? "还没答过"
      : `共 ${stats.answered} 题 · 正确率 ${Math.round((stats.correct / stats.answered) * 100)}%`;
  return [
    { label: "今日练习", value: `${practice.value.todayCount} 条 · ${formatMinutes(practice.value.todayMs)}` },
    { label: "连续练习", value: `${practice.value.streak} 天` },
    { label: "累计练习", value: `${practice.value.totalCount} 条 · ${formatMinutes(practice.value.totalMs)}` },
    { label: "乐理答题", value: quiz },
  ];
});

const metricsRows = computed(() => {
  const gap = metrics.value.gapHitRate;
  return [
    {
      label: "近 30 天练习",
      value: `${metrics.value.practice.sessions} 段 · ${formatMinutes(metrics.value.practice.durationMs)}`,
    },
    {
      label: "放弃点",
      value: metrics.value.practice.abandoned === 0
        ? "还没有中断记录"
        : `${metrics.value.abandonPoints.length} 类 · ${metrics.value.practice.abandoned} 段`,
    },
    {
      label: "缺口命中率",
      value: gap.rate === null
        ? "还没有重练记录"
        : `${Math.round(gap.rate * 100)}%（${gap.onCount}/${gap.total} 槽位）`,
    },
  ];
});
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

    <section class="section" data-test="me-history">
      <h2>最近练习</h2>
      <p v-if="history.length === 0" class="muted" data-test="me-history-empty">
        还没有练习记录。
      </p>
      <ol v-else class="history">
        <li
          v-for="day in history"
          :key="day.day"
          class="history-day"
          data-test="me-history-day"
          :data-day="day.day"
        >
          <div class="history-head">
            <strong>{{ day.label }}</strong>
            <small>{{ day.entries.length }} 条 · {{ formatMinutes(day.ms) }}</small>
          </div>
          <ul>
            <li
              v-for="(entry, index) in day.entries"
              :key="`${entry.at}-${index}`"
              data-test="me-history-entry"
            >
              <span class="clock">{{ formatClock(entry.at) }}</span>
              <span>{{ entry.label }}</span>
              <small>{{ formatMinutes(entry.ms) }}</small>
            </li>
          </ul>
        </li>
      </ol>
    </section>

    <section class="section" data-test="me-metrics">
      <h2>练习指标</h2>
      <dl class="stats">
        <div v-for="row in metricsRows" :key="row.label" class="stat">
          <dt>{{ row.label }}</dt>
          <dd>{{ row.value }}</dd>
        </div>
      </dl>
      <div v-if="metrics.abandonPoints.length > 0" class="metrics-list" data-test="me-metrics-abandons">
        <h3>最常中断</h3>
        <ul>
          <li v-for="point in metrics.abandonPoints.slice(0, 3)" :key="point.key">
            <span>{{ point.label }} · {{ point.focus ?? point.screen ?? "未标注" }}</span>
            <small>{{ point.sessions }} 次 · 平均 {{ formatMinutes(point.averageMs) }}</small>
          </li>
        </ul>
      </div>
      <p class="muted backup-hint">
        指标只在本机生成，不上传。缺口命中率统计错题重练，以及曲库里还没弹对的分段跟弹。
      </p>
      <div class="actions">
        <button type="button" class="quiet" data-test="me-metrics-export" @click="downloadMetrics">
          导出练习指标
        </button>
      </div>
      <p v-if="metricsError" class="backup-error" data-test="me-metrics-error">{{ metricsError }}</p>
      <p v-if="metricsNotice" class="backup-notice" data-test="me-metrics-notice">
        {{ metricsNotice }}
      </p>
    </section>

    <section class="section" data-test="me-backup">
      <h2>学习档案</h2>
      <p class="muted backup-hint">
        导出的 JSON 只包含学习进度、练习记录和技能账本，不包含外部曲库包。
        换设备时在新设备导入即可；导入会覆盖当前档案，确认前不会写入。
      </p>
      <div class="actions">
        <button type="button" class="primary" data-test="me-backup-export" @click="downloadBackup">
          导出学习档案
        </button>
        <button type="button" class="quiet" data-test="me-backup-pick" @click="pickBackup">
          导入学习档案
        </button>
        <input
          ref="backupInput"
          type="file"
          class="file-input"
          data-test="me-backup-file"
          accept=".json,application/json"
          @change="onBackupFile"
        />
      </div>
      <p v-if="backupError" class="backup-error" data-test="me-backup-error">{{ backupError }}</p>
      <p v-if="backupNotice" class="backup-notice" data-test="me-backup-notice">
        {{ backupNotice }}
      </p>
      <div v-if="pendingProfile" class="backup-pending" data-test="me-backup-pending">
        <p>将用导入的档案覆盖当前进度：{{ pendingSummary }}</p>
        <div class="actions">
          <button type="button" class="primary" data-test="me-backup-confirm" @click="confirmBackup">
            确认覆盖
          </button>
          <button type="button" class="quiet" data-test="me-backup-cancel" @click="cancelBackup">
            取消
          </button>
        </div>
      </div>
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

.history {
  display: grid;
  gap: var(--pb-space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.history-day {
  padding: var(--pb-space-3) var(--pb-space-4);
  border: 1px solid var(--pb-border-soft);
  border-radius: var(--pb-radius);
  background: var(--pb-surface);
}

.history-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--pb-space-2);
}

.history-head small,
.history li small,
.history .clock {
  color: var(--pb-muted);
  font-size: 0.78rem;
}

.history ul {
  display: grid;
  gap: 0.25rem;
  margin: 0.5rem 0 0;
  padding: 0;
  list-style: none;
}

.history ul li {
  display: grid;
  grid-template-columns: 3.2rem 1fr auto;
  align-items: baseline;
  gap: var(--pb-space-2);
  font-size: 0.85rem;
}

.metrics-list {
  padding: var(--pb-space-3) var(--pb-space-4);
  border: 1px solid var(--pb-border-soft);
  border-radius: var(--pb-radius);
  background: var(--pb-surface-2);
}

.metrics-list h3 {
  margin: 0 0 var(--pb-space-2);
  font-size: 0.85rem;
}

.metrics-list ul {
  display: grid;
  gap: 0.35rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.metrics-list li {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--pb-space-2);
  font-size: 0.82rem;
}

.metrics-list small {
  color: var(--pb-muted);
  font-size: 0.75rem;
}

.backup-hint {
  margin: 0;
  font-size: 0.8rem;
  line-height: 1.55;
}

.backup-error,
.backup-notice {
  margin: 0;
  font-size: 0.8rem;
  line-height: 1.5;
}

.backup-error {
  color: var(--pb-danger);
}

.backup-notice {
  color: var(--pb-ok);
}

.backup-pending {
  display: grid;
  gap: var(--pb-space-2);
  padding: var(--pb-space-3) var(--pb-space-4);
  border: 1px solid var(--pb-border-soft);
  border-radius: var(--pb-radius);
  background: var(--pb-surface-2);
}

.backup-pending p {
  margin: 0;
  font-size: 0.85rem;
}

/* 原生 file input 保留在 DOM 里由按钮触发，避免两套外观 */
.file-input {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
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
