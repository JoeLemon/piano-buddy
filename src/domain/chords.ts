import { pitchToMidi } from "./pitch";
import type { Pitch } from "./types";

/**
 * 当前谱面词汇支持的和弦性质。
 *
 * 三和弦只认大三/小三（增三和弦没有进谱面词汇表：它在调内音级里无法稳定
 * 拼写，`TRIADS` 也收不下）；七和弦支持大七、小七、属七、减七与半减七。
 * 乐理题库（`practice/chordCatalog.ts`）是另一套口径，那边多一个增三和弦，
 * 但不代表曲目编配能用。
 */
export type ChordQuality = "maj" | "min" | "maj7" | "min7" | "dom7" | "dim7" | "halfDim7";

/** 以根音为 0 的半音结构。 */
const QUALITY_INTERVALS: Record<ChordQuality, readonly number[]> = {
  maj: [0, 4, 7],
  min: [0, 3, 7],
  maj7: [0, 4, 7, 11],
  min7: [0, 3, 7, 10],
  dom7: [0, 4, 7, 10],
  // 减七：三个小三度叠起来，四个音等距，是全谱最「不稳定」的和弦。
  dim7: [0, 3, 6, 9],
  // 半减七（m7♭5）：小三和弦 + 小七度，小调 ii 级最常用。
  halfDim7: [0, 3, 6, 10],
};

const QUALITIES = Object.keys(QUALITY_INTERVALS) as ChordQuality[];

export type ChordInfo = {
  /** 实际承担根音的那个音（保留拼写，用于调号/临时记号判断）。 */
  root: Pitch;
  quality: ChordQuality;
  /** 0 = 原位，1 = 第一转位，2 = 第二转位，3 = 第三转位（七和弦）。 */
  inversion: number;
  /** 最低音。 */
  bass: Pitch;
  /**
   * 是否有重复音（八度重复根音/五音）。四音三和弦 `C4–E4–G4–C5` 就是
   * `doubled: true`；判定规则里它按「总跨度」而不是五指位看。
   */
  doubled: boolean;
};

function pitchClass(pitch: Pitch): number {
  return ((pitchToMidi(pitch) % 12) + 12) % 12;
}

function lowest(pitches: readonly Pitch[]): Pitch {
  return pitches.reduce((low, pitch) =>
    pitchToMidi(pitch) < pitchToMidi(low) ? pitch : low,
  );
}

/**
 * 从同时发声音里识别根音、性质与转位。
 *
 * 接受 3–5 个音；**允许八度重复**（`C4–E4–G4–C5`、`B3–D4–F4–A4–B4`），因为
 * 柱式和弦编配里重复根音太常见，一刀切拒绝会让内容侧只能写三个音的和弦。
 * 重复只允许是**同一个音级的八度重复**：完全重复的音（同音同八度）不算和弦，
 * 两个不同音级拼成同一个音（B♯ 与 C）也不认。
 *
 * 转位不影响根音和性质，只影响 `inversion`；这就是「转位被识别为同一和弦」
 * 的底层实现。
 */
export function identifyChord(pitches: readonly Pitch[]): ChordInfo | null {
  if (pitches.length < 3 || pitches.length > 5) return null;

  // 同一个音（同音级同八度）重复写两遍是错误的记谱，先拒掉。
  const exact = new Set(pitches.map((pitch) => `${pitch.step}${pitch.octave}${pitch.alteration}`));
  if (exact.size !== pitches.length) return null;

  const classes = pitches.map(pitchClass);
  const distinct = [...new Set(classes)];
  if (distinct.length < 3) return null;

  for (const candidate of pitches) {
    const rootPc = pitchClass(candidate);
    const intervals = [...new Set(distinct.map((pc) => (pc - rootPc + 12) % 12))].sort((a, b) => a - b);

    for (const quality of QUALITIES) {
      const shape = QUALITY_INTERVALS[quality];
      if (shape.length !== intervals.length) continue;
      if (!shape.every((value, index) => value === intervals[index])) continue;

      // 根音取同音级里最低的那个，拼写才稳定（C4–E4–G4–C5 的根音写 C4，不写 C5）。
      const root = pitches
        .filter((pitch) => pitchClass(pitch) === rootPc)
        .reduce((low, pitch) => (pitchToMidi(pitch) < pitchToMidi(low) ? pitch : low));
      const bass = lowest(pitches);
      const bassIndex = shape.indexOf((pitchClass(bass) - rootPc + 12) % 12);
      return {
        root,
        quality,
        inversion: bassIndex >= 0 ? bassIndex : 0,
        bass,
        // 去重后的音级数比实际音数少，说明有八度重复。
        doubled: distinct.length < pitches.length,
      };
    }
  }
  return null;
}

/** 七和弦：四个不同音级叠三度（含减七与半减七）。 */
export function isSeventhQuality(quality: ChordQuality): boolean {
  return quality === "maj7" || quality === "min7" || quality === "dom7"
    || quality === "dim7" || quality === "halfDim7";
}

/** 减七 / 半减七：需要额外的 `chord.diminished` 技能与 L6 词汇档。 */
export function isDiminishedQuality(quality: ChordQuality): boolean {
  return quality === "dim7" || quality === "halfDim7";
}

export function isTriadQuality(quality: ChordQuality): boolean {
  return quality === "maj" || quality === "min";
}
