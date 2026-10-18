import { describe, expect, it } from "vitest";
import { compare, passLimit } from "../src/domain/compare";
import { flattenScore } from "../src/domain/timeline";
import type { Score } from "../src/domain/types";

function togetherQuarters(): Score {
  return {
    id: "together",
    mode: "reading-test",
    level: 2,
    meter: { beats: 4, beatValue: 4 },
    keySignature: "C",
    hands: ["RH", "LH"],
    bpm: 60,
    staves: {
      RH: {
        clef: "treble",
        measures: [{
          notes: [{
            id: "rh-c4",
            pitches: [{ step: "C", octave: 4, alteration: 0 }],
            duration: "q",
          }],
        }],
      },
      LH: {
        clef: "bass",
        measures: [{
          notes: [{
            id: "lh-c3",
            pitches: [{ step: "C", octave: 3, alteration: 0 }],
            duration: "q",
          }],
        }],
      },
    },
  };
}

describe("flattenScore", () => {
  it("orders sounding notes by beat, right hand before left, and skips rests", () => {
    const score: Score = {
      id: "rests",
      mode: "reading-test",
      level: 2,
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
                { id: "rh-rest", pitches: [], duration: "q" },
                {
                  id: "rh-c4",
                  pitches: [{ step: "C", octave: 4, alteration: 0 }],
                  duration: "q",
                },
              ],
            },
            {
              notes: [{
                id: "rh-d4",
                pitches: [{ step: "D", octave: 4, alteration: 0 }],
                duration: "q",
              }],
            },
          ],
        },
        LH: {
          clef: "bass",
          measures: [
            {
              notes: [{
                id: "lh-c3",
                pitches: [{ step: "C", octave: 3, alteration: 0 }],
                duration: "q",
              }],
            },
            {
              notes: [
                { id: "lh-rest", pitches: [], duration: "qr" },
                {
                  id: "lh-e3",
                  pitches: [{ step: "E", octave: 3, alteration: 0 }],
                  duration: "q",
                },
              ],
            },
          ],
        },
      },
    };

    expect(flattenScore(score)).toEqual([
      { id: "lh-c3", midi: 48, beat: 0, hand: "LH", label: "C3", finger: null },
      { id: "rh-c4", midi: 60, beat: 1, hand: "RH", label: "C4", finger: null },
      { id: "rh-d4", midi: 62, beat: 2, hand: "RH", label: "D4", finger: null },
      { id: "lh-e3", midi: 52, beat: 2, hand: "LH", label: "E3", finger: null },
    ]);
  });

  it("puts the right hand before the left hand on the same beat", () => {
    expect(flattenScore(togetherQuarters())).toEqual([
      { id: "rh-c4", midi: 60, beat: 0, hand: "RH", label: "C4", finger: null },
      { id: "lh-c3", midi: 48, beat: 0, hand: "LH", label: "C3", finger: null },
    ]);
  });
});

describe("compare two hands", () => {
  it("accepts both keys when they match the timeline", () => {
    const played = [
      { midi: 60, timeMs: 0 },
      { midi: 48, timeMs: 0 },
    ];
    const result = compare(togetherQuarters(), "BOTH", played, 60);
    expect(result.pitchErrors).toBe(0);
    expect(result.rhythmBreaks).toBe(0);
    expect(result.wrongPitchNoteIds).toEqual([]);
    expect(result.lateNoteIds).toEqual([]);
    expect(result.firstWrongLabel).toBeNull();
  });

  it("records only the right-hand note when that pitch is wrong", () => {
    const played = [
      { midi: 62, timeMs: 0 },
      { midi: 48, timeMs: 0 },
    ];
    const result = compare(togetherQuarters(), "BOTH", played, 60);
    expect(result.pitchErrors).toBe(1);
    expect(result.wrongPitchNoteIds).toEqual(["rh-c4"]);
    expect(result.firstWrongLabel).toBe("C4");
    expect(result.lateNoteIds).toEqual([]);
  });

  it("marks the left hand late when it arrives more than two beats after its onset", () => {
    const played = [
      { midi: 60, timeMs: 0 },
      { midi: 48, timeMs: 3000 },
    ];
    const result = compare(togetherQuarters(), "BOTH", played, 60);
    expect(result.pitchErrors).toBe(0);
    expect(result.rhythmBreaks).toBe(1);
    expect(result.lateNoteIds).toEqual(["lh-c3"]);
  });

  it("does not mark a note that is exactly two beats late", () => {
    const played = [
      { midi: 60, timeMs: 0 },
      { midi: 48, timeMs: 2000 },
    ];
    const result = compare(togetherQuarters(), "BOTH", played, 60);
    expect(result.rhythmBreaks).toBe(0);
    expect(result.lateNoteIds).toEqual([]);
  });

  it("scores both staves when the score has two hands even if the caller names one hand", () => {
    const played = [
      { midi: 60, timeMs: 0 },
      { midi: 48, timeMs: 3000 },
    ];
    const result = compare(togetherQuarters(), "RH", played, 60);
    expect(result.lateNoteIds).toEqual(["lh-c3"]);
    expect(result.pitchErrors).toBe(0);
  });

  it("leaves the other staff out of a one-hand score", () => {
    const score = togetherQuarters();
    score.hands = ["RH"];
    const result = compare(score, "RH", [{ midi: 60, timeMs: 0 }], 60);
    expect(result.pitchErrors).toBe(0);
    expect(result.wrongPitchNoteIds).toEqual([]);
    expect(result.lateNoteIds).toEqual([]);
  });

  it("scores both staves for BOTH even when the score lists a single hand", () => {
    const score = togetherQuarters();
    score.hands = ["RH"];
    const played = [
      { midi: 60, timeMs: 0 },
      { midi: 64, timeMs: 0 },
    ];
    const result = compare(score, "BOTH", played, 60);
    expect(result.pitchErrors).toBe(1);
    expect(result.wrongPitchNoteIds).toEqual(["lh-c3"]);
  });
});

describe("passLimit", () => {
  it("allows two pitch errors at level 2", () => {
    expect(passLimit(2)).toBe(2);
    expect(passLimit(1)).toBe(2);
  });
});
