<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { audioAvailable, createPreviewPlayer, type PreviewPlayer } from "../audio/preview";
import type { LessonId, Profile } from "../domain/profile";
import { markSegmentFollowed } from "../domain/profile";
import { recordGapAttempt } from "../domain/metrics";
import { routeForSkill, type SkillRoute } from "../domain/skillRoutes";
import { scoreSegments, segmentBeatRange, sliceScore } from "../domain/sliceScore";
import { flattenScore } from "../domain/timeline";
import type { Hand, Score } from "../domain/types";
import { flatRows, paintGrandProgress, paintScoreProgress } from "../notation/scorePaint";
import { renderGrandScore, renderScore } from "../notation/renderScore";
import { L3_PREP_LESSONS } from "../practice";
import {
  SKILL_BY_ID,
  assessmentKey,
  assessmentsForSong,
  buildRepertoireAssessment,
  catalogFromInstalled,
  estimatePracticeMinutes,
  masteredSkillIds,
  mergeCatalogs,
  migrateProfile,
  missingSkillOrder,
  missingSkills,
  practiceEvidence,
  rateScore,
  recordFollowPractice,
  recordRepertoireAssessment,
  requiredSkillsForScore,
  scoreFromPackage,
  type Catalog,
  type CatalogArrangement,
  type DifficultyVector,
  type InstalledPackage,
  type RepertoireAssessment,
  type RepertoireSegmentResult,
  type Skill,
  type SkillMastery,
} from "../repertoire";
import ScoreFollow from "./ScoreFollow.vue";

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
  /** 运行时安装的外部曲库包；与内置 content/catalog.json 合并展示。 */
  installedPackages?: readonly InstalledPackage[];
}>();

const emit = defineEmits<{
  "open-reading": [];
  "open-lesson": [lessonId: LessonId];
  "open-theory": [lessonId: string];
  /** L4 预备关在乐理练习页里，带关卡 id 直达。 */
  "open-stage": [stageId: string];
  "update-profile": [profile: Profile];
  /** 一整首曲子的分段评测已收齐（无论成绩是否比上次好）。 */
  completed: [];
}>();

const bundledCatalog = parseCatalog(catalogRaw);
const bundledScores = loadScores(scoreSources, manifestSources);
const installedCatalog = computed(() => catalogFromInstalled(props.installedPackages ?? []));
const catalog = computed(() =>
  mergeCatalogs(bundledCatalog, installedCatalog.value.catalog ?? { version: 1, songs: [] }),
);
const scores = computed(() => {
  const out = new Map(bundledScores);
  for (const pkg of props.installedPackages ?? []) {
    const score = scoreFromPackage(pkg);
    if (score) out.set(pkg.manifest.id, score);
  }
  return out;
});
const songs = computed(() => catalog.value.songs);
const allArrangements = computed(() =>
  catalog.value.songs.flatMap((song) =>
    song.arrangements.map((arrangement) => ({ song, arrangement })),
  ),
);

/**
 * 曲库搜索与筛选。
 *
 * 曲库已经到 8 首 10 编配，再靠上下滚动找曲子会越来越慢。这里只做两件
 * 最常用的事：按曲名/作曲家/编配名搜索，按档位筛选；搜索命中曲名时保留
 * 该曲的所有编配，命中编配名时才收窄到具体编配，避免「搜欢乐颂却只剩一首」。
 */
const query = ref("");
const levelFilter = ref<number | "all">("all");
const levelOptions = computed(() =>
  [...new Set(allArrangements.value.map((item) => item.arrangement.level))].sort((a, b) => a - b),
);

function arrangementText(song: { title: string; composer?: string }, arrangement: CatalogArrangement) {
  return [song.title, song.composer ?? "", arrangement.name, arrangement.label, arrangement.arrangementId]
    .join(" ")
    .toLowerCase();
}

const filteredSongs = computed(() => {
  const needle = query.value.trim().toLowerCase();
  return songs.value
    .map((song) => {
      const songText = [song.title, song.composer ?? ""].join(" ").toLowerCase();
      const songMatches = needle.length === 0 || songText.includes(needle);
      const arrangements = song.arrangements.filter((arrangement) => {
        if (levelFilter.value !== "all" && arrangement.level !== levelFilter.value) return false;
        return songMatches || arrangementText(song, arrangement).includes(needle);
      });
      return { ...song, arrangements };
    })
    .filter((song) => song.arrangements.length > 0);
});
const filteredArrangements = computed(() =>
  filteredSongs.value.flatMap((song) =>
    song.arrangements.map((arrangement) => ({ song, arrangement })),
  ),
);

function clearFilters() {
  query.value = "";
  levelFilter.value = "all";
}

const selectedId = ref(allArrangements.value[0]?.arrangement.arrangementId ?? "");
const selected = computed(
  () =>
    filteredArrangements.value.find(
      (item) => item.arrangement.arrangementId === selectedId.value,
    ) ?? null,
);
const selectedScore = computed<Score | null>(() => {
  const packageId = selected.value?.arrangement.packageId;
  return packageId ? scores.value.get(packageId) ?? null : null;
});

/** 外部包装入或筛选变化后，如果当前选择不可见，落回第一首可见曲目。 */
watch(filteredArrangements, (items) => {
  if (items.some((item) => item.arrangement.arrangementId === selectedId.value)) return;
  selectedId.value = items[0]?.arrangement.arrangementId ?? "";
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
/**
 * 补短板顺序：先档位（前置先学），同档里「练过」的排前——半熟的技能补成
 * 过关最快，也让学生看见曲库里的练习确实在推进关卡。
 */
const missing = computed(() => {
  const arrangement = selected.value?.arrangement;
  if (!arrangement) return [];
  return missingSkillOrder(missingSkills(arrangement.skillDeps, mastered.value), ledger.value).map(
    (id) => skillInfo(id),
  );
});
/** 练过的缺口：曲目里已经能弹下来，只差认谱过关的那几项。 */
const practicedMissing = computed(
  () => missing.value.filter((skill) => evidence.value.has(skill.id)).length,
);
/**
 * 补完耗时：把缺口折算成分钟，回答「这首曲子离能弹还差多久」。
 * 没有微课的缺口不计入——界面已经用「暂无微课」说过一次，不重复。
 */
const estimate = computed(() =>
  estimatePracticeMinutes(
    missing.value.map((skill) => skill.id),
    ledger.value,
  ),
);
const estimateText = computed(() => {
  if (estimate.value.estimated === 0) return "";
  return estimate.value.unrouted > 0
    ? `有微课的部分，预计约 ${estimate.value.minutes} 分钟。`
    : `按这个顺序补，预计约 ${estimate.value.minutes} 分钟。`;
});
const readiness = computed(() => {
  if (missing.value.length === 0) return "所需技能已齐，可以开始。";
  const base = `还差 ${missing.value.length} 项技能`;
  return practicedMissing.value > 0
    ? `${base}，其中 ${practicedMissing.value} 项已经练过。`
    : `${base}。`;
});

/**
 * 同歌升级：同一首歌换了更高编配，技能账本不重建，旧编配的整曲成绩也保留。
 *
 * 曲库页把这两件事说清楚，学生才不会以为换到 L3 就要把 L2 的进度重来一遍。
 */
const arrangementLookup = computed(
  () => new Map(allArrangements.value.map((item) => [item.arrangement.arrangementId, item])),
);
const sameSongAssessments = computed(() =>
  assessmentsForSong(props.profile.repertoireAssessments, selected.value?.song.songId ?? ""),
);
const currentAssessment = computed<RepertoireAssessment | null>(() => {
  const arrangement = selected.value?.arrangement;
  if (!arrangement) return null;
  return props.profile.repertoireAssessments?.[assessmentKey(arrangement.arrangementId, hand.value)] ?? null;
});
const inheritedAssessment = computed<RepertoireAssessment | null>(() => {
  const current = selected.value?.arrangement;
  if (!current) return null;
  return sameSongAssessments.value
    .filter((assessment) => {
      if (assessment.arrangementId === current.arrangementId) return false;
      const info = arrangementLookup.value.get(assessment.arrangementId);
      return (info?.arrangement.level ?? 0) < current.level;
    })
    .sort((a, b) => {
      const levelA = arrangementLookup.value.get(a.arrangementId)?.arrangement.level ?? 0;
      const levelB = arrangementLookup.value.get(b.arrangementId)?.arrangement.level ?? 0;
      return levelB - levelA;
    })[0] ?? null;
});
const currentAssessmentText = computed(() => {
  const assessment = currentAssessment.value;
  if (!assessment) return "";
  return `本编配${handLabel(assessment.hand)}已评测 ${assessment.segments.length} 段，最好匹配率 ${Math.round(assessment.accuracy * 100)}%。`;
});
const inheritanceText = computed(() => {
  const assessment = inheritedAssessment.value;
  if (!assessment) return "";
  const label = arrangementLookup.value.get(assessment.arrangementId)?.arrangement.label
    ?? assessment.arrangementId;
  return `同歌升级：${label} 编配已评测 ${assessment.segments.length} 段（${Math.round(assessment.accuracy * 100)}%），已掌握技能与练习证据会保留。`;
});

function handLabel(value: Hand | "BOTH"): string {
  return value === "BOTH" ? "双手" : value === "RH" ? "右手" : "左手";
}
/** 分段跟弹：两小节一段，避免一上来就是整首。 */
const segments = computed(() => (selectedScore.value ? scoreSegments(selectedScore.value) : []));
const selectedSegment = ref(0);
const activeSegment = computed(() => segments.value[selectedSegment.value] ?? segments.value[0] ?? null);

/**
 * 整曲评测：按分段顺序把每一段交给 ScoreFollow，收齐后再按音数加权。
 *
 * 不把整首谱子塞进一个 ScoreFollow，是因为曲库的判分口径本来就是「这一段
 * 弹对没有」；分段收结果既能复用同一套判定，也能在结果里指出具体哪一段弱。
 */
const assessing = ref(false);
const assessmentIndex = ref(0);
/** 重测同一段时靠它换 key，强制 ScoreFollow 重新开始。 */
const assessmentAttempt = ref(0);
const assessmentResults = ref<RepertoireSegmentResult[]>([]);
const assessmentSegment = computed(() => segments.value[assessmentIndex.value] ?? null);
const assessmentScore = computed(() => {
  const score = selectedScore.value;
  const segment = assessmentSegment.value;
  if (!score || !segment) return null;
  return sliceScore(score, segment.start, segment.end, hand.value);
});
const assessmentResult = computed(
  () => assessmentResults.value.find((result) => result.index === assessmentIndex.value) ?? null,
);
const assessmentComplete = computed(
  () => segments.value.length > 0 && assessmentResults.value.length === segments.value.length,
);
const assessmentTotals = computed(() => {
  const onCount = assessmentResults.value.reduce((sum, result) => sum + result.onCount, 0);
  const total = assessmentResults.value.reduce((sum, result) => sum + result.total, 0);
  return { onCount, total, accuracy: total > 0 ? onCount / total : 0 };
});
const assessmentSummary = computed(() => {
  if (!assessmentComplete.value) {
    return `已测 ${assessmentResults.value.length} / ${segments.value.length} 段`;
  }
  const { onCount, total, accuracy } = assessmentTotals.value;
  return `整曲匹配率 ${Math.round(accuracy * 100)}%（${onCount} / ${total} 音）`;
});
const assessmentProgress = computed(() => {
  const segment = assessmentSegment.value;
  if (!segment) return "";
  return `第 ${assessmentIndex.value + 1} / ${segments.value.length} 段 · ${segment.label}`;
});

function assessmentResultFor(index: number): RepertoireSegmentResult | null {
  return assessmentResults.value.find((result) => result.index === index) ?? null;
}

function assessmentDetail(index: number): string {
  const result = assessmentResultFor(index);
  return result
    ? `${Math.round(result.accuracy * 100)}%（${result.onCount}/${result.total}）`
    : "";
}

function clearAssessment() {
  assessing.value = false;
  assessmentIndex.value = 0;
  assessmentAttempt.value = 0;
  assessmentResults.value = [];
}

function startAssessment() {
  if (!selectedScore.value || segments.value.length === 0) return;
  stopPlayback();
  assessing.value = true;
  following.value = true;
  assessmentIndex.value = 0;
  assessmentAttempt.value += 1;
  assessmentResults.value = [];
  selectedSegment.value = 0;
  loop.value = false;
}

function toggleAssessment() {
  if (assessing.value) {
    clearAssessment();
    following.value = false;
    return;
  }
  startAssessment();
}

function nextAssessment() {
  if (!assessing.value || !assessmentResult.value) return;
  if (assessmentIndex.value >= segments.value.length - 1) return;
  assessmentIndex.value += 1;
  assessmentAttempt.value += 1;
  selectedSegment.value = assessmentIndex.value;
}

function retryAssessmentSegment() {
  if (!assessing.value) return;
  assessmentResults.value = assessmentResults.value.filter(
    (result) => result.index !== assessmentIndex.value,
  );
  assessmentAttempt.value += 1;
}

/**
 * 就地跟弹：切出这一段交给 ScoreFollow，练完还留在曲库。
 *
 * 以前这里跳去视奏页，回来时段落选择就没了，一段一段往下练会反复重选；
 * 而且视奏页的口径是「弹错也不要停」，跟「把这两小节练熟」不是一回事。
 */
const following = ref(false);
/** A–B 循环：示范播放只在当前分段里反复，听完一遍自动重播。 */
const loop = ref(false);
const followScore = computed(() => {
  if (assessing.value) return assessmentScore.value;
  const score = selectedScore.value;
  const segment = activeSegment.value;
  if (!score || !segment) return null;
  return sliceScore(score, segment.start, segment.end, hand.value);
});
/** 跟弹沿用示范的速度档：同一个「速度」只管一处，不再多一个滑块。 */
const followBpm = computed(() => Math.round((selectedScore.value?.bpm ?? 60) * speed.value));
/** 整曲评测换段/重测都要重建 ScoreFollow；单段跟弹则跟着分段选择走。 */
const followKey = computed(() =>
  assessing.value
    ? `${selectedId.value}-assess-${assessmentIndex.value}-${assessmentAttempt.value}-${hand.value}`
    : `${selectedId.value}-${selectedSegment.value}-${hand.value}`,
);

/**
 * 弱起提示：首小节不满拍，谱面看起来像少了一截。不解释一句，
 * 用户会以为曲库漏了音，或者跟着示范时找不到第一拍。
 */
const pickupHint = computed(() => {
  const pickup = selectedScore.value?.pickup;
  if (!pickup) return "";
  return `弱起 ${pickup} 拍：第 1 小节只有 ${pickup} 拍，不是漏音；跟弹时第一格落在小节末尾。`;
});

function toggleFollow() {
  // 示范播放与跟弹不共用一条时间线；换谱子后由 staffScore 的 watch 重建播放器。
  stopPlayback();
  if (assessing.value) {
    clearAssessment();
    following.value = false;
    return;
  }
  following.value = !following.value;
}

/**
 * A–B 循环：把循环区交给示范播放器，听完一遍自动重播。
 *
 * 不跟弹时循环区是当前分段（小节坐标转成的拍坐标，`segmentBeatRange`）；
 * 跟弹时播放器谱面就是这一段，循环整个播放区即可——「循环本段」在两种
 * 状态下是同一件事。换分段、换手、换编配都会让谱长或区间变化，重新设
 * 一次，不信任旧状态。
 */
function applyLoop() {
  const active = ensurePlayer();
  if (!active) return;
  if (!loop.value) {
    active.setLoop(null);
    return;
  }
  if (following.value) {
    active.setLoop({ start: 0, end: active.totalBeats });
    return;
  }
  const segment = activeSegment.value;
  const score = selectedScore.value;
  if (!segment || !score) {
    active.setLoop(null);
    return;
  }
  const range = segmentBeatRange(score, hand.value, segment);
  // 领域层用 startBeat/endBeat 说话，播放器接口是 start/end：在这里换名字，
  // 免得两个坐标系在类型上看起来一样、传错了却不报错。
  active.setLoop({ start: range.startBeat, end: range.endBeat });
  // 开循环就把播放头放到段首：按播放就是从这一段开始反复。
  if (!active.playing) active.seek(range.startBeat);
}

function toggleLoop() {
  loop.value = !loop.value;
  applyLoop();
}

/** 跟弹时谱面只画这一段：看到的和判的必须是同一份音符，否则不知道在练哪两小节。 */
const staffScore = computed(() =>
  (following.value || assessing.value) && followScore.value ? followScore.value : selectedScore.value,
);

/** 缺技能清单里，每一项能落到哪一节具体课；没有课的显示「暂无微课」。 */
const missingRoutes = computed(() =>
  missing.value.map((skill) => ({ skill, route: routeForSkill(skill.id) })),
);
/** L1/L2 有现成微课；L3–L6 有预备课；只有图谱里还没接课的高级技能才提示「暂无微课」。 */
const canPracticeBasics = computed(() => missing.value.some((skill) => skill.level <= 2));

/**
 * 跟弹写下的练习证据：练过几次、最快什么速度。
 *
 * 只作展示，不改变「掌握」的判断——那是过关测试的事。少了它，
 * 「先选曲」练得再多，缺技能清单上也看不出一点变化。
 */
const evidence = computed(() => {
  const out = new Map<string, SkillMastery>();
  for (const skill of requiredSkills.value) {
    const item = practiceEvidence(ledger.value, skill.id);
    if (item) out.set(skill.id, item);
  }
  return out;
});
const hasL3Missing = computed(() => missing.value.some((skill) => skill.level === 3));
/** L4+ 里真正没有微课的缺口；已经接了乐理预备关的技能不在这里重复。 */
const unroutedHigherMissing = computed(() =>
  missing.value.filter((skill) => skill.level > 3 && !routeForSkill(skill.id)),
);
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
// 谱子换了（切曲 / 切段 / 开关跟弹）就把示范播放器一起换掉，
// 否则进度条和听到的还是上一份谱子。
watch(staffScore, () => {
  stopPlayback();
  position.value = 0;
  totalBeats.value = 0;
  ensurePlayer();
  // 新播放器不记得循环区；跟弹一开循环就是关的，这里按开关状态补回。
  applyLoop();
});

// 不跟弹时换分段 / 换手不会重建播放器，但循环区要跟着换；跟弹时这两者也会
// 换掉 staffScore，那条 watch 会一并重设循环。
watch([selectedSegment, hand], () => {
  applyLoop();
});

watch([staffScore, staffEl, showFingers], async () => {
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
  const score = staffScore.value;
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
  const score = staffScore.value;
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
  const wasAssessing = assessing.value;
  stopPlayback();
  clearAssessment();
  if (wasAssessing) following.value = false;
  selectedId.value = arrangement.arrangementId;
  selectedSegment.value = 0;
  position.value = 0;
  totalBeats.value = 0;
  playing.value = false;
  renderError.value = "";
  // 换曲后分段变了，旧的循环区没有意义； staffScore 的 watch 会重建播放器。
  loop.value = false;
  ensurePlayer();
}

/**
 * 整段弹对过的谱面 id。
 *
 * 切片谱 id 自带编配、小节范围和手别（`...m1-2.RH`），所以换手要重新弹对——
 * 右手弹顺了不代表左手也会，这一点在账本上不能含糊。
 */
const followedScores = computed(() => new Set(props.profile.followedSegments));
/** 分段下拉里标「已弹对」用；和账本里的 id 对得上才算。 */
const segmentDone = computed(
  () =>
    new Map(
      segments.value.map((segment) => [
        segment.index,
        followedScores.value.has(sliceIdFor(segment) ?? ""),
      ]),
    ),
);

function sliceIdFor(segment: { start: number; end: number }): string | null {
  const score = selectedScore.value;
  if (!score) return null;
  return sliceScore(score, segment.start, segment.end, hand.value).id;
}

/**
 * 跟弹整段弹对：把这段涉及的技能记一次练习，段落本身也存进档案。
 *
 * 记账口径和「已弹对」标记一致——全对才记。练个半熟不往账本上写，
 * 否则技能清单上的「练过」会越来越不值钱。
 */
function bankPractice(profile: Profile, score: Score, bpm: number): Profile {
  const nextLedger = recordFollowPractice(
    profile.skillLedger,
    requiredSkillsForScore(score),
    hand.value === "BOTH" ? "both" : hand.value,
    bpm,
  );
  return {
    ...markSegmentFollowed(profile, score.id),
    skillLedger: nextLedger,
  };
}

/**
 * 收齐全曲后写一次评测。
 *
 * 只有弹对的分段才顺手写「已弹对」和技能练习证据；整曲匹配率则按实际
 * 命中音数记录，哪怕某段没弹全也能看出弱在哪。写档案时从 `props.profile`
 * 出发，不重建 `skillLedger`，所以同歌换更高编配时已掌握技能不会被清零。
 */
function persistAssessment(results: RepertoireSegmentResult[]) {
  const score = selectedScore.value;
  const selectedItem = selected.value;
  if (!score || !selectedItem || results.length !== segments.value.length) return;

  const assessment = buildRepertoireAssessment({
    songId: selectedItem.song.songId,
    arrangementId: selectedItem.arrangement.arrangementId,
    packageId: selectedItem.arrangement.packageId,
    hand: hand.value,
    bpm: followBpm.value,
    segments: results,
  });

  let next = recordRepertoireAssessment(props.profile, assessment);
  for (const result of results) {
    if (result.total === 0 || result.onCount < result.total) continue;
    const segmentScore = sliceScore(score, result.start, result.end, hand.value);
    next = bankPractice(next, segmentScore, followBpm.value);
  }
  if (next !== props.profile) emit("update-profile", next);
  emit("completed");
}

function onFollowDone(payload: { onCount: number; total: number }) {
  const score = followScore.value;
  if (!score || payload.total === 0) return;

  if (assessing.value) {
    const segment = assessmentSegment.value;
    if (!segment) return;
    const result: RepertoireSegmentResult = {
      index: segment.index,
      start: segment.start,
      end: segment.end,
      label: segment.label,
      onCount: payload.onCount,
      total: payload.total,
      accuracy: payload.onCount / payload.total,
    };
    const next = [
      ...assessmentResults.value.filter((item) => item.index !== segment.index),
      result,
    ].sort((a, b) => a.index - b.index);
    assessmentResults.value = next;
    if (next.length === segments.value.length) persistAssessment(next);
    return;
  }

  // 还没整段弹对的分段就是「缺口」：记下这次重练的命中槽位，
  // 让「我的」页能回答「反复练的地方到底命中多少」。
  const segment = activeSegment.value;
  const gap = segment ? segmentDone.value.get(segment.index) !== true : false;
  let next = props.profile;
  if (gap) {
    next = recordGapAttempt(next, {
      source: "repertoire-segment",
      scoreId: score.id,
      hand: hand.value,
      onCount: payload.onCount,
      total: payload.total,
    });
  }
  if (payload.onCount < payload.total) {
    if (next !== props.profile) emit("update-profile", next);
    return;
  }
  emit("update-profile", bankPractice(next, score, followBpm.value));
}

function openSkillRoute(route: SkillRoute) {
  if (route.kind === "theory") {
    emit("open-theory", route.lessonId);
    return;
  }
  if (route.kind === "stage") {
    emit("open-stage", route.stageId);
    return;
  }
  emit("open-lesson", route.lessonId);
}

function ensurePlayer(): PreviewPlayer | null {
  const score = staffScore.value;
  const packageId = selected.value?.arrangement.packageId;
  if (!score || !packageId) return null;
  // 缓存键带上谱子 id：跟弹切到某一段时，示范播放也要换成那一段。
  const cacheKey = `${packageId}:${score.id}`;
  if (player && playerPackageId === cacheKey) return player;

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
  playerPackageId = cacheKey;
  totalBeats.value = next.totalBeats;
  next.setSpeed(speed.value);
  return next;
}

function stopPlayback() {
  player?.stop();
  player = null;
  playerPackageId = null;
  // 播放器没了，「正在播放」的状态也要跟着清零：换谱、收起跟弹之后
  // 新播放器是从头开始的，按钮不能还显示「暂停」。
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
  if (assessing.value) clearAssessment();
  speed.value = value;
  const next = ensurePlayer();
  next?.setSpeed(value);
}

function setHand(value: Hand | "BOTH") {
  if (assessing.value) clearAssessment();
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

    <div v-else class="filters" data-test="repertoire-filters">
      <input
        v-model="query"
        type="search"
        class="search"
        placeholder="搜曲名、作曲家或编配"
        aria-label="搜索曲目"
        data-test="repertoire-search"
      />
      <div class="levels" role="group" aria-label="按档位筛选">
        <button
          type="button"
          :class="{ active: levelFilter === 'all' }"
          :aria-pressed="levelFilter === 'all'"
          data-test="repertoire-level"
          data-level="all"
          @click="levelFilter = 'all'"
        >
          全部
        </button>
        <button
          v-for="level in levelOptions"
          :key="level"
          type="button"
          :class="{ active: levelFilter === level }"
          :aria-pressed="levelFilter === level"
          data-test="repertoire-level"
          :data-level="level"
          @click="levelFilter = level"
        >
          L{{ level }}
        </button>
      </div>
      <span class="filter-count" data-test="repertoire-count">
        {{ filteredSongs.length }} 首 · {{ filteredArrangements.length }} 个编配
      </span>
    </div>

    <p
      v-if="songs.length > 0 && filteredSongs.length === 0"
      class="empty"
      data-test="repertoire-empty"
    >
      没有匹配的曲目。
      <button type="button" class="link" data-test="repertoire-clear" @click="clearFilters">
        清除筛选
      </button>
    </p>

    <section v-for="song in filteredSongs" :key="song.songId" class="song" :data-song="song.songId">
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
          :data-level="arrangement.level"
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
        <p v-if="currentAssessmentText" class="muted assessment-best" data-test="repertoire-assessment-best">
          {{ currentAssessmentText }}
        </p>
        <p v-if="inheritanceText" class="muted assessment-inheritance" data-test="repertoire-inheritance">
          {{ inheritanceText }}
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
          :disabled="segments.length === 0 || assessing"
        >
          <option v-for="segment in segments" :key="segment.index" :value="segment.index">
            {{ segment.label }}{{ segmentDone.get(segment.index) ? " · 已弹对" : "" }}
          </option>
        </select>
        <button
          type="button"
          class="primary"
          data-test="repertoire-follow"
          :disabled="!followScore || assessing"
          @click="toggleFollow"
        >
          {{ assessing ? "评测中" : following ? "收起跟弹" : "跟弹本段" }}
        </button>
        <button
          type="button"
          class="assess"
          :class="{ active: assessing }"
          :aria-pressed="assessing"
          data-test="repertoire-assess"
          :disabled="!selectedScore || segments.length === 0"
          @click="toggleAssessment"
        >
          {{ assessing ? "退出整曲评测" : "整曲评测" }}
        </button>
        <button
          type="button"
          class="loop"
          :class="{ active: loop }"
          :aria-pressed="loop"
          :disabled="!activeSegment"
          data-test="repertoire-loop"
          @click="toggleLoop"
        >
          {{ loop ? "取消循环" : "循环本段" }}
        </button>
        <span class="segment-hint">只练这一段，可反复弹，不占用视奏额度。</span>
      </div>

      <p v-if="pickupHint" class="pickup-hint" data-test="repertoire-pickup">
        {{ pickupHint }}
      </p>

      <section v-if="assessing" class="assessment" data-test="repertoire-assessment">
        <div class="assessment-head">
          <strong>整曲评测</strong>
          <span>{{ assessmentProgress }}</span>
          <span class="assessment-summary" data-test="repertoire-assessment-summary">
            {{ assessmentSummary }}
          </span>
        </div>
        <ol class="assessment-list">
          <li
            v-for="segment in segments"
            :key="segment.index"
            :class="{
              done: assessmentResultFor(segment.index),
              current: segment.index === assessmentIndex,
            }"
            :data-test="`repertoire-assessment-segment-${segment.index}`"
          >
            <span>{{ segment.label }}</span>
            <span v-if="assessmentDetail(segment.index)" class="assessment-detail">
              {{ assessmentDetail(segment.index) }}
            </span>
            <span v-else-if="segment.index === assessmentIndex" class="assessment-current">当前</span>
            <span v-else class="muted">待测</span>
          </li>
        </ol>
        <div class="assessment-actions">
          <button
            v-if="assessmentIndex < segments.length - 1"
            type="button"
            class="primary"
            data-test="repertoire-assessment-next"
            :disabled="!assessmentResult"
            @click="nextAssessment"
          >
            下一段
          </button>
          <button
            type="button"
            data-test="repertoire-assessment-retry"
            :disabled="!assessmentResult"
            @click="retryAssessmentSegment"
          >
            重测本段
          </button>
          <button type="button" data-test="repertoire-assessment-restart" @click="startAssessment">
            从头评测
          </button>
        </div>
        <p v-if="assessmentComplete" class="assessment-complete" data-test="repertoire-assessment-complete">
          整曲评测完成：{{ assessmentSummary }}。分段结果已记录，可点「重测本段」刷新较弱的一段。
        </p>
      </section>

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

      <!-- 谱面在上、跟弹在下：眼睛看谱，手落在下面的琴键上 -->
      <ScoreFollow
        v-if="(following || assessing) && followScore"
        :key="followKey"
        :score="followScore"
        :hand="hand"
        :bpm="followBpm"
        prefix="repertoire"
        @done="onFollowDone"
      />

      <div class="info-grid">
        <section class="info" data-test="repertoire-skills">
          <h3>需要的技能</h3>
          <ul class="skill-list">
            <li
              v-for="skill in requiredSkills"
              :key="skill.id"
              :class="{ done: skill.done }"
              :data-skill="skill.id"
            >
              <span>{{ skill.done ? "✓" : "○" }} {{ skill.name }}</span>
              <small v-if="!skill.done && evidence.get(skill.id)" class="practiced">
                练过 · {{ evidence.get(skill.id)?.bpm ?? "—" }} BPM
              </small>
              <small v-else>L{{ skill.level }}</small>
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
                  <small v-if="evidence.get(item.skill.id)" class="practiced">
                    练过 · {{ evidence.get(item.skill.id)?.bpm ?? "—" }} BPM
                  </small>
                </span>
                <small>L{{ item.skill.level }}</small>
              </li>
            </ol>
            <p v-if="estimateText" class="muted estimate" data-test="repertoire-estimate">
              {{ estimateText }}
            </p>
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
              <p v-if="unroutedHigherMissing.length > 0" class="muted" data-test="repertoire-higher-gap">
                L4+ 的 {{ unroutedHigherMissing.map((skill) => skill.name).join("、") }} 暂无微课。
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

.filters {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.55rem;
  margin: 0 0 1rem;
}

.filters .search {
  flex: 1 1 16rem;
  min-width: 10rem;
  padding: 0.5rem 0.7rem;
  border: 1px solid var(--pb-border-soft);
  border-radius: var(--pb-radius);
  background: var(--pb-surface);
  color: var(--pb-ink);
  font-size: 0.85rem;
}

.levels {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}

.levels button {
  padding: 0.35rem 0.7rem;
  border: 1px solid var(--pb-border-soft);
  border-radius: var(--pb-radius-pill);
  background: transparent;
  color: var(--pb-muted);
  font-size: 0.8rem;
  cursor: pointer;
}

.levels button.active {
  border-color: var(--pb-accent);
  background: var(--pb-accent);
  color: var(--pb-accent-text);
}

.filter-count {
  color: var(--pb-muted);
  font-size: 0.78rem;
}

.empty {
  margin: 0 0 1rem;
  color: var(--pb-muted);
  font-size: 0.88rem;
}

.empty .link {
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--pb-accent);
  font-size: inherit;
  text-decoration: underline;
  text-underline-offset: 0.2rem;
  cursor: pointer;
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

/* 弱起提示贴着谱面：先解释「为什么第一小节少一截」，再看谱 */
.pickup-hint {
  margin: 0.5rem 0 0;
  padding: 0.4rem 0.7rem;
  border-left: 3px solid var(--pb-accent);
  background: var(--pb-tip-bg);
  color: var(--pb-ink);
  font-size: 0.82rem;
  line-height: 1.5;
}

.assessment-best,
.assessment-inheritance {
  margin: 0.25rem 0 0;
  font-size: 0.82rem;
  text-align: right;
}

/* 整曲评测：分段列表就是成绩单，当前段与已完成段用不同底色区分 */
.assessment {
  margin: 0.75rem 0;
  padding: var(--pb-space-2) var(--pb-space-3);
  border: 1px solid var(--pb-border-soft);
  border-radius: var(--pb-radius);
  background: var(--pb-surface-2);
}

.assessment-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.4rem 0.75rem;
  margin-bottom: 0.5rem;
}

.assessment-summary {
  margin-left: auto;
  color: var(--pb-accent-2);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.assessment-list {
  display: grid;
  gap: 0.3rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.assessment-list li {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.28rem 0.5rem;
  border-radius: var(--pb-radius);
  color: var(--pb-muted);
  font-size: 0.85rem;
}

.assessment-list li.current {
  background: var(--pb-surface);
  box-shadow: inset 3px 0 0 var(--pb-accent);
  color: var(--pb-ink);
}

.assessment-list li.done {
  color: var(--pb-ink);
}

.assessment-detail {
  font-variant-numeric: tabular-nums;
}

.assessment-current {
  color: var(--pb-accent-2);
  font-weight: 600;
}

.assessment-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--pb-space-2);
  margin-top: 0.6rem;
}

.assessment-complete {
  margin: 0.6rem 0 0;
  color: var(--pb-ok);
  font-size: 0.85rem;
  line-height: 1.5;
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

/* 循环开关：和速度/手的分段按钮同一视觉语言，激活时实心浅底 */
.segment-bar .loop {
  padding: 0.24rem 0.6rem;
  border: 1px solid var(--pb-border-soft);
  border-radius: var(--pb-radius-pill);
  background: transparent;
  color: var(--pb-ink);
  font-size: 0.82rem;
  cursor: pointer;
}

.segment-bar .loop.active {
  border-color: var(--pb-accent);
  background: var(--pb-surface);
  box-shadow: var(--pb-shadow-1);
  font-weight: 600;
}

.segment-bar .loop:disabled {
  cursor: not-allowed;
  opacity: 0.5;
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

/*
 * 「练过」是练习证据，不是掌握，也不该被看成动作：用虚线加弱色，
 * 和旁边实心描边的「去上课」按钮一眼区分开。
 */
.skill-list .practiced {
  padding: 0.05rem 0.4rem;
  border: 1px dashed var(--pb-border);
  border-radius: var(--pb-radius-pill);
  color: var(--pb-muted);
  font-size: 0.72rem;
  white-space: nowrap;
}

.practice {
  margin-top: 0.75rem;
  border-color: var(--pb-accent);
}

/* 耗时估算跟在补短板顺序下面：先看顺序，再看要练多久 */
.estimate {
  margin: 0.5rem 0 0;
  font-size: 0.85rem;
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
