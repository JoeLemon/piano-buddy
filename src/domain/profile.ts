import { isPass, type CompareResult } from "./compare";
import type { Hand, Score } from "./types";

export type Assessment = {
  knowsTreble: boolean;
  knowsBass: boolean;
  keepsPulse: boolean;
};

export type Profile = {
  assessment: Assessment | null;
  lessonId:
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
    | null;
  lessonPhase: "notes" | "lines";
  l1RightPassed: boolean;
  l1LeftPassed: boolean;
  failStreak: number;
  slowed: boolean;
  l2Passed: boolean;
  l2FailStreak: number;
  l2Slowed: boolean;
  weakPitchQueue: string[];
  findCorrect: number;
  linesCompleted: number;
  tapStreak: number;
  sightUses: Record<string, number>;
  errorSnippets: Score[];
  lastSeed: number;
  seenReadingTips: boolean;
  seenSightTips: boolean;
};

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
    weakPitchQueue: [],
    findCorrect: 0,
    linesCompleted: 0,
    tapStreak: 0,
    sightUses: {},
    errorSnippets: [],
    lastSeed: 1,
    seenReadingTips: false,
    seenSightTips: false,
  };
}

/** Fill missing fields when loading an older stored profile. */
export function mergeProfile(stored: Partial<Profile> | null | undefined): Profile {
  const base = initialProfile();
  if (!stored) return base;
  return {
    ...base,
    ...stored,
    assessment: stored.assessment ?? null,
    weakPitchQueue: stored.weakPitchQueue ?? [],
    sightUses: stored.sightUses ?? {},
    errorSnippets: stored.errorSnippets ?? [],
    seenReadingTips: stored.seenReadingTips ?? false,
    seenSightTips: stored.seenSightTips ?? false,
    l2Passed: stored.l2Passed ?? false,
    l2FailStreak: stored.l2FailStreak ?? 0,
    l2Slowed: stored.l2Slowed ?? false,
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

/** L1 stays per hand. L2 ignores hand and needs both L1 hands plus the L2 test. */
export function canEnterSightLevel(profile: Profile, level: 1 | 2, hand?: Hand): boolean {
  if (level === 1) return hand ? canEnterSight(profile, hand) : false;
  return canEnterL2(profile) && profile.l2Passed;
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

export function testBpmForLevel(profile: Profile, level: 1 | 2): number {
  if (level === 1) return testBpm(profile);
  return profile.l2Slowed ? 52 : 60;
}

// Task 4: collapse into passLimit(2) / isPass(result, 2).
const L2_PITCH_LIMIT = 2;
const L2_RHYTHM_LIMIT = 2;

function l2TestPassed(result: CompareResult): boolean {
  return result.pitchErrors <= L2_PITCH_LIMIT && result.rhythmBreaks < L2_RHYTHM_LIMIT;
}

export function applyL2TestResult(profile: Profile, result: CompareResult): Profile {
  if (l2TestPassed(result)) {
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

export function startL2IfReady(profile: Profile): Profile {
  if (!canEnterL2(profile)) return profile;
  if (profile.lessonId?.startsWith("L2")) return profile;
  return advanceLesson(profile, "L2-1");
}

const STEADY_GAP_MIN_MS = 800;
const STEADY_GAP_MAX_MS = 1200;
const TAP_GOAL = 8;
const FIND_GOAL = 8;
const LINE_GOAL = 2;

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
