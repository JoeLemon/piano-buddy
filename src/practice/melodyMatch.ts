import { parsePitchLabel, pitchToMidi } from "../domain/pitch";
import type { PlaybackQuestion } from "./melodyTypes";

/**
 * 旋律跟弹的纯匹配逻辑。
 *
 * 八度严格：谱面上写了哪个八度，就该弹哪个八度。旋律题现在有谱面
 * （`melodyStaff`），跟弹的主任务就是「看着谱把旋律弹出来」，音高口径
 * 与曲库跟弹（`pitchEqual`）、练习页弹奏作答（`playAnswer`）一致。
 * 「只比音名不比八度」是无谱面时期的降级口径，已不再使用。
 */
export type MelodyMatchResult = {
  /** 这个音是否等于目标序列的当前音。 */
  correct: boolean;
  /** 匹配成功后前进到的位置；失败时保持原位。 */
  nextIndex: number;
  /** 整条旋律是否已经跟完。 */
  complete: boolean;
};

export function matchMelodyNote(
  question: PlaybackQuestion,
  index: number,
  midi: number,
): MelodyMatchResult {
  const target = question.melody[index];
  if (!target) return { correct: false, nextIndex: index, complete: true };

  const targetMidi = pitchToMidi(parsePitchLabel(target.pitch));
  if (targetMidi !== midi) {
    return { correct: false, nextIndex: index, complete: false };
  }

  const nextIndex = index + 1;
  return {
    correct: true,
    nextIndex,
    complete: nextIndex >= question.melody.length,
  };
}
