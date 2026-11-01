import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { Score } from "../src/domain/types";
import { scoreSegments, sliceScore } from "../src/domain/sliceScore";
import { gradeRhythm, planForScore, rhythmSummary } from "../src/practice";
import { rateScore, requiredSkillsForScore } from "../src/repertoire";

/**
 * 《风铃》的 L6 教学链：谱面本身、分段切片、跟弹时间轴与判定必须说同一件事。
 *
 * 这里不 mock 时间：每个目标音按自己的拍点换算成毫秒，再交给 `gradeRhythm`
 * 走真实的音高/拍点判定。这样十六分音符的密度、左右手合并槽位和分段边界
 * 都会在测试里露出来。
 */

const SCORE = JSON.parse(
  readFileSync(resolve("content/song.wind-chime.l6/content/score.json"), "utf8"),
) as Score;

const COUNT_IN = 4;
const MS_PER_BEAT = 60000 / SCORE.bpm;

function perfectHits(score: Score, hand: "RH" | "LH" | "BOTH" = "BOTH") {
  const plan = planForScore(score, hand);
  const hits = plan.slots.flatMap((slot, slotIndex) =>
    slot.midis.map((midi) => ({
      midi,
      slotIndex,
      atMs: (slot.startBeat + COUNT_IN) * MS_PER_BEAT,
    })),
  );
  return { plan, hits };
}

describe("《风铃》L6 教学链", () => {
  it("is a 12-measure L6 etude with sixteenth-note and leap skills", () => {
    expect(rateScore(SCORE).level).toBe(6);
    expect(scoreSegments(SCORE)).toHaveLength(6);

    const skills = requiredSkillsForScore(SCORE);
    expect(skills).toContain("rhythm.sixteenth");
    expect(skills).toContain("pos.leap");
    expect(skills).toContain("texture.broken");

    const plan = planForScore(SCORE, "BOTH");
    // 12 小节 × 每拍 4 个十六分 = 192 个合并槽位。
    expect(plan.slots).toHaveLength(192);
    expect(plan.beatsPerBar).toBe(4);
    expect(plan.measureStarts).toHaveLength(12);
    // 第一拍右手 C5 + 左手 C3 必须合并成一个“一起按”的位置。
    expect(plan.slots[0]?.midis).toEqual([48, 72]);
  });

  it("scores a perfect whole-song pass at the authored 48 BPM", () => {
    const { plan, hits } = perfectHits(SCORE);
    const result = gradeRhythm(plan, hits, 0, COUNT_IN);

    expect(result.total).toBe(192);
    expect(result.onCount).toBe(192);
    expect(result.accuracy).toBe(1);
    expect(rhythmSummary(result)).toContain("100%");
  });

  it("keeps every two-measure assessment segment independently playable", () => {
    for (const segment of scoreSegments(SCORE)) {
      const sliced = sliceScore(SCORE, segment.start, segment.end, "BOTH");
      const { plan, hits } = perfectHits(sliced);
      const result = gradeRhythm(plan, hits, 0, COUNT_IN);

      expect(plan.slots, segment.label).toHaveLength(32);
      expect(result.onCount, segment.label).toBe(32);
    }
  });
});
