import {
  INTERVAL_CATALOG,
  displayName as intervalDisplayName,
} from "./intervalCatalog";
import { CHORD_CATALOG, type ChordType } from "./chordCatalog";
import {
  chordExplanation,
  brokenChordExplanation,
  handSpanExplanation,
  intervalExplanation,
  melodyExplanation,
  noteExplanation,
  patternExplanation,
  progressionExplanation,
} from "./explanation";
import { BROKEN_CHORD_EXAMPLES, type BrokenChordExample } from "./brokenChordContent";
import {
  degreeLabel,
  handSpanChoices,
  HAND_SPAN_EXAMPLES,
  type HandSpanExample,
} from "./handSpanContent";
import { MELODY_BANK } from "./melodyBank";
import { melodyStaff } from "./melodyPlayback";
import type { PlaybackKey, PlaybackQuestion } from "./melodyTypes";
import { PLAYBACK_KEYS } from "./melodyTypes";
import { generateMelodyQuestions } from "./melodyGenerator";
import { NOTE_EXAMPLES, noteExamplesInRange, type NoteExample } from "./noteContent";
import { PATTERN_EXAMPLES, type PatternExample } from "./patternContent";
import type { PracticeStaffPrompt } from "./practiceScore";
import {
  CHORD_EXAMPLES,
  CHORD_LABELS,
  INTERVAL_EXAMPLES,
  KEY_LABELS,
  PROGRESSIONS,
  SYMBOLS,
  type ChordExample,
  type IntervalExample,
  type ProgressionExample,
  type SymbolEntry,
  type SymbolGroup,
} from "./theoryContent";
import { ACCIDENTAL_EXAMPLES, type AccidentalExample } from "./accidentalContent";

export type PracticeKind =
  | "notes"
  | "symbols"
  | "intervals"
  | "chords"
  | "accidentals"
  | "progressions"
  | "patterns"
  | "melodies"
  | "broken"
  | "handSpan";

export const PRACTICE_KINDS: readonly PracticeKind[] = [
  "notes",
  "symbols",
  "intervals",
  "chords",
  "accidentals",
  "progressions",
  "patterns",
  "melodies",
  "broken",
  "handSpan",
];

export const PRACTICE_LABELS: Record<PracticeKind, string> = {
  notes: "单音",
  symbols: "符号",
  intervals: "音程",
  chords: "和弦",
  accidentals: "临时升降",
  progressions: "和弦进行",
  patterns: "音型",
  melodies: "旋律听辨",
  broken: "分解和弦",
  handSpan: "手位读谱",
};

/**
 * 练习范围。
 *
 * 所有字段都是「不传 = 全部」；数组传空也按全部处理，避免 UI 在
 * 一个都没选时意外生成 0 道题。真正限制范围的是非空子集。
 */
export type PracticeOptions = {
  symbolGroups?: readonly SymbolGroup[];
  chordTypeIds?: readonly string[];
  intervalIds?: readonly string[];
  progressionIds?: readonly string[];
  playbackKeys?: readonly PlaybackKey[];
  /** 单音题音域；不传用内置 C3–E5。 */
  noteRange?: { low: string; high: string };
  includeSharps?: boolean;
  includeFlats?: boolean;
  /** 旋律题来源：静态题库或现场生成。 */
  melodySource?: "bank" | "random";
};

export type PracticeChoice = {
  id: string;
  label: string;
};

export type PracticeQuestion = {
  id: string;
  kind: PracticeKind;
  /** 题面文本；即使有谱面也保留，方便读屏与测试断言。 */
  prompt: string;
  hint: string;
  choices: PracticeChoice[];
  answerId: string;
  explanation: string;
  /** 判读步骤：答完告诉学生「先看什么、再数什么」，空数组表示该题型没有步骤。 */
  explanationSteps?: readonly string[];
  /** 单音 / 音程 / 和弦 / 音型 / 进行题带谱面，练习页会画出来并允许试听。 */
  staff?: PracticeStaffPrompt;
  /** 只有旋律听辨题带音频数据。 */
  melody?: PlaybackQuestion;
};

export function practiceQuestionCount(kind: PracticeKind, options: PracticeOptions = {}): number {
  switch (kind) {
    case "notes":
      return Math.min(8, notePool(options).length);
    case "symbols":
      return Math.min(8, symbolPool(options).length);
    case "intervals":
      return Math.min(8, intervalPool(options).length);
    case "chords":
      return Math.min(8, chordPool(options).length);
    case "accidentals":
      return Math.min(6, ACCIDENTAL_EXAMPLES.length);
    case "progressions":
      return Math.min(PROGRESSIONS.length, progressionPool(options).length);
    case "patterns":
      return Math.min(8, PATTERN_EXAMPLES.length);
    case "melodies":
      return options.melodySource === "random"
        ? 8
        : Math.min(8, melodyPool(options).length);
    case "broken":
      return Math.min(8, BROKEN_CHORD_EXAMPLES.length);
    case "handSpan":
      return Math.min(8, HAND_SPAN_EXAMPLES.length);
  }
}

export function createPracticeQuestions(
  kind: PracticeKind,
  seed: number,
  options: PracticeOptions = {},
): PracticeQuestion[] {
  const random = mulberry32(seed);
  const count = practiceQuestionCount(kind, options);
  switch (kind) {
    case "notes": {
      const pool = notePool(options);
      return pick(pool, count, random).map((item) => noteQuestion(item, pool, random));
    }
    case "symbols":
      return pick(symbolPool(options), count, random).map((item) =>
        symbolQuestion(item, fourChoices(item.id, item.meaning, SYMBOLS, (entry) => entry.meaning, random)),
      );
    case "intervals":
      return pick(intervalPool(options), count, random).map((item) =>
        intervalQuestion(
          item,
          fourChoices(
            item.intervalId,
            item.label,
            INTERVAL_CATALOG,
            (entry) => intervalDisplayName(entry),
            random,
          ),
        ),
      );
    case "chords":
      return pick(chordPool(options), count, random).map((item) =>
        chordQuestion(
          item,
          fourChoices(item.typeId, item.label, CHORD_CATALOG, chordLabel, random),
        ),
      );
    case "accidentals":
      return pick(ACCIDENTAL_EXAMPLES, count, random).map((item) =>
        accidentalQuestion(item, shuffle([...item.choices], random)),
      );
    case "progressions":
      return pick(progressionPool(options), count, random).map((item) =>
        progressionQuestion(item, progressionChoices()),
      );
    case "patterns":
      return pick(PATTERN_EXAMPLES, count, random).map((item) =>
        patternQuestion(item, fourChoices(item.id, item.label, PATTERN_EXAMPLES, (entry) => entry.label, random)),
      );
    case "melodies": {
      const bank = options.melodySource === "random"
        ? generateMelodyQuestions(melodyKeys(options), seed + 0x9e3779b9, count)
        : pick(melodyPool(options), count, random);
      return bank.map((item) => melodyQuestion(item, melodyChoices(random)));
    }
    case "broken":
      return pick(BROKEN_CHORD_EXAMPLES, count, random).map((item) =>
        brokenQuestion(
          item,
          fourChoices(item.typeId, item.label, CHORD_CATALOG, chordLabel, random),
        ),
      );
    case "handSpan":
      return pick(HAND_SPAN_EXAMPLES, count, random).map((item) =>
        handSpanQuestion(item, shuffle(handSpanChoices(item.spanDegrees), random)),
      );
  }
}

/** 测试和 UI 都可以用它，不依赖随机状态。 */
export function isPracticeAnswer(question: PracticeQuestion, choiceId: string): boolean {
  return question.answerId === choiceId;
}

function noteQuestion(
  item: NoteExample,
  pool: readonly NoteExample[],
  random: () => number,
): PracticeQuestion {
  const explained = noteExplanation(item);
  return {
    id: item.id,
    kind: "notes",
    prompt: item.pitch,
    hint: "谱面上这个音是什么？",
    choices: fourChoices(item.pitch, item.label, pool, (entry) => entry.label, random),
    answerId: item.pitch,
    explanation: explained.summary,
    explanationSteps: explained.steps,
    staff: item.staff,
  };
}

function symbolQuestion(item: SymbolEntry, choices: PracticeChoice[]): PracticeQuestion {
  return {
    id: `symbol:${item.id}`,
    kind: "symbols",
    prompt: item.symbol,
    hint: "这个记号是什么意思？",
    choices,
    answerId: item.id,
    explanation: `${item.symbol} = ${item.meaning}（${item.english}）`,
  };
}

function intervalQuestion(item: IntervalExample, choices: PracticeChoice[]): PracticeQuestion {
  const explained = intervalExplanation(item);
  return {
    id: `interval:${item.intervalId}`,
    kind: "intervals",
    prompt: item.notes,
    hint: "这两个音构成什么音程？",
    choices,
    answerId: item.intervalId,
    explanation: explained.summary,
    explanationSteps: explained.steps,
    staff: item.staff,
  };
}

function chordQuestion(item: ChordExample, choices: PracticeChoice[]): PracticeQuestion {
  const explained = chordExplanation(item);
  return {
    id: `chord:${item.id}`,
    kind: "chords",
    prompt: item.notes,
    hint: `以 ${item.root} 为根音，这是什么和弦？`,
    choices,
    answerId: item.typeId,
    explanation: explained.summary,
    explanationSteps: explained.steps,
    staff: item.staff,
  };
}

function accidentalQuestion(
  item: AccidentalExample,
  choices: readonly PracticeChoice[],
): PracticeQuestion {
  return {
    id: `accidental:${item.id}`,
    kind: "accidentals",
    prompt: item.prompt,
    hint: item.hint,
    choices: [...choices],
    answerId: item.answerId,
    explanation: item.explanation,
  };
}

function progressionQuestion(item: ProgressionExample, choices: PracticeChoice[]): PracticeQuestion {
  const explained = progressionExplanation(item);
  return {
    id: `progression:${item.id}`,
    kind: "progressions",
    prompt: `${item.key}：${item.chords.join(" → ")}`,
    hint: "这组和弦的级数是什么？",
    choices,
    answerId: item.answer,
    explanation: explained.summary,
    explanationSteps: explained.steps,
    staff: item.staff,
  };
}

function patternQuestion(item: PatternExample, choices: PracticeChoice[]): PracticeQuestion {
  const explained = patternExplanation(item);
  return {
    id: `pattern:${item.id}`,
    kind: "patterns",
    prompt: item.notes.join(" – "),
    hint: "这串音是往哪个方向走的？",
    choices,
    answerId: item.id,
    explanation: explained.summary,
    explanationSteps: explained.steps,
    staff: item.staff,
  };
}

function melodyQuestion(item: PlaybackQuestion, choices: PracticeChoice[]): PracticeQuestion {
  const explained = melodyExplanation(item);
  return {
    id: `melody:${item.id}`,
    kind: "melodies",
    prompt: "听旋律，判断调性",
    hint: `${item.meter} · ${item.melody.length} 个音 · 先点播放`,
    choices,
    answerId: item.key,
    explanation: explained.summary,
    explanationSteps: explained.steps,
    melody: item,
    // 谱面与试听同源：答完调性揭谱后，跟着同一份谱面跟弹。
    staff: melodyStaff(item),
  };
}

function brokenQuestion(item: BrokenChordExample, choices: PracticeChoice[]): PracticeQuestion {
  const explained = brokenChordExplanation(item);
  return {
    id: `broken:${item.id}`,
    kind: "broken",
    prompt: item.arpeggio.join(" – "),
    hint: "这是一个分解和弦，它是什么和弦？",
    choices,
    answerId: item.typeId,
    explanation: explained.summary,
    explanationSteps: explained.steps,
    staff: item.staff,
  };
}

function handSpanQuestion(item: HandSpanExample, choices: PracticeChoice[]): PracticeQuestion {
  const explained = handSpanExplanation(item);
  return {
    id: `handSpan:${item.id}`,
    kind: "handSpan",
    prompt: item.notes,
    hint: "这组音最两端跨了几度？",
    choices,
    answerId: String(item.spanDegrees),
    explanation: explained.summary,
    explanationSteps: explained.steps,
    staff: item.staff,
  };
}

/** 和弦类型的中文名 + 英文缩写，选项和解释共用一份。 */
function chordLabel(entry: ChordType): string {
  return `${CHORD_LABELS[entry.id] ?? entry.id} (${entry.uiLabel})`;
}

/** 按分组过滤符号；没有指定分组时返回全部。 */
function symbolPool(options: PracticeOptions): readonly SymbolEntry[] {
  const groups = options.symbolGroups;
  if (!groups || groups.length === 0) return SYMBOLS;
  return SYMBOLS.filter((entry) => groups.includes(entry.group));
}

/** 按和弦类型过滤例子；没有指定类型时返回全部根音。 */
function chordPool(options: PracticeOptions): readonly ChordExample[] {
  const types = options.chordTypeIds;
  if (!types || types.length === 0) return CHORD_EXAMPLES;
  return CHORD_EXAMPLES.filter((example) => types.includes(example.typeId));
}

/** 按音程 id 过滤例子；选项池仍是完整音程表，保证四个干扰项都成立。 */
function intervalPool(options: PracticeOptions): readonly IntervalExample[] {
  const ids = options.intervalIds;
  if (!ids || ids.length === 0) return INTERVAL_EXAMPLES;
  return INTERVAL_EXAMPLES.filter((example) => ids.includes(example.intervalId));
}

/** 按进行 id 过滤例子。 */
function progressionPool(options: PracticeOptions): readonly ProgressionExample[] {
  const ids = options.progressionIds;
  if (!ids || ids.length === 0) return PROGRESSIONS;
  return PROGRESSIONS.filter((example) => ids.includes(example.id));
}

/**
 * 单音题库：没有音域/升降号选项时直接用内置题库；
 * 有选项时按音域现场拼，保证范围与升降号真的生效。
 */
function notePool(options: PracticeOptions): readonly NoteExample[] {
  const sharps = options.includeSharps ?? false;
  const flats = options.includeFlats ?? false;
  if (!options.noteRange && !sharps && !flats) return NOTE_EXAMPLES;
  const low = options.noteRange?.low ?? "C3";
  const high = options.noteRange?.high ?? "E5";
  const generated = noteExamplesInRange(low, high, {
    includeSharps: sharps,
    includeFlats: flats,
  });
  return generated.length > 0 ? generated : NOTE_EXAMPLES;
}

/** 按调性过滤旋律题库；没有指定时返回全部。 */
function melodyPool(options: PracticeOptions): readonly PlaybackQuestion[] {
  const keys = melodyKeys(options);
  if (keys.length === 0) return MELODY_BANK;
  return MELODY_BANK.filter((item) => keys.includes(item.key));
}

function melodyKeys(options: PracticeOptions): PlaybackKey[] {
  const keys = options.playbackKeys;
  if (!keys || keys.length === 0) return [...PLAYBACK_KEYS];
  return [...keys];
}

type WithId = { id: string };

/**
 * 生成四个不重复标签的选项。
 *
 * 符号表里有多个条目共享同一个中文意思（rit./rall. 都是「渐慢」），如果
 * 直接按条目取干扰项，会出现两个一模一样但只有一个算对的按钮，所以这里
 * 以标签去重。答案永远第一个放进去，保证一定存在。
 */
function fourChoices<T extends WithId>(
  answerId: string,
  answerLabel: string,
  pool: readonly T[],
  labelOf: (item: T) => string,
  random: () => number,
): PracticeChoice[] {
  const byLabel = new Map<string, string>();
  byLabel.set(answerLabel, answerId);
  for (const item of shuffle([...pool], random)) {
    if (byLabel.size >= 4) break;
    const label = labelOf(item);
    if (!byLabel.has(label)) byLabel.set(label, item.id);
  }
  return shuffle(
    [...byLabel.entries()].map(([label, id]) => ({ id, label })),
    random,
  );
}

function progressionChoices(): PracticeChoice[] {
  return PROGRESSIONS.map((item) => ({ id: item.answer, label: item.answer }));
}

function melodyChoices(random: () => number): PracticeChoice[] {
  return shuffle(
    PLAYBACK_KEYS.map((key) => ({ id: key, label: KEY_LABELS[key] })),
    random,
  );
}

function pick<T>(pool: readonly T[], count: number, random: () => number): T[] {
  return shuffle([...pool], random).slice(0, Math.min(count, pool.length));
}

function shuffle<T>(items: T[], random: () => number): T[] {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const next = Math.floor(random() * (index + 1));
    [items[index], items[next]] = [items[next], items[index]];
  }
  return items;
}

/** 小而稳定的 PRNG，方便测试固定 seed 复现同一组题。 */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
