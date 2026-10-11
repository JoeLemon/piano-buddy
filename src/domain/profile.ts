import type { Hand, Score } from "./types";

export type Assessment = {
  knowsTreble: boolean;
  knowsBass: boolean;
  keepsPulse: boolean;
};

export type Profile = {
  assessment: Assessment | null;
  lessonId: "L1-1" | "L1-2" | "L1-3" | "L1-4" | "L1-test" | null;
  lessonPhase: "notes" | "lines";
  l1RightPassed: boolean;
  l1LeftPassed: boolean;
  failStreak: number;
  slowed: boolean;
  weakPitchQueue: string[];
  findCorrect: number;
  linesCompleted: number;
  tapStreak: number;
  sightUses: Record<string, number>;
  errorSnippets: Score[];
  lastSeed: number;
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
    weakPitchQueue: [],
    findCorrect: 0,
    linesCompleted: 0,
    tapStreak: 0,
    sightUses: {},
    errorSnippets: [],
    lastSeed: 1,
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

export function recordLineFinished(profile: Profile): Profile {
  const countsLine = profile.lessonId === "L1-3"
    || (profile.lessonId === "L1-4" && profile.lessonPhase === "lines");
  if (!countsLine) return profile;
  const linesCompleted = profile.linesCompleted + 1;
  if (linesCompleted < LINE_GOAL) return { ...profile, linesCompleted };
  return advanceLesson(profile, profile.lessonId === "L1-3" ? "L1-4" : "L1-test");
}
