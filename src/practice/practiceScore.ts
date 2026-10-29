import { parsePitchLabel } from "../domain/pitch";
import type { Clef, Duration, NoteEvent, Score } from "../domain/types";

/**
 * 练习题的谱面提示。
 *
 * 内容层只描述「几个音、什么时值、用哪个谱号」，不直接依赖 VexFlow；
 * 需要渲染或试听时再由 `scoreFromPracticeStaff` 转成项目现有的 `Score` IR。
 * 这样音程、和弦、单音、音型、和弦进行可以共用同一套谱面与播放能力。
 */
export type PracticeStaffGroup = {
  /** 同时发声的一组音；单音是一个元素，和弦/音程是多个元素。 */
  pitches: readonly string[];
  /** 默认四分音符；音程、和弦用全音符更容易看清。 */
  duration?: Duration;
};

/** 一小节里的若干组音；和弦进行用小节来分隔每个和弦。 */
export type PracticeStaffMeasure = readonly PracticeStaffGroup[];

export type PracticeStaffPrompt = {
  clef: Clef;
  /** 单小节题的内容；有 `measures` 时忽略。 */
  groups: readonly PracticeStaffGroup[];
  /**
   * 多小节题（目前是和弦进行）。
   *
   * 每个元素对应谱面上的一小节；只有显式给出时才启用，避免改变
   * 单音 / 音程 / 和弦 / 音型的既有渲染。
   */
  measures?: readonly PracticeStaffMeasure[];
};

/**
 * 把练习题的谱面提示转成 `Score`。
 *
 * 只生成右手谱：练习题不需要真实曲目的调号/声部结构，
 * `previewScore` 与 `renderScore` 都能直接消费。
 */
export function scoreFromPracticeStaff(
  prompt: PracticeStaffPrompt,
  id: string,
  bpm = 72,
  beatsPerBar: 3 | 4 = 4,
): Score {
  const measureGroups = prompt.measures?.length
    ? prompt.measures
    : [prompt.groups];
  const measures = measureGroups.map((groups) => ({
    notes: groups.map((group, index) => practiceNote(group, index)),
  }));

  return {
    id: `practice.staff.${id}`,
    mode: "reading-lesson",
    level: 3,
    meter: { beats: beatsPerBar, beatValue: 4 },
    keySignature: "C",
    hands: ["RH"],
    bpm,
    staves: {
      RH: { clef: prompt.clef, measures },
    },
  };
}

/**
 * 把和弦改成琶音试听：每个和弦音依次弹出，而不是同时响。
 *
 * 只用于听觉训练，不参与谱面渲染；时值统一用四分音符，
 * 让 3–4 个和弦音听上去是一串清楚的分解和弦。
 */
export function arpeggioScore(
  prompt: PracticeStaffPrompt,
  id: string,
  bpm = 72,
): Score {
  const groups = prompt.measures?.flat() ?? prompt.groups;
  const notes: NoteEvent[] = [];
  let index = 0;
  for (const group of groups) {
    for (const label of uniqueLabels(group.pitches)) {
      index += 1;
      notes.push({
        id: `a${index}`,
        pitches: [parsePitchLabel(label)],
        duration: "q",
      });
    }
  }

  return {
    id: `practice.arpeggio.${id}`,
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

/**
 * 把分解谱面改回柱式试听：同一组音同时发声。
 *
 * 分解和弦题专用——谱面上是依次弹出的几个音，柱式按钮把它们一起响出来，
 * 让学生直接听见「还是这个和弦，只是换了织体」。与 `arpeggioScore`
 * 互为反向：和弦题默认柱式、可听分解；分解题默认分解、可听柱式。
 *
 * 只用于听觉训练，不参与谱面渲染。
 */
export function blockScore(
  prompt: PracticeStaffPrompt,
  id: string,
  bpm = 72,
): Score {
  const groups = prompt.measures?.flat() ?? prompt.groups;
  // 柱式：所有组（分解谱面上是逐个音）合成一个同时发声的事件。
  const allPitches = groups.flatMap((group) => group.pitches);
  const notes: NoteEvent[] = [
    {
      id: "b1",
      pitches: uniqueLabels(allPitches).map((label) => parsePitchLabel(label)),
      duration: "w",
    },
  ];

  return {
    id: `practice.block.${id}`,
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

function practiceNote(group: PracticeStaffGroup, index: number): NoteEvent {
  return {
    id: `n${index + 1}`,
    // 同音（纯一度）只保留一个音，避免 VexFlow 画出重叠符头。
    pitches: uniqueLabels(group.pitches).map((label) => parsePitchLabel(label)),
    duration: group.duration ?? "q",
  };
}

/** 保留第一次出现的拼写；等音但拼写不同的音（如 E–Fb）仍然保留两个。 */
function uniqueLabels(labels: readonly string[]): string[] {
  return [...new Set(labels)];
}
