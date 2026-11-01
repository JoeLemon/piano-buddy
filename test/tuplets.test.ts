import { describe, expect, it } from "vitest";
import { isAllowed } from "../src/domain/allowed";
import { measureBudget } from "../src/domain/pickup";
import { scoreEvents } from "../src/domain/scoreEvents";
import { tupletErrors } from "../src/domain/tuplets";
import type { Meter, NoteEvent, Score } from "../src/domain/types";
import { noteBeats } from "../src/domain/vocabulary";

const C4 = { step: "C", octave: 4, alteration: 0 } as const;
const D4 = { step: "D", octave: 4, alteration: 0 } as const;
const E4 = { step: "E", octave: 4, alteration: 0 } as const;
const F4 = { step: "F", octave: 4, alteration: 0 } as const;
const G4 = { step: "G", octave: 4, alteration: 0 } as const;
const A4 = { step: "A", octave: 4, alteration: 0 } as const;

function note(
  id: string,
  pitch: NoteEvent["pitches"][number],
  duration: NoteEvent["duration"],
  tuplet?: string,
): NoteEvent {
  return { id, pitches: [pitch], duration, ...(tuplet ? { tuplet } : {}) };
}

function score(
  measures: NoteEvent[][],
  meter: Meter = { beats: 4, beatValue: 4 },
): Score {
  return {
    id: "score.tuplets.test",
    mode: "repertoire",
    level: 5,
    meter,
    keySignature: "C",
    hands: ["RH"],
    bpm: 72,
    staves: { RH: { clef: "treble", measures: measures.map((notes) => ({ notes })) } },
  };
}

/** 4/4：三个八分三连音占 1 拍 + 三个四分音符 = 4 拍。 */
function validTriplet(): NoteEvent[] {
  return [
    note("t1a", C4, "8", "t1"),
    note("t1b", D4, "8", "t1"),
    note("t1c", E4, "8", "t1"),
    note("q1", F4, "q"),
    note("q2", G4, "q"),
    note("q3", A4, "q"),
  ];
}

describe("三连音结构", () => {
  it("三个同基础时值的音共用组 id，实际时值按 2/3 折算", () => {
    const notes = validTriplet();
    expect(tupletErrors(score([notes]))).toEqual([]);
    expect(noteBeats(notes[0])).toBeCloseTo(1 / 3, 10);
    expect(scoreEvents(score([notes])).map((event) => event.beat)).toEqual([
      0,
      1 / 3,
      2 / 3,
      1,
      2,
      3,
    ]);
  });

  it("L5 起允许三连音，L4 仍拒绝", () => {
    const base = score([validTriplet()]);
    expect(isAllowed(base)).toBe(true);
    expect(isAllowed({ ...base, level: 4 })).toBe(false);
  });

  it("6/8 的一小节按 3 个四分音符算，两组三连音 + 两个八分刚好填满", () => {
    const notes = [
      note("a1", C4, "8", "a"),
      note("a2", D4, "8", "a"),
      note("a3", E4, "8", "a"),
      note("b1", F4, "8", "b"),
      note("b2", G4, "8", "b"),
      note("b3", A4, "8", "b"),
      note("c1", C4, "8"),
      note("c2", D4, "8"),
    ];
    const sixEight = score([notes], { beats: 6, beatValue: 8 });
    expect(measureBudget(sixEight, 0)).toBe(3);
    expect(tupletErrors(sixEight)).toEqual([]);
    expect(isAllowed(sixEight)).toBe(true);
  });

  it("少一个音时指出应有 3 个", () => {
    const errors = tupletErrors(score([[note("a", C4, "8", "t"), note("b", D4, "8", "t")]]));
    expect(errors[0]).toContain("应有 3 个音");
  });

  it("基础时值不同时拒绝", () => {
    const errors = tupletErrors(
      score([[note("a", C4, "8", "t"), note("b", D4, "q", "t"), note("c", E4, "8", "t")]]),
    );
    expect(errors.some((text) => text.includes("基础时值必须相同"))).toBe(true);
  });

  it("三个音必须连续", () => {
    const errors = tupletErrors(
      score([[
        note("a", C4, "8", "t"),
        note("x", F4, "8"),
        note("b", D4, "8", "t"),
        note("c", E4, "8", "t"),
      ]]),
    );
    expect(errors.some((text) => text.includes("必须连续"))).toBe(true);
  });

  it("组 id 不能跨小节重复", () => {
    const errors = tupletErrors(
      score([
        [note("a", C4, "8", "t"), note("b", D4, "8", "t"), note("c", E4, "8", "t")],
        [note("d", F4, "8", "t"), note("e", G4, "8", "t"), note("f", A4, "8", "t")],
      ]),
    );
    expect(errors.some((text) => text.includes("组 id 必须唯一"))).toBe(true);
  });
});
