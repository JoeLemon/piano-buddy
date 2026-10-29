import { parsePitchLabel, pitchToMidi } from "../domain/pitch";
import type { Clef } from "../domain/types";
import type { PracticeStaffPrompt } from "./practiceScore";

/**
 * 单音认谱题的内容。
 *
 * 来自 00-SightReading_3.0 的 Notes（A 类）练习：谱面上给一个音，
 * 学生在四个音名里选出它。默认音域 C3–E5；练习页可以收窄音域，
 * 也可以把升号/降号加进来。
 */
export type NoteExample = {
  id: string;
  /** 拼写音高，同时作为正确答案 id，例如 "C4"。 */
  pitch: string;
  clef: Clef;
  /** 选项里显示的音名，与 pitch 一致。 */
  label: string;
  staff: PracticeStaffPrompt;
};

/** 练习页可选的音域（低音谱 / 高音谱 / 宽音域）。 */
export type NoteRange = {
  id: string;
  label: string;
  low: string;
  high: string;
};

export const NOTE_RANGES: readonly NoteRange[] = [
  { id: "all", label: "全部 C3–E5", low: "C3", high: "E5" },
  { id: "treble", label: "高音谱 C4–C5", low: "C4", high: "C5" },
  { id: "bass", label: "低音谱 C3–C4", low: "C3", high: "C4" },
  { id: "wide", label: "宽音域 C2–C6", low: "C2", high: "C6" },
];

const TREBLE_PITCHES = ["C4", "D4", "E4", "F4", "G4", "A4", "B4", "C5", "D5", "E5"] as const;
const BASS_PITCHES = ["C3", "D3", "E3", "F3", "G3", "A3", "B3", "C4"] as const;

function note(pitch: string, clef: Clef): NoteExample {
  return {
    id: `note:${clef}:${pitch}`,
    pitch,
    clef,
    label: pitch,
    staff: { clef, groups: [{ pitches: [pitch], duration: "w" }] },
  };
}

export const NOTE_EXAMPLES: readonly NoteExample[] = [
  ...TREBLE_PITCHES.map((pitch) => note(pitch, "treble")),
  ...BASS_PITCHES.map((pitch) => note(pitch, "bass")),
];

const NATURAL_BY_PC: Readonly<Record<number, string>> = {
  0: "C",
  2: "D",
  4: "E",
  5: "F",
  7: "G",
  9: "A",
  11: "B",
};

/** 只有这些字母上出现升号才不用重升；与参考项目的 SHARP_OK 一致。 */
const SHARP_OK = new Set(["C", "D", "F", "G", "A"]);
/** 只有这些字母上出现降号才不用重降；与参考项目的 FLAT_OK 一致。 */
const FLAT_OK = new Set(["D", "E", "G", "A", "B"]);

/**
 * 按音域列出一组单音题。
 *
 * 自然音总是包含；升/降号只在不会产生重升重降的字母上生成。
 * 同一个键位如果同时允许升号和降号，会保留两种拼写（C# 与 Db），
 * 因为读谱题要练的正是「看到什么记号就说什么音」。
 */
export function noteExamplesInRange(
  low: string,
  high: string,
  options: { includeSharps?: boolean; includeFlats?: boolean } = {},
): NoteExample[] {
  const lowMidi = pitchToMidi(parsePitchLabel(low));
  const highMidi = pitchToMidi(parsePitchLabel(high));
  if (highMidi < lowMidi) return [];

  const examples: NoteExample[] = [];
  const seen = new Set<string>();

  const push = (pitch: string, midi: number) => {
    if (seen.has(pitch)) return;
    seen.add(pitch);
    examples.push(note(pitch, midi < 60 ? "bass" : "treble"));
  };

  for (let midi = lowMidi; midi <= highMidi; midi += 1) {
    const pc = ((midi % 12) + 12) % 12;
    const natural = NATURAL_BY_PC[pc];
    if (natural) {
      push(`${natural}${Math.floor(midi / 12) - 1}`, midi);
      continue;
    }

    if (options.includeSharps) {
      const letter = NATURAL_BY_PC[(pc + 11) % 12];
      if (letter && SHARP_OK.has(letter)) {
        push(`${letter}#${Math.floor((midi - 1) / 12) - 1}`, midi);
      }
    }
    if (options.includeFlats) {
      const letter = NATURAL_BY_PC[(pc + 1) % 12];
      if (letter && FLAT_OK.has(letter)) {
        push(`${letter}b${Math.floor((midi + 1) / 12) - 1}`, midi);
      }
    }
  }

  return examples;
}
