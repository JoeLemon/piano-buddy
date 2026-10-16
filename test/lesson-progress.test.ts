import { describe, expect, it } from "vitest";
import {
  currentLessonIndex,
  homeLessonLabel,
  lessonAdvanceCopy,
  lessonGoalText,
  lessonSteps,
} from "../src/domain/lessonProgress";
import { initialProfile } from "../src/domain/profile";

describe("lessonProgress", () => {
  it("lists the five L1 steps and reports the current goal", () => {
    expect(lessonSteps()).toEqual(["L1-1", "L1-2", "L1-3", "L1-4", "L1-test"]);
    const tapping = { ...initialProfile(), lessonId: "L1-1" as const, tapStreak: 3 };
    expect(currentLessonIndex(tapping)).toBe(0);
    expect(lessonGoalText(tapping)).toBe("稳拍 3/8");
    expect(homeLessonLabel(tapping)).toBe("当前：跟拍");
  });

  it("returns the advance sentence between lessons", () => {
    expect(lessonAdvanceCopy("L1-1", "L1-2")).toBe("跟拍稳住了。接下来认五个音。");
    expect(lessonAdvanceCopy("L1-4", "L1-test")).toBe("左手也认完了。准备过关测试。");
  });
});
