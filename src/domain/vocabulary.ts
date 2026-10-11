import { parsePitchLabel } from "./pitch";
import type { Duration, Hand, KeySignature, Level, Pitch, PositionId, Step } from "./types";

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
};

const STEPS: readonly Step[] = ["C", "D", "E", "F", "G", "A", "B"];

export const TRIADS: readonly (readonly Step[])[] = [
  ["C", "E", "G"],
  ["F", "A", "C"],
  ["G", "B", "D"],
];

export type LevelSpec = {
  meters: ReadonlyArray<{ beats: 3 | 4; beatValue: 4 }>;
  keys: readonly KeySignature[];
  durations: readonly Duration[];
  maxChordSize: number;
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

const fourFour = [{ beats: 4 as const, beatValue: 4 as const }];
const threeOrFour = [{ beats: 4 as const, beatValue: 4 as const }, { beats: 3 as const, beatValue: 4 as const }];

const keysC: KeySignature[] = ["C"];
const keysOneAccidental: KeySignature[] = ["C", "F", "G"];
const keysTwoAccidentals: KeySignature[] = ["C", "F", "G", "D", "Bb"];

const positionC: PositionId[] = ["C"];
const positionsThroughG: PositionId[] = ["C", "D-shift", "F", "G"];
const allPositions: PositionId[] = [...positionsThroughG, "D-major", "Bb"];

export const LEVEL_SPEC: Record<Level, LevelSpec> = {
  1: {
    meters: fourFour.map((meter) => ({ ...meter })),
    keys: [...keysC],
    durations: [...quarter],
    maxChordSize: 1,
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
    maxChordSize: 1,
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
    maxChordSize: 3,
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
    keys: [...keysTwoAccidentals],
    durations: [...eighth],
    maxChordSize: 3,
    accidentals: true,
    positions: [...allPositions],
    maxLedgerLines: 2,
    expandEnds: true,
    ledgerWindow: false,
    singleHand: false,
    maxLeap: null,
  },
  5: {
    meters: threeOrFour.map((meter) => ({ ...meter })),
    keys: [...keysTwoAccidentals],
    durations: [...dotted],
    maxChordSize: 3,
    accidentals: true,
    positions: [...allPositions],
    maxLedgerLines: 2,
    expandEnds: true,
    ledgerWindow: false,
    singleHand: false,
    maxLeap: null,
  },
  6: {
    meters: threeOrFour.map((meter) => ({ ...meter })),
    keys: [...keysTwoAccidentals],
    durations: [...sixteenth],
    maxChordSize: 3,
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
