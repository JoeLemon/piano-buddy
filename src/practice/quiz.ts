import {
  INTERVAL_CATALOG,
  displayName as intervalDisplayName,
} from "./intervalCatalog";
import { CHORD_CATALOG, type ChordType } from "./chordCatalog";
import { MELODY_BANK } from "./melodyBank";
import type { PlaybackQuestion } from "./melodyTypes";
import { PLAYBACK_KEYS } from "./melodyTypes";
import { NOTE_EXAMPLES, type NoteExample } from "./noteContent";
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
  | "melodies";

export const PRACTICE_KINDS: readonly PracticeKind[] = [
  "notes",
  "symbols",
  "intervals",
  "chords",
  "accidentals",
  "progressions",
  "patterns",
  "melodies",
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
};

/** 练习范围：符号可以只看某几组，和弦可以只练某几类。 */
export type PracticeOptions = {
  symbolGroups?: readonly SymbolGroup[];
  chordTypeIds?: readonly string[];
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
  /** 单音 / 音程 / 和弦 / 音型题带谱面，练习页会画出来并允许试听。 */
  staff?: PracticeStaffPrompt;
  /** 只有旋律听辨题带音频数据。 */
  melody?: PlaybackQuestion;
};

export function practiceQuestionCount(kind: PracticeKind, options: PracticeOptions = {}): number {
  switch (kind) {
    case "notes":
      return 8;
    case "symbols":
      return Math.min(8, symbolPool(options).length);
    case "intervals":
      return 8;
    case "chords":
      return Math.min(8, chordPool(options).length);
    case "accidentals":
      return 6;
    case "progressions":
      return PROGRESSIONS.length;
    case "patterns":
      return 8;
    case "melodies":
      return 8;
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
    case "notes":
      return pick(NOTE_EXAMPLES, count, random).map((item) => noteQuestion(item, random));
    case "symbols":
      return pick(symbolPool(options), count, random).map((item) =>
        symbolQuestion(item, fourChoices(item.id, item.meaning, SYMBOLS, (entry) => entry.meaning, random)),
      );
    case "intervals":
      return pick(INTERVAL_EXAMPLES, count, random).map((item) =>
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
      return pick(PROGRESSIONS, count, random).map((item) =>
        progressionQuestion(item, progressionChoices()),
      );
    case "patterns":
      return pick(PATTERN_EXAMPLES, count, random).map((item) =>
        patternQuestion(item, fourChoices(item.id, item.label, PATTERN_EXAMPLES, (entry) => entry.label, random)),
      );
    case "melodies":
      return pick(MELODY_BANK, count, random).map((item) =>
        melodyQuestion(item, melodyChoices(random)),
      );
  }
}

/** 测试和 UI 都可以用它，不依赖随机状态。 */
export function isPracticeAnswer(question: PracticeQuestion, choiceId: string): boolean {
  return question.answerId === choiceId;
}

function noteQuestion(item: NoteExample, random: () => number): PracticeQuestion {
  return {
    id: `note:${item.clef}:${item.pitch}`,
    kind: "notes",
    prompt: item.pitch,
    hint: "谱面上这个音是什么？",
    choices: fourChoices(item.pitch, item.label, NOTE_EXAMPLES, (entry) => entry.label, random),
    answerId: item.pitch,
    explanation: `${item.pitch} 在${item.clef === "treble" ? "高音" : "低音"}谱上。`,
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
  return {
    id: `interval:${item.intervalId}`,
    kind: "intervals",
    prompt: item.notes,
    hint: "这两个音构成什么音程？",
    choices,
    answerId: item.intervalId,
    explanation: `${item.notes} 是 ${item.label}。`,
    staff: item.staff,
  };
}

function chordQuestion(item: ChordExample, choices: PracticeChoice[]): PracticeQuestion {
  return {
    id: `chord:${item.id}`,
    kind: "chords",
    prompt: item.notes,
    hint: `以 ${item.root} 为根音，这是什么和弦？`,
    choices,
    answerId: item.typeId,
    explanation: `${item.notes} 是 ${item.label}。`,
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
  return {
    id: `progression:${item.id}`,
    kind: "progressions",
    prompt: `${item.key}：${item.chords.join(" → ")}`,
    hint: "这组和弦的级数是什么？",
    choices,
    answerId: item.answer,
    explanation: `${item.key} 的 ${item.chords.join(" → ")} 是 ${item.answer}。`,
  };
}

function patternQuestion(item: PatternExample, choices: PracticeChoice[]): PracticeQuestion {
  return {
    id: `pattern:${item.id}`,
    kind: "patterns",
    prompt: item.notes.join(" – "),
    hint: "这串音是往哪个方向走的？",
    choices,
    answerId: item.id,
    explanation: `${item.notes.join(" – ")} 是${item.label}。`,
    staff: item.staff,
  };
}

function melodyQuestion(item: PlaybackQuestion, choices: PracticeChoice[]): PracticeQuestion {
  return {
    id: `melody:${item.id}`,
    kind: "melodies",
    prompt: "听旋律，判断调性",
    hint: `${item.meter} · ${item.melody.length} 个音 · 先点播放`,
    choices,
    answerId: item.key,
    explanation: `${item.id} 属于 ${KEY_LABELS[item.key]}。`,
    melody: item,
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
