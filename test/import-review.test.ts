import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { annotateScore } from "../src/domain/fingering";
import type { Score } from "../src/domain/types";
import {
  countScoreMeasures,
  countUnfingered,
  reviewImportedScore,
} from "../src/repertoire/importReview";

const L2_SCORE = JSON.parse(
  readFileSync(resolve("content/song.ode-to-joy.l2/content/score.json"), "utf8"),
) as Score;

function stripFingers(score: Score): Score {
  const staves: Score["staves"] = {};
  for (const hand of score.hands) {
    const stave = score.staves[hand];
    if (!stave) continue;
    staves[hand] = {
      ...stave,
      measures: stave.measures.map((measure) => ({
        ...measure,
        notes: measure.notes.map((note) =>
          note.pitches.length > 0 ? { ...note, fingers: undefined } : note,
        ),
      })),
    };
  }
  return { ...score, staves };
}

describe("导入后审阅", () => {
  it("统计小节数与未补指法的音", () => {
    const raw = stripFingers(L2_SCORE);
    expect(countScoreMeasures(L2_SCORE)).toBe(8);
    expect(countUnfingered(L2_SCORE)).toBe(0);
    expect(countUnfingered(raw)).toBeGreaterThan(0);

    const fingered = annotateScore(raw);
    expect(countUnfingered(fingered)).toBe(0);
  });

  it("同时给出按音高/按指法评级与差异技能", () => {
    const raw = stripFingers(L2_SCORE);
    const fingered = annotateScore(raw);
    const review = reviewImportedScore(raw, fingered);

    expect(review.measures).toBe(8);
    const rank = (difficulty: typeof review.pitch) =>
      difficulty.level + (difficulty.label.endsWith("+") ? 0.5 : 0);
    expect(review.delta).toBe(rank(review.fingered) - rank(review.pitch));
    expect(review.requiredPitch).toEqual([...review.requiredPitch].sort());
    expect(review.requiredFingered).toEqual([...review.requiredFingered].sort());
    expect(review.positionsPitch.source).toBe("pitch");
    expect(review.positionsFingered.source).toBe("fingering");

    for (const id of review.addedSkills) {
      expect(review.requiredPitch).not.toContain(id);
      expect(review.requiredFingered).toContain(id);
    }
    for (const id of review.removedSkills) {
      expect(review.requiredPitch).toContain(id);
      expect(review.requiredFingered).not.toContain(id);
    }
  });
});
