import type { PracticeStaffPrompt } from "./practiceScore";

/**
 * 音型走向题的内容。
 *
 * 来自 00-SightReading_3.0 的 Patterns（D 类）：给一小串音，
 * 判断它是上行、下行、回环还是跳进。时值统一用四分音符，
 * 重点在音高走向而不是节奏。
 */
export type PatternExample = {
  id: string;
  /** 选项里显示的走向名称。 */
  label: string;
  notes: readonly string[];
  staff: PracticeStaffPrompt;
};

const PATTERN_ROWS: readonly { id: string; label: string; notes: readonly string[] }[] = [
  { id: "up3", label: "上行三音", notes: ["C4", "D4", "E4"] },
  { id: "down3", label: "下行三音", notes: ["E4", "D4", "C4"] },
  { id: "up4", label: "上行四音", notes: ["C4", "D4", "E4", "F4"] },
  { id: "down4", label: "下行四音", notes: ["G4", "F4", "E4", "D4"] },
  { id: "arch", label: "上行再下行", notes: ["C4", "E4", "G4", "E4"] },
  { id: "valley", label: "下行再上行", notes: ["G4", "E4", "C4", "E4"] },
  { id: "repeat", label: "同音重复", notes: ["C4", "C4", "E4", "E4"] },
  { id: "skip", label: "跳进三度", notes: ["C4", "E4", "D4", "G4"] },
];

export const PATTERN_EXAMPLES: readonly PatternExample[] = PATTERN_ROWS.map((row) => ({
  ...row,
  staff: {
    clef: "treble",
    groups: row.notes.map((pitch) => ({ pitches: [pitch], duration: "q" as const })),
  },
}));
