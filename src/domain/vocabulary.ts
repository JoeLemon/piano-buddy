import { parsePitchLabel } from "./pitch";
import type { Duration, Hand, KeySignature, Level, Meter, NoteEvent, Pitch, PositionId, Step } from "./types";

export const DURATION_BEATS: Record<Duration, number> = {
  w: 4,
  wr: 4,
  hd: 3,
  h: 2,
  hr: 2,
  qd: 1.5,
  q: 1,
  qr: 1,
  "8": 0.5,
  "8r": 0.5,
  "16": 0.25,
  "16r": 0.25,
};

/** 三连音 3:2：三个写谱时值占两个的时长。 */
const TRIPLET_FACTOR = 2 / 3;

/**
 * 一个音符实际占几拍（四分音符单位）。
 *
 * 普通音符就是 `DURATION_BEATS[duration]`；三连音按 2/3 折算。所有需要
 * 「这个音有多长」的地方都读这里，别再直接查 `DURATION_BEATS`——否则三连音
 * 会被当成普通八分音符，小节永远差 1/3 拍。
 */
export function noteBeats(note: Pick<NoteEvent, "duration" | "tuplet">): number {
  const base = DURATION_BEATS[note.duration] ?? 0;
  return note.tuplet ? base * TRIPLET_FACTOR : base;
}

/** 一小节有多少个四分音符拍：4/4 = 4、3/4 = 3、6/8 = 3。 */
export function meterQuarterBeats(meter: Meter): number {
  return (meter.beats * 4) / meter.beatValue;
}

const POSITION_LABELS: Record<PositionId, Record<Hand, readonly string[]>> = {
  C: {
    RH: ["C4", "D4", "E4", "F4", "G4"],
    LH: ["C3", "D3", "E3", "F3", "G3"],
  },
  "D-shift": {
    RH: ["D4", "E4", "F4", "G4", "A4"],
    LH: ["D3", "E3", "F3", "G3", "A3"],
  },
  F: {
    RH: ["F4", "G4", "A4", "Bb4", "C5"],
    LH: ["F3", "G3", "A3", "Bb3", "C4"],
  },
  G: {
    RH: ["G4", "A4", "B4", "C5", "D5"],
    LH: ["G3", "A3", "B3", "C4", "D4"],
  },
  "D-major": {
    RH: ["D4", "E4", "F#4", "G4", "A4"],
    LH: ["D3", "E3", "F#3", "G3", "A3"],
  },
  Bb: {
    RH: ["Bb4", "C5", "D5", "Eb5", "F5"],
    LH: ["Bb3", "C4", "D4", "Eb4", "F4"],
  },
};

/** Scale whose degrees spell this position, including the white-key D shift. */
const POSITION_KEY: Record<PositionId, KeySignature> = {
  C: "C",
  "D-shift": "C",
  F: "F",
  G: "G",
  "D-major": "D",
  Bb: "Bb",
};

export const KEY_ACCIDENTALS: Record<KeySignature, Partial<Record<Step, -1 | 1>>> = {
  C: {},
  F: { B: -1 },
  G: { F: 1 },
  D: { F: 1, C: 1 },
  Bb: { B: -1, E: -1 },
  // 小调按自然小调写调号；和声小调的升高导音（如 E 小调的 D♯）走临时记号。
  Am: {},
  Em: { F: 1 },
  Dm: { B: -1 },
};

/** a/e/d 小调：与 C/G/F 大调共用调号，但主音和调式不同。 */
export const MINOR_KEYS: readonly KeySignature[] = ["Am", "Em", "Dm"];

export function isMinorKey(key: KeySignature): key is "Am" | "Em" | "Dm" {
  return MINOR_KEYS.includes(key);
}

const STEPS: readonly Step[] = ["C", "D", "E", "F", "G", "A", "B"];

/**
 * 当前三和弦词汇：C/F/G 大三和弦 + A/D/E 小三和弦。
 *
 * 小三和弦加上 A–C–E、D–F–A、E–G–B 之后，a/d 小调的 i、iv、V
 * 与 e 小调的 i、iv 都能落在同一张表里。表里的顺序是根音在前的原位
 * 拼写；转位由 `domain/chords.ts` 的 `identifyChord()` 识别，不再另列。
 */
export const TRIADS: readonly (readonly Step[])[] = [
  ["C", "E", "G"],
  ["F", "A", "C"],
  ["G", "B", "D"],
  ["A", "C", "E"],
  ["D", "F", "A"],
  ["E", "G", "B"],
];

export type LevelSpec = {
  meters: ReadonlyArray<Meter>;
  keys: readonly KeySignature[];
  durations: readonly Duration[];
  /** 是否允许 3:2 三连音。 */
  tuplets: boolean;
  maxChordSize: number;
  /** 是否允许转位三和弦（L4 起）。 */
  inversions: boolean;
  /** 是否允许七和弦（L5 起）。 */
  sevenths: boolean;
  /** 是否允许减七/半减七（L6 起）：需要 `chord.diminished` 技能。 */
  diminished: boolean;
  /** 是否允许八度重复根音的四音三和弦（L5 起，需 `maxChordSize >= 4`）。 */
  doubledRoot: boolean;
  accidentals: boolean;
  positions: readonly PositionId[];
  maxLedgerLines: number;
  expandEnds: boolean;
  ledgerWindow: boolean;
  singleHand: boolean;
  maxLeap: number | null;
};

const quarter: Duration[] = ["w", "h", "q", "wr", "hr", "qr"];
const eighth: Duration[] = [...quarter, "8", "8r"];
const dotted: Duration[] = [...eighth, "hd", "qd"];
const sixteenth: Duration[] = [...dotted, "16", "16r"];

const fourFour: Meter[] = [{ beats: 4, beatValue: 4 }];
const threeOrFour: Meter[] = [
  { beats: 4, beatValue: 4 },
  { beats: 3, beatValue: 4 },
];
/** 6/8 从 L5 起进入词汇表；L4 及以下仍只教 4/4、3/4。 */
const threeFourOrSixEight: Meter[] = [...threeOrFour, { beats: 6, beatValue: 8 }];

const keysC: KeySignature[] = ["C"];
const keysOneAccidental: KeySignature[] = ["C", "F", "G"];
const keysTwoAccidentals: KeySignature[] = ["C", "F", "G", "D", "Bb"];
/** 小调从 L4 起进入词汇表；L1–L3 仍只教大调。 */
const keysWithMinor: KeySignature[] = [...keysTwoAccidentals, ...MINOR_KEYS];

const positionC: PositionId[] = ["C"];
const positionsThroughG: PositionId[] = ["C", "D-shift", "F", "G"];
const allPositions: PositionId[] = [...positionsThroughG, "D-major", "Bb"];

export const LEVEL_SPEC: Record<Level, LevelSpec> = {
  1: {
    meters: fourFour.map((meter) => ({ ...meter })),
    keys: [...keysC],
    durations: [...quarter],
    tuplets: false,
    maxChordSize: 1,
    inversions: false,
    sevenths: false,
    diminished: false,
    doubledRoot: false,
    accidentals: false,
    positions: [...positionC],
    maxLedgerLines: 1,
    expandEnds: false,
    ledgerWindow: false,
    singleHand: true,
    maxLeap: null,
  },
  2: {
    meters: fourFour.map((meter) => ({ ...meter })),
    keys: [...keysOneAccidental],
    durations: [...eighth],
    tuplets: false,
    maxChordSize: 1,
    inversions: false,
    sevenths: false,
    diminished: false,
    doubledRoot: false,
    accidentals: false,
    positions: [...positionsThroughG],
    maxLedgerLines: 1,
    expandEnds: false,
    ledgerWindow: false,
    singleHand: false,
    maxLeap: null,
  },
  3: {
    meters: fourFour.map((meter) => ({ ...meter })),
    keys: [...keysOneAccidental],
    durations: [...eighth],
    tuplets: false,
    maxChordSize: 3,
    inversions: false,
    sevenths: false,
    diminished: false,
    doubledRoot: false,
    accidentals: true,
    positions: [...positionsThroughG],
    maxLedgerLines: 1,
    expandEnds: false,
    ledgerWindow: false,
    singleHand: false,
    maxLeap: null,
  },
  4: {
    meters: threeOrFour.map((meter) => ({ ...meter })),
    keys: [...keysWithMinor],
    durations: [...eighth],
    tuplets: false,
    maxChordSize: 3,
    inversions: true,
    sevenths: false,
    diminished: false,
    doubledRoot: false,
    accidentals: true,
    positions: [...allPositions],
    maxLedgerLines: 2,
    expandEnds: true,
    ledgerWindow: false,
    singleHand: false,
    maxLeap: null,
  },
  5: {
    meters: threeFourOrSixEight.map((meter) => ({ ...meter })),
    keys: [...keysWithMinor],
    durations: [...dotted],
    tuplets: true,
    maxChordSize: 4,
    inversions: true,
    sevenths: true,
    diminished: false,
    doubledRoot: true,
    accidentals: true,
    positions: [...allPositions],
    maxLedgerLines: 2,
    expandEnds: true,
    ledgerWindow: false,
    singleHand: false,
    maxLeap: null,
  },
  6: {
    meters: threeFourOrSixEight.map((meter) => ({ ...meter })),
    keys: [...keysWithMinor],
    durations: [...sixteenth],
    tuplets: true,
    maxChordSize: 4,
    inversions: true,
    sevenths: true,
    diminished: true,
    doubledRoot: true,
    accidentals: true,
    positions: [...allPositions],
    maxLedgerLines: 2,
    expandEnds: true,
    ledgerWindow: true,
    singleHand: false,
    maxLeap: 12,
  },
};

export function keyAlteration(key: KeySignature, step: Step): -1 | 0 | 1 {
  return KEY_ACCIDENTALS[key][step] ?? 0;
}

export function pitchesFor(position: PositionId, hand: Hand): Pitch[] {
  return POSITION_LABELS[position][hand].map((label) => parsePitchLabel(label));
}

export function fingerFor(position: PositionId, hand: Hand, pitch: Pitch): number {
  const index = pitchesFor(position, hand).findIndex(
    (slot) => slot.step === pitch.step && slot.octave === pitch.octave && slot.alteration === pitch.alteration,
  );
  if (index < 0) throw new Error(`pitch not in position ${position} ${hand}`);
  return hand === "RH" ? index + 1 : 5 - index;
}

/**
 * One diatonic second past each end, spelled in the position's key.
 * C right hand reaches B3 below and A4 above.
 */
export function expansionPitches(position: PositionId, hand: Hand): [Pitch, Pitch] {
  const pitches = pitchesFor(position, hand);
  const key = POSITION_KEY[position];
  return [moveDiatonic(pitches[0], -1, key), moveDiatonic(pitches[pitches.length - 1], 1, key)];
}

function moveDiatonic(pitch: Pitch, direction: -1 | 1, key: KeySignature): Pitch {
  const index = STEPS.indexOf(pitch.step);
  let next = index + direction;
  let octave = pitch.octave;
  if (next < 0) {
    next = STEPS.length - 1;
    octave -= 1;
  } else if (next >= STEPS.length) {
    next = 0;
    octave += 1;
  }
  const step = STEPS[next];
  return { step, octave, alteration: keyAlteration(key, step) };
}
