import { describe, expect, it } from "vitest";
import {
  applyAssessment,
  canEnterSight,
  initialProfile,
  markSegmentFollowed,
  mergeProfile,
  practiceAccuracy,
  practiceStatsTotals,
  recordPracticeAnswer,
  registerSightUse,
  routeAfterAssessment,
  testBpm,
} from "../src/domain/profile";
import { recordFollowPractice, skillKey } from "../src/repertoire/skillState";

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

  it("keeps the skill ledger and followed segments across reloads", () => {
    const stored = {
      ...initialProfile(),
      skillLedger: recordFollowPractice({}, ["pos.five"], "RH", 92, 5),
      followedSegments: ["arr.ode-to-joy.standard.m1-2.RH"],
    };
    const merged = mergeProfile(stored);
    expect(merged.skillLedger[skillKey("pos.five", "RH")].state).toBe("learning");
    expect(merged.skillLedger[skillKey("pos.five", "RH")].bpm).toBe(92);
    expect(merged.followedSegments).toEqual(["arr.ode-to-joy.standard.m1-2.RH"]);
  });

  it("repairs a malformed ledger instead of trusting it", () => {
    const merged = mergeProfile({
      ...initialProfile(),
      skillLedger: {
        "pos.five@RH": { skillId: "pos.five", hand: "RH", state: "passed", confidence: 1 },
        // 坏形状：不是对象、缺 skillId。
        broken: "nope",
        "no-skill@RH": { hand: "RH", state: "learning", confidence: 0.2 },
        // state 对不上、confidence 超范围：修一下继续用，不丢练习证据。
        "bad-state@RH": { skillId: "pos.five", hand: "RH", state: " Mastered", confidence: 0.2 },
        "bad-confidence@RH": { skillId: "pos.five", hand: "RH", state: "learning", confidence: 9 },
      } as never,
    });
    expect(Object.keys(merged.skillLedger)).toEqual([
      "pos.five@RH",
      "bad-state@RH",
      "bad-confidence@RH",
    ]);
    // 认不出的 state 一律降成 learning：坏数据最多丢掉一次过关，
    // 绝不可能把没过的技能变成已过关。
    expect(merged.skillLedger["bad-state@RH"].state).toBe("learning");
    expect(merged.skillLedger["bad-confidence@RH"].confidence).toBe(1);
    // 真正写进去的 passed 不受影响。
    expect(merged.skillLedger["pos.five@RH"].state).toBe("passed");
  });

  it("marks a followed segment once, keeping the newest entries", () => {
    let profile = initialProfile();
    profile = markSegmentFollowed(profile, "a.m1-2.RH");
    profile = markSegmentFollowed(profile, "a.m1-2.RH");
    profile = markSegmentFollowed(profile, "a.m3-4.RH");
    expect(profile.followedSegments).toEqual(["a.m1-2.RH", "a.m3-4.RH"]);
    expect(markSegmentFollowed(profile, "")).toBe(profile);
  });
});

describe("practiceStats", () => {
  it("counts answers per kind without touching skill passes", () => {
    let profile = initialProfile();
    profile = recordPracticeAnswer(profile, "chords", true);
    profile = recordPracticeAnswer(profile, "chords", false);
    profile = recordPracticeAnswer(profile, "chords", true);
    profile = recordPracticeAnswer(profile, "intervals", true);
    expect(profile.practiceStats.chords).toEqual({ answered: 3, correct: 2 });
    expect(profile.practiceStats.intervals).toEqual({ answered: 1, correct: 1 });
    // 统计永远不写技能账本：一次答得好不构成过关。
    expect(profile.skillLedger).toEqual({});
  });

  it("ignores an empty kind and reports no accuracy before answering", () => {
    const profile = initialProfile();
    expect(recordPracticeAnswer(profile, "", true)).toBe(profile);
    expect(practiceAccuracy(profile.practiceStats, "chords")).toBeNull();
    expect(practiceStatsTotals(profile.practiceStats)).toEqual({ answered: 0, correct: 0 });
  });

  it("rounds the cumulative accuracy and totals across kinds", () => {
    const profile = {
      ...initialProfile(),
      practiceStats: {
        chords: { answered: 3, correct: 2 },
        intervals: { answered: 4, correct: 4 },
      },
    };
    expect(practiceAccuracy(profile.practiceStats, "chords")).toBe(67);
    expect(practiceAccuracy(profile.practiceStats, "melodies")).toBeNull();
    expect(practiceStatsTotals(profile.practiceStats)).toEqual({ answered: 7, correct: 6 });
  });

  it("repairs malformed stored stats instead of trusting them", () => {
    const merged = mergeProfile({
      ...initialProfile(),
      practiceStats: {
        chords: { answered: 10, correct: 3 },
        // 答对数超过答数：夹回 answered（典型的手改档案 / 旧 bug）。
        inflated: { answered: 2, correct: 9 },
        // 坏形状：计数是字符串、是负数、整体不是对象、没有答过。
        "string-counts": { answered: "5", correct: 2 },
        negative: { answered: -3, correct: -1 },
        broken: "nope",
        empty: { answered: 0, correct: 0 },
      } as never,
    });
    expect(merged.practiceStats).toEqual({
      chords: { answered: 10, correct: 3 },
      inflated: { answered: 2, correct: 2 },
    });
  });
});
