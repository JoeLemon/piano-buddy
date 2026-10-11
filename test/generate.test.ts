import { describe, expect, it } from "vitest";
import { isAllowed } from "../src/domain/allowed";
import { generateL1 } from "../src/domain/generate";

describe("generateL1", () => {
  it("builds a deterministic four-bar single-hand line with at least 8 notes", () => {
    const score = generateL1({ hand: "RH", seed: 3, mode: "reading-test" });
    expect(score.level).toBe(1);
    expect(score.hands).toEqual(["RH"]);
    expect(score.staves.RH?.measures).toHaveLength(4);
    expect(score.keySignature).toBe("C");
    expect(score.meter).toEqual({ beats: 4, beatValue: 4 });
    expect(isAllowed(score)).toBe(true);
    const sounding = score.staves.RH!.measures.flatMap((measure) =>
      measure.notes.filter((note) => note.pitches.length > 0),
    );
    expect(sounding.length).toBeGreaterThanOrEqual(8);
    expect(generateL1({ hand: "RH", seed: 3, mode: "reading-test" })).toEqual(score);
  });

  it("gives the left hand bass C3-G3", () => {
    const score = generateL1({ hand: "LH", seed: 9, mode: "sight" });
    expect(score.staves.LH?.clef).toBe("bass");
    expect(isAllowed(score)).toBe(true);
  });
});
