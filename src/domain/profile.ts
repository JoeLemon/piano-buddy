import { isPass, type CompareResult } from "./compare";
import type { Hand, Score } from "./types";

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

export type PracticeEntry = {
  /** 完成时间（毫秒时间戳）。 */
  at: number;
  kind: PracticeKind;
  /** 本次实际练习时长，进入页面到离开/完成之间计时。 */
  ms: number;
};

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
  /** 一条一条的练习记录；只保留最近 400 条，避免档案无限增长。 */
  practiceLog: PracticeEntry[];
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
    practiceLog: [],
  };
}

/** Fill missing fields when loading an older stored profile. */
export function mergeProfile(stored: Partial<Profile> | null | undefined): Profile {
  const base = initialProfile();
  if (!stored) return base;
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
    l3PrepCompleted: Array.isArray(stored.l3PrepCompleted)
      ? [...new Set(stored.l3PrepCompleted.filter((id): id is string => typeof id === "string"))]
      : [],
    practiceLog: normalizePracticeLog(stored.practiceLog),
  };
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
  if (!lessonId || profile.l3PrepCompleted.includes(lessonId)) return profile;
  return {
    ...profile,
    l3PrepCompleted: [...profile.l3PrepCompleted, lessonId],
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
