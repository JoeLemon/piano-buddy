<script setup lang="ts">
import { computed } from "vue";
import {
  learningPath,
  nextAction,
  reviewAction,
  sightUnlocked,
  type NextAction,
} from "../domain/nextStep";
import { formatMinutes, practiceSummary } from "../domain/practiceLog";
import type { LessonId, Profile } from "../domain/profile";
import { routeForSkill } from "../domain/skillRoutes";

const props = defineProps<{
  profile: Profile;
  rightUnlocked: boolean;
  leftUnlocked: boolean;
}>();

const emit = defineEmits<{
  "open-reading": [];
  "open-l3-reading": [];
  "open-sight": [];
  "open-placement": [];
  "open-error": [];
  "open-lesson": [lessonId: LessonId];
  "open-theory": [lessonId: string];
  "open-stage": [stageId: string];
}>();

const action = computed(() => nextAction(props.profile));
const review = computed(() => reviewAction(props.profile));
const path = computed(() => learningPath(props.profile));
const bothLocked = computed(() => !props.rightUnlocked && !props.leftUnlocked);
const sightReady = computed(() => sightUnlocked(props.profile));
const hasErrors = computed(() => props.profile.errorSnippets.length > 0 && sightReady.value);
const errorCount = computed(() => props.profile.errorSnippets.length);
const practice = computed(() => practiceSummary(props.profile));
const todayDone = computed(() => practice.value.todayCount > 0);
const practiceLine = computed(
  () => `${practice.value.todayCount} 条 · ${formatMinutes(practice.value.todayMs)}`,
);

/** 主卡按钮的落点：课程/过关都走识谱，视奏走视奏，自评走自评。 */
function runAction(next: NextAction) {
  if (next.kind === "placement") {
    emit("open-placement");
    return;
  }
  if (next.kind === "sight") {
    emit("open-sight");
    return;
  }
  if (next.kind === "review") {
    // 复习落到第一个过期技能的微课；没有微课就回当前识谱课。
    const route = next.skillIds?.[0] ? routeForSkill(next.skillIds[0]) : null;
    if (route?.kind === "reading" || route?.kind === "l3") {
      emit("open-lesson", route.lessonId);
      return;
    }
    if (route?.kind === "theory") {
      emit("open-theory", route.lessonId);
      return;
    }
    if (route?.kind === "stage") {
      emit("open-stage", route.stageId);
      return;
    }
    emit("open-reading");
    return;
  }
  // L3 和弦课要走 L3 入口，不能复用 L2 的「回看最后一课」逻辑。
  if (next.kind === "lesson" && next.eyebrow === "L3 和弦") {
    emit("open-l3-reading");
    return;
  }
  emit("open-reading");
}

function openSight() {
  if (bothLocked.value) {
    emit("open-reading");
    return;
  }
  emit("open-sight");
}

function openReview() {
  const next = review.value;
  if (next) runAction(next);
}
</script>

<template>
  <div class="surface home" data-test="home-surface">
    <header class="hero">
      <h1>{{ action.title }}</h1>
      <p v-if="action.detail" class="lead">{{ action.detail }}</p>
      <p v-if="action.goal" class="goal" data-test="next-goal">{{ action.goal }}</p>
      <button
        type="button"
        class="cta"
        :data-test="action.kind === 'placement' ? 'placement' : 'next-cta'"
        @click="runAction(action)"
      >
        {{ action.cta }}
        <span aria-hidden="true">→</span>
      </button>
    </header>

    <div class="today-strip" :data-done="todayDone" data-test="today-status">
      <span class="today-state">{{ todayDone ? "今天已练过" : "今天还没开始" }}</span>
      <span data-test="today-count">{{ practiceLine }}</span>
      <span data-test="today-streak">连续 {{ practice.streak }} 天</span>
    </div>

    <section
      v-if="review && action.kind !== 'review'"
      class="review-reminder"
      data-test="review-reminder"
    >
      <div>
        <strong>{{ review.title }}</strong>
        <p>{{ review.detail }}</p>
      </div>
      <button type="button" class="review-cta" data-test="review-cta" @click="openReview">
        {{ review.cta }}
      </button>
    </section>

    <div class="dash">
      <section class="block">
        <h2 class="block-title">学习路径</h2>
        <ol class="rail" data-test="learning-path">
          <li
            v-for="stage in path"
            :key="stage.id"
            class="stage"
            :data-state="stage.state"
            :data-stage="stage.id"
          >
            <span class="marker" aria-hidden="true">{{ stage.state === "done" ? "✓" : stage.state === "current" ? "●" : "○" }}</span>
            <span class="stage-name">{{ stage.name }}</span>
            <span v-if="stage.caption" class="stage-caption">{{ stage.caption }}</span>
          </li>
        </ol>
      </section>

      <section class="block">
        <h2 class="block-title">今日练习</h2>
        <ul class="tools">
          <li>
            <button type="button" class="tool" data-test="sight" @click="openSight">
              <span class="tool-label">
                5 分钟视奏
                <span v-if="!sightReady" class="tag">未解锁</span>
              </span>
            </button>
          </li>
          <li>
            <button type="button" class="tool" data-test="reading" @click="emit('open-reading')">
              <span class="tool-label">先认谱</span>
            </button>
          </li>
          <li v-if="hasErrors">
            <button type="button" class="tool" data-test="error-book" @click="emit('open-error')">
              <span class="tool-label">
                错题重练
                <span class="tag">{{ errorCount }}</span>
              </span>
            </button>
          </li>
        </ul>
        <p v-if="bothLocked" class="note">视奏里只会用到已经认过的五个音，先把它们认准。</p>
      </section>
    </div>
  </div>
</template>

<style scoped>
.home {
  display: flex;
  flex-direction: column;
  gap: var(--pb-space-4);
}

/* ---------- 主卡：今天只推一件事 ---------- */

.hero {
  padding-bottom: var(--pb-space-4);
  border-bottom: 1px solid var(--pb-border-soft);
}

.hero h1 {
  margin: 0 0 var(--pb-space-2);
  font-size: clamp(1.4rem, 1.2rem + 1.2vw, 1.85rem);
}

.hero .lead {
  max-width: 38rem;
  margin-bottom: var(--pb-space-3);
}

.goal {
  display: flex;
  width: fit-content;
  margin: 0 0 var(--pb-space-3);
  padding: 0.2rem 0.6rem;
  border-radius: var(--pb-radius-pill);
  background: var(--pb-surface-2);
  color: var(--pb-ink-2);
  font-size: 0.82rem;
  font-variant-numeric: tabular-nums;
}

.cta {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.6rem 1.1rem;
  border: 1px solid var(--pb-accent-2);
  border-radius: var(--pb-radius);
  background: var(--pb-accent-2);
  color: var(--pb-accent-text);
  font-size: 0.95rem;
  font-weight: 600;
  cursor: pointer;
}

/* 今日完成态：不抢主卡的注意力，只把「今天有没有练」说清楚 */
.today-strip {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.4rem 0.75rem;
  margin: calc(var(--pb-space-3) * -1) 0 0;
  padding: 0.55rem 0.8rem;
  border: 1px solid var(--pb-border-soft);
  border-radius: var(--pb-radius);
  background: var(--pb-surface-2);
  color: var(--pb-muted);
  font-size: 0.82rem;
  font-variant-numeric: tabular-nums;
}

.today-strip[data-done="true"] {
  border-left: 3px solid var(--pb-ok);
}

.today-state {
  color: var(--pb-ink-2);
  font-weight: 600;
}

.today-strip[data-done="true"] .today-state {
  color: var(--pb-ok);
}

/* 复习提醒是副卡：不抢主卡的动作，但把「学过的东西放旧了」说清楚 */
.review-reminder {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--pb-space-2) var(--pb-space-3);
  padding: 0.65rem 0.8rem;
  border: 1px solid var(--pb-border-soft);
  border-left: 3px solid var(--pb-warn);
  border-radius: var(--pb-radius);
  background: var(--pb-surface-2);
}

.review-reminder strong {
  display: block;
  color: var(--pb-ink);
  font-size: 0.88rem;
}

.review-reminder p {
  margin: 0.2rem 0 0;
  color: var(--pb-muted);
  font-size: 0.8rem;
  line-height: 1.5;
}

.review-cta {
  flex: none;
  padding: 0.4rem 0.8rem;
  border: 1px solid var(--pb-accent-2);
  border-radius: var(--pb-radius);
  background: transparent;
  color: var(--pb-accent-2);
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
}

/* ---------- 两栏：路径 + 练法 ---------- */

.dash {
  display: grid;
  gap: var(--pb-space-5);
}

@media (min-width: 900px) {
  .dash {
    grid-template-columns: 15rem minmax(0, 1fr);
    gap: var(--pb-space-6);
    align-items: start;
  }
}

.block-title {
  margin: 0 0 var(--pb-space-2);
  font-family: var(--pb-font-body);
  font-size: 0.78rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  color: var(--pb-muted);
  text-transform: uppercase;
}

/* 竖排路径：一条线串起四段，比四个孤立小方块更像「进度」 */
.rail {
  margin: 0;
  padding: 0;
  list-style: none;
}

.stage {
  position: relative;
  padding: 0 0 var(--pb-space-3) 1.4rem;
  margin-left: 0.4rem;
  /* 连接线比卡片描边稍深一点，否则整条路径会「断」成四个点 */
  border-left: 1px solid color-mix(in srgb, var(--pb-border) 22%, transparent);
}

.stage:last-child {
  padding-bottom: 0;
  border-left-color: transparent;
}

.marker {
  position: absolute;
  left: -0.44rem;
  top: 0.1rem;
  display: grid;
  place-items: center;
  width: 0.85rem;
  height: 0.85rem;
  border-radius: 50%;
  background: var(--pb-surface);
  color: var(--pb-muted);
  font-size: 0.58rem;
  line-height: 1;
}

.stage[data-state="done"] .marker {
  color: var(--pb-ok);
}

.stage[data-state="current"] .marker {
  color: var(--pb-accent);
  box-shadow: 0 0 0 3px var(--pb-accent-soft);
}

.stage-name {
  display: block;
  color: var(--pb-ink);
  font-size: 0.9rem;
  font-weight: 600;
  line-height: 1.35;
}

.stage[data-state="todo"] .stage-name {
  color: var(--pb-ink-2);
  font-weight: 500;
}

.stage-caption {
  display: block;
  color: var(--pb-muted);
  font-size: 0.78rem;
  line-height: 1.4;
}

/* ---------- 工具清单 ---------- */

.tools {
  margin: 0;
  padding: 0;
  list-style: none;
  border: 1px solid var(--pb-border-soft);
  border-radius: var(--pb-radius);
  overflow: hidden;
}

.tools > li + li {
  border-top: 1px solid var(--pb-border-soft);
}

.tool {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--pb-space-3);
  width: 100%;
  padding: var(--pb-space-3) var(--pb-space-4);
  border: 0;
  background: var(--pb-surface);
  color: var(--pb-ink);
  text-align: left;
  cursor: pointer;
}

.tool:hover {
  background: var(--pb-surface-2);
}

/* 行尾的 ›：一行一条入口，得看得出可点 */
.tool::after {
  content: "›";
  flex: 0 0 auto;
  color: var(--pb-border);
  font-size: 1.05rem;
  line-height: 1;
}

.tool-label {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  font-size: 0.92rem;
  font-weight: 600;
  white-space: nowrap;
}

/* 卡内标签：金浅底 + 墨绿文字，6px 小圆角 */
.tag {
  padding: 0.05rem 0.4rem;
  border-radius: var(--pb-radius-sm);
  background: var(--pb-accent-2-soft);
  color: var(--pb-accent);
  font-size: 0.72rem;
  font-weight: 500;
}

.block .note {
  margin: var(--pb-space-2) 0 0;
}

/* 宽屏：右侧入口排成两列卡片，不再是长列表 */
@media (min-width: 900px) {
  .tools {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--pb-space-2);
    border: 0;
    border-radius: 0;
    overflow: visible;
  }

  .tools > li + li {
    border-top: 0;
  }

  /* 奇数个入口时最后一条占满整行，不留半格空白 */
  .tools > li:last-child:nth-child(odd) {
    grid-column: 1 / -1;
  }

  .tool {
    height: 100%;
    border: 1px solid var(--pb-border-soft);
    border-radius: var(--pb-radius);
  }

  .block .note {
    margin-top: var(--pb-space-3);
  }
}
</style>
