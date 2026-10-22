import type { Score } from "../domain/types";
import {
  SKILL_BY_ID,
  maxSkillLevel,
  minLevelForScore,
  requiredSkillsForScore,
} from "./skillGraph";

/**
 * ── 难度评级 ─────────────────────────────────────────────────
 * 难度 = 主项（词汇表最小容纳档 与 所需技能最高档 取较大者）
 *        + 速度修正（相对各档 MVP 测试速度锚点）
 *        + 重复度修正（段落循环越多越易学）
 *        + 长度修正（超长曲目上调）。
 *
 * 采用保守算法：最终档向下取整（宁评低不评高），半档体现在 label 的 +/− 上；
 * 向下修正最多 -0.5，避免把一首 L2 曲子直接标成 L1。
 *
 * vector 只是「难在哪」的可解释维度，不参与最终档计算；最终档仍由
 * baseLevel + adjustments 决定，方便和 MVP 的 L1–L6 解锁规则对齐。
 */

export interface DifficultyAdjustment {
  /** 速度修正（相对锚点 BPM） */
  speed: number;
  /** 重复度修正（<=0） */
  repeat: number;
  /** 长度修正（>=0） */
  length: number;
  /** 合计修正（半档步进，向下最多 -0.5） */
  total: number;
}

/** 可解释的难度维度；0 表示该维度没有要求。 */
export interface DifficultyVector {
  rhythm: number;
  coordination: number;
  key: number;
  handPosition: number;
  harmony: number;
  texture: number;
}

export interface Difficulty {
  /** 最终解锁档 1..6；7 表示超出词汇表（超纲） */
  level: number;
  /** 主项：词汇表最小容纳档与技能最高档的较大者（未修正） */
  baseLevel: number;
  bpm: number;
  adjustments: DifficultyAdjustment;
  /** 体感难度标签，如 L3 / L3+ / 超纲 */
  label: string;
  /** 难度来源，用于 UI「难在哪」和内容 QA */
  vector: DifficultyVector;
}

export interface RateOptions {
  /** 0..1 重复度：1 = 整曲同一乐句循环，越低越难 */
  repeat?: number;
  /** 覆盖小节数（默认从乐谱统计） */
  measures?: number;
}

/** 各档 MVP 过关测试速度锚点（BPM），用于速度修正的基准。 */
const REF_BPM: Record<number, number> = { 1: 60, 2: 60, 3: 60, 4: 52, 5: 52, 6: 48 };

const clampNum = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function speedAdjust(bpm: number, baseLevel: number): number {
  const ref = REF_BPM[clampNum(baseLevel, 1, 6)] ?? 60;
  const delta = bpm - ref;
  if (delta >= 24) return 1;
  if (delta >= 12) return 0.5;
  if (delta <= -24) return -1;
  if (delta <= -12) return -0.5;
  return 0;
}

function repeatAdjust(repeat: number | undefined): number {
  if (repeat == null) return 0;
  if (repeat >= 0.8) return -1;
  if (repeat >= 0.5) return -0.5;
  return 0;
}

function lengthAdjust(measures: number): number {
  if (measures > 48) return 1;
  if (measures > 24) return 0.5;
  return 0;
}

function maxLevelFor(ids: Iterable<string>, prefixes: readonly string[]): number {
  let max = 0;
  for (const id of ids) {
    if (!prefixes.some((prefix) => id.startsWith(prefix))) continue;
    max = Math.max(max, SKILL_BY_ID.get(id)?.level ?? 0);
  }
  return max;
}

export function buildDifficultyVector(required: Iterable<string>): DifficultyVector {
  const ids = [...required];
  return {
    rhythm: maxLevelFor(ids, ["rhythm."]),
    coordination: maxLevelFor(ids, ["hands."]),
    key: maxLevelFor(ids, ["key."]),
    handPosition: maxLevelFor(ids, ["pos."]),
    harmony: maxLevelFor(ids, ["chord."]),
    texture: maxLevelFor(ids, ["texture."]),
  };
}

function countMeasures(score: Score): number {
  let max = 0;
  for (const hand of score.hands) {
    const stave = score.staves[hand];
    if (stave) max = Math.max(max, stave.measures.length);
  }
  return max;
}

export function rateScore(score: Score, opts: RateOptions = {}): Difficulty {
  const required = requiredSkillsForScore(score);
  const vector = buildDifficultyVector(required);
  const vocabularyLevel = minLevelForScore(score);
  const skillLevel = maxSkillLevel(required);
  const baseLevel = vocabularyLevel >= 7 ? 7 : Math.max(vocabularyLevel, skillLevel);
  const bpm = score.bpm;

  if (baseLevel >= 7) {
    return {
      level: 7,
      baseLevel,
      bpm,
      adjustments: { speed: 0, repeat: 0, length: 0, total: 0 },
      label: "超纲",
      vector,
    };
  }

  const speed = speedAdjust(bpm, baseLevel);
  const repeat = repeatAdjust(opts.repeat);
  const length = lengthAdjust(opts.measures ?? countMeasures(score));
  // 向下修正封顶 -0.5：低评会让用户无聊、技术变形，也是失败模式。
  const total = Math.max(-0.5, speed + repeat + length);

  const raw = clampNum(baseLevel + total, 1, 6);
  const level = clampNum(Math.floor(raw), 1, 6);

  const whole = Math.floor(raw);
  const frac = raw - whole;
  const label = frac >= 0.5 ? `L${whole}+` : `L${whole}`;

  return { level, baseLevel, bpm, adjustments: { speed, repeat, length, total }, label, vector };
}
