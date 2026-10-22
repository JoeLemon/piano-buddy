<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { audioAvailable, createPreviewPlayer, type PreviewPlayer } from "../audio/preview";
import type { LessonId, Profile } from "../domain/profile";
import { routeForSkill, type SkillRoute } from "../domain/skillRoutes";
import { scoreSegments, sliceScore } from "../domain/sliceScore";
import { flattenScore } from "../domain/timeline";
import type { Hand, Score } from "../domain/types";
import { flatRows, paintGrandProgress, paintScoreProgress } from "../notation/scorePaint";
import { renderGrandScore, renderScore } from "../notation/renderScore";
import { L3_PREP_LESSONS } from "../practice";
import {
  SKILL_BY_ID,
  masteredSkillIds,
  migrateProfile,
  missingSkills,
  rateScore,
  type Catalog,
  type CatalogArrangement,
  type DifficultyVector,
  type Skill,
} from "../repertoire";

/** 内容用 ?raw 读入，避免依赖 JSON import 的构建配置。 */
import catalogRaw from "../../content/catalog.json?raw";

const scoreSources = import.meta.glob("../../content/song.*/content/score.json", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;
const manifestSources = import.meta.glob("../../content/song.*/manifest.json", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

const props = defineProps<{
  profile: Profile;
}>();

const emit = defineEmits<{
  "open-reading": [];
  "open-lesson": [lessonId: LessonId];
  "open-theory": [lessonId: string];
  "follow-score": [payload: { score: Score; hand: Hand | "BOTH"; title: string }];
}>();

const catalog = parseCatalog(catalogRaw);
const scores = loadScores(scoreSources, manifestSources);
const songs = computed(() => catalog.songs);
const allArrangements = computed(() =>
  catalog.songs.flatMap((song) =>
    song.arrangements.map((arrangement) => ({ song, arrangement })),
  ),
);
const selectedId = ref(allArrangements.value[0]?.arrangement.arrangementId ?? "");
const selected = computed(
  () =>
    allArrangements.value.find((item) => item.arrangement.arrangementId === selectedId.value) ??
    null,
);
const selectedScore = computed<Score | null>(() => {
  const packageId = selected.value?.arrangement.packageId;
  return packageId ? scores.get(packageId) ?? null : null;
});

const staffEl = ref<HTMLElement | null>(null);
const renderError = ref("");
const showFingers = ref(true);
const hand = ref<Hand | "BOTH">("BOTH");
const speed = ref(1);
const position = ref(0);
const totalBeats = ref(0);
const playing = ref(false);
const audioReady = computed(() => audioAvailable());

let player: PreviewPlayer | null = null;
let playerPackageId: string | null = null;
/** 播放到第几个发声音（0 起）；null 表示尚未播放或已回到开头。 */
const playbackIndex = ref<number | null>(null);
/** 播放示范没有对错判定，上色只区分「已播放」与「当前音」。 */
const NO_KEYS: ReadonlySet<string> = new Set();

const ledger = computed(() => migrateProfile(props.profile));
const mastered = computed(() => masteredSkillIds(ledger.value));
const requiredSkills = computed(() => {
  const ids = selected.value?.arrangement.skillDeps ?? [];
  return ids
    .map((id) => ({ ...skillInfo(id), done: mastered.value.has(id) }))
    .sort((a, b) => a.level - b.level || a.id.localeCompare(b.id));
});
const missing = computed(() => {
  const arrangement = selected.value?.arrangement;
  if (!arrangement) return [];
  return [...missingSkills(arrangement.skillDeps, mastered.value)]
    .map((id) => skillInfo(id))
    .sort((a, b) => a.level - b.level || a.id.localeCompare(b.id));
});
const readiness = computed(() =>
  missing.value.length === 0 ? "所需技能已齐，可以开始。" : `还差 ${missing.value.length} 项技能。`,
);
/** 分段跟弹：两小节一段，避免一上来就是整首。 */
const segments = computed(() => (selectedScore.value ? scoreSegments(selectedScore.value) : []));
const selectedSegment = ref(0);
const activeSegment = computed(() => segments.value[selectedSegment.value] ?? segments.value[0] ?? null);
/** 缺技能清单里，每一项能落到哪一节具体课；没有课的显示「暂无微课」。 */
const missingRoutes = computed(() =>
  missing.value.map((skill) => ({ skill, route: routeForSkill(skill.id) })),
);
/** L1/L2 有现成微课；L3 有预备课，L4+ 仍只有技能规则。 */
const canPracticeBasics = computed(() => missing.value.some((skill) => skill.level <= 2));
const hasL3Missing = computed(() => missing.value.some((skill) => skill.level === 3));
const higherMissing = computed(() => missing.value.filter((skill) => skill.level > 3));
const l3CompletedCount = computed(
  () =>
    L3_PREP_LESSONS.filter((lesson) =>
      props.profile.l3PrepCompleted?.includes(lesson.id),
    ).length,
);

const VECTOR_LABELS: Record<keyof DifficultyVector, string> = {
  rhythm: "节奏",
  coordination: "双手",
  key: "调号",
  handPosition: "手位",
  harmony: "和声",
  texture: "织体",
};
const vector = computed(() => {
  const score = selectedScore.value;
  if (!score) return [];
  const value = rateScore(score).vector;
  return (Object.keys(VECTOR_LABELS) as (keyof DifficultyVector)[]).map((key) => ({
    key,
    label: VECTOR_LABELS[key],
    value: value[key],
  }));
});

onMounted(() => {
  drawStaff();
  // 先建播放器只为拿到总拍数；真正打开 AudioContext 发生在 play()。
  ensurePlayer();
});
onBeforeUnmount(() => stopPlayback());
watch([selectedScore, staffEl, showFingers], async () => {
  await nextTick();
  drawStaff();
}, { flush: "post" });

function parseCatalog(raw: string): Catalog {
  try {
    const parsed = JSON.parse(raw) as Catalog;
    return parsed && Array.isArray(parsed.songs) ? parsed : { version: 1, songs: [] };
  } catch {
    return { version: 1, songs: [] };
  }
}

/** 用 manifest.id 把 content/song.* 目录里的谱子映射到 catalog 的 packageId。 */
function loadScores(
  scoreRaw: Record<string, string>,
  manifestRaw: Record<string, string>,
): Map<string, Score> {
  const packageByDir = new Map<string, string>();
  for (const [path, raw] of Object.entries(manifestRaw)) {
    const dir = directoryOf(path);
    if (!dir) continue;
    try {
      const manifest = JSON.parse(raw) as { id?: string };
      if (manifest.id) packageByDir.set(dir, manifest.id);
    } catch {
      // 无效 manifest 由 validate:content 报错；界面只是不展示坏包。
    }
  }

  const out = new Map<string, Score>();
  for (const [path, raw] of Object.entries(scoreRaw)) {
    const dir = directoryOf(path);
    const packageId = dir ? packageByDir.get(dir) : null;
    if (!packageId) continue;
    try {
      out.set(packageId, JSON.parse(raw) as Score);
    } catch {
      // 同上。
    }
  }
  return out;
}

function directoryOf(path: string): string | null {
  return /(song\.[^/]+)\//.exec(path)?.[1] ?? null;
}

function skillInfo(id: string): Skill {
  return SKILL_BY_ID.get(id) ?? { id, name: id, level: 0, prereq: [] };
}

function drawStaff() {
  const element = staffEl.value;
  const score = selectedScore.value;
  if (!element || !score) return;
  renderError.value = "";
  try {
    if (score.hands.includes("RH") && score.hands.includes("LH")) {
      renderGrandScore(element, score, showFingers.value);
    } else {
      const only: Hand = score.hands.includes("RH") ? "RH" : "LH";
      renderScore(element, score, only, showFingers.value);
    }
    // 重绘会把上色一起清掉（切指法、换曲），这里按播放位置补回。
    paintPlayback(playbackIndex.value);
  } catch (error) {
    renderError.value = error instanceof Error ? error.message : "谱面渲染失败";
  }
}

/** 双手谱用大谱表上色，单谱表用单行上色。 */
function isGrandScore(score: Score): boolean {
  return score.hands.includes("RH") && score.hands.includes("LH");
}

/**
 * 播放示范时的颜色进度：已播放的音转暖米灰，正在响的音金色。
 * index 是播放器的发声音序号（与谱面发声音顺序一致）；null 表示回到开头、清空上色。
 */
function paintPlayback(index: number | null) {
  const element = staffEl.value;
  const score = selectedScore.value;
  if (!element || !score) return;
  if (isGrandScore(score)) {
    const active = index == null ? null : flattenScore(score)[index] ?? null;
    paintGrandProgress(element, score, {
      timelineCount: index == null ? 0 : index + 1,
      correctKeys: NO_KEYS,
      wrongKeys: NO_KEYS,
      activeKey: active ? `${active.hand}:${active.id}` : null,
    });
    return;
  }
  const only: Hand = score.hands.includes("RH") ? "RH" : "LH";
  if (index == null) {
    paintScoreProgress(element, score, only, { playedCount: 0, correctIds: NO_KEYS, wrongIds: NO_KEYS });
    return;
  }
  const active = flatRows(score, only).find((row) => row.sounding === index) ?? null;
  paintScoreProgress(element, score, only, {
    playedCount: index + 1,
    correctIds: NO_KEYS,
    wrongIds: NO_KEYS,
    activeId: active?.id ?? null,
  });
}

function selectArrangement(arrangement: CatalogArrangement) {
  if (arrangement.arrangementId === selectedId.value) return;
  stopPlayback();
  selectedId.value = arrangement.arrangementId;
  selectedSegment.value = 0;
  position.value = 0;
  totalBeats.value = 0;
  playing.value = false;
  renderError.value = "";
  ensurePlayer();
}

/** 把当前段切成一份独立谱子，交给视奏页跟弹/评测。 */
function followSegment() {
  const score = selectedScore.value;
  const segment = activeSegment.value;
  if (!score || !segment) return;
  const title = `${selected.value?.song.title ?? "曲目"} · ${selected.value?.arrangement.name ?? ""}`;
  emit("follow-score", {
    score: sliceScore(score, segment.start, segment.end, hand.value),
    hand: hand.value,
    title: `${title} · ${segment.label}`,
  });
}

function openSkillRoute(route: SkillRoute) {
  if (route.kind === "theory") {
    emit("open-theory", route.lessonId);
    return;
  }
  emit("open-lesson", route.lessonId);
}

function ensurePlayer(): PreviewPlayer | null {
  const score = selectedScore.value;
  const packageId = selected.value?.arrangement.packageId;
  if (!score || !packageId) return null;
  if (player && playerPackageId === packageId) return player;

  stopPlayback();
  const next = createPreviewPlayer(score, hand.value, score.bpm, {
    onNote: (index) => {
      // 播放器按发声音逐个回调，正好复用谱面的着色逻辑。
      playbackIndex.value = index;
      paintPlayback(index);
    },
    onProgress: (beat) => {
      position.value = beat;
      if (player) totalBeats.value = player.totalBeats;
    },
    onEnd: () => {
      playing.value = false;
      if (player) position.value = player.totalBeats;
      // 播完保留整条上色，最后一音不再标成「正在响」。
      paintPlayback(playbackIndex.value);
    },
  });
  player = next;
  playerPackageId = packageId;
  totalBeats.value = next.totalBeats;
  next.setSpeed(speed.value);
  return next;
}

function stopPlayback() {
  player?.stop();
  player = null;
  playerPackageId = null;
  playing.value = false;
  playbackIndex.value = null;
  paintPlayback(null);
}

function togglePlay() {
  const next = ensurePlayer();
  if (!next) return;
  if (next.playing) next.pause();
  else next.play();
  playing.value = next.playing;
}

function restart() {
  const next = ensurePlayer();
  if (!next) return;
  next.seek(0);
  next.play();
  position.value = 0;
  playing.value = next.playing;
  // 从头播：先清掉上一轮的颜色，新音会随播放重新上色。
  playbackIndex.value = null;
  paintPlayback(null);
}

function seek(beat: number) {
  const next = ensurePlayer();
  if (!next) return;
  next.seek(beat);
  position.value = beat;
  playing.value = next.playing;
  // 跳到新位置后，旧的上色与当前位置不再对应，先清空再由播放回调重建。
  playbackIndex.value = null;
  paintPlayback(null);
}

function onSeekInput(event: Event) {
  seek(Number((event.target as HTMLInputElement).value));
}

function setSpeed(value: number) {
  speed.value = value;
  const next = ensurePlayer();
  next?.setSpeed(value);
}

function setHand(value: Hand | "BOTH") {
  hand.value = value;
  const next = ensurePlayer();
  if (!next) return;
  next.setHand(value);
  totalBeats.value = next.totalBeats;
  position.value = next.positionBeats;
  playing.value = next.playing;
  // 换手后发声音序号整体变了，清掉旧上色。
  playbackIndex.value = null;
  paintPlayback(null);
}
</script>

<template>
  <div class="surface repertoire" data-test="repertoire">
    <h1>选一首曲子</h1>

    <p v-if="songs.length === 0" class="muted">还没有可用的曲目包。</p>

    <section v-for="song in songs" :key="song.songId" class="song" :data-song="song.songId">
      <div class="song-head">
        <div>
          <h2>{{ song.title }}</h2>
          <p v-if="song.composer" class="muted">{{ song.composer }}</p>
        </div>
      </div>

      <div class="arrangements">
        <button
          v-for="arrangement in song.arrangements"
          :key="arrangement.arrangementId"
          type="button"
          class="arrangement"
          :class="{ active: arrangement.arrangementId === selectedId }"
          :aria-pressed="arrangement.arrangementId === selectedId"
          data-test="arrangement"
          :data-arrangement="arrangement.arrangementId"
          @click="selectArrangement(arrangement)"
        >
          <strong>{{ arrangement.label }}</strong>
          <span>{{ arrangement.name }}</span>
          <small>{{ arrangement.bpm }} BPM · {{ arrangement.measures }} 小节</small>
        </button>
      </div>
    </section>

    <section v-if="selected" class="detail" data-test="repertoire-detail">
      <div class="detail-head">
        <h2>{{ selected.arrangement.name }}</h2>
        <p class="readiness" :class="{ ready: missing.length === 0 }" data-test="readiness">
          {{ readiness }}
        </p>
      </div>

      <div class="transport" data-test="repertoire-player">
        <div class="controls">
          <button type="button" class="primary" :disabled="!audioReady" data-test="repertoire-play" @click="togglePlay">
            {{ playing ? "暂停" : "播放" }}
          </button>
          <button type="button" :disabled="!audioReady" data-test="repertoire-restart" @click="restart">
            重播
          </button>
          <button type="button" data-test="repertoire-fingers" @click="showFingers = !showFingers">
            {{ showFingers ? "隐藏指法" : "显示指法" }}
          </button>
        </div>
        <div class="toggles">
          <span class="toggle-label">速度</span>
          <div class="segments">
            <button
              v-for="value in [0.5, 0.75, 1]"
              :key="value"
              type="button"
              :class="{ active: speed === value }"
              :aria-pressed="speed === value"
              data-test="repertoire-speed"
              @click="setSpeed(value)"
            >
              {{ Math.round(value * 100) }}%
            </button>
          </div>
          <span class="toggle-label">手</span>
          <div class="segments">
            <button
              v-for="value in ['BOTH', 'RH', 'LH']"
              :key="value"
              type="button"
              :class="{ active: hand === value }"
              :aria-pressed="hand === value"
              data-test="repertoire-hand"
              @click="setHand(value as Hand | 'BOTH')"
            >
              {{ value === "BOTH" ? "双手" : value === "RH" ? "右手" : "左手" }}
            </button>
          </div>
        </div>
      </div>

      <div class="segment-bar" data-test="repertoire-segments">
        <label class="toggle-label" for="repertoire-segment">分段</label>
        <select
          id="repertoire-segment"
          v-model.number="selectedSegment"
          data-test="repertoire-segment"
          :disabled="segments.length === 0"
        >
          <option v-for="segment in segments" :key="segment.index" :value="segment.index">
            {{ segment.label }}
          </option>
        </select>
        <button
          type="button"
          class="primary"
          data-test="repertoire-follow"
          :disabled="!selectedScore || !activeSegment"
          @click="followSegment"
        >
          跟弹本段
        </button>
        <span class="segment-hint">只评这一段；练完可在复盘里回到曲库。</span>
      </div>

      <div class="staff" ref="staffEl" data-test="repertoire-staff"></div>
      <p v-if="renderError" class="warn">{{ renderError }}</p>

      <div class="playhead">
        <span class="time">{{ position.toFixed(1) }} / {{ totalBeats.toFixed(1) }} 拍</span>
        <input
          class="seek"
          type="range"
          min="0"
          :max="totalBeats || 0"
          step="0.25"
          :value="position"
          :disabled="!audioReady || totalBeats <= 0"
          aria-label="播放位置"
          data-test="repertoire-seek"
          @input="onSeekInput"
        />
      </div>
      <p v-if="!audioReady" class="muted">当前浏览器没有可用的 Web Audio，示范播放不可用。</p>

      <div class="info-grid">
        <section class="info" data-test="repertoire-skills">
          <h3>需要的技能</h3>
          <ul class="skill-list">
            <li v-for="skill in requiredSkills" :key="skill.id" :class="{ done: skill.done }">
              <span>{{ skill.done ? "✓" : "○" }} {{ skill.name }}</span>
              <small>L{{ skill.level }}</small>
            </li>
          </ul>
          <template v-if="missing.length > 0">
            <h3>补短板顺序</h3>
            <ol class="skill-list missing">
              <li v-for="item in missingRoutes" :key="item.skill.id">
                <span class="skill-name">
                  {{ item.skill.name }}
                  <button
                    v-if="item.route"
                    type="button"
                    class="skill-route"
                    :data-test="`skill-route-${item.skill.id}`"
                    @click="openSkillRoute(item.route)"
                  >
                    {{ item.route.label }}
                  </button>
                  <small v-else class="no-lesson">暂无微课</small>
                </span>
                <small>L{{ item.skill.level }}</small>
              </li>
            </ol>
            <button
              v-if="canPracticeBasics"
              type="button"
              class="practice"
              data-test="repertoire-practice"
              @click="emit('open-reading')"
            >
              回识谱课补 L1/L2
            </button>
            <template v-if="hasL3Missing">
              <!-- L3 技能走上面的直达按钮；这里只补充预备课与 L4+ 的边界说明。 -->
              <p class="muted" data-test="repertoire-l3">
                L3 技能可点上面的按钮直达对应课；乐理预备课在「学习 · 乐理预备课」（已学 {{ l3CompletedCount }}/{{ L3_PREP_LESSONS.length }}）。
              </p>
              <p class="muted" data-test="repertoire-l3-gap">
                预备课完成只记「学习中」，不会直接跳过曲目过关。
              </p>
              <p v-if="higherMissing.length > 0" class="muted" data-test="repertoire-higher-gap">
                L4+ 的 {{ higherMissing.map((skill) => skill.name).join("、") }} 暂无微课。
              </p>
            </template>
          </template>
        </section>

        <section class="info" data-test="repertoire-difficulty">
          <h3>难在哪</h3>
          <p class="muted">{{ selected.arrangement.label }} · {{ selected.arrangement.bpm }} BPM · {{ selected.arrangement.measures }} 小节</p>
          <div v-for="dimension in vector" :key="dimension.key" class="vector-row">
            <span>{{ dimension.label }}</span>
            <div class="vector-track">
              <div class="vector-fill" :style="{ width: `${Math.min(100, dimension.value / 6 * 100)}%` }"></div>
            </div>
            <small>{{ dimension.value }}</small>
          </div>
          <p v-if="selected.arrangement.rights" class="rights">
            {{ selected.arrangement.rights.type }} · {{ selected.arrangement.rights.attribution }}
          </p>
        </section>
      </div>
    </section>
  </div>
</template>

<style scoped>
h1,
h2,
h3 {
  margin: 0 0 0.5rem;
  font-family: var(--pb-font-display);
  font-weight: 600;
}

h1 {
  font-size: 1.85rem;
}

h2 {
  font-size: 1.25rem;
}

h3 {
  margin-top: 1rem;
  font-size: 1rem;
}

.muted,
.rights {
  color: var(--pb-muted);
}

.song {
  margin: 0 0 1rem;
  padding: 0.9rem 1rem;
  border: 1px solid var(--pb-border-soft);
  border-radius: var(--pb-radius);
}

.song-head,
.detail-head,
.controls,
.toggles,
.vector-row {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}

.song-head,
.detail-head {
  justify-content: space-between;
  gap: 1rem;
}

.song-head h2,
.detail-head h2 {
  margin: 0;
}

.song-head p,
.detail-head p {
  margin: 0.15rem 0 0;
}

.arrangements {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
  gap: 0.6rem;
  margin-top: 0.8rem;
}

.arrangement {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  min-height: 5.2rem;
  padding: 0.7rem 0.8rem;
  border: 1px solid var(--pb-border-soft);
  border-radius: var(--pb-radius);
  background: var(--pb-surface);
  color: var(--pb-ink);
  text-align: left;
  cursor: pointer;
}

.arrangement.active {
  border-color: var(--pb-accent);
  box-shadow: 0 0 0 1px var(--pb-accent);
}

.arrangement span,
.arrangement small {
  color: var(--pb-muted);
  font-size: 0.85rem;
}

.detail {
  padding: 1rem;
  border: 1px solid var(--pb-border-soft);
  border-radius: var(--pb-radius);
}

.readiness {
  margin: 0;
  color: var(--pb-warn);
  font-size: 0.9rem;
  text-align: right;
}

.readiness.ready {
  color: var(--pb-ok);
}

.staff {
  overflow-x: auto;
  margin: 0.75rem 0;
  scrollbar-width: thin;
}

/* 播放条放在谱面上方：先能听，再看谱，滚动时不用来回找按钮 */
.transport {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--pb-space-2) var(--pb-space-3);
  margin: 0.75rem 0;
  padding: var(--pb-space-2) var(--pb-space-3);
  border: 1px solid var(--pb-border-soft);
  border-radius: var(--pb-radius);
  background: var(--pb-surface-2);
}

.controls {
  flex-wrap: wrap;
}

button {
  padding: 0.45rem 0.7rem;
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
}

/* 分段控件里的按钮交给全局 .segments，不再套一层描边 */
.segments > button {
  padding: 0.24rem 0.55rem;
  border: 0;
  border-radius: var(--pb-radius-pill);
  background: transparent;
  font-size: 0.82rem;
}

.segments > button.active {
  border: 0;
  background: var(--pb-surface);
  box-shadow: var(--pb-shadow-1);
  font-weight: 600;
}

.playhead {
  display: flex;
  align-items: center;
  gap: var(--pb-space-3);
  margin: 0 0 1rem;
}

.time {
  flex: 0 0 auto;
  color: var(--pb-muted);
  font-size: 0.8rem;
  font-variant-numeric: tabular-nums;
}

.seek {
  flex: 1 1 auto;
  width: auto;
  margin: 0;
  accent-color: var(--pb-accent-2);
}

.toggles {
  flex-wrap: wrap;
  gap: var(--pb-space-2);
}

/* 窄屏把速度/手两组合成一行，避免播放条堆成四排 */
@media (max-width: 600px) {
  .transport {
    gap: var(--pb-space-2);
  }

  .segments > button {
    padding: 0.2rem 0.45rem;
    font-size: 0.76rem;
  }

  .toggle-label {
    font-size: 0.78rem;
  }
}

.toggle-label {
  color: var(--pb-muted);
  font-size: 0.85rem;
}

/* 分段跟弹：和播放条分开，避免用户以为「跟弹」只是换个速度 */
.segment-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--pb-space-2) var(--pb-space-3);
  margin: -0.25rem 0 0.9rem;
  padding: var(--pb-space-2) var(--pb-space-3);
  border: 1px dashed var(--pb-border-soft);
  border-radius: var(--pb-radius);
}

.segment-bar select {
  padding: 0.3rem 0.45rem;
  border: 1px solid var(--pb-border-soft);
  border-radius: var(--pb-radius);
  background: var(--pb-surface);
  color: var(--pb-ink);
  font-size: 0.85rem;
}

.segment-hint {
  color: var(--pb-muted);
  font-size: 0.78rem;
}

.skill-name {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem;
}

.skill-route {
  padding: 0.15rem 0.45rem;
  border-color: var(--pb-accent);
  border-radius: var(--pb-radius-pill);
  font-size: 0.75rem;
}

.no-lesson {
  color: var(--pb-muted);
  font-size: 0.75rem;
}

.info-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
  gap: 1rem;
}

.info {
  min-width: 0;
}

.skill-list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.skill-list li {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.4rem 0.75rem;
  padding: 0.3rem 0;
  border-bottom: 1px solid var(--pb-border-soft);
  color: var(--pb-muted);
}

.skill-list li.done {
  color: var(--pb-ink);
}

.skill-list small {
  flex: none;
  color: var(--pb-muted);
}

.skill-list.missing {
  color: var(--pb-warn);
}

.practice {
  margin-top: 0.75rem;
  border-color: var(--pb-accent);
}

.vector-row {
  margin: 0.35rem 0;
  font-size: 0.85rem;
}

.vector-row > span {
  flex: 0 0 2.4rem;
  color: var(--pb-muted);
}

.vector-track {
  flex: 1;
  height: 0.4rem;
  overflow: hidden;
  border-radius: var(--pb-radius-pill);
  background: var(--pb-border-soft);
}

.vector-fill {
  height: 100%;
  border-radius: var(--pb-radius-pill);
  background: var(--pb-accent-2);
}

.vector-row small {
  flex: 0 0 1rem;
  text-align: right;
  color: var(--pb-muted);
}

.rights {
  margin: 0.8rem 0 0;
  font-size: 0.8rem;
}

.warn {
  color: var(--pb-warn);
}

@media (max-width: 640px) {
  .detail-head {
    display: block;
  }

  .readiness {
    margin-top: 0.5rem;
    text-align: left;
  }
}
</style>
