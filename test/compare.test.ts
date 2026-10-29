import { describe, expect, it } from "vitest";
import { compare } from "../src/domain/compare";
import { feedbackText } from "../src/domain/feedback";
import { applyTestResult, initialProfile } from "../src/domain/profile";
import type { Score } from "../src/domain/types";

const quarters = ["C", "D", "E", "F", "C", "D", "E", "G"] as const;

function eightQuarters(): Score {
  return {
    id: "fixed",
    mode: "reading-test",
    level: 1,
    meter: { beats: 4, beatValue: 4 },
    keySignature: "C",
    hands: ["RH"],
    bpm: 60,
    staves: {
      RH: {
        clef: "treble",
        measures: [0, 1].map((measure) => ({
          notes: quarters.slice(measure * 4, measure * 4 + 4).map((step, index) => ({
            id: `${measure}-${index}`,
            pitches: [{ step, octave: 4, alteration: 0 as const }],
            duration: "q" as const,
            fingers: [1],
          })),
        })),
      },
    },
  };
}

describe("compare", () => {
  it("counts a wrong pitch and ignores an early note", () => {
    const played = quarters.map((step, index) => ({
      midi: index === 1 ? 67 : ({ C: 60, D: 62, E: 64, F: 65, G: 67 })[step],
      timeMs: index * 1000 - 50,
    }));
    const result = compare(eightQuarters(), "RH", played, 60);
    expect(result.pitchErrors).toBe(1);
    expect(result.rhythmBreaks).toBe(0);
    expect(result.firstWrongLabel).toBe("D4");
    expect(result.wrongPitchNoteIds).toEqual(["0-1"]);
    expect(result.lateNoteIds).toEqual([]);
  });

  it("counts a note more than two beats late as a rhythm break", () => {
    const played = quarters.map((step, index) => ({
      midi: ({ C: 60, D: 62, E: 64, F: 65, G: 67 })[step],
      timeMs: index === 1 ? 3500 : index * 1000,
    }));
    const result = compare(eightQuarters(), "RH", played, 60);
    expect(result.rhythmBreaks).toBe(1);
    expect(result.lateNoteIds).toEqual(["0-1"]);
  });

  it("uses the spec copy and slows the test only on the third consecutive failure", () => {
    const failed = {
      pitchErrors: 3,
      rhythmBreaks: 0,
      firstWrongLabel: "F4",
      wrongPitchNoteIds: ["a", "b", "c"],
      lateNoteIds: [], shortNoteIds: [],
    };
    expect(feedbackText(failed, 1, "RH")).toBe(
      "F 还要找一下。它在 E 上面一格，右手四指。再来一条新的。",
    );
    const passed = {
      pitchErrors: 1,
      rhythmBreaks: 0,
      firstWrongLabel: "D4",
      wrongPitchNoteIds: ["x"],
      lateNoteIds: [], shortNoteIds: [],
    };
    expect(feedbackText(passed, 1, "RH")).toBe(
      "这些音可以直接认了。接下来的视奏里只会用到它们。",
    );
    let profile = initialProfile();
    profile = applyTestResult(profile, ["RH"], [failed]);
    profile = applyTestResult(profile, ["RH"], [failed]);
    expect(profile.slowed).toBe(false);
    profile = applyTestResult(profile, ["RH"], [failed]);
    expect(profile.slowed).toBe(true);
    expect(profile.l1RightPassed).toBe(false);
    expect(profile.lessonId).not.toBe("L1-4");
  });

  it("sends a passed right-hand-only test to the left-hand lesson", () => {
    const passed = {
      pitchErrors: 0,
      rhythmBreaks: 0,
      firstWrongLabel: null,
      wrongPitchNoteIds: [],
      lateNoteIds: [], shortNoteIds: [],
    };
    const profile = applyTestResult(initialProfile(), ["RH"], [passed]);
    expect(profile.l1RightPassed).toBe(true);
    expect(profile.l1LeftPassed).toBe(false);
    expect(profile.lessonId).toBe("L1-4");
    expect(profile.lessonPhase).toBe("notes");
  });
});

/** 一个二分音符 + 两个四分音符：长短都有，才能看出音长判定按各自的时值算。 */
function holdScore(): Score {
  return {
    id: "hold",
    mode: "reading-test",
    level: 1,
    meter: { beats: 4, beatValue: 4 },
    keySignature: "C",
    hands: ["RH"],
    bpm: 60,
    staves: {
      RH: {
        clef: "treble",
        measures: [
          {
            notes: [
              { id: "half", pitches: [{ step: "C", octave: 4, alteration: 0 as const }], duration: "h" as const, fingers: [1] },
              { id: "q1", pitches: [{ step: "D", octave: 4, alteration: 0 as const }], duration: "q" as const, fingers: [2] },
              { id: "q2", pitches: [{ step: "E", octave: 4, alteration: 0 as const }], duration: "q" as const, fingers: [3] },
            ],
          },
        ],
      },
    },
  };
}

describe("hold length in compare", () => {
  it("reports notes released before 60% of their duration", () => {
    const played = [
      { midi: 60, timeMs: 0, offMs: 1000 }, // 二分音符只按 1 拍（需 1.2）
      { midi: 62, timeMs: 2000, offMs: 2700 }, // 四分音符按 0.7 拍，够
      { midi: 64, timeMs: 3000, offMs: 3400 }, // 四分音符只按 0.4 拍
    ];
    const result = compare(holdScore(), "RH", played, 60);
    expect(result.shortNoteIds).toEqual(["half", "q2"]);
    // 音长只观察：错音、节奏判罚一个都没多算。
    expect(result.pitchErrors).toBe(0);
    expect(result.rhythmBreaks).toBe(0);
    expect(result.lateNoteIds).toEqual([]);
  });

  it("counts exactly 60% as held and skips notes released without an off", () => {
    const result = compare(holdScore(), "RH", [
      { midi: 60, timeMs: 0, offMs: 1200 }, // 正好六成
      { midi: 62, timeMs: 2000, offMs: 2600 }, // 正好六成
      { midi: 64, timeMs: 3000 }, // 没收到 note-off：无从判断
    ], 60);
    expect(result.shortNoteIds).toEqual([]);
  });

  it("does not judge holds for a wrong pitch", () => {
    const result = compare(holdScore(), "RH", [
      { midi: 61, timeMs: 0, offMs: 100 }, // 音就错了，按住多久说明不了什么
      { midi: 62, timeMs: 2000, offMs: 2700 },
      { midi: 64, timeMs: 3000, offMs: 3700 },
    ], 60);
    expect(result.shortNoteIds).toEqual([]);
    expect(result.pitchErrors).toBe(1);
  });
});

/** 同一拍上左手全音符、右手四分音符：短的音本来就要先抬，不能拿长的要求它。 */
function mixedBeatScore(): Score {
  return {
    id: "mixed-beat",
    mode: "reading-test",
    level: 3,
    meter: { beats: 4, beatValue: 4 },
    keySignature: "C",
    hands: ["RH", "LH"],
    bpm: 60,
    staves: {
      RH: {
        clef: "treble",
        measures: [
          {
            notes: [
              { id: "rh-q", pitches: [{ step: "C", octave: 4, alteration: 0 as const }], duration: "q" as const, fingers: [1] },
              { id: "rh-h", pitches: [{ step: "D", octave: 4, alteration: 0 as const }], duration: "h" as const, fingers: [2] },
            ],
          },
        ],
      },
      LH: {
        clef: "bass",
        measures: [
          {
            notes: [
              { id: "lh-w", pitches: [{ step: "C", octave: 3, alteration: 0 as const }], duration: "w" as const, fingers: [5] },
            ],
          },
        ],
      },
    },
  };
}

describe("hold length in the chord path", () => {
  it("judges each note by its own duration on a shared beat", () => {
    const played = [
      { midi: 60, timeMs: 0, offMs: 700 }, // 右手四分音符按 0.7 拍，够
      { midi: 48, timeMs: 0, offMs: 1000 }, // 左手全音符只按 1 拍（需 2.4）
      { midi: 62, timeMs: 1000, offMs: 2700 }, // 右手二分音符按 1.7 拍（需 1.2）
    ];
    const result = compare(mixedBeatScore(), "BOTH", played, 60);
    expect(result.shortNoteIds).toEqual(["lh-w"]);
    expect(result.pitchErrors).toBe(0);
  });

  it("marks a beat short when one finger lifts early", () => {
    const played = [
      { midi: 60, timeMs: 0, offMs: 700 }, // 右手四分音符，按时抬
      { midi: 48, timeMs: 0, offMs: 200 }, // 左手全音符只按 0.2 拍
      { midi: 62, timeMs: 1000, offMs: 2700 }, // 右手二分音符，够
    ];
    const result = compare(mixedBeatScore(), "BOTH", played, 60);
    expect(result.shortNoteIds).toEqual(["lh-w"]);
    expect(result.pitchErrors).toBe(0);
  });
});
