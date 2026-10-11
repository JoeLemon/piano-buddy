import { describe, expect, it } from "vitest";
import { isAllowed } from "../src/domain/allowed";
import { fingerFor } from "../src/domain/vocabulary";
import type { Score } from "../src/domain/types";

function l1(hand: "RH" | "LH" = "RH"): Score {
  const pitches = hand === "RH"
    ? [["C", 4], ["D", 4], ["E", 4], ["F", 4]]
    : [["C", 3], ["D", 3], ["E", 3], ["F", 3]];
  return {
    id: "t",
    mode: "sight",
    level: 1,
    meter: { beats: 4, beatValue: 4 },
    keySignature: "C",
    hands: [hand],
    bpm: 60,
    staves: {
      [hand]: {
        clef: hand === "RH" ? "treble" : "bass",
        measures: pitches.map(([step, octave]) => ({
          notes: [{
            id: `${step}${octave}`,
            pitches: [{ step, octave, alteration: 0 }],
            duration: "w",
            fingers: [fingerFor("C", hand, { step: step as "C", octave: octave as number, alteration: 0 })],
          }],
        })),
      },
    },
  } as Score;
}

describe("isAllowed", () => {
  it("accepts an L1 whole-note line and the C position fingers", () => {
    expect(isAllowed(l1("RH"))).toBe(true);
    expect(fingerFor("C", "RH", { step: "C", octave: 4, alteration: 0 })).toBe(1);
    expect(fingerFor("C", "LH", { step: "C", octave: 3, alteration: 0 })).toBe(5);
    expect(fingerFor("C", "RH", { step: "G", octave: 4, alteration: 0 })).toBe(5);
  });

  it("rejects eighth notes, chords, black keys, and two hands at L1", () => {
    const eighth = l1();
    eighth.staves.RH!.measures[0].notes[0].duration = "8";
    expect(isAllowed(eighth)).toBe(false);

    const chord = l1();
    chord.staves.RH!.measures[0].notes[0].pitches.push({ step: "E", octave: 4, alteration: 0 });
    expect(isAllowed(chord)).toBe(false);

    const sharp = l1();
    sharp.staves.RH!.measures[0].notes[0].pitches[0].alteration = 1;
    expect(isAllowed(sharp)).toBe(false);

    const both = l1();
    both.hands = ["RH", "LH"];
    expect(isAllowed(both)).toBe(false);
  });

  it("accepts an F major eighth-note line only from L2", () => {
    const score = l1();
    score.level = 2;
    score.keySignature = "F";
    score.staves.RH!.measures[0].notes = Array.from({ length: 8 }, (_, index) => ({
      id: `eighth-${index}`,
      pitches: [{ step: "B" as const, octave: 4, alteration: -1 as const }],
      duration: "8" as const,
      fingers: [4],
    }));
    expect(isAllowed(score)).toBe(true);
    score.level = 1;
    expect(isAllowed(score)).toBe(false);
  });

  it("accepts an L3 third and rejects a second", () => {
    const third = l1();
    third.level = 3;
    third.staves.RH!.measures[0].notes[0].pitches = [
      { step: "C", octave: 4, alteration: 0 },
      { step: "E", octave: 4, alteration: 0 },
    ];
    expect(isAllowed(third)).toBe(true);

    const second = l1();
    second.level = 3;
    second.staves.RH!.measures[0].notes[0].pitches = [
      { step: "C", octave: 4, alteration: 0 },
      { step: "D", octave: 4, alteration: 0 },
    ];
    expect(isAllowed(second)).toBe(false);
  });

  it("rejects an L3 fourth and accepts a fifth", () => {
    const fourth = l1();
    fourth.level = 3;
    fourth.staves.RH!.measures[0].notes[0].pitches = [
      { step: "C", octave: 4, alteration: 0 },
      { step: "F", octave: 4, alteration: 0 },
    ];
    expect(isAllowed(fourth)).toBe(false);

    const fifth = l1();
    fifth.level = 3;
    fifth.staves.RH!.measures[0].notes[0].pitches = [
      { step: "C", octave: 4, alteration: 0 },
      { step: "G", octave: 4, alteration: 0 },
    ];
    expect(isAllowed(fifth)).toBe(true);

    const repeated = l1();
    repeated.level = 3;
    repeated.staves.RH!.measures[0].notes[0].pitches = [
      { step: "C", octave: 4, alteration: 0 },
      { step: "E", octave: 4, alteration: 0 },
      { step: "E", octave: 4, alteration: 0 },
    ];
    expect(isAllowed(repeated)).toBe(false);
  });

  it("allows the left-hand neighbor above Bb at L4", () => {
    const score = l1("LH");
    score.level = 4;
    score.keySignature = "Bb";
    score.staves.LH!.measures[0].notes[0].pitches = [{ step: "G", octave: 4, alteration: 0 }];
    expect(isAllowed(score)).toBe(true);
  });
});
