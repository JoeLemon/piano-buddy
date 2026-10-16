import { describe, expect, it } from "vitest";
import { isAllowed } from "../src/domain/allowed";
import { generateL2, type L2Shape } from "../src/domain/generateL2";
import type { Duration, Hand, Pitch, Score } from "../src/domain/types";
import { DURATION_BEATS, fingerFor, pitchesFor } from "../src/domain/vocabulary";

function expectFrame(score: Score, shape: L2Shape, seed: number, mode: Score["mode"]) {
  expect(score.level).toBe(2);
  expect(score.bpm).toBe(60);
  expect(score.meter).toEqual({ beats: 4, beatValue: 4 });
  expect(score.mode).toBe(mode);
  expect(score.id.startsWith(`l2-${shape.kind}-${seed}`)).toBe(true);
  expect(score.hands.length).toBeGreaterThanOrEqual(1);
  for (const hand of score.hands) {
    expect(score.staves[hand]?.measures).toHaveLength(4);
    expect(score.staves[hand]?.clef).toBe(hand === "RH" ? "treble" : "bass");
  }
  expect(isAllowed(score)).toBe(true);
}

function sounding(score: Score, hand: Hand) {
  return score.staves[hand]!.measures.flatMap((measure) => measure.notes.filter((note) => note.pitches.length > 0));
}

function samePitch(pitch: Pitch, slot: Pitch): boolean {
  return pitch.step === slot.step && pitch.octave === slot.octave && pitch.alteration === slot.alteration;
}

function hasEighthGroup(score: Score): boolean {
  for (const hand of score.hands) {
    for (const measure of score.staves[hand]!.measures) {
      let beat = 0;
      for (let index = 0; index < measure.notes.length; index++) {
        const note = measure.notes[index];
        const beats = DURATION_BEATS[note.duration];
        const next = measure.notes[index + 1];
        if (Number.isInteger(beat) && beats === 0.5 && next && DURATION_BEATS[next.duration] === 0.5) return true;
        beat += beats;
      }
    }
  }
  return false;
}

function onsets(score: Score, hand: Hand): number[] {
  const beats: number[] = [];
  let beat = 0;
  for (const measure of score.staves[hand]!.measures) {
    for (const note of measure.notes) {
      if (note.pitches.length > 0) beats.push(beat);
      beat += DURATION_BEATS[note.duration];
    }
  }
  return beats;
}

function positionByFinger(pitch: Pitch, finger: number, hand: Hand): "C" | "D-shift" | undefined {
  let matched: "C" | "D-shift" | undefined;
  for (const position of ["C", "D-shift"] as const) {
    try {
      if (fingerFor(position, hand, pitch) === finger) matched = position;
    } catch {
      // Pitch is outside this five-finger position.
    }
  }
  return matched;
}

describe("generateL2", () => {
  it("keeps an eighths line in one C five-finger hand and includes an eighth pair", () => {
    const shape: L2Shape = { kind: "eighths-single", hand: "RH" };
    const score = generateL2({ seed: 1, mode: "reading-lesson", shape });
    expectFrame(score, shape, 1, "reading-lesson");
    expect(score.hands).toEqual(["RH"]);
    expect(score.keySignature).toBe("C");
    expect(score.id).toBe("l2-eighths-single-1-RH");
    expect(score.staves.LH).toBeUndefined();
    const notes = sounding(score, "RH");
    const slots = pitchesFor("C", "RH");
    expect(notes.length).toBeGreaterThan(0);
    for (const note of notes) {
      expect(slots.some((slot) => samePitch(note.pitches[0], slot))).toBe(true);
      expect(note.fingers).toEqual([fingerFor("C", "RH", note.pitches[0])]);
    }
    expect(hasEighthGroup(score)).toBe(true);
    expect(generateL2({ seed: 1, mode: "reading-lesson", shape })).toEqual(score);
  });

  it("spells the left-hand eighths line in bass C3-G3", () => {
    const shape: L2Shape = { kind: "eighths-single", hand: "LH" };
    const score = generateL2({ seed: 2, mode: "reading-lesson", shape });
    expectFrame(score, shape, 2, "reading-lesson");
    expect(score.hands).toEqual(["LH"]);
    expect(score.id).toBe("l2-eighths-single-2-LH");
    const slots = pitchesFor("C", "LH");
    for (const note of sounding(score, "LH")) {
      expect(slots.some((slot) => samePitch(note.pitches[0], slot))).toBe(true);
    }
    expect(hasEighthGroup(score)).toBe(true);
  });

  it("gives odd bars to one hand and even bars to the other", () => {
    const shape: L2Shape = { kind: "alternate" };
    const score = generateL2({ seed: 3, mode: "reading-lesson", shape });
    expectFrame(score, shape, 3, "reading-lesson");
    expect(score.hands).toEqual(["RH", "LH"]);
    expect(score.keySignature).toBe("C");
    expect(score.id).toBe("l2-alternate-3");
    const owners = [0, 1, 2, 3].map((measure) =>
      score.hands.filter((hand) =>
        score.staves[hand]!.measures[measure].notes.some((note) => note.pitches.length > 0),
      ),
    );
    for (const hands of owners) expect(hands).toHaveLength(1);
    expect(owners[0][0]).not.toBe(owners[1][0]);
    expect(owners[2][0]).toBe(owners[0][0]);
    expect(owners[3][0]).toBe(owners[1][0]);
    const slots = { RH: pitchesFor("C", "RH"), LH: pitchesFor("C", "LH") };
    for (const hand of score.hands) {
      for (const note of sounding(score, hand)) {
        expect(slots[hand].some((slot) => samePitch(note.pitches[0], slot))).toBe(true);
      }
    }
    expect(generateL2({ seed: 3, mode: "reading-lesson", shape })).toEqual(score);
  });

  it("attacks both hands together on the same rhythm", () => {
    const shape: L2Shape = { kind: "together", texture: "same" };
    const score = generateL2({ seed: 4, mode: "reading-lesson", shape });
    expectFrame(score, shape, 4, "reading-lesson");
    expect(score.hands).toEqual(["RH", "LH"]);
    expect(score.keySignature).toBe("C");
    expect(score.id).toBe("l2-together-4-same");
    const rh = score.staves.RH!.measures.map((measure) => measure.notes.map((note) => note.duration));
    const lh = score.staves.LH!.measures.map((measure) => measure.notes.map((note) => note.duration));
    expect(rh).toEqual(lh);
    expect(onsets(score, "RH")).toEqual(onsets(score, "LH"));
    expect(onsets(score, "RH").length).toBeGreaterThan(0);
    expect(generateL2({ seed: 4, mode: "reading-lesson", shape })).toEqual(score);
  });

  it("holds one hand while the other walks in quarters or eighths", () => {
    const shape: L2Shape = { kind: "together", texture: "hold" };
    const score = generateL2({ seed: 5, mode: "reading-lesson", shape });
    expectFrame(score, shape, 5, "reading-lesson");
    expect(score.id).toBe("l2-together-5-hold");
    expect(score.keySignature).toBe("C");
    const spans = (hand: Hand) => {
      const found: { start: number; end: number; duration: Duration }[] = [];
      let beat = 0;
      for (const measure of score.staves[hand]!.measures) {
        for (const note of measure.notes) {
          const length = DURATION_BEATS[note.duration];
          if (note.pitches.length > 0) found.push({ start: beat, end: beat + length, duration: note.duration });
          beat += length;
        }
      }
      return found;
    };
    const rh = spans("RH");
    const lh = spans("LH");
    const isLong = (notes: { duration: Duration }[]) =>
      notes.length > 0 && notes.every((note) => note.duration === "h" || note.duration === "w");
    const rhLong = isLong(rh);
    const lhLong = isLong(lh);
    expect(rhLong).not.toBe(lhLong);
    const short = rhLong ? lh : rh;
    const long = rhLong ? rh : lh;
    expect(short.every((note) => note.duration === "q" || note.duration === "8")).toBe(true);
    expect(short.every((note) => long.some((span) => note.start >= span.start && note.start < span.end))).toBe(true);
    expect(generateL2({ seed: 5, mode: "reading-lesson", shape })).toEqual(score);
  });

  it("finds the F five-finger notes, including B-flat", () => {
    const shape: L2Shape = { kind: "key-find", key: "F", hand: "RH" };
    const score = generateL2({ seed: 6, mode: "reading-lesson", shape });
    expectFrame(score, shape, 6, "reading-lesson");
    expect(score.hands).toEqual(["RH"]);
    expect(score.keySignature).toBe("F");
    expect(score.id).toBe("l2-key-find-6-F-RH");
    const slots = pitchesFor("F", "RH");
    const notes = sounding(score, "RH");
    for (const note of notes) {
      expect(slots.some((slot) => samePitch(note.pitches[0], slot))).toBe(true);
      expect(note.fingers).toEqual([fingerFor("F", "RH", note.pitches[0])]);
    }
    expect(notes.some((note) => note.pitches[0].step === "B" && note.pitches[0].alteration === -1)).toBe(true);
    expect(generateL2({ seed: 6, mode: "reading-lesson", shape })).toEqual(score);
  });

  it("finds the G five-finger notes from G", () => {
    const shape: L2Shape = { kind: "key-find", key: "G", hand: "LH" };
    const score = generateL2({ seed: 7, mode: "reading-lesson", shape });
    expectFrame(score, shape, 7, "reading-lesson");
    expect(score.hands).toEqual(["LH"]);
    expect(score.keySignature).toBe("G");
    expect(score.id).toBe("l2-key-find-7-G-LH");
    const slots = pitchesFor("G", "LH");
    const notes = sounding(score, "LH");
    for (const note of notes) {
      expect(slots.some((slot) => samePitch(note.pitches[0], slot))).toBe(true);
    }
    expect(notes.some((note) => samePitch(note.pitches[0], slots[0]))).toBe(true);
    expect(generateL2({ seed: 7, mode: "reading-lesson", shape })).toEqual(score);
  });

  it("reads an F or G five-finger line that includes eighths", () => {
    const lines: L2Shape[] = [
      { kind: "key-line", key: "F", hand: "LH" },
      { kind: "key-line", key: "G", hand: "RH" },
    ];
    for (const [index, shape] of lines.entries()) {
      if (shape.kind !== "key-line") continue;
      const seed = 8 + index;
      const score = generateL2({ seed, mode: "reading-lesson", shape });
      expectFrame(score, shape, seed, "reading-lesson");
      expect(score.hands).toEqual([shape.hand]);
      expect(score.keySignature).toBe(shape.key);
      expect(score.id).toBe(`l2-key-line-${seed}-${shape.key}-${shape.hand}`);
      const slots = pitchesFor(shape.key, shape.hand);
      for (const note of sounding(score, shape.hand)) {
        expect(slots.some((slot) => samePitch(note.pitches[0], slot))).toBe(true);
        expect(note.fingers).toEqual([fingerFor(shape.key, shape.hand, note.pitches[0])]);
      }
      expect(hasEighthGroup(score)).toBe(true);
      expect(generateL2({ seed, mode: "reading-lesson", shape })).toEqual(score);
    }
  });

  it("shifts from C position to D-shift exactly once", () => {
    for (const [index, hand] of (["RH", "LH"] as const).entries()) {
      const shape: L2Shape = { kind: "shift-once", hand };
      const seed = 10 + index;
      const score = generateL2({ seed, mode: "reading-lesson", shape });
      expectFrame(score, shape, seed, "reading-lesson");
      expect(score.hands).toEqual([hand]);
      expect(score.keySignature).toBe("C");
      expect(score.id).toBe(`l2-shift-once-${seed}-${hand}`);
      const positions = sounding(score, hand).map((note) => positionByFinger(note.pitches[0], note.fingers?.[0] ?? -1, hand));
      expect(positions[0]).toBe("C");
      expect(positions[positions.length - 1]).toBe("D-shift");
      const transitions = positions.slice(1).filter((position, noteIndex) => position !== positions[noteIndex]).length;
      expect(transitions).toBe(1);
      expect(generateL2({ seed, mode: "reading-lesson", shape })).toEqual(score);
    }
  });

  it("builds a two-hand test or sight line with eighths and at least eight notes", () => {
    const kinds = ["test", "sight"] as const;
    for (const [index, kind] of kinds.entries()) {
      const shape: L2Shape = { kind };
      const seed = 12 + index;
      const mode = kind === "test" ? "reading-test" : "sight";
      const score = generateL2({ seed, mode, shape });
      expectFrame(score, shape, seed, mode);
      expect(score.hands).toEqual(["RH", "LH"]);
      expect(score.id).toBe(`l2-${kind}-${seed}`);
      expect(["C", "F", "G"]).toContain(score.keySignature);
      expect(sounding(score, "RH").length).toBeGreaterThan(0);
      expect(sounding(score, "LH").length).toBeGreaterThan(0);
      expect(sounding(score, "RH").length + sounding(score, "LH").length).toBeGreaterThanOrEqual(8);
      expect(hasEighthGroup(score)).toBe(true);
      expect(generateL2({ seed, mode, shape })).toEqual(score);
    }
  });

  it("changes the line when the seed changes", () => {
    const shape: L2Shape = { kind: "eighths-single", hand: "RH" };
    const first = generateL2({ seed: 1, mode: "reading-lesson", shape });
    const second = generateL2({ seed: 99, mode: "reading-lesson", shape });
    expect(second).not.toEqual(first);
  });
});
