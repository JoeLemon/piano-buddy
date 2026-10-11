import { describe, expect, it } from "vitest";
import { parsePitchLabel, pitchLabel, pitchToMidi } from "../src/domain/pitch";

describe("pitch", () => {
  it("maps middle C and the L1 five-finger notes", () => {
    expect(pitchToMidi({ step: "C", octave: 4, alteration: 0 })).toBe(60);
    expect(pitchToMidi({ step: "D", octave: 4, alteration: 0 })).toBe(62);
    expect(pitchToMidi({ step: "E", octave: 4, alteration: 0 })).toBe(64);
    expect(pitchToMidi({ step: "F", octave: 4, alteration: 0 })).toBe(65);
    expect(pitchToMidi({ step: "G", octave: 4, alteration: 0 })).toBe(67);
    expect(pitchToMidi({ step: "C", octave: 3, alteration: 0 })).toBe(48);
    expect(pitchToMidi({ step: "B", octave: 4, alteration: -1 })).toBe(70);
  });

  it("round-trips labels used by the weak-note queue", () => {
    expect(pitchLabel({ step: "F", octave: 4, alteration: 0 })).toBe("F4");
    expect(pitchLabel({ step: "B", octave: 4, alteration: -1 })).toBe("Bb4");
    expect(parsePitchLabel("F#4")).toEqual({ step: "F", octave: 4, alteration: 1 });
  });
});
