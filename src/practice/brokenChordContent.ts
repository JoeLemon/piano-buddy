import type { PracticeStaffPrompt } from "./practiceScore";
import { CHORD_EXAMPLES, CHORD_LABELS, type ChordExample } from "./theoryContent";

/**
 * 分解和弦（texture.broken）：同一个和弦的音依次弹出。
 *
 * 曲库 L4 编配的左手就是这种织体（根–三–五循环的八分音符）。学生在这里要
 * 解决的是「一串音听着散，其实是一个和弦」：内容直接派生于和弦题库
 * （CHORD_EXAMPLES）——根音、拼写、类型全部沿用，不另存一份答案，
 * 两边永远不会各说一套。
 *
 * 谱面画依次弹出的四个（三和弦三个）四分音符；「柱式」试听把同一组音
 * 同时响出来，让学生听见「还是这个和弦，只是换了织体」。
 */
export type BrokenChordExample = {
  /** 题目唯一 id = 和弦类型 + 根音，与和弦题库同源。 */
  id: string;
  /** 正确答案 id（和弦类型），例如 "maj"。 */
  typeId: string;
  root: string;
  /** 依次弹出的音（三和弦不补八度：L4 编配的左手就是根–三–五循环）。 */
  arpeggio: readonly string[];
  /** 同时发声的形式（柱式），A/B 试听对照用；与 arpeggio 是同一组音。 */
  block: readonly string[];
  label: string;
  staff: PracticeStaffPrompt;
};

export const BROKEN_CHORD_EXAMPLES: readonly BrokenChordExample[] = CHORD_EXAMPLES.map(
  (example: ChordExample) => {
    const pitches = example.staff.groups[0]?.pitches ?? [];
    return {
      id: example.id,
      typeId: example.typeId,
      root: example.root,
      arpeggio: pitches,
      block: pitches,
      label: example.label,
      staff: {
        clef: example.staff.clef,
        // 每个音单独一组、四分音符：谱面上就是「一个个往外冒」的分解和弦。
        groups: pitches.map((pitch) => ({ pitches: [pitch], duration: "q" as const })),
      },
    };
  },
);
