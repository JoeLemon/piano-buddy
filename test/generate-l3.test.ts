import { describe, expect, it } from "vitest";
import { isAllowed } from "../src/domain/allowed";
import { generateL3, type L3Shape } from "../src/domain/generateL3";
import { scoreEvents } from "../src/domain/scoreEvents";
import type { Hand } from "../src/domain/types";

const SHAPES: L3Shape[] = [
  { kind: "interval", hand: "RH" },
  { kind: "interval", hand: "LH" },
  { kind: "triad", hand: "RH" },
  { kind: "triad", hand: "LH" },
  { kind: "accidental", hand: "RH" },
  { kind: "accidental", hand: "LH" },
  { kind: "test" },
  { kind: "sight" },
];

function events(score: ReturnType<typeof generateL3>, hand: Hand) {
  return scoreEvents(score, hand);
}

describe("generateL3", () => {
  it("keeps every sampled shape inside the L3 vocabulary", () => {
    for (const shape of SHAPES) {
      for (let seed = 1; seed <= 20; seed += 1) {
        const score = generateL3({ seed, mode: "reading-lesson", shape });
        expect(isAllowed(score), `${shape.kind} seed ${seed}`).toBe(true);
        expect(score.level).toBe(3);
        const hand = shape.kind === "test" || shape.kind === "sight" ? "RH" : shape.hand;
        expect(score.staves[hand]?.measures).toHaveLength(4);
        if (shape.kind === "test" || shape.kind === "sight") {
          expect(score.hands).toEqual(["RH", "LH"]);
        } else {
          expect(score.hands).toEqual([shape.hand]);
        }
      }
    }
  });

  it("makes every interval event a two-note chord", () => {
    const score = generateL3({
      seed: 3,
      mode: "reading-lesson",
      shape: { kind: "interval", hand: "RH" },
    });
    const sounding = events(score, "RH");
    expect(sounding.length).toBeGreaterThan(0);
    for (const event of sounding) expect(event.midis).toHaveLength(2);
  });

  it("uses three-note triads in the right and left hand lessons", () => {
    for (const hand of ["RH", "LH"] as const) {
      const score = generateL3({
        seed: 5,
        mode: "reading-lesson",
        shape: { kind: "triad", hand },
      });
      for (const event of events(score, hand)) expect(event.midis).toHaveLength(3);
    }
  });

  it("writes an explicit accidental in the accidental lesson", () => {
    const score = generateL3({
      seed: 7,
      mode: "reading-lesson",
      shape: { kind: "accidental", hand: "RH" },
    });
    const alterations = (score.staves.RH?.measures ?? []).flatMap((measure) =>
      measure.notes.flatMap((note) => note.pitches.map((pitch) => pitch.alteration)),
    );
    expect(alterations.some((alteration) => alteration !== 0)).toBe(true);
  });

  it("gives the L3 test chords in the left hand while the right hand plays", () => {
    const score = generateL3({
      seed: 11,
      mode: "reading-test",
      shape: { kind: "test" },
    });
    expect(score.hands).toEqual(["RH", "LH"]);
    const left = events(score, "LH");
    const right = events(score, "RH");
    expect(left.length).toBeGreaterThan(0);
    expect(right.length).toBeGreaterThan(0);
    expect(left.some((event) => event.midis.length === 3)).toBe(true);
    expect(right.some((event) => event.midis.length === 3)).toBe(true);
  });
});
