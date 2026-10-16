import { describe, expect, it } from "vitest";
import {
  currentLessonIndex,
  homeLessonLabel,
  lessonGoalText,
  lessonStepLabel,
  lessonSteps,
} from "../src/domain/lessonProgress";
import {
  applyL2TestResult,
  canEnterL2,
  canEnterSight,
  canEnterSightLevel,
  initialProfile,
  mergeProfile,
  startL2IfReady,
  testBpmForLevel,
  type Profile,
} from "../src/domain/profile";

describe("L2 profile gates", () => {
  it("blocks L2 until both L1 hands passed", () => {
    const one = { ...initialProfile(), l1RightPassed: true };
    expect(canEnterL2(one)).toBe(false);
    const both = { ...one, l1LeftPassed: true };
    expect(canEnterL2(both)).toBe(true);
    expect(canEnterSightLevel(both, 2)).toBe(false);
    const passed = applyL2TestResult(both, {
      pitchErrors: 0, rhythmBreaks: 0, firstWrongLabel: null,
      wrongPitchNoteIds: [], lateNoteIds: [],
    });
    expect(passed.l2Passed).toBe(true);
    expect(canEnterSightLevel(passed, 2)).toBe(true);
  });

  it("slows L2 only after three fails and merges missing fields", () => {
    let p = { ...initialProfile(), l1RightPassed: true, l1LeftPassed: true };
    const fail = {
      pitchErrors: 3, rhythmBreaks: 0, firstWrongLabel: "C4",
      wrongPitchNoteIds: ["a"], lateNoteIds: [],
    };
    p = applyL2TestResult(p, fail);
    p = applyL2TestResult(p, fail);
    expect(p.l2Slowed).toBe(false);
    p = applyL2TestResult(p, fail);
    expect(p.l2Slowed).toBe(true);
    expect(testBpmForLevel(p, 2)).toBe(52);
    expect(mergeProfile({ l1RightPassed: true }).l2Passed).toBe(false);
    expect(startL2IfReady({ ...initialProfile(), l1RightPassed: true, l1LeftPassed: true, lessonId: "L1-test" }).lessonId).toBe("L2-1");
  });

  it("keeps L1 sight and tempo separate from the L2 streak", () => {
    const rightOnly = { ...initialProfile(), l1RightPassed: true, failStreak: 1, slowed: false };
    expect(canEnterSight(rightOnly, "RH")).toBe(true);
    expect(canEnterSight(rightOnly, "LH")).toBe(false);
    expect(canEnterSightLevel(rightOnly, 1, "RH")).toBe(true);
    expect(canEnterSightLevel(rightOnly, 1, "LH")).toBe(false);
    expect(canEnterSightLevel(rightOnly, 2)).toBe(false);

    const both = { ...initialProfile(), l1RightPassed: true, l1LeftPassed: true };
    const withinLimit = applyL2TestResult(both, {
      pitchErrors: 2, rhythmBreaks: 1, firstWrongLabel: null,
      wrongPitchNoteIds: [], lateNoteIds: [],
    });
    expect(withinLimit.l2Passed).toBe(true);
    expect(withinLimit.failStreak).toBe(0);
    expect(withinLimit.slowed).toBe(false);

    const late = applyL2TestResult(both, {
      pitchErrors: 0, rhythmBreaks: 2, firstWrongLabel: null,
      wrongPitchNoteIds: [], lateNoteIds: ["a", "b"],
    });
    expect(late.l2Passed).toBe(false);
    expect(late.l2FailStreak).toBe(1);
    expect(late.failStreak).toBe(0);
    expect(late.slowed).toBe(false);
    expect(testBpmForLevel(both, 2)).toBe(60);
    expect(testBpmForLevel({ ...both, slowed: true }, 1)).toBe(52);

    const stayed = startL2IfReady({ ...both, lessonId: "L2-3" });
    expect(stayed.lessonId).toBe("L2-3");
    expect(startL2IfReady(rightOnly).lessonId).toBeNull();
    expect(canEnterSightLevel(withinLimit, 2, "LH")).toBe(true);
  });
});

describe("L2 lesson progress copy", () => {
  it("keeps the five L1 steps and adds L2 line and find-key goals", () => {
    expect(lessonSteps()).toEqual(["L1-1", "L1-2", "L1-3", "L1-4", "L1-test"]);
    expect(lessonSteps(2)).toEqual(["L2-1", "L2-2", "L2-3", "L2-4", "L2-5", "L2-6", "L2-test"]);

    const line = { ...initialProfile(), lessonId: "L2-1" as Profile["lessonId"], linesCompleted: 1 };
    expect(lessonGoalText(line)).toBe("短句 1/2");
    expect(lessonGoalText({ ...line, lessonId: "L2-2", linesCompleted: 0 })).toBe("短句 0/2");
    expect(lessonGoalText({ ...line, lessonId: "L2-3", linesCompleted: 0 })).toBe("短句 0/2");
    expect(lessonGoalText({ ...line, lessonId: "L2-6", linesCompleted: 0 })).toBe("短句 0/2");
    expect(lessonStepLabel("L2-1")).toBe("八分音符");

    const find = { ...initialProfile(), lessonId: "L2-4" as Profile["lessonId"], findCorrect: 3 };
    expect(lessonGoalText(find)).toBe("找键 3/8");
    expect(lessonGoalText({ ...find, lessonId: "L2-5", findCorrect: 0 })).toBe("找键 0/8");
    expect(lessonStepLabel("L2-4")).toBe("F 五指");
    expect(lessonStepLabel("L2-5")).toBe("G 五指");
    expect(lessonStepLabel("L2-6")).toBe("五指平移");
    expect(lessonGoalText({ ...initialProfile(), lessonId: "L2-test" })).toBe("过关测试");
    expect(currentLessonIndex(find)).toBe(3);
    expect(homeLessonLabel({
      ...initialProfile(),
      l1RightPassed: true,
      l1LeftPassed: true,
      lessonId: "L2-1",
    })).toBe("当前：八分音符");
  });
});
