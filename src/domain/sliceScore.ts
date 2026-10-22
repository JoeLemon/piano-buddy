import type { Hand, Measure, Score } from "./types";

/** 曲库「分段跟弹」的一段：从 start 到 end（0 起，不含 end）。 */
export type ScoreSegment = {
  index: number;
  start: number;
  end: number;
  label: string;
};

/** 默认两小节一段；短曲也至少有一段。 */
const SEGMENT_MEASURES = 2;

export function scoreSegments(score: Score, size = SEGMENT_MEASURES): ScoreSegment[] {
  const total = measureCount(score);
  if (total === 0) return [];
  const width = Math.max(1, Math.floor(size));
  const segments: ScoreSegment[] = [];
  for (let start = 0; start < total; start += width) {
    const end = Math.min(total, start + width);
    segments.push({
      index: segments.length,
      start,
      end,
      label: start + 1 === end ? `第 ${start + 1} 小节` : `第 ${start + 1}–${end} 小节`,
    });
  }
  return segments;
}

/**
 * 切出一段用于跟弹/评测。
 *
 * 指定 hand 时只保留那只手，让曲库里的「右手/左手」选择可以直接变成单手跟弹；
 * BOTH 保留双谱表。谱子 id 带小节范围，避免不同段落在错题本里互相覆盖。
 */
export function sliceScore(
  score: Score,
  start: number,
  end: number,
  hand: Hand | "BOTH" = "BOTH",
): Score {
  const total = measureCount(score);
  const from = clamp(start, 0, total);
  const to = clamp(end, from, total);
  const hands: Hand[] = hand === "BOTH" ? [...score.hands] : [hand];
  const staves: Score["staves"] = {};
  for (const current of hands) {
    const stave = score.staves[current];
    if (!stave) continue;
    staves[current] = {
      clef: stave.clef,
      measures: stave.measures.slice(from, to).map(cloneMeasure),
    };
  }
  return {
    ...score,
    id: `${score.id}.m${from + 1}-${to}${hand === "BOTH" ? "" : `.${hand}`}`,
    hands,
    staves,
  };
}

/** 用整首的总小节数做上限；缺一只手时以存在的那只为基准。 */
export function measureCount(score: Score): number {
  return score.hands.reduce(
    (count, hand) => Math.max(count, score.staves[hand]?.measures.length ?? 0),
    0,
  );
}

function cloneMeasure(measure: Measure): Measure {
  return {
    notes: measure.notes.map((note) => ({
      ...note,
      pitches: note.pitches.map((pitch) => ({ ...pitch })),
      fingers: note.fingers ? [...note.fingers] : undefined,
    })),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
