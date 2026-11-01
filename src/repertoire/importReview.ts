import type { Score } from "../domain/types";
import { rateScore, type Difficulty } from "./difficulty";
import {
  analyzeHandPositions,
  requiredSkillsForScore,
  type PositionAnalysis,
} from "./skillGraph";

/**
 * MusicXML 导入后的作者审阅数据。
 *
 * 一份谱会有两个评级：
 *  - `pitch`：未补指法，按音高/词汇表判断，代表谱面本身要求什么；
 *  - `fingered`：补完指法后，引擎按手位判断，`validate:content` 用的是这个。
 *
 * 求解器只看局部连贯性，可能把 C 手位旋律判成换位，从而把评级抬高。
 * 批量导入把它做成一张差异表，并列出「指法新增的技能」，方便作者逐首校对。
 */
export interface ImportReview {
  /** 全曲最大小节数。 */
  measures: number;
  pitch: Difficulty;
  fingered: Difficulty;
  /** 按标签折算的档位差（`L2+` 记 2.5）；正数表示补指法后评级被抬高。 */
  delta: number;
  requiredPitch: string[];
  requiredFingered: string[];
  /** 只有补指法后才出现的技能（通常就是待校对的手位）。 */
  addedSkills: string[];
  /** 补指法后反而消失的技能，通常是求解器把手位判成了更简单的形状。 */
  removedSkills: string[];
  /** 补完指法后仍缺 finger=1..5 的音数；>0 时 demo 会崩。 */
  unfingered: number;
  positionsPitch: PositionAnalysis;
  positionsFingered: PositionAnalysis;
}

export function countScoreMeasures(score: Score): number {
  let max = 0;
  for (const hand of score.hands) {
    max = Math.max(max, score.staves[hand]?.measures.length ?? 0);
  }
  return max;
}

/** 统计没有合法指法的发声音；和弦要求每个音都有对应手指。 */
export function countUnfingered(score: Score): number {
  let count = 0;
  for (const hand of score.hands) {
    for (const measure of score.staves[hand]?.measures ?? []) {
      for (const note of measure.notes) {
        if (note.pitches.length === 0) continue;
        const fingers = note.fingers;
        if (!fingers || fingers.length !== note.pitches.length) {
          count += 1;
          continue;
        }
        if (fingers.some((finger) => finger < 1 || finger > 5)) count += 1;
      }
    }
  }
  return count;
}

export function reviewImportedScore(pitchScore: Score, fingeredScore: Score = pitchScore): ImportReview {
  const pitch = rateScore(pitchScore);
  const fingered = rateScore(fingeredScore);
  const requiredPitch = [...requiredSkillsForScore(pitchScore)].sort();
  const requiredFingered = [...requiredSkillsForScore(fingeredScore)].sort();
  const pitchSet = new Set(requiredPitch);
  const fingeredSet = new Set(requiredFingered);

  return {
    measures: countScoreMeasures(fingeredScore),
    pitch,
    fingered,
    delta: difficultyRank(fingered) - difficultyRank(pitch),
    requiredPitch,
    requiredFingered,
    addedSkills: requiredFingered.filter((id) => !pitchSet.has(id)),
    removedSkills: requiredPitch.filter((id) => !fingeredSet.has(id)),
    unfingered: countUnfingered(fingeredScore),
    positionsPitch: analyzeHandPositions(pitchScore),
    positionsFingered: analyzeHandPositions(fingeredScore),
  };
}

/** 把 `L2+` 折算成 2.5，避免 L1+ → L2 被显示成「差 0」。 */
function difficultyRank(difficulty: Difficulty): number {
  return difficulty.level + (difficulty.label.endsWith("+") ? 0.5 : 0);
}
