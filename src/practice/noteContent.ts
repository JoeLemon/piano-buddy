import type { Clef } from "../domain/types";
import type { PracticeStaffPrompt } from "./practiceScore";

/**
 * 单音认谱题的内容。
 *
 * 来自 00-SightReading_3.0 的 Notes（A 类）练习：谱面上给一个音，
 * 学生在四个音名里选出它。这里把音域控制在初学最常用的 C3–C5。
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

const TREBLE_PITCHES = ["C4", "D4", "E4", "F4", "G4", "A4", "B4", "C5", "D5", "E5"] as const;
const BASS_PITCHES = ["C3", "D3", "E3", "F3", "G3", "A3", "B3", "C4"] as const;

function note(pitch: string, clef: Clef): NoteExample {
  return {
    id: `note:${pitch}`,
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
