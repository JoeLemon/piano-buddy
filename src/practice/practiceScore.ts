import { parsePitchLabel } from "../domain/pitch";
import type { Clef, Duration, Score } from "../domain/types";

/**
 * 练习题的谱面提示。
 *
 * 内容层只描述「几个音、什么时值、用哪个谱号」，不直接依赖 VexFlow；
 * 需要渲染或试听时再由 `scoreFromPracticeStaff` 转成项目现有的 `Score` IR。
 * 这样音程、和弦、单音、音型可以共用同一套谱面与播放能力。
 */
export type PracticeStaffGroup = {
  /** 同时发声的一组音；单音是一个元素，和弦/音程是多个元素。 */
  pitches: readonly string[];
  /** 默认四分音符；音程、和弦用全音符更容易看清。 */
  duration?: Duration;
};

export type PracticeStaffPrompt = {
  clef: Clef;
  groups: readonly PracticeStaffGroup[];
};

/**
 * 把练习题的谱面提示转成 `Score`。
 *
 * 只生成一个小节的右手谱：练习题不需要真实曲目的调号/小节结构，
 * `previewScore` 与 `renderScore` 都能直接消费。
 */
export function scoreFromPracticeStaff(
  prompt: PracticeStaffPrompt,
  id: string,
  bpm = 72,
): Score {
  const notes = prompt.groups.map((group, index) => ({
    id: `n${index + 1}`,
    // 同音（纯一度）只保留一个音，避免 VexFlow 画出重叠符头。
    pitches: uniqueLabels(group.pitches).map((label) => parsePitchLabel(label)),
    duration: group.duration ?? "q",
  }));

  return {
    id: `practice.staff.${id}`,
    mode: "reading-lesson",
    level: 3,
    meter: { beats: 4, beatValue: 4 },
    keySignature: "C",
    hands: ["RH"],
    bpm,
    staves: {
      RH: { clef: prompt.clef, measures: [{ notes }] },
    },
  };
}

/** 保留第一次出现的拼写；等音但拼写不同的音（如 E–Fb）仍然保留两个。 */
function uniqueLabels(labels: readonly string[]): string[] {
  return [...new Set(labels)];
}
