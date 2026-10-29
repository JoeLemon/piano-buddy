import { isPass, type CompareResult } from "./compare";
import type { Hand, Score } from "./types";
// 只引类型：账本的状态机在 repertoire/skillState，这里只负责它的持久化形状。
// 两侧都是 import type，编译后不留运行时依赖，不会形成循环。
import type { SkillLedger, SkillMastery } from "../repertoire/skillState";
import type { SkillState } from "../repertoire/skillGraph";

export type Assessment = {
  knowsTreble: boolean;
  knowsBass: boolean;
  keepsPulse: boolean;
};

/** 识谱主线里的课位。L3R 是 L3 和弦识谱课，L3 预备课仍单独记在 l3PrepCompleted。 */
export type LessonId =
  | "L1-1"
  | "L1-2"
  | "L1-3"
  | "L1-4"
  | "L1-test"
  | "L2-1"
  | "L2-2"
  | "L2-3"
  | "L2-4"
  | "L2-5"
  | "L2-6"
  | "L2-test"
  | "L3R-1"
  | "L3R-2"
  | "L3R-3"
  | "L3R-4"
  | "L3R-test";

/** 练习记录的类型，用于「今日 / 我的」汇总。 */
export type PracticeKind = "reading" | "sight" | "test" | "theory" | "l3" | "repertoire";

/**
 * 乐理路径的进度。
 *
 * 这是「主线课程 + L3 预备课」唯一的一份理论进度：`completed` 存已通过的
 * 节点 id，`best` 存每个节点最高答对数。`l3PrepCompleted` 作为旧档案的
 * 兼容镜像保留，加载时会自动并进来。
 */
export type TheoryProgress = {
  completed: string[];
  best: Record<string, number>;
};


export type PracticeEntry = {
  /** 完成时间（毫秒时间戳）。 */
  at: number;
  kind: PracticeKind;
  /** 本次实际练习时长，进入页面到离开/完成之间计时。 */
  ms: number;
};

/**
 * 乐理练习的按题型计数：key 是题型 id（notes/symbols/intervals/…）。
 *
 * 只累计「答了几题、答对几题」，不参与任何过关判定——技能是否过关由
 * 关卡通过线与技能账本说话，正确率只是给学生和自己看的趋势。
 */
export type PracticeStat = {
  answered: number;
  correct: number;
};

export type PracticeStats = Record<string, PracticeStat>;

export type Profile = {
  assessment: Assessment | null;
  lessonId: LessonId | null;
  lessonPhase: "notes" | "lines";
  l1RightPassed: boolean;
  l1LeftPassed: boolean;
  failStreak: number;
  slowed: boolean;
  l2Passed: boolean;
  l2FailStreak: number;
  l2Slowed: boolean;
  /** L3 和弦识谱过关；不等于 L3 预备课完成。 */
  l3Passed: boolean;
  l3FailStreak: number;
  l3Slowed: boolean;
  weakPitchQueue: string[];
  findCorrect: number;
  linesCompleted: number;
  tapStreak: number;
  sightUses: Record<string, number>;
  errorSnippets: Score[];
  lastSeed: number;
  seenReadingTips: boolean;
  seenSightTips: boolean;
  /** 已完成的 L3 预备课 id；只表示上过课，不等于技能已过关。 */
  l3PrepCompleted: string[];
  /** 乐理路径的唯一进度（基础十关 + L3 预备课）。 */
  theoryPath: TheoryProgress;
  /** 一条一条的练习记录；只保留最近 400 条，避免档案无限增长。 */
  practiceLog: PracticeEntry[];
  /**
   * 技能掌握账本：课内完成、曲库跟弹写的都是 learning，只有过关测试写 passed。
   * 两条学习路径（按部就班 / 先选曲）因此共用同一份状态。
   */
  skillLedger: SkillLedger;
  /** 整段弹对过的切片谱 id（id 已含编配、小节与手别，换手要重新弹对）。 */
  followedSegments: string[];
  /** 乐理练习按题型的累计答数/答对数；只做统计，不写过关。 */
  practiceStats: PracticeStats;
};

const PRACTICE_KINDS: readonly PracticeKind[] = [
  "reading",
  "sight",
  "test",
  "theory",
  "l3",
  "repertoire",
];

export function initialProfile(): Profile {
  return {
    assessment: null,
    lessonId: null,
    lessonPhase: "notes",
    l1RightPassed: false,
    l1LeftPassed: false,
    failStreak: 0,
    slowed: false,
    l2Passed: false,
    l2FailStreak: 0,
    l2Slowed: false,
    l3Passed: false,
    l3FailStreak: 0,
    l3Slowed: false,
    weakPitchQueue: [],
    findCorrect: 0,
    linesCompleted: 0,
    tapStreak: 0,
    sightUses: {},
    errorSnippets: [],
    lastSeed: 1,
    seenReadingTips: false,
    seenSightTips: false,
    l3PrepCompleted: [],
    theoryPath: { completed: [], best: {} },
    practiceLog: [],
    skillLedger: {},
    followedSegments: [],
    practiceStats: {},
  };
}

/** Fill missing fields when loading an older stored profile. */
export function mergeProfile(stored: Partial<Profile> | null | undefined): Profile {
  const base = initialProfile();
  if (!stored) return base;
  const l3PrepCompleted = normalizeStringArray(stored.l3PrepCompleted);
  const theoryPath = normalizeTheoryProgress(stored.theoryPath, l3PrepCompleted);
  // 不整体 spread stored：旧档案里被移除的字段（如 curriculumCompleted）不该被带回来。
  return {
    ...base,
    assessment: stored.assessment ?? null,
    lessonId: stored.lessonId ?? null,
    lessonPhase: stored.lessonPhase === "lines" ? "lines" : "notes",
    l1RightPassed: stored.l1RightPassed ?? false,
    l1LeftPassed: stored.l1LeftPassed ?? false,
    failStreak: stored.failStreak ?? 0,
    slowed: stored.slowed ?? false,
    l2Passed: stored.l2Passed ?? false,
    l2FailStreak: stored.l2FailStreak ?? 0,
    l2Slowed: stored.l2Slowed ?? false,
    l3Passed: stored.l3Passed ?? false,
    l3FailStreak: stored.l3FailStreak ?? 0,
    l3Slowed: stored.l3Slowed ?? false,
    weakPitchQueue: stored.weakPitchQueue ?? [],
    findCorrect: stored.findCorrect ?? 0,
    linesCompleted: stored.linesCompleted ?? 0,
    tapStreak: stored.tapStreak ?? 0,
    sightUses: stored.sightUses ?? {},
    errorSnippets: stored.errorSnippets ?? [],
    lastSeed: stored.lastSeed ?? 1,
    seenReadingTips: stored.seenReadingTips ?? false,
    seenSightTips: stored.seenSightTips ?? false,
    // L3 旧字段作为镜像保留：从 theoryPath 里补齐，避免两条线显示不一致。
    l3PrepCompleted: uniqueStrings([
      ...l3PrepCompleted,
      ...theoryPath.completed.filter(isL3PrepId),
    ]),
    theoryPath,
    practiceLog: normalizePracticeLog(stored.practiceLog),
    skillLedger: normalizeSkillLedger(stored.skillLedger),
    followedSegments: normalizeStringArray(stored.followedSegments).slice(-MAX_FOLLOWED_SEGMENTS),
    practiceStats: normalizePracticeStats(stored.practiceStats),
  };
}

/** 「已弹对」的段落在内容不变时不会太多；留个上限防止档案无限增长。 */
const MAX_FOLLOWED_SEGMENTS = 200;

/** 记一段「整段弹对」；同一段重复弹对不占新位置，只保留最近 MAX 条。 */
export function markSegmentFollowed(profile: Profile, scoreId: string): Profile {
  if (!scoreId || profile.followedSegments.includes(scoreId)) return profile;
  return {
    ...profile,
    followedSegments: [...profile.followedSegments, scoreId].slice(-MAX_FOLLOWED_SEGMENTS),
  };
}

const SKILL_STATES: readonly SkillState[] = ["locked", "learning", "passed"];
const SKILL_HANDS: readonly SkillMastery["hand"][] = ["RH", "LH", "both", "none"];

/**
 * 校验存盘账本：只做结构检查，不检查技能 id 是否在图谱里。
 *
 * 未知 id 天然无害——读取方都遍历图谱再查账本，对不上的条目永远不会被匹配到。
 * 真正要防的是坏形状（null、字符串、超范围 confidence）把界面带崩。
 */
function normalizeSkillLedger(value: unknown): SkillLedger {
  if (!value || typeof value !== "object") return {};
  const out: SkillLedger = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!key.includes("@")) continue;
    const item = raw as Partial<SkillMastery> | null;
    if (!item || typeof item !== "object") continue;
    const skillId = typeof item.skillId === "string" ? item.skillId : "";
    if (!skillId) continue;
    const state = SKILL_STATES.includes(item.state as SkillState)
      ? (item.state as SkillState)
      : "learning";
    const hand = SKILL_HANDS.includes(item.hand as SkillMastery["hand"])
      ? (item.hand as SkillMastery["hand"])
      : "both";
    const confidence =
      typeof item.confidence === "number" && Number.isFinite(item.confidence)
        ? Math.min(1, Math.max(0, item.confidence))
        : 0;
    out[key] = {
      skillId,
      hand,
      state,
      confidence,
      bpm: finiteOrUndefined(item.bpm),
      masteredAt: finiteOrUndefined(item.masteredAt),
      lastPracticedAt: finiteOrUndefined(item.lastPracticedAt),
    };
  }
  return out;
}

function finiteOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isL3PrepId(id: string): boolean {
  return /^L3-\d+$/.test(id);
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return uniqueStrings(value.filter((id): id is string => typeof id === "string" && id.length > 0));
}

function normalizeTheoryProgress(value: unknown, legacy: readonly string[] = []): TheoryProgress {
  const completed = new Set<string>(legacy.filter(isL3PrepId));
  const best: Record<string, number> = {};
  if (value && typeof value === "object") {
    const candidate = value as Partial<TheoryProgress>;
    for (const id of normalizeStringArray(candidate.completed)) completed.add(id);
    if (candidate.best && typeof candidate.best === "object") {
      for (const [id, score] of Object.entries(candidate.best)) {
        if (typeof score === "number" && Number.isFinite(score) && score >= 0) {
          best[id] = score;
        }
      }
    }
  }
  return { completed: [...completed], best };
}

function uniqueStrings(items: readonly string[]): string[] {
  return [...new Set(items)];
}

/** 非负整数；坏数据（负数、小数、NaN、字符串）一律视为不存在。 */
function countOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

/**
 * 校验存盘练习统计：只做结构检查，不检查题型 id 是否还存在。
 *
 * 和技能账本一个思路——认不出的题型天然无害（读取方按当前题型查表，对不上
 * 就不显示）。真正要防的是坏形状把界面带崩：答对数超过答数是最典型的
 * （旧版本 bug 或手改档案），这里夹回 answered。
 */
function normalizePracticeStats(value: unknown): PracticeStats {
  if (!value || typeof value !== "object") return {};
  const out: PracticeStats = {};
  for (const [kind, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!kind) continue;
    const item = raw as Partial<PracticeStat> | null;
    if (!item || typeof item !== "object") continue;
    const answered = countOrUndefined(item.answered);
    if (answered === undefined || answered === 0) continue;
    const correct = Math.min(countOrUndefined(item.correct) ?? 0, answered);
    out[kind] = { answered, correct };
  }
  return out;
}

/**
 * 记一次乐理练习结果：按题型累计答数与答对数。
 *
 * 只写计数——一次练习答得好不构成「技能已过关」，过关始终走
 * `recordTheoryResult`（关卡通过线）与技能账本两条既有通道。
 */
export function recordPracticeAnswer(
  profile: Profile,
  kind: string,
  correct: boolean,
): Profile {
  if (!kind) return profile;
  const current = profile.practiceStats[kind];
  const answered = (current?.answered ?? 0) + 1;
  const next: PracticeStat = {
    answered,
    correct: (current?.correct ?? 0) + (correct ? 1 : 0),
  };
  if (current && current.answered === next.answered && current.correct === next.correct) {
    return profile;
  }
  return { ...profile, practiceStats: { ...profile.practiceStats, [kind]: next } };
}

/** 某题型的累计正确率（百分比）；没答过返回 null，界面即可不显示。 */
export function practiceAccuracy(stats: PracticeStats, kind: string): number | null {
  const item = stats[kind];
  if (!item || item.answered <= 0) return null;
  return Math.round((item.correct / item.answered) * 100);
}

/** 全部题型合计的答数/答对数，给「我的」页汇总用。 */
export function practiceStatsTotals(stats: PracticeStats): PracticeStat {
  let answered = 0;
  let correct = 0;
  for (const item of Object.values(stats)) {
    answered += item.answered;
    correct += item.correct;
  }
  return { answered, correct };
}

function normalizePracticeLog(value: unknown): PracticeEntry[] {
  if (!Array.isArray(value)) return [];
  const entries = value.filter((entry): entry is PracticeEntry => {
    if (!entry || typeof entry !== "object") return false;
    const candidate = entry as Partial<PracticeEntry>;
    return (
      typeof candidate.at === "number"
      && Number.isFinite(candidate.at)
      && typeof candidate.ms === "number"
      && Number.isFinite(candidate.ms)
      && candidate.ms > 0
      && typeof candidate.kind === "string"
      && PRACTICE_KINDS.includes(candidate.kind as PracticeKind)
    );
  });
  return entries.slice(-400);
}

/** 记录一节 L3 预备课完成；只写“上过”，不写技能 passed。 */
export function completeL3PrepLesson(profile: Profile, lessonId: string): Profile {
  if (!lessonId) return profile;
  const progress = normalizeTheoryProgress(profile.theoryPath, profile.l3PrepCompleted);
  const alreadyL3 = profile.l3PrepCompleted.includes(lessonId);
  const alreadyPath = progress.completed.includes(lessonId);
  if (alreadyL3 && alreadyPath) return profile;
  return {
    ...profile,
    l3PrepCompleted: uniqueStrings([...profile.l3PrepCompleted, lessonId]),
    theoryPath: {
      completed: uniqueStrings([...progress.completed, ...profile.l3PrepCompleted, lessonId]),
      best: progress.best,
    },
  };
}

/**
 * 写一次乐理路径结果：最高答对数总是更新，达到通过线才标记完成。
 *
 * 基础十关和 L3 预备课共用这一份进度；L3 课自己的「上过课」仍由
 * `completeL3PrepLesson` 写入，两处通过 `theoryPath.completed` 对齐。
 */
export function recordTheoryResult(
  profile: Profile,
  nodeId: string,
  score: number,
  passScore: number,
): Profile {
  if (!nodeId || !Number.isFinite(score) || score < 0) return profile;
  const progress = normalizeTheoryProgress(profile.theoryPath, profile.l3PrepCompleted);
  const previousBest = progress.best[nodeId] ?? 0;
  const best = Math.max(previousBest, Math.floor(score));
  const completed = score >= passScore
    ? uniqueStrings([...progress.completed, nodeId])
    : progress.completed;
  const l3PrepCompleted = nodeId.startsWith("L3-") && completed.includes(nodeId)
    ? uniqueStrings([...profile.l3PrepCompleted, nodeId])
    : profile.l3PrepCompleted;

  if (
    best === previousBest
    && completed.length === progress.completed.length
    && l3PrepCompleted.length === profile.l3PrepCompleted.length
  ) {
    return profile;
  }

  return {
    ...profile,
    l3PrepCompleted,
    theoryPath: { completed, best: { ...progress.best, [nodeId]: best } },
  };
}

/** Drop a sight line from the error book once it has been used twice. */
export function pruneExhaustedErrorSnippet(profile: Profile, scoreId: string): Profile {
  const uses = profile.sightUses[scoreId] ?? 0;
  if (uses < 2) return profile;
  if (!profile.errorSnippets.some((item) => item.id === scoreId)) return profile;
  return {
    ...profile,
    errorSnippets: profile.errorSnippets.filter((item) => item.id !== scoreId),
  };
}

export function routeAfterAssessment(
  assessment: Assessment,
): { kind: "lesson"; lessonId: "L1-1" } | { kind: "test"; hands: Hand[] } {
  if (!assessment.knowsTreble || !assessment.keepsPulse) {
    return { kind: "lesson", lessonId: "L1-1" };
  }
  if (!assessment.knowsBass) {
    return { kind: "test", hands: ["RH"] };
  }
  return { kind: "test", hands: ["RH", "LH"] };
}

export function applyAssessment(profile: Profile, assessment: Assessment): Profile {
  const route = routeAfterAssessment(assessment);
  return {
    ...profile,
    assessment,
    lessonId: route.kind === "lesson" ? "L1-1" : "L1-test",
  };
}

export function canEnterSight(profile: Profile, hand: Hand): boolean {
  return hand === "RH" ? profile.l1RightPassed : profile.l1LeftPassed;
}

export function canEnterL2(profile: Profile): boolean {
  return profile.l1RightPassed && profile.l1LeftPassed;
}

/** L3 和弦识谱需要先过 L2；L3 预备课不是前置，避免把两条线绑死。 */
export function canEnterL3(profile: Profile): boolean {
  return canEnterL2(profile) && profile.l2Passed;
}

/** L1 stays per hand. L2/L3 need the previous level's pass. */
export function canEnterSightLevel(profile: Profile, level: 1 | 2 | 3, hand?: Hand): boolean {
  if (level === 1) return hand ? canEnterSight(profile, hand) : false;
  if (level === 2) return canEnterL2(profile) && profile.l2Passed;
  return canEnterL3(profile) && profile.l3Passed;
}

export function registerSightUse(
  profile: Profile,
  scoreId: string,
): { profile: Profile; allowed: boolean } {
  const uses = profile.sightUses[scoreId] ?? 0;
  if (uses >= 2) return { profile, allowed: false };
  return {
    profile: {
      ...profile,
      sightUses: { ...profile.sightUses, [scoreId]: uses + 1 },
    },
    allowed: true,
  };
}

export function testBpm(profile: Profile): number {
  return profile.slowed ? Math.max(44, 52) : 60;
}

export function testBpmForLevel(profile: Profile, level: 1 | 2 | 3): number {
  if (level === 1) return testBpm(profile);
  if (level === 2) return profile.l2Slowed ? 52 : 60;
  return profile.l3Slowed ? 52 : 60;
}

export function applyL2TestResult(profile: Profile, result: CompareResult): Profile {
  if (isPass(result, 2)) {
    // match L1: slowed stays after pass
    return { ...profile, l2Passed: true, l2FailStreak: 0 };
  }
  const l2FailStreak = profile.l2FailStreak + 1;
  return {
    ...profile,
    l2FailStreak,
    l2Slowed: profile.l2Slowed || l2FailStreak >= 3,
  };
}

export function applyL3TestResult(profile: Profile, result: CompareResult): Profile {
  if (isPass(result, 3)) {
    return { ...profile, l3Passed: true, l3FailStreak: 0 };
  }
  const l3FailStreak = profile.l3FailStreak + 1;
  return {
    ...profile,
    l3FailStreak,
    l3Slowed: profile.l3Slowed || l3FailStreak >= 3,
  };
}

export function startL2IfReady(profile: Profile): Profile {
  if (!canEnterL2(profile)) return profile;
  if (profile.lessonId?.startsWith("L2")) return profile;
  return advanceLesson(profile, "L2-1");
}

export function startL3IfReady(profile: Profile): Profile {
  if (!canEnterL3(profile) || profile.l3Passed) return profile;
  if (profile.lessonId?.startsWith("L3R")) return profile;
  return advanceLesson(profile, "L3R-1");
}

const STEADY_GAP_MIN_MS = 800;
const STEADY_GAP_MAX_MS = 1200;
const TAP_GOAL = 8;
const FIND_GOAL = 8;
const LINE_GOAL = 2;
const L3_LINE_GOAL = 2;

function advanceLesson(profile: Profile, lessonId: NonNullable<Profile["lessonId"]>): Profile {
  return {
    ...profile,
    lessonId,
    lessonPhase: "notes",
    findCorrect: 0,
    linesCompleted: 0,
    tapStreak: 0,
  };
}

function isFindLesson(profile: Profile): boolean {
  return profile.lessonId === "L1-2"
    || (profile.lessonId === "L1-4" && profile.lessonPhase === "notes");
}

export function recordTap(profile: Profile, gapMs: number | null): Profile {
  if (profile.lessonId !== "L1-1" || gapMs === null) return profile;
  if (gapMs < STEADY_GAP_MIN_MS || gapMs > STEADY_GAP_MAX_MS) {
    return { ...profile, tapStreak: 0 };
  }
  const tapStreak = profile.tapStreak + 1;
  if (tapStreak < TAP_GOAL) return { ...profile, tapStreak };
  return advanceLesson(profile, "L1-2");
}

export function recordFindKey(profile: Profile, targetLabel: string, correct: boolean): Profile {
  if (!isFindLesson(profile)) return profile;
  if (!correct) {
    return {
      ...profile,
      weakPitchQueue: [...profile.weakPitchQueue, targetLabel, targetLabel],
    };
  }
  const findCorrect = profile.findCorrect + 1;
  if (findCorrect < FIND_GOAL) return { ...profile, findCorrect };
  if (profile.lessonId === "L1-2") return advanceLesson(profile, "L1-3");
  return { ...profile, findCorrect, lessonPhase: "lines" };
}

/** L2-4 / L2-5 找键：每只手各认 8 个，合计 16 个。 */
const L2_FIND_GOAL = FIND_GOAL * 2;

function isL2FindLesson(profile: Profile): boolean {
  return profile.lessonId === "L2-4" || profile.lessonId === "L2-5";
}

/** 没认满 8 个用右手，认满 8 个换左手。 */
export function l2FindHand(profile: Profile): Hand {
  return profile.findCorrect < FIND_GOAL ? "RH" : "LH";
}

/** L2 找键不因弹错回退，只记正确的次数；每手 8 个。 */
export function recordL2FindKey(profile: Profile, correct: boolean): Profile {
  if (!isL2FindLesson(profile)) return profile;
  if (!correct) return profile;
  const findCorrect = profile.findCorrect + 1;
  if (findCorrect < L2_FIND_GOAL) return { ...profile, findCorrect };
  return advanceLesson(profile, profile.lessonId === "L2-4" ? "L2-5" : "L2-6");
}

export function applyTestResult(
  profile: Profile,
  hands: Hand[],
  results: CompareResult[],
): Profile {
  let next: Profile = { ...profile };
  let anyFailed = false;
  let rightPassed = false;
  for (let index = 0; index < hands.length; index++) {
    const hand = hands[index];
    const result = results[index];
    if (!result || !isPass(result, 1)) {
      anyFailed = true;
      continue;
    }
    if (hand === "RH") {
      rightPassed = true;
      next = { ...next, l1RightPassed: true };
    } else {
      next = { ...next, l1LeftPassed: true };
    }
  }
  if (anyFailed) {
    const failStreak = next.failStreak + 1;
    next = { ...next, failStreak, slowed: next.slowed || failStreak >= 3 };
  } else {
    next = { ...next, failStreak: 0 };
  }
  if (rightPassed && !hands.includes("LH")) return advanceLesson(next, "L1-4");
  return next;
}

export function recordLineFinished(profile: Profile): Profile {
  const countsLine = profile.lessonId === "L1-3"
    || (profile.lessonId === "L1-4" && profile.lessonPhase === "lines");
  if (!countsLine) return profile;
  const linesCompleted = profile.linesCompleted + 1;
  if (linesCompleted < LINE_GOAL) return { ...profile, linesCompleted };
  return advanceLesson(profile, profile.lessonId === "L1-3" ? "L1-4" : "L1-test");
}

/** L3 和弦课的推进：每条线完成后写入；第四课结束进入 L3 过关。 */
export function recordL3Line(profile: Profile): Profile {
  const lessonId = profile.lessonId;
  if (!lessonId || !lessonId.startsWith("L3R-") || lessonId === "L3R-test") return profile;
  const linesCompleted = profile.linesCompleted + 1;
  if (linesCompleted < L3_LINE_GOAL) return { ...profile, linesCompleted };
  const next: NonNullable<Profile["lessonId"]> = lessonId === "L3R-1"
    ? "L3R-2"
    : lessonId === "L3R-2"
      ? "L3R-3"
      : lessonId === "L3R-3"
        ? "L3R-4"
        : "L3R-test";
  return advanceLesson(profile, next);
}

/** 从「曲库缺技能」跳课时只改课位，不动已经通过的 L1/L2/L3 结果。 */
export function jumpToLesson(profile: Profile, lessonId: LessonId): Profile {
  return {
    ...profile,
    lessonId,
    lessonPhase: "notes",
    findCorrect: 0,
    linesCompleted: 0,
    tapStreak: 0,
  };
}
