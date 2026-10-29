import { parsePitchLabel } from "../domain/pitch";
import type { Duration, Score } from "../domain/types";
import { MELODY_BPM, type PlaybackQuestion } from "./melodyTypes";
import { scoreFromPracticeStaff, type PracticeStaffPrompt } from "./practiceScore";

/**
 * 旋律题的谱面：主音和弦占第一小节，旋律按拍分小节。
 *
 * 谱面、试听、跟弹判定共用这一份 IR——听到的、看到的、判的是同一组音。
 * 第一小节放主音和弦（听辨调性的锚点，3/4 用 3 拍、4/4 用 4 拍满小节），
 * 旋律从第二小节开始，每小节按拍数配平。
 */
export function melodyStaff(question: PlaybackQuestion): PracticeStaffPrompt {
  const beatsPerBar = question.meter === "3/4" ? 3 : 4;
  const measures = [[{ pitches: question.tonic, duration: (beatsPerBar === 3 ? "hd" : "w") as Duration }]];

  let current: { pitches: string[]; duration: Duration }[] = [];
  let used = 0;
  for (const note of question.melody) {
    // 装不下就开新小节；单音不超过一小节（题库节奏按小节配平）。
    if (used > 0 && used + note.beats > beatsPerBar) {
      measures.push(current);
      current = [];
      used = 0;
    }
    current.push({ pitches: [note.pitch], duration: durationFor(note.beats) });
    used += note.beats;
  }
  if (current.length > 0) measures.push(current);

  return { clef: "treble", groups: [], measures };
}

/**
 * 把 Playback 题库的一条旋律转成现有带时值 IR，供 previewScore 试听与谱面渲染。
 *
 * 直接派生自 `melodyStaff`：不另存一份音符数据，试听听到的与谱面画出来
 * 的永远是同一组音。节拍从题目的 meter 来，3/4 与 4/4 的小节线才画得对。
 */
export function melodyToScore(question: PlaybackQuestion): Score {
  return scoreFromPracticeStaff(melodyStaff(question), question.id, MELODY_BPM, question.meter === "3/4" ? 3 : 4);
}

/** 拍数 → 时值符号。题库只用二分之一的粒度，取不齐时落到上一级。 */
export function durationFor(beats: number): Duration {
  if (beats >= 4) return "w";
  if (beats >= 3) return "hd";
  if (beats >= 2) return "h";
  if (beats >= 1.5) return "qd";
  if (beats >= 1) return "q";
  if (beats >= 0.5) return "8";
  return "16";
}
