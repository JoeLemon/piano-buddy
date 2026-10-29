import { parsePitchLabel, pitchToMidi } from "../domain/pitch";
import type { Clef } from "../domain/types";
import { CHORD_CATALOG } from "./chordCatalog";
import { INTERVAL_CATALOG } from "./intervalCatalog";
import type { BrokenChordExample } from "./brokenChordContent";
import { degreeLabel, type HandSpanExample } from "./handSpanContent";
import type { PlaybackQuestion } from "./melodyTypes";
import type { NoteExample } from "./noteContent";
import type { PatternExample } from "./patternContent";
import { KEY_LABELS } from "./theoryContent";
import type { ChordExample, IntervalExample, ProgressionExample } from "./theoryContent";

/**
 * 逐题讲解：每题给「一句结论 + 两步判读」。
 *
 * 原来的 explanation 只是把答案换个说法（`C4 – E4 是大三度。`），学生
 * 答错时看了也学不到怎么推。这里按各题型的**判读方法**拆成固定步骤：
 * 音程先数字母再数半音、和弦先找根音再叠三度、单音先认谱号再数线间。
 *
 * 所有事实都从目录里取（音程半音数、和弦叠置结构、进行级数），不写死，
 * 改目录不会让讲解跟着错。
 */
export type PracticeExplanation = {
  /** 一句话结论。 */
  summary: string;
  /** 判读步骤：先看什么、再数什么。 */
  steps: readonly string[];
};

const CN_NUMERALS = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];

function cn(value: number): string {
  return CN_NUMERALS[value] ?? String(value);
}

const CLEF_NAMES: Record<Clef, string> = { treble: "高音谱", bass: "低音谱" };

/** 每个谱号「第一线」上的音；谱面位置一律从这条线往上数。 */
const BOTTOM_LINE: Record<Clef, string> = { treble: "E4", bass: "G2" };

/** 各谱号里最好记的 C，作为数线间的锚点。 */
const C_ANCHOR: Record<Clef, string> = { treble: "C5", bass: "C3" };

const DIATONIC_STEP: Record<string, number> = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };

/** 把音高折成「从 C0 起的第几个音级」，用来数线间。 */
function diatonicIndex(label: string): number {
  const pitch = parsePitchLabel(label);
  return pitch.octave * 7 + (DIATONIC_STEP[pitch.step] ?? 0);
}

/**
 * 音在五线谱上的位置，例如「第一线」「第三间」「下加一线」「上加一间」。
 *
 * 只数音级（不看升降号）：临时升降号不改变音高所在的线间。
 */
export function staffPlacement(clef: Clef, pitch: string): string {
  const step = diatonicIndex(pitch) - diatonicIndex(BOTTOM_LINE[clef]);
  if (step < 0) {
    const below = -step;
    return below % 2 === 1 ? `下加${cn((below + 1) / 2)}间` : `下加${cn(below / 2)}线`;
  }
  if (step <= 8) {
    return step % 2 === 0 ? `第${cn(step / 2 + 1)}线` : `第${cn((step - 1) / 2 + 1)}间`;
  }
  const above = step - 8;
  return above % 2 === 1 ? `上加${cn((above + 1) / 2)}间` : `上加${cn(above / 2)}线`;
}

/** 单音认谱：先认谱号锚点，再数到符头。 */
export function noteExplanation(item: NoteExample): PracticeExplanation {
  const clefName = CLEF_NAMES[item.clef];
  const placement = staffPlacement(item.clef, item.pitch);
  const anchor = C_ANCHOR[item.clef];
  // 方向必须按音高判断：高音谱的 C4 在锚点 C5 下方，写成「往上数」会自相矛盾。
  const direction =
    diatonicIndex(item.pitch) >= diatonicIndex(anchor) ? "往上" : "往下";
  return {
    summary: `这是 ${item.pitch}，落在${clefName}的${placement}。`,
    steps: [
      `先认谱号：${clefName}里最好认的锚点是一个 C —— ${anchor}。`,
      `从 ${anchor} ${direction}数线、间，${placement}就是 ${item.pitch}。`,
    ],
  };
}

const QUALITY_CN: Record<string, string> = {
  diminished: "减",
  minor: "小",
  perfect: "纯",
  major: "大",
  augmented: "增",
};

/** 音程：先数字母得度数，再数半音定性质。 */
export function intervalExplanation(item: IntervalExample): PracticeExplanation {
  const entry = INTERVAL_CATALOG.find((candidate) => candidate.id === item.intervalId);
  const start = parsePitchLabel(item.startPitch);
  const end = parsePitchLabel(item.endPitch);
  if (!entry) {
    return { summary: `${item.notes} 是${item.label}。`, steps: [] };
  }
  const semitones = Math.abs(pitchToMidi(end) - pitchToMidi(start));
  const quality = QUALITY_CN[entry.quality] ?? "";
  return {
    summary: `${item.notes} 是${item.label}：跨${cn(entry.number)}个音级、${semitones} 个半音。`,
    steps: [
      `先数字母：${start.step} 到 ${end.step} 一共跨${cn(entry.number)}个音级，所以是${cn(entry.number)}度。`,
      `再数半音：${item.startPitch} 到 ${item.endPitch} 是 ${semitones} 个半音；${cn(entry.number)}度里的 ${semitones} 个半音属于「${quality}」，所以是${item.label}。`,
    ],
  };
}

const THIRD_CN: Record<number, string> = { 3: "小三度", 4: "大三度" };

/** 和弦：先找根音，再按三度叠置，最后对半音结构。 */
export function chordExplanation(item: ChordExample): PracticeExplanation {
  const type = CHORD_CATALOG.find((candidate) => candidate.id === item.typeId);
  if (!type) {
    return { summary: `${item.notes} 是${item.label}。`, steps: [] };
  }
  const thirds = type.stackedStructure.map((gap) => THIRD_CN[gap] ?? `${gap} 个半音`);
  return {
    summary: `${item.notes} 是${item.label}：${item.root} 往上依次叠${thirds.join(" + ")}。`,
    steps: [
      `先找根音：${item.root} 是最低的那个音，往上按三度叠置得到 ${item.notes}。`,
      `再对半音：离根音 ${type.semitonesFromRoot.join(" / ")} 个半音，也就是 ${type.stackedStructure.join(" + ")}（${thirds.join(" + ")}），正是${item.label}的结构。`,
    ],
  };
}

/**
 * 分解和弦：依次弹出的同一组音，按三度叠回去就是和弦类型。
 *
 * 与和弦题（柱式）共用目录数据：根音、拼写、类型全部来自 CHORD_EXAMPLES，
 * 讲解里的三度结构从 CHORD_CATALOG 取，不写死。
 */
export function brokenChordExplanation(item: BrokenChordExample): PracticeExplanation {
  const type = CHORD_CATALOG.find((candidate) => candidate.id === item.typeId);
  if (!type) {
    return { summary: `${item.arpeggio.join(" – ")} 是${item.label}。`, steps: [] };
  }
  const thirds = type.stackedStructure.map((gap) => THIRD_CN[gap] ?? `${gap} 个半音`);
  return {
    summary: `${item.arpeggio.join(" – ")} 是${item.label}的分解：依次弹出的还是 ${item.root} 往上叠${thirds.join(" + ")} 的那几个音。`,
    steps: [
      `先别管顺序，把听到的音拢到一块：${item.arpeggio.join("、")}。`,
      `按三度叠回去：最低的 ${item.root} 是根音，往上 ${type.semitonesFromRoot.join(" / ")} 个半音，正是${item.label}。`,
      `拿不准就点「柱式」：同一组音同时响，一听就是${item.label}——只是换了织体。`,
    ],
  };
}

/** 手位读谱：最两端的音级跨度，决定一个手位放不放得下。 */
export function handSpanExplanation(item: HandSpanExample): PracticeExplanation {
  const low = item.pitches[0];
  const high = item.pitches[item.pitches.length - 1];
  const letters = countLetters(low, high);
  const expand = item.spanDegrees >= 6;
  return {
    summary: `最两端是 ${low} 到 ${high}，数字母跨了${degreeLabel(item.spanDegrees)}。`,
    steps: [
      `只看最两端的两个音（${low} 和 ${high}），中间音不改变跨度。`,
      `从低到高数字母：${letters}，数到几就是几度。`,
      expand
        ? `${degreeLabel(item.spanDegrees)}超过五度，一个手位放不下：要把两端撑开，或者提前换手位。`
        : `${degreeLabel(item.spanDegrees)}在五度以内，五指手位罩得住。`,
    ],
  };
}

/** 两个音名之间经过的字母，例如 C4→A4 = "C、D、E、F、G、A"。 */
function countLetters(low: string, high: string): string {
  const from = parsePitchLabel(low);
  const to = parsePitchLabel(high);
  const start = from.octave * 7 + (DIATONIC_STEP[from.step] ?? 0);
  const end = to.octave * 7 + (DIATONIC_STEP[to.step] ?? 0);
  const names: string[] = [];
  for (let index = start; index <= end; index += 1) {
    const step = ((index % 7) + 7) % 7;
    names.push(Object.keys(DIATONIC_STEP).find((key) => DIATONIC_STEP[key] === step) ?? "?");
  }
  return `${names.join("、")}`;
}

/** 和弦进行：调决定级数，级数描述和弦在调里的位置。 */
export function progressionExplanation(item: ProgressionExample): PracticeExplanation {
  const degrees = item.answer.split("–").map((degree) => degree.trim());
  const located = item.chords
    .slice(0, degrees.length)
    .map((chord, index) => `${chord} 是第 ${degrees[index]} 级`);
  return {
    summary: `${item.key}里，这组和弦就是 ${item.answer}。`,
    steps: [
      `先看调：${item.key}；级数就是和弦根音在这个调里的位置。`,
      `逐个定位：${located.join("，")}。`,
    ],
  };
}

/** 相邻音的音高关系，用来说明走向。 */
function describeTrend(notes: readonly string[]): string {
  const midis = notes.map((note) => pitchToMidi(parsePitchLabel(note)));
  let ups = 0;
  let downs = 0;
  let flats = 0;
  for (let index = 1; index < midis.length; index += 1) {
    const delta = midis[index] - midis[index - 1];
    if (delta > 0) ups += 1;
    else if (delta < 0) downs += 1;
    else flats += 1;
  }
  if (ups > 0 && downs === 0) return "每一步都比前一个高";
  if (downs > 0 && ups === 0) return "每一步都比前一个低";
  if (flats > 0 && ups === 0 && downs === 0) return "每个音都停在同一高度";
  return `先${ups >= downs ? "升" : "降"}后${ups >= downs ? "降" : "升"}`;
}

/** 音型走向：首尾定方向，逐音比较定折返。 */
export function patternExplanation(item: PatternExample): PracticeExplanation {
  const first = item.notes[0] ?? "";
  const last = item.notes[item.notes.length - 1] ?? "";
  return {
    summary: `${item.notes.join(" – ")} 是${item.label}。`,
    steps: [
      `首尾先看方向：${first} 起、${last} 止。`,
      `再逐音比较相邻两个音：${describeTrend(item.notes)}。`,
    ],
  };
}

/** 听辨调性：主和弦给调，终止音确认调。 */
export function melodyExplanation(item: PlaybackQuestion): PracticeExplanation {
  const label = KEY_LABELS[item.key];
  const last = item.melody[item.melody.length - 1]?.pitch ?? "";
  const tonicRoot = item.tonic[0] ?? "";
  const endsOnTonic =
    last && tonicRoot && parsePitchLabel(last).step === parsePitchLabel(tonicRoot).step;
  const steps = [
    `开头先给主和弦 ${item.tonic.join(" – ")}：${item.key.includes("major") ? "大三和弦偏大调" : "小三和弦偏小调"}。`,
    endsOnTonic
      ? `旋律最后一个音是 ${last}，正好落在主音上，${label}就确定了。`
      : `旋律最后一个音是 ${last}，回头对照主音 ${tonicRoot} 就能确认是${label}。`,
  ];
  return { summary: `这段旋律是${label}。`, steps };
}
