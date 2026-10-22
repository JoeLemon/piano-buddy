import { describe, expect, it } from "vitest";
import {
  canEnterL3,
  canEnterSightLevel,
  initialProfile,
  jumpToLesson,
  recordL3Line,
  startL3IfReady,
  type Profile,
} from "../src/domain/profile";

function l2Passed(partial: Partial<Profile> = {}): Profile {
  return {
    ...initialProfile(),
    assessment: { knowsTreble: true, knowsBass: true, keepsPulse: true },
    lessonId: "L2-test",
    l1RightPassed: true,
    l1LeftPassed: true,
    l2Passed: true,
    ...partial,
  };
}

describe("L3 lesson progression", () => {
  it("requires L1 and L2 before the chord course starts", () => {
    expect(canEnterL3(initialProfile())).toBe(false);
    expect(canEnterL3({ ...initialProfile(), l1RightPassed: true, l1LeftPassed: true })).toBe(false);
    expect(canEnterL3(l2Passed())).toBe(true);
    expect(startL3IfReady(initialProfile()).lessonId).not.toBe("L3R-1");
    expect(startL3IfReady(l2Passed()).lessonId).toBe("L3R-1");
  });

  it("moves through the four chord lessons two lines at a time", () => {
    let profile = l2Passed({ lessonId: "L3R-1", linesCompleted: 0 });

    for (const expected of ["L3R-2", "L3R-3", "L3R-4", "L3R-test"]) {
      profile = recordL3Line(profile);
      expect(profile.lessonId).not.toBe(expected);
      profile = recordL3Line(profile);
      expect(profile.lessonId).toBe(expected);
      expect(profile.linesCompleted).toBe(0);
    }
  });

  it("does not start the chord course again after L3 has passed", () => {
    const passed = l2Passed({ lessonId: "L3R-test", l3Passed: true });
    expect(startL3IfReady(passed)).toBe(passed);
    expect(canEnterSightLevel(passed, 3)).toBe(true);
    expect(canEnterSightLevel(passed, 3, "RH")).toBe(true);
  });

  it("jumps to a lesson for the repertoire gap list without clearing passes", () => {
    const profile = jumpToLesson(
      l2Passed({ lessonId: "L3R-4", linesCompleted: 1, findCorrect: 7 }),
      "L1-2",
    );
    expect(profile.lessonId).toBe("L1-2");
    expect(profile.linesCompleted).toBe(0);
    expect(profile.findCorrect).toBe(0);
    expect(profile.l1RightPassed).toBe(true);
    expect(profile.l2Passed).toBe(true);
  });
});
