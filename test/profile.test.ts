import { describe, expect, it } from "vitest";
import {
  applyAssessment,
  canEnterSight,
  initialProfile,
  registerSightUse,
  routeAfterAssessment,
  testBpm,
} from "../src/domain/profile";

describe("profile", () => {
  it("does not unlock sight reading from the questionnaire", () => {
    const profile = applyAssessment(initialProfile(), {
      knowsTreble: true,
      knowsBass: true,
      keepsPulse: true,
    });
    expect(profile.lessonId).toBe("L1-test");
    expect(canEnterSight(profile, "RH")).toBe(false);
    expect(canEnterSight(profile, "LH")).toBe(false);
  });

  it("sends a complete beginner to the pulse lesson", () => {
    expect(routeAfterAssessment({
      knowsTreble: false,
      knowsBass: false,
      keepsPulse: false,
    })).toEqual({ kind: "lesson", lessonId: "L1-1" });
  });

  it("tests only the right hand when the bass clef is unknown", () => {
    expect(routeAfterAssessment({
      knowsTreble: true,
      knowsBass: false,
      keepsPulse: true,
    })).toEqual({ kind: "test", hands: ["RH"] });
  });

  it("allows a sight line twice and blocks the third play", () => {
    let profile = initialProfile();
    profile = { ...profile, l1RightPassed: true };
    const first = registerSightUse(profile, "l1-RH-1");
    const second = registerSightUse(first.profile, "l1-RH-1");
    const third = registerSightUse(second.profile, "l1-RH-1");
    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true);
    expect(third.allowed).toBe(false);
  });

  it("drops the test tempo by 8 bpm once after three failures", () => {
    const profile = { ...initialProfile(), failStreak: 3, slowed: true };
    expect(testBpm(initialProfile())).toBe(60);
    expect(testBpm(profile)).toBe(52);
  });
});
