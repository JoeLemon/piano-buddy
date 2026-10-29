import { parsePitchLabel, pitchToMidi } from "../domain/pitch";
import type { Clef } from "../domain/types";
import type { PracticeStaffPrompt } from "./practiceScore";

/**
 * 手位读谱（pos.expand）：数最两端跨了几度，判断一个手位放不放得下。
 *
 * 前置技能是五指手位（pos.five）：五度以内一只手罩得住，六度以上就要把
 * 手位两端撑开，或者提前换手位——这是 L4 编配里最常见的读谱判断。
 *
 * 两条刻意的简化：① 全部用自然音（不带临时升降），这题教的是跨度，
 * 不掺升降号的噪声；② 中间音不参与判断，只有最两端算数——学生最常
 * 犯的错就是把中间音也算进去，把五度数成七度。
 */

export type HandSpanExample = {
  id: string;
  /** 谱面上的音，按从低到高排列。 */
  pitches: readonly string[];
  clef: Clef;
  /** 最两端跨的级数（数字母数出来的度数），例如 6 = 六度。 */
  spanDegrees: number;
  /** 题面文本，例如 "C4 – E4 – G4 – A4"。 */
  notes: string;
  staff: PracticeStaffPrompt;
};

const DEGREE_NAMES: Record<number, string> = {
  2: "二度",
  3: "三度",
  4: "四度",
  5: "五度",
  6: "六度",
  7: "七度",
  8: "八度",
};

const LETTER_STEPS: Record<string, number> = {
  C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6,
};

/** 音级跨度（数字母，不看半音）：C4→A4 是六度。 */
function diatonicSpan(low: string, high: string): number {
  const a = parsePitchLabel(low);
  const b = parsePitchLabel(high);
  const steps =
    b.octave * 7 + LETTER_STEPS[b.step] - (a.octave * 7 + LETTER_STEPS[a.step]);
  return steps + 1;
}

type SpanSeed = {
  id: string;
  pitches: readonly string[];
  clef?: Clef;
};

const SPAN_SEEDS: readonly SpanSeed[] = [
  // 五度：五指手位罩得住（对照项）
  { id: "c-major", pitches: ["C4", "E4", "G4"] },
  { id: "d-minor", pitches: ["D4", "F4", "A4"] },
  { id: "g-major-low", pitches: ["G3", "B3", "D4"] },
  // 六度：要撑手位了
  { id: "c-add9", pitches: ["C4", "E4", "G4", "A4"] },
  { id: "f-major", pitches: ["C4", "F4", "A4"] },
  { id: "e-minor", pitches: ["E4", "G4", "C5"] },
  { id: "c-bass", pitches: ["C3", "E3", "G3", "A3"], clef: "bass" },
  // 七度：撑开或换手位
  { id: "c-dom", pitches: ["C4", "F4", "B4"] },
  { id: "g-span", pitches: ["G4", "B4", "D5", "F5"] },
  // 八度：最常见的扩张
  { id: "c-octave", pitches: ["C4", "G4", "C5"] },
  { id: "f-octave", pitches: ["F4", "A4", "C5", "F5"] },
  { id: "g-bass-octave", pitches: ["G2", "B2", "D3", "G3"], clef: "bass" },
];

export const HAND_SPAN_EXAMPLES: readonly HandSpanExample[] = SPAN_SEEDS.map((seed) => {
  const ordered = [...seed.pitches].sort((a, b) => pitchToMidi(parsePitchLabel(a)) - pitchToMidi(parsePitchLabel(b)));
  const span = diatonicSpan(ordered[0], ordered[ordered.length - 1]);
  return {
    id: `span:${seed.id}`,
    pitches: ordered,
    clef: seed.clef ?? "treble",
    spanDegrees: span,
    notes: ordered.join(" – "),
    staff: {
      clef: seed.clef ?? "treble",
      groups: ordered.map((pitch) => ({ pitches: [pitch], duration: "q" as const })),
    },
  };
});

/** 级数的中文名；跨出 2..8 的范围不该出现，出现即内容错误。 */
export function degreeLabel(degrees: number): string {
  const label = DEGREE_NAMES[degrees];
  if (!label) throw new Error(`bad span degree: ${degrees}`);
  return label;
}

/**
 * 四个档位的选项：正确答案 ±1、±2 起找，不够再放宽到 ±3（八度、二度
 * 这些贴边的度数一侧没有空间），全部落在二度..八度。
 */
export function handSpanChoices(answer: number): { id: string; label: string }[] {
  const ids = new Set<number>([answer]);
  for (const delta of [1, -1, 2, -2, 3, -3]) {
    if (ids.size >= 4) break;
    const candidate = answer + delta;
    if (candidate >= 2 && candidate <= 8) ids.add(candidate);
  }
  return [...ids]
    .sort((a, b) => a - b)
    .map((degrees) => ({ id: String(degrees), label: degreeLabel(degrees) }));
}
