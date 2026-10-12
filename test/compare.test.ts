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
  });

  it("counts a note more than two beats late as a rhythm break", () => {
    const played = quarters.map((step, index) => ({
      midi: ({ C: 60, D: 62, E: 64, F: 65, G: 67 })[step],
      timeMs: index === 1 ? 3500 : index * 1000,
    }));
    expect(compare(eightQuarters(), "RH", played, 60).rhythmBreaks).toBe(1);
  });

  it("uses the spec copy and slows the test only on the third consecutive failure", () => {
    const failed = { pitchErrors: 3, rhythmBreaks: 0, firstWrongLabel: "F4" };
    expect(feedbackText(failed, 1, "RH")).toBe(
      "F 还要找一下。它在 E 上面一格，右手四指。再来一条新的。",
    );
    const passed = { pitchErrors: 1, rhythmBreaks: 0, firstWrongLabel: "D4" };
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
    const passed = { pitchErrors: 0, rhythmBreaks: 0, firstWrongLabel: null };
    const profile = applyTestResult(initialProfile(), ["RH"], [passed]);
    expect(profile.l1RightPassed).toBe(true);
    expect(profile.l1LeftPassed).toBe(false);
    expect(profile.lessonId).toBe("L1-4");
    expect(profile.lessonPhase).toBe("notes");
  });
});
