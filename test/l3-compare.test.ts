import { describe, expect, it } from "vitest";
import { compare, isPass } from "../src/domain/compare";
import { applyL3TestResult, initialProfile } from "../src/domain/profile";
import type { Duration, Measure, Pitch, Score } from "../src/domain/types";

function measure(notes: { id: string; duration: Duration; pitches: Pitch[] }[]): Measure {
  return { notes: notes.map((note) => ({ ...note, fingers: note.pitches.map(() => 1) })) };
}

function chordScore(): Score {
  const c3: Pitch = { step: "C", octave: 3, alteration: 0 };
  const e3: Pitch = { step: "E", octave: 3, alteration: 0 };
  const g3: Pitch = { step: "G", octave: 3, alteration: 0 };
  const g2: Pitch = { step: "G", octave: 2, alteration: 0 };
  const b2: Pitch = { step: "B", octave: 2, alteration: 0 };
  const d3: Pitch = { step: "D", octave: 3, alteration: 0 };
  const staves: Score["staves"] = {
    RH: {
      clef: "treble",
      measures: [
        measure([
          { id: "rh-0", duration: "h", pitches: [{ step: "C", octave: 4, alteration: 0 }] },
          { id: "rh-1", duration: "h", pitches: [{ step: "D", octave: 4, alteration: 0 }] },
        ]),
      ],
    },
    LH: {
      clef: "bass",
      measures: [
        measure([
          { id: "lh-0", duration: "h", pitches: [c3, e3, g3] },
          { id: "lh-1", duration: "h", pitches: [g2, b2, d3] },
        ]),
      ],
    },
  };
  return {
    id: "l3-beats",
    mode: "reading-test",
    level: 3,
    meter: { beats: 4, beatValue: 4 },
    keySignature: "C",
    hands: ["RH", "LH"],
    bpm: 60,
    staves,
  };
}

function singleHandTriads(): Score {
  return {
    id: "l3-triad",
    mode: "reading-lesson",
    level: 3,
    meter: { beats: 4, beatValue: 4 },
    keySignature: "C",
    hands: ["RH"],
    bpm: 60,
    staves: {
      RH: {
        clef: "treble",
        measures: [
          measure([
            {
              id: "a",
              duration: "h",
              pitches: [
                { step: "C", octave: 4, alteration: 0 },
                { step: "E", octave: 4, alteration: 0 },
                { step: "G", octave: 4, alteration: 0 },
              ],
            },
            {
              id: "b",
              duration: "h",
              pitches: [
                { step: "F", octave: 4, alteration: 0 },
                { step: "A", octave: 4, alteration: 0 },
                { step: "C", octave: 5, alteration: 0 },
              ],
            },
          ]),
        ],
      },
    },
  };
}

function group(midis: number[], timeMs: number) {
  return midis.map((midi) => ({ midi, timeMs }));
}

describe("L3 chord compare", () => {
  it("counts one wrong chord once instead of splitting it into three errors", () => {
    const played = [...group([60], 0), ...group([65, 69], 0), ...group([65, 69, 72], 2000)];
    const result = compare(singleHandTriads(), "RH", played, 60);
    expect(result.pitchErrors).toBe(1);
    expect(result.wrongPitchNoteIds).toEqual(["a"]);
    expect(result.firstWrongLabel).toBe("C4+E4+G4");
  });

  it("accepts both hands when they start on the same beat", () => {
    const played = [
      ...group([60, 48, 52, 55], 0),
      ...group([62, 43, 47, 50], 2000),
    ];
    const result = compare(chordScore(), "BOTH", played, 60);
    expect(result.pitchErrors).toBe(0);
    expect(result.rhythmBreaks).toBe(0);
    expect(result.wrongPitchNoteIds).toEqual([]);
  });

  it("reports every note in an incomplete two-hand beat", () => {
    const played = [
      ...group([60, 48], 0),
      ...group([62, 43, 47, 50], 2000),
    ];
    const result = compare(chordScore(), "BOTH", played, 60);
    expect(result.pitchErrors).toBe(1);
    expect(new Set(result.wrongPitchNoteIds)).toEqual(new Set(["rh-0", "lh-0"]));
  });

  it("passes L3 with up to three wrong beats and unlocks sight level 3", () => {
    const result = {
      pitchErrors: 3,
      rhythmBreaks: 0,
      firstWrongLabel: "C4",
      wrongPitchNoteIds: ["a", "b", "c"],
      lateNoteIds: [],
    };
    expect(isPass(result, 3)).toBe(true);
    const profile = applyL3TestResult(initialProfile(), result);
    expect(profile.l3Passed).toBe(true);
    expect(profile.l3FailStreak).toBe(0);
  });

  it("slows the L3 test only on the third consecutive failure", () => {
    const failed = {
      pitchErrors: 4,
      rhythmBreaks: 0,
      firstWrongLabel: "C4",
      wrongPitchNoteIds: ["a"],
      lateNoteIds: [],
    };
    let profile = initialProfile();
    profile = applyL3TestResult(profile, failed);
    profile = applyL3TestResult(profile, failed);
    expect(profile.l3Slowed).toBe(false);
    profile = applyL3TestResult(profile, failed);
    expect(profile.l3Slowed).toBe(true);
    expect(profile.l3Passed).toBe(false);
  });
});
