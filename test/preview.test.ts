import { describe, expect, it } from "vitest";
import { previewScore } from "../src/audio/preview";
import { generateL1 } from "../src/domain/generate";

describe("previewScore", () => {
  it("returns a stop handle without throwing when audio is unavailable", () => {
    const score = generateL1({ hand: "RH", seed: 5, mode: "sight" });
    const playback = previewScore(score, "RH", 60);
    expect(typeof playback.stop).toBe("function");
    playback.stop();
  });
});
