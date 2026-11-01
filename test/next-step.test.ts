import { describe, expect, it } from "vitest";
import { initialProfile, type Profile } from "../src/domain/profile";
import { learningPath, nextAction, sightUnlocked } from "../src/domain/nextStep";
import { SKILL_BY_ID } from "../src/repertoire/skillGraph";

function profile(partial: Partial<Profile> = {}): Profile {
  return { ...initialProfile(), ...partial };
}

const assessed = { knowsTreble: true, knowsBass: false, keepsPulse: true };

describe("nextAction", () => {
  it("starts with the placement questionnaire", () => {
    const action = nextAction(profile());
    expect(action.kind).toBe("placement");
    expect(action.cta).toBe("开始自评");
    expect(action.detail).toContain("不会直接解锁视奏");
  });

  it("points at the current L1 lesson with its goal", () => {
    const action = nextAction(profile({ assessment: assessed, lessonId: "L1-2" }));
    expect(action.kind).toBe("lesson");
    expect(action.eyebrow).toBe("L1 识谱课");
    expect(action.title).toContain("认五个音");
    expect(action.goal).toBe("找键 0/8");
    // 课中不再重复解释，副标题留空，靠标题和进度说话
    expect(action.detail).toBeUndefined();
  });

  it("asks for the missing hand at the L1 pass test", () => {
    const action = nextAction(profile({
      assessment: assessed,
      lessonId: "L1-test",
      l1RightPassed: true,
    }));
    expect(action.kind).toBe("test");
    expect(action.title).toContain("左手");
    expect(action.title).not.toContain("右手");
    expect(action.goal).toBe("右手 ✓ · 左手待过");
  });

  it("moves to L2 once both hands passed L1", () => {
    const action = nextAction(profile({
      assessment: assessed,
      lessonId: "L1-test",
      l1RightPassed: true,
      l1LeftPassed: true,
    }));
    expect(action.kind).toBe("lesson");
    expect(action.title).toContain("L2");
    expect(action.detail).toContain("八分音符");
  });

  it("keeps the L2 lesson goal while studying L2", () => {
    const action = nextAction(profile({
      assessment: assessed,
      lessonId: "L2-4",
      l1RightPassed: true,
      l1LeftPassed: true,
    }));
    expect(action.eyebrow).toBe("L2 识谱课");
    expect(action.title).toContain("F 五指");
    expect(action.goal).toBe("找键 0/16");
  });

  it("asks for the L2 pass test at the end of L2", () => {
    const action = nextAction(profile({
      assessment: assessed,
      lessonId: "L2-test",
      l1RightPassed: true,
      l1LeftPassed: true,
    }));
    expect(action.kind).toBe("test");
    expect(action.detail).toContain("双手");
  });

  it("moves into L3 chords after L2 instead of jumping straight to sight", () => {
    const action = nextAction(profile({
      assessment: assessed,
      lessonId: "L2-test",
      l1RightPassed: true,
      l1LeftPassed: true,
      l2Passed: true,
    }));
    expect(action.kind).toBe("lesson");
    expect(action.eyebrow).toBe("L3 和弦");
    expect(action.title).toContain("双音");
    expect(action.cta).toBe("开始 L3");
    expect(action.goal).toBe("短句 0/2");
  });

  it("promotes sight reading to the daily default after L3", () => {
    const action = nextAction(profile({
      assessment: assessed,
      lessonId: "L3R-test",
      l1RightPassed: true,
      l1LeftPassed: true,
      l2Passed: true,
      l3Passed: true,
    }));
    expect(action.kind).toBe("sight");
    expect(action.detail).toContain("L3 也过了");
    expect(action.goal).toBe("一条最多 2 遍");
  });

  it("puts stale mastered skills ahead of new sight reading after L3", () => {
    const now = Date.UTC(2026, 10, 1);
    const action = nextAction(profile({
      assessment: assessed,
      lessonId: "L3R-test",
      l1RightPassed: true,
      l1LeftPassed: true,
      l2Passed: true,
      l3Passed: true,
      skillLedger: {
        "pos.five@both": {
          skillId: "pos.five",
          hand: "both",
          state: "passed",
          confidence: 1,
          lastPracticedAt: 0,
        },
      },
    }), now);

    expect(action.kind).toBe("review");
    expect(action.eyebrow).toBe("复习提醒");
    expect(action.title).toContain("该复习了");
    expect(action.detail).toContain(SKILL_BY_ID.get("pos.five")?.name);
    expect(action.goal).toBe("1 项待复习");
    expect(action.skillIds).toEqual(["pos.five"]);
  });

  it("keeps sight reading when the mastered skill was practiced recently", () => {
    const now = Date.UTC(2026, 10, 1);
    const action = nextAction(profile({
      assessment: assessed,
      lessonId: "L3R-test",
      l1RightPassed: true,
      l1LeftPassed: true,
      l2Passed: true,
      l3Passed: true,
      skillLedger: {
        "pos.five@both": {
          skillId: "pos.five",
          hand: "both",
          state: "passed",
          confidence: 1,
          lastPracticedAt: now - 1000,
        },
      },
    }), now);

    expect(action.kind).toBe("sight");
  });

  it("does not interrupt the main course with a review card", () => {
    const now = Date.UTC(2026, 10, 1);
    const action = nextAction(profile({
      assessment: assessed,
      lessonId: "L1-2",
      skillLedger: {
        "pos.five@both": {
          skillId: "pos.five",
          hand: "both",
          state: "passed",
          confidence: 1,
          lastPracticedAt: 0,
        },
      },
    }), now);

    expect(action.kind).toBe("lesson");
  });

  it("counts a skill once when both hands are stale", () => {
    const now = Date.UTC(2026, 10, 1);
    const stale = (hand: "RH" | "LH" | "both", skillId: string) => ({
      skillId,
      hand,
      state: "passed" as const,
      confidence: 1,
      lastPracticedAt: 0,
    });
    const action = nextAction(profile({
      assessment: assessed,
      lessonId: "L3R-test",
      l1RightPassed: true,
      l1LeftPassed: true,
      l2Passed: true,
      l3Passed: true,
      skillLedger: {
        "pos.five@RH": stale("RH", "pos.five"),
        "pos.five@LH": stale("LH", "pos.five"),
        "rhythm.quarter@both": stale("both", "rhythm.quarter"),
      },
    }), now);

    expect(action.kind).toBe("review");
    expect(action.title).toContain("2 项技能");
    expect(action.skillIds).toHaveLength(2);
  });

  it("never shows a percentage anywhere on the dashboard copy", () => {
    const states: Partial<Profile>[] = [
      {},
      { assessment: assessed, lessonId: "L1-1" },
      { assessment: assessed, lessonId: "L1-test", l1RightPassed: true },
      { assessment: assessed, lessonId: "L2-3", l1RightPassed: true, l1LeftPassed: true },
      { assessment: assessed, lessonId: "L2-test", l1RightPassed: true, l1LeftPassed: true, l2Passed: true },
    ];
    for (const state of states) {
      const action = nextAction(profile(state));
      expect(`${action.title}${action.detail}${action.goal}${action.cta}`).not.toContain("%");
      for (const stage of learningPath(profile(state))) {
        expect(stage.caption).not.toContain("%");
      }
    }
  });
});

describe("learningPath", () => {
  it("marks L1 as the current stage before anything is passed", () => {
    const stages = learningPath(profile({ assessment: assessed, lessonId: "L1-1" }));
    expect(stages.map((stage) => stage.id)).toEqual(["L1", "L2", "L3", "library"]);
    expect(stages[0].state).toBe("current");
    expect(stages[1].state).toBe("todo");
  });

  it("marks L1 done and L2 current after the L1 pass test", () => {
    const stages = learningPath(profile({
      assessment: assessed,
      lessonId: "L1-test",
      l1RightPassed: true,
      l1LeftPassed: true,
    }));
    expect(stages[0].state).toBe("done");
    expect(stages[1].state).toBe("current");
  });

  it("counts finished L3 prep lessons without claiming the skills are passed", () => {
    const stages = learningPath(profile({
      assessment: assessed,
      lessonId: "L2-test",
      l1RightPassed: true,
      l1LeftPassed: true,
      l2Passed: true,
      l3PrepCompleted: ["triad", "accidental"],
    }));
    expect(stages[1].state).toBe("done");
    const l3 = stages.find((stage) => stage.id === "L3");
    expect(l3?.state).toBe("current");
    expect(l3?.caption).toBe("正在学 · 预备 2/9");
  });

  it("marks the library ready once L3 is passed", () => {
    const stages = learningPath(profile({ l2Passed: true, l3Passed: true, l1RightPassed: true, l1LeftPassed: true }));
    expect(stages.find((stage) => stage.id === "L3")?.state).toBe("done");
    const library = stages.find((stage) => stage.id === "library");
    expect(library?.state).toBe("current");
    expect(library?.caption).toBe("挑一首曲子弹");
  });

  it("keeps the library reachable right after L2 with a softer caption", () => {
    const stages = learningPath(profile({ l2Passed: true, l1RightPassed: true, l1LeftPassed: true }));
    const library = stages.find((stage) => stage.id === "library");
    expect(library?.state).toBe("todo");
    expect(library?.caption).toBe("可以边学边挑");
  });
});

describe("sightUnlocked", () => {
  it("needs at least one passed hand", () => {
    expect(sightUnlocked(profile())).toBe(false);
    expect(sightUnlocked(profile({ l1LeftPassed: true }))).toBe(true);
  });
});
