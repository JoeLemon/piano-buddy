import type { MelodyNote, PlaybackKey, PlaybackQuestion } from "./melodyTypes";
import { PLAYBACK_KEYS } from "./melodyTypes";

/**
 * 旋律听辨的随机出题器（题库之外的补充）。
 *
 * 参考项目有一份很长的「可唱性」生成器；这里保留它最重要的约束：
 * - 四个考纲调（G/E 大调、G/E 小调）；
 * - 旋律从主音出发、落在主音上；
 * - 级进为主，偶尔跳进；
 * - 小调使用和声小调的升高导音。
 *
 * 输出结构与静态题库完全一致，因此播放、判题、谱面转换都不需要分叉。
 */
type MelodyKeyInfo = {
  /** 第 1–7 级，放在中央 C 附近。 */
  scale: readonly string[];
  /** 高八度的主音，作为第 8 级。 */
  upperTonic: string;
  /** 主和弦（根音、三音、五音、高八度根音）。 */
  tonicChord: readonly string[];
};

const KEY_INFO: Readonly<Record<PlaybackKey, MelodyKeyInfo>> = {
  "G major": {
    scale: ["G4", "A4", "B4", "C5", "D5", "E5", "F#5"],
    upperTonic: "G5",
    tonicChord: ["G4", "B4", "D5", "G5"],
  },
  "E major": {
    scale: ["E4", "F#4", "G#4", "A4", "B4", "C#5", "D#5"],
    upperTonic: "E5",
    tonicChord: ["E4", "G#4", "B4", "E5"],
  },
  "G minor": {
    // 和声小调：第 7 级升高，听感上更接近考纲里的「小调」。
    scale: ["G4", "A4", "Bb4", "C5", "D5", "Eb5", "F#5"],
    upperTonic: "G5",
    tonicChord: ["G4", "Bb4", "D5", "G5"],
  },
  "E minor": {
    scale: ["E4", "F#4", "G4", "A4", "B4", "C5", "D#5"],
    upperTonic: "E5",
    tonicChord: ["E4", "G4", "B4", "E5"],
  },
};

/** 一小节的节奏型；每种都正好填满 4/4 或 3/4。 */
const RHYTHMS_44: readonly (readonly number[])[] = [
  [1, 1, 1, 1],
  [0.5, 0.5, 1, 1, 1],
  [2, 1, 1],
  [1, 0.5, 0.5, 2],
  [2, 2],
  [0.5, 0.5, 0.5, 0.5, 1, 1],
];

const RHYTHMS_34: readonly (readonly number[])[] = [
  [1, 1, 1],
  [0.5, 0.5, 2],
  [2, 1],
  [1, 0.5, 0.5, 1],
];

/** 级进为主、允许同音与二度/三度跳进。 */
const STEPS = [-2, -1, -1, -1, 0, 1, 1, 1, 2] as const;

export function melodyKeyInfo(key: PlaybackKey): MelodyKeyInfo {
  return KEY_INFO[key];
}

/** 生成一条两小节的短旋律；同一 seed 永远得到同一条。 */
export function generateMelody(
  key: PlaybackKey,
  seed: number,
  id = `generated-${key.replace(/\s+/g, "-")}-${seed}`,
): PlaybackQuestion {
  const random = mulberry32(seed >>> 0);
  const meter = random() < 0.25 ? "3/4" : "4/4";
  const rhythms = meter === "3/4" ? RHYTHMS_34 : RHYTHMS_44;
  const info = KEY_INFO[key];

  const degrees: number[] = [];
  const measureRhythms: number[][] = [];
  for (let measure = 0; measure < 2; measure += 1) {
    const rhythm = [...rhythms[Math.floor(random() * rhythms.length)]];
    measureRhythms.push(rhythm);
    for (let index = 0; index < rhythm.length; index += 1) {
      const isFirst = degrees.length === 0;
      const isLast = measure === 1 && index === rhythm.length - 1;
      if (isFirst) {
        degrees.push(0);
        continue;
      }
      if (isLast) {
        degrees.push(random() < 0.5 ? 0 : 7);
        continue;
      }

      const previous = degrees[degrees.length - 1];
      const step = STEPS[Math.floor(random() * STEPS.length)];
      let next = previous + step;
      // 太靠近顶端时向下回归，避免连续贴在高音区。
      if (next > 6 && random() < 0.65) next = previous - 1;
      if (next < 1 && random() < 0.5) next = previous + 1;
      degrees.push(Math.max(0, Math.min(7, next)));
    }
  }

  const melody: MelodyNote[] = [];
  let degreeIndex = 0;
  for (const rhythm of measureRhythms) {
    for (const beats of rhythm) {
      const degree = degrees[degreeIndex] ?? 0;
      melody.push({
        pitch: degree >= info.scale.length ? info.upperTonic : info.scale[degree],
        beats,
      });
      degreeIndex += 1;
    }
  }

  return {
    id,
    key,
    meter,
    tonic: [...info.tonicChord],
    melody,
  };
}

/** 按 seed 生成一组题；keys 为空时退回四个考纲调。 */
export function generateMelodyQuestions(
  keys: readonly PlaybackKey[],
  seed: number,
  count: number,
): PlaybackQuestion[] {
  const usable = keys.length > 0 ? keys : PLAYBACK_KEYS;
  const questions: PlaybackQuestion[] = [];
  for (let index = 0; index < count; index += 1) {
    const questionSeed = (seed + index * 104729) >>> 0;
    const key = usable[questionSeed % usable.length];
    questions.push(
      generateMelody(key, questionSeed, `generated-${questionSeed}-${index + 1}`),
    );
  }
  return questions;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
