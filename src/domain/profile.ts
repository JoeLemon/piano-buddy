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
