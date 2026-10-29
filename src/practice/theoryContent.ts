/**
 * 乐理练习的内容层。
 *
 * 数据来自 00-SightReading_3.0 的符号表、音程表、和弦表、和弦进行与
 * Playback 题库；这里只保留纯数据，不依赖 React、VexFlow 或云端 CMS。
 * 当前 App 的练习入口做「单音 / 符号 / 音程 / 和弦 / 临时升降 / 进行 / 音型 / 旋律」，
 * 并逐步接入谱面与试听；教师 CMS、MusicXML 导入仍不搬。
 */

import { CATALOG_BY_ID as INTERVAL_BY_ID, displayName as intervalDisplayName } from "./intervalCatalog";
import { CHORD_CATALOG, type ChordType } from "./chordCatalog";
import type { PracticeStaffPrompt } from "./practiceScore";
import type { PlaybackKey } from "./melodyTypes";

export type SymbolEntry = {
  id: string;
  symbol: string;
  meaning: string;
  english: string;
  /** 由参考项目符号表按常见程度粗分；不是当前 App 的 L1–L6 评级。 */
  group: "力度" | "速度" | "发音" | "反复" | "八度" | "演奏法";
};

/** 参考项目 templates/symbols-batch.txt 的 32 个符号。 */
export const SYMBOLS: readonly SymbolEntry[] = [
  { id: "sym.pp", symbol: "pp", meaning: "极弱", english: "pianissimo", group: "力度" },
  { id: "sym.p", symbol: "p", meaning: "弱", english: "piano", group: "力度" },
  { id: "sym.mp", symbol: "mp", meaning: "中弱", english: "mezzo-piano", group: "力度" },
  { id: "sym.mf", symbol: "mf", meaning: "中强", english: "mezzo-forte", group: "力度" },
  { id: "sym.f", symbol: "f", meaning: "强", english: "forte", group: "力度" },
  { id: "sym.ff", symbol: "ff", meaning: "极强", english: "fortissimo", group: "力度" },
  { id: "sym.fff", symbol: "fff", meaning: "最强", english: "fortississimo", group: "力度" },
  { id: "sym.sfz", symbol: "sfz", meaning: "突强", english: "sforzando", group: "力度" },
  { id: "sym.fp", symbol: "fp", meaning: "强后立弱", english: "forte-piano", group: "力度" },
  { id: "sym.cresc", symbol: "cresc.", meaning: "渐强", english: "crescendo", group: "力度" },
  { id: "sym.decresc", symbol: "decresc.", meaning: "渐弱", english: "decrescendo", group: "力度" },
  { id: "sym.dim", symbol: "dim.", meaning: "渐弱", english: "diminuendo", group: "力度" },
  { id: "sym.rit", symbol: "rit.", meaning: "渐慢", english: "ritardando", group: "速度" },
  { id: "sym.rall", symbol: "rall.", meaning: "渐慢", english: "rallentando", group: "速度" },
  { id: "sym.accel", symbol: "accel.", meaning: "渐快", english: "accelerando", group: "速度" },
  { id: "sym.a-tempo", symbol: "a tempo", meaning: "恢复原速", english: "a tempo", group: "速度" },
  { id: "sym.fermata", symbol: "fermata", meaning: "延音记号", english: "𝄐", group: "发音" },
  { id: "sym.staccato", symbol: "staccato", meaning: "断音", english: "·", group: "发音" },
  { id: "sym.accent", symbol: "accent", meaning: "重音", english: ">", group: "发音" },
  { id: "sym.tenuto", symbol: "tenuto", meaning: "保持音", english: "—", group: "发音" },
  { id: "sym.marcato", symbol: "marcato", meaning: "顿音", english: "^", group: "发音" },
  { id: "sym.trill", symbol: "trill", meaning: "颤音", english: "tr", group: "演奏法" },
  { id: "sym.dc", symbol: "D.C.", meaning: "从头反复", english: "Da Capo", group: "反复" },
  { id: "sym.ds", symbol: "D.S.", meaning: "从记号处反复", english: "Dal Segno", group: "反复" },
  { id: "sym.fine", symbol: "Fine", meaning: "结束", english: "Fine", group: "反复" },
  { id: "sym.coda", symbol: "Coda", meaning: "尾声", english: "⊕", group: "反复" },
  { id: "sym.8va", symbol: "8va", meaning: "高八度演奏", english: "ottava alta", group: "八度" },
  { id: "sym.8vb", symbol: "8vb", meaning: "低八度演奏", english: "ottava bassa", group: "八度" },
  { id: "sym.legato", symbol: "legato", meaning: "连奏", english: "legato", group: "演奏法" },
  { id: "sym.pizz", symbol: "pizz.", meaning: "拨弦", english: "pizzicato", group: "演奏法" },
  { id: "sym.arco", symbol: "arco", meaning: "用弓", english: "arco", group: "演奏法" },
  { id: "sym.con-ped", symbol: "con ped.", meaning: "踩踏板", english: "con pedale", group: "演奏法" },
];

export type SymbolGroup = SymbolEntry["group"];

/** 符号练习的分组顺序：练习页与主线关卡都按这个顺序展示。 */
export const SYMBOL_GROUPS: readonly SymbolGroup[] = [
  "力度",
  "速度",
  "发音",
  "反复",
  "八度",
  "演奏法",
];

export type IntervalExample = {
  /** 题目唯一 id，等于音程 id（每个音程只取一个清晰的拼写例子）。 */
  id: string;
  intervalId: string;
  /** 两个音的拼写，用于谱面与试听。 */
  startPitch: string;
  endPitch: string;
  /** 题面文本，例如 "C4 – E4"。 */
  notes: string;
  label: string;
  staff: PracticeStaffPrompt;
};

/**
 * 27 个音程各取一个拼写例子。
 *
 * 选例原则：从白键起算、最多只出现一个升/降号，避免重升重降；
 * 这样既覆盖完整音程目录，又不会让初学者被 `Bbb` 之类的拼写劝退。
 */
const INTERVAL_SPELLINGS: readonly { intervalId: string; startPitch: string; endPitch: string }[] = [
  { intervalId: "P1", startPitch: "C4", endPitch: "C4" },
  { intervalId: "A1", startPitch: "C4", endPitch: "C#4" },
  { intervalId: "d2", startPitch: "E4", endPitch: "Fb4" },
  { intervalId: "m2", startPitch: "E4", endPitch: "F4" },
  { intervalId: "M2", startPitch: "C4", endPitch: "D4" },
  { intervalId: "A2", startPitch: "F4", endPitch: "G#4" },
  { intervalId: "d3", startPitch: "B4", endPitch: "Db5" },
  { intervalId: "m3", startPitch: "C4", endPitch: "Eb4" },
  { intervalId: "M3", startPitch: "C4", endPitch: "E4" },
  { intervalId: "A3", startPitch: "C4", endPitch: "E#4" },
  { intervalId: "d4", startPitch: "B4", endPitch: "Eb5" },
  { intervalId: "P4", startPitch: "C4", endPitch: "F4" },
  { intervalId: "A4", startPitch: "F4", endPitch: "B4" },
  { intervalId: "d5", startPitch: "B4", endPitch: "F5" },
  { intervalId: "P5", startPitch: "C4", endPitch: "G4" },
  { intervalId: "A5", startPitch: "C4", endPitch: "G#4" },
  { intervalId: "d6", startPitch: "A4", endPitch: "Fb5" },
  { intervalId: "m6", startPitch: "E4", endPitch: "C5" },
  { intervalId: "M6", startPitch: "C4", endPitch: "A4" },
  { intervalId: "A6", startPitch: "C4", endPitch: "A#4" },
  { intervalId: "d7", startPitch: "B4", endPitch: "Ab5" },
  { intervalId: "m7", startPitch: "C4", endPitch: "Bb4" },
  { intervalId: "M7", startPitch: "C4", endPitch: "B4" },
  { intervalId: "A7", startPitch: "C4", endPitch: "B#4" },
  { intervalId: "d8", startPitch: "C4", endPitch: "Cb5" },
  { intervalId: "P8", startPitch: "C4", endPitch: "C5" },
  { intervalId: "A8", startPitch: "C4", endPitch: "C#5" },
];

export const INTERVAL_EXAMPLES: readonly IntervalExample[] = INTERVAL_SPELLINGS.map((entry) => {
  const interval = INTERVAL_BY_ID.get(entry.intervalId);
  return {
    ...entry,
    id: entry.intervalId,
    notes: `${entry.startPitch} – ${entry.endPitch}`,
    label: interval ? intervalDisplayName(interval) : entry.intervalId,
    staff: {
      clef: "treble",
      // 音程用和声音程（两音叠置）呈现，高音在上更符合读谱直觉。
      groups: [{ pitches: [entry.startPitch, entry.endPitch], duration: "w" }],
    },
  };
});

export const CHORD_LABELS: Record<string, string> = {
  maj: "大三和弦",
  min: "小三和弦",
  aug: "增三和弦",
  dim: "减三和弦",
  maj7: "大七和弦",
  min7: "小七和弦",
  dom7: "属七和弦",
  dim7: "减七和弦",
};

export type ChordExample = {
  /** 题目唯一 id = 和弦类型 + 根音，例如 "maj:G4"。 */
  id: string;
  /** 正确答案 id（和弦类型），例如 "maj"。 */
  typeId: string;
  root: string;
  notes: string;
  label: string;
  staff: PracticeStaffPrompt;
};

/**
 * 每种和弦取 2–3 个根音，避免所有题都从 C 起算。
 * 根音经过挑选，保证叠置三度后最多只有一个升/降号。
 */
const CHORD_ROOTS: Readonly<Record<string, readonly string[]>> = {
  maj: ["C4", "G3", "F4"],
  min: ["A4", "D4", "E4"],
  aug: ["C4", "F4"],
  maj7: ["C4", "G4"],
  min7: ["A4", "D4"],
  dom7: ["G4", "C4"],
  dim7: ["D4", "B4"],
};

const LETTERS = ["C", "D", "E", "F", "G", "A", "B"] as const;
const LETTER_INDEX: Record<string, number> = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };
const LETTER_SEMITONES: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/**
 * 以给定根音按「叠三度」拼写和弦音。
 *
 * 与直接加半音不同，叠三度会保留正确的音名字母（C 的减七是 C–Eb–Gb–Bbb，
 * 而不是 C–Eb–F#–A），这对读谱训练很重要。这里限制最多一个升降号，
 * 超出则视为内容错误，尽早暴露而不是悄悄换成等音拼写。
 */
function spellStackedChord(root: string, offsets: readonly number[]): string[] {
  const match = /^([A-G])([#b]?)(\d+)$/.exec(root);
  if (!match) throw new Error(`bad chord root: ${root}`);

  const rootLetter = match[1];
  const rootAccidental = match[2] === "#" ? 1 : match[2] === "b" ? -1 : 0;
  const rootOctave = Number(match[3]);
  const rootStep = LETTER_INDEX[rootLetter] + rootOctave * 7;
  const rootMidi = LETTER_SEMITONES[rootLetter] + rootAccidental + (rootOctave + 1) * 12;

  return offsets.map((offset, index) => {
    const step = rootStep + 2 * index;
    const letter = LETTERS[((step % 7) + 7) % 7];
    const octave = Math.floor(step / 7);
    const naturalMidi = LETTER_SEMITONES[letter] + (octave + 1) * 12;
    const diff = rootMidi + offset - naturalMidi;
    const accidental = diff === 0 ? "" : diff === 1 ? "#" : diff === -1 ? "b" : null;
    if (accidental === null) {
      throw new Error(`chord spelling needs a double accidental: ${root} +${offset}`);
    }
    return `${letter}${accidental}${octave}`;
  });
}

export const CHORD_EXAMPLES: readonly ChordExample[] = CHORD_CATALOG.flatMap((chord: ChordType) => {
  const roots = CHORD_ROOTS[chord.id] ?? ["C4"];
  return roots.map((root) => {
    const pitches = spellStackedChord(root, chord.semitonesFromRoot);
    return {
      id: `${chord.id}:${root}`,
      typeId: chord.id,
      root,
      notes: pitches.join(" – "),
      label: `${CHORD_LABELS[chord.id] ?? chord.id} (${chord.uiLabel})`,
      staff: { clef: "treble", groups: [{ pitches, duration: "w" }] },
    };
  });
});

export type ProgressionExample = {
  id: string;
  key: string;
  chords: readonly string[];
  answer: string;
  /** 每个和弦一小节，练习页据此画谱并试听。 */
  staff: PracticeStaffPrompt;
};

/** 把三个和弦的 voicing 排成三小节，每小节一个全音符和弦。 */
function progressionStaff(voicings: readonly (readonly string[])[]): PracticeStaffPrompt {
  return {
    clef: "treble",
    groups: [],
    measures: voicings.map((pitches) => [{ pitches, duration: "w" }]),
  };
}

/** 参考项目的四条 Level 6 进行，用 C 大调 / A 小调写成可读例子。 */
export const PROGRESSIONS: readonly ProgressionExample[] = [
  {
    id: "major-141",
    key: "C 大调",
    chords: ["C", "F", "C"],
    answer: "I – IV – I",
    staff: progressionStaff([
      ["C4", "E4", "G4"],
      ["F4", "A4", "C5"],
      ["C4", "E4", "G4"],
    ]),
  },
  {
    id: "major-151",
    key: "C 大调",
    chords: ["C", "G", "C"],
    answer: "I – V – I",
    staff: progressionStaff([
      ["C4", "E4", "G4"],
      ["G4", "B4", "D5"],
      ["C4", "E4", "G4"],
    ]),
  },
  {
    id: "minor-141",
    key: "A 小调",
    chords: ["Am", "Dm", "Am"],
    answer: "i – iv – i",
    staff: progressionStaff([
      ["A4", "C5", "E5"],
      ["D4", "F4", "A4"],
      ["A4", "C5", "E5"],
    ]),
  },
  {
    id: "minor-151",
    key: "A 小调",
    chords: ["Am", "E", "Am"],
    answer: "i – V – i",
    staff: progressionStaff([
      ["A4", "C5", "E5"],
      ["E4", "G#4", "B4"],
      ["A4", "C5", "E5"],
    ]),
  },
];

export const KEY_LABELS: Record<PlaybackKey, string> = {
  "G major": "G 大调",
  "E major": "E 大调",
  "G minor": "G 小调",
  "E minor": "E 小调",
};

export const CONTENT_SOURCE = "题库改编自 00-SightReading_3.0，临时升降题为项目补充。";
