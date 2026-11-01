import { describe, expect, it } from "vitest";
import {
  measureCount,
  scoreSegments,
  segmentBeatRange,
  sliceScore,
} from "../src/domain/sliceScore";
import type { Measure, Score } from "../src/domain/types";

function blankMeasure(index: number): Measure {
  return {
    notes: [
      {
        id: `m${index}`,
        pitches: [{ step: "C", octave: 4, alteration: 0 }],
        duration: "w",
        fingers: [1],
      },
    ],
  };
}

function longScore(): Score {
  const measures = Array.from({ length: 5 }, (_, index) => blankMeasure(index));
  return {
    id: "score.demo.l3",
    mode: "repertoire",
    level: 3,
    meter: { beats: 4, beatValue: 4 },
    keySignature: "C",
    hands: ["RH", "LH"],
    bpm: 72,
    staves: {
      RH: { clef: "treble", measures },
      LH: { clef: "bass", measures: measures.map((measure) => ({ ...measure })) },
    },
  };
}

describe("sliceScore", () => {
  it("splits a piece into two-measure segments and labels the last short one", () => {
    const segments = scoreSegments(longScore());
    expect(segments.map((segment) => segment.label)).toEqual([
      "第 1–2 小节",
      "第 3–4 小节",
      "第 5 小节",
    ]);
    expect(segments.map((segment) => [segment.start, segment.end])).toEqual([
      [0, 2],
      [2, 4],
      [4, 5],
    ]);
    expect(measureCount(longScore())).toBe(5);
  });

  it("keeps both staves for a both-hands segment and gives it a unique id", () => {
    const sliced = sliceScore(longScore(), 1, 3);
    expect(sliced.hands).toEqual(["RH", "LH"]);
    expect(sliced.staves.RH?.measures.map((measure) => measure.notes[0]?.id)).toEqual(["m1", "m2"]);
    expect(sliced.staves.LH?.measures).toHaveLength(2);
    expect(sliced.id).toBe("score.demo.l3.m2-3");
  });

  it("can keep one hand for single-hand following", () => {
    const sliced = sliceScore(longScore(), 0, 2, "LH");
    expect(sliced.hands).toEqual(["LH"]);
    expect(sliced.staves.RH).toBeUndefined();
    expect(sliced.staves.LH?.measures).toHaveLength(2);
    expect(sliced.id).toBe("score.demo.l3.m1-2.LH");
  });

  it("clones notes so editing a slice does not mutate the catalog score", () => {
    const original = longScore();
    const sliced = sliceScore(original, 0, 1);
    sliced.staves.RH!.measures[0]!.notes[0]!.pitches[0]!.step = "G";
    expect(original.staves.RH?.measures[0]?.notes[0]?.pitches[0]?.step).toBe("C");
  });

  it("clamps out-of-range requests instead of producing broken staves", () => {
    const sliced = sliceScore(longScore(), -3, 99);
    expect(sliced.staves.RH?.measures).toHaveLength(5);
    expect(sliced.hands).toEqual(["RH", "LH"]);
  });

  it("remaps repeats that fit entirely inside the slice", () => {
    const score = longScore();
    score.repeats = [{ from: 1, to: 3 }];
    const sliced = sliceScore(score, 1, 4);
    expect(sliced.repeats).toEqual([{ from: 0, to: 2 }]);
    // 切片不修改原谱。
    expect(score.repeats).toEqual([{ from: 1, to: 3 }]);
  });

  it("drops a repeat that is only half inside the slice", () => {
    const score = longScore();
    score.repeats = [{ from: 1, to: 3 }];
    // 终点 3 落在段外：留下半截反复只会让跟弹莫名跳回。
    expect(sliceScore(score, 0, 3).repeats).toBeUndefined();
  });

  it("keeps navigation marks inside the slice and drops orphaned jumps", () => {
    const score = longScore();
    score.navigation = [
      { at: 1, kind: "segno" },
      { at: 2, kind: "ds" },
    ];
    const kept = sliceScore(score, 1, 4);
    expect(kept.navigation).toEqual([
      { at: 0, kind: "segno" },
      { at: 1, kind: "ds" },
    ]);
    // 从第 3 小节切起：Segno 被切掉，D.S. 没有落点，不能留在段里。
    expect(sliceScore(score, 2, 4).navigation).toBeUndefined();
  });
});

describe("segmentBeatRange", () => {
  it("converts a two-measure segment to beats", () => {
    // 每小节一个全音符 = 4 拍
    expect(segmentBeatRange(longScore(), "BOTH", { start: 0, end: 2 })).toEqual({
      startBeat: 0,
      endBeat: 8,
    });
    expect(segmentBeatRange(longScore(), "BOTH", { start: 2, end: 4 })).toEqual({
      startBeat: 8,
      endBeat: 16,
    });
  });

  it("uses the selected hand when one hand is shorter than the other", () => {
    const score = longScore();
    score.staves.LH!.measures = score.staves.LH!.measures.slice(0, 2);
    // 左手只有两小节：循环到左手谱尾为止，不会给出越界的拍点
    expect(segmentBeatRange(score, "LH", { start: 0, end: 4 })).toEqual({
      startBeat: 0,
      endBeat: 8,
    });
    // 双手仍然按右手算满五小节
    expect(segmentBeatRange(score, "BOTH", { start: 4, end: 5 })).toEqual({
      startBeat: 16,
      endBeat: 20,
    });
  });

  it("clamps out-of-range segments instead of returning negative beats", () => {
    expect(segmentBeatRange(longScore(), "RH", { start: -2, end: 99 })).toEqual({
      startBeat: 0,
      endBeat: 20,
    });
    expect(segmentBeatRange(longScore(), "RH", { start: 4, end: 2 })).toEqual({
      startBeat: 16,
      endBeat: 16,
    });
  });

  it("measures the segment in performance order when the score repeats", () => {
    const score = longScore();
    score.repeats = [{ from: 0, to: 1 }];
    // 演奏顺序 1–2–1–2–3：前两小节弹两遍，第 3 小节从第 16 拍开始。
    expect(segmentBeatRange(score, "RH", { start: 0, end: 2 })).toEqual({
      startBeat: 0,
      endBeat: 16,
    });
    expect(segmentBeatRange(score, "RH", { start: 2, end: 3 })).toEqual({
      startBeat: 16,
      endBeat: 20,
    });
  });
});
