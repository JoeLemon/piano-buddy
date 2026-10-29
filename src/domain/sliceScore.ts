import type { Hand, Measure, NoteEvent, Score } from "./types";
import { DURATION_BEATS } from "./vocabulary";

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
    const measures = stave.measures.slice(from, to).map(cloneMeasure);
    trimDanglingTies(measures);
    staves[current] = { clef: stave.clef, measures };
  }
  const sliced: Score = {
    ...score,
    id: `${score.id}.m${from + 1}-${to}${hand === "BOTH" ? "" : `.${hand}`}`,
    hands,
    staves,
  };
  // 弱起只属于「从第一小节开始」的那一段。中间切出来的段落首小节是整小节，
  // 继续带着 pickup 会让 isAllowed 与跟弹的小节线都算错。
  if (from > 0) delete sliced.pickup;
  return sliced;
}

/** 用整首的总小节数做上限；缺一只手时以存在的那只为基准。 */
export function measureCount(score: Score): number {
  return score.hands.reduce(
    (count, hand) => Math.max(count, score.staves[hand]?.measures.length ?? 0),
    0,
  );
}

/**
 * 分段对应的拍区间（含头不含尾），供示范播放的 A–B 循环用。
 *
 * 小节坐标转拍坐标：把参考谱表前若干小节的时值累加出来。双手谱以右手为
 * 参考——两手小节对齐时拍坐标一致；单选一只手时用那只手，循环范围和听到
 * 的永远是同一份音符。
 */
export function segmentBeatRange(
  score: Score,
  hand: Hand | "BOTH",
  segment: { start: number; end: number },
): { startBeat: number; endBeat: number } {
  const reference: Hand | null =
    hand === "BOTH"
      ? score.hands.includes("RH")
        ? "RH"
        : score.hands[0] ?? null
      : hand;
  const measures = reference ? score.staves[reference]?.measures ?? [] : [];
  const total = measureCount(score);
  const from = clamp(segment.start, 0, total);
  const to = clamp(segment.end, from, total);

  let startBeat = 0;
  let endBeat = 0;
  for (let index = 0; index < measures.length && index < to; index += 1) {
    endBeat += measureBeats(measures[index]);
    if (index < from) startBeat = endBeat;
  }
  return { startBeat, endBeat: Math.max(endBeat, startBeat) };
}

function measureBeats(measure: Measure): number {
  return measure.notes.reduce((sum, note) => sum + (DURATION_BEATS[note.duration] ?? 0), 0);
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

/**
 * 切片会把连音线拦腰截断：第一段可能只剩下后半截，最后一段可能只剩下前半截。
 * 就地清掉悬空的那一端——否则切片看起来像记谱错误（`isAllowed` 也会判它不合法），
 * 而学习者看到的是一段本来就没头没尾的练习。
 *
 * 只看两端的**发声**音：中间的休止符不影响，端点落在休止符上就不必动。
 */
function trimDanglingTies(measures: readonly Measure[]): void {
  const first = firstSounding(measures);
  if (first && (first.tie === "stop" || first.tie === "continue")) delete first.tie;

  const last = lastSounding(measures);
  if (last?.tie === "start") delete last.tie;
  else if (last?.tie === "continue") last.tie = "stop";
}

function firstSounding(measures: readonly Measure[]): NoteEvent | null {
  for (const measure of measures) {
    for (const note of measure.notes) {
      if (note.pitches.length > 0 && !note.duration.endsWith("r")) return note;
    }
  }
  return null;
}

function lastSounding(measures: readonly Measure[]): NoteEvent | null {
  for (let m = measures.length - 1; m >= 0; m -= 1) {
    const notes = measures[m].notes;
    for (let i = notes.length - 1; i >= 0; i -= 1) {
      const note = notes[i];
      if (note.pitches.length > 0 && !note.duration.endsWith("r")) return note;
    }
  }
  return null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
