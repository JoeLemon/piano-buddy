import { isAllowed } from "./allowed";
import type { Duration, Hand, KeySignature, Measure, Mode, NoteEvent, Pitch, Score } from "./types";
import { DURATION_BEATS, fingerFor, pitchesFor, type PositionId } from "./vocabulary";

export type L2Shape =
  | { kind: "eighths-single"; hand: Hand }
  | { kind: "alternate" }
  | { kind: "together"; texture: "same" | "hold" }
  | { kind: "key-find"; key: "F" | "G"; hand: Hand }
  | { kind: "key-line"; key: "F" | "G"; hand: Hand }
  | { kind: "shift-once"; hand: Hand }
  | { kind: "test" }
  | { kind: "sight" };

const MEASURE_COUNT = 4;
const MAX_ATTEMPTS = 30;
const HANDS: readonly Hand[] = ["RH", "LH"];

const EIGHTH_BARS: Duration[][] = [
  ["8", "8", "q", "q", "q"],
  ["q", "8", "8", "q", "q"],
  ["q", "q", "8", "8", "q"],
  ["q", "q", "q", "8", "8"],
  ["8", "8", "8", "8", "q", "q"],
  ["8", "8", "8", "8", "8", "8", "8", "8"],
];

const WALK_BARS: Duration[][] = [
  ["q", "q", "q", "q"],
  ["8", "8", "q", "q", "q"],
  ["q", "8", "8", "q", "q"],
  ["q", "q", "8", "8", "q"],
  ["8", "8", "8", "8", "8", "8", "8", "8"],
];

const LONG_BARS: Duration[][] = [["w"], ["h", "h"]];
const QUARTER_BAR: Duration[] = ["q", "q", "q", "q"];
const LESSON_KEYS = ["C", "F", "G"] as const;

type LessonKey = (typeof LESSON_KEYS)[number];

export function generateL2(request: { seed: number; mode: Mode; shape: L2Shape }): Score {
  const random = mulberry32(request.seed);
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const score = buildScore(request, random);
    if (isAllowed(score) && shapeFits(score, request.shape)) return score;
  }
  throw new Error(`failed to generate an L2 score for ${request.shape.kind}`);
}

function buildScore(request: { seed: number; mode: Mode; shape: L2Shape }, random: () => number): Score {
  const { mode, seed, shape } = request;
  switch (shape.kind) {
    case "eighths-single":
      return assemble(scoreId(shape, seed), mode, "C", [shape.hand], {
        [shape.hand]: measuresFor(shape.hand, "C", takeBars(random, EIGHTH_BARS), random),
      });
    case "alternate":
      return assemble(scoreId(shape, seed), mode, "C", [...HANDS], alternateHands(random));
    case "together":
      return assemble(
        scoreId(shape, seed),
        mode,
        "C",
        [...HANDS],
        shape.texture === "same" ? pairedHands("C", EIGHTH_BARS, random) : heldHands(random),
      );
    case "key-find":
      return assemble(scoreId(shape, seed), mode, shape.key, [shape.hand], {
        [shape.hand]: findingMeasures(shape.hand, shape.key, random),
      });
    case "key-line":
      return assemble(scoreId(shape, seed), mode, shape.key, [shape.hand], {
        [shape.hand]: measuresFor(shape.hand, shape.key, takeBars(random, EIGHTH_BARS), random),
      });
    case "shift-once":
      return assemble(scoreId(shape, seed), mode, "C", [shape.hand], {
        [shape.hand]: shiftingMeasures(shape.hand, random),
      });
    case "test":
    case "sight": {
      const key = LESSON_KEYS[Math.floor(random() * LESSON_KEYS.length)];
      const dense = EIGHTH_BARS.filter((bar) => bar.filter((duration) => duration === "8").length >= 4);
      const catalog = shape.kind === "sight" && dense.length > 0 ? dense : EIGHTH_BARS;
      return assemble(scoreId(shape, seed), mode, key, [...HANDS], pairedHands(key, catalog, random));
    }
  }
}

function scoreId(shape: L2Shape, seed: number): string {
  const base = `l2-${shape.kind}-${seed}`;
  switch (shape.kind) {
    case "eighths-single":
    case "shift-once":
      return `${base}-${shape.hand}`;
    case "together":
      return `${base}-${shape.texture}`;
    case "key-find":
    case "key-line":
      return `${base}-${shape.key}-${shape.hand}`;
    default:
      return base;
  }
}

function assemble(
  id: string,
  mode: Mode,
  key: KeySignature,
  hands: Hand[],
  byHand: Partial<Record<Hand, Measure[]>>,
): Score {
  const staves: Score["staves"] = {};
  for (const hand of hands) {
    const measures = byHand[hand];
    if (!measures) throw new Error(`missing ${hand} stave`);
    staves[hand] = { clef: hand === "RH" ? "treble" : "bass", measures };
  }
  return {
    id,
    mode,
    level: 2,
    meter: { beats: 4, beatValue: 4 },
    keySignature: key,
    hands,
    bpm: 60,
    staves,
  };
}

function alternateHands(random: () => number): Record<Hand, Measure[]> {
  const oddHand: Hand = random() < 0.5 ? "RH" : "LH";
  const evenHand: Hand = oddHand === "RH" ? "LH" : "RH";
  const byHand: Record<Hand, Measure[]> = { RH: [], LH: [] };
  for (let measureIndex = 0; measureIndex < MEASURE_COUNT; measureIndex++) {
    const active = measureIndex % 2 === 0 ? oddHand : evenHand;
    const bar = takeOne(random, EIGHTH_BARS);
    for (const hand of HANDS) {
      byHand[hand].push(
        hand === active
          ? measureFrom(hand, "C", bar, measureIndex, random)
          : { notes: [{ id: `${hand}-${measureIndex}-0`, duration: "wr", pitches: [] }] },
      );
    }
  }
  return byHand;
}

function pairedHands(position: LessonKey, catalog: Duration[][], random: () => number): Record<Hand, Measure[]> {
  const bars = takeBars(random, catalog);
  return {
    RH: measuresFor("RH", position, bars, random),
    LH: measuresFor("LH", position, bars, random),
  };
}

function heldHands(random: () => number): Record<Hand, Measure[]> {
  const holder: Hand = random() < 0.5 ? "RH" : "LH";
  const byHand: Record<Hand, Measure[]> = { RH: [], LH: [] };
  for (let measureIndex = 0; measureIndex < MEASURE_COUNT; measureIndex++) {
    const longBar = takeOne(random, LONG_BARS);
    const walkBar = takeOne(random, WALK_BARS);
    for (const hand of HANDS) {
      byHand[hand].push(measureFrom(hand, "C", hand === holder ? longBar : walkBar, measureIndex, random));
    }
  }
  return byHand;
}

function findingMeasures(hand: Hand, key: "F" | "G", random: () => number): Measure[] {
  const vocab = pitchesFor(key, hand);
  let introduced = 0;
  return measuresFor(hand, key, Array.from({ length: MEASURE_COUNT }, () => QUARTER_BAR.slice()), random, () => {
    if (introduced < vocab.length) {
      const pitch = vocab[introduced];
      introduced += 1;
      return pitch;
    }
    return vocab[Math.floor(random() * vocab.length)];
  });
}

function shiftingMeasures(hand: Hand, random: () => number): Measure[] {
  const shiftAt = 1 + Math.floor(random() * 3);
  return Array.from({ length: MEASURE_COUNT }, (_, measureIndex) => {
    const position: PositionId = measureIndex < shiftAt ? "C" : "D-shift";
    const vocab = pitchesFor(position, hand);
    return measureFrom(hand, position, takeOne(random, EIGHTH_BARS), measureIndex, random, (noteIndex) => {
      if (measureIndex === 0 && noteIndex === 0) return vocab[0];
      if (measureIndex === shiftAt && noteIndex === 0) return vocab[vocab.length - 1];
      return vocab[Math.floor(random() * vocab.length)];
    });
  });
}

function measuresFor(
  hand: Hand,
  position: PositionId,
  bars: Duration[][],
  random: () => number,
  choose?: (noteIndex: number) => Pitch,
): Measure[] {
  return bars.map((bar, measureIndex) => measureFrom(hand, position, bar, measureIndex, random, choose));
}

function measureFrom(
  hand: Hand,
  position: PositionId,
  durations: Duration[],
  measureIndex: number,
  random: () => number,
  choose?: (noteIndex: number) => Pitch,
): Measure {
  const vocab = pitchesFor(position, hand);
  const notes = durations.map((duration, noteIndex) => {
    const id = `${hand}-${measureIndex}-${noteIndex}`;
    if (duration.endsWith("r")) return { id, duration, pitches: [] };
    const source = choose ? choose(noteIndex) : vocab[Math.floor(random() * vocab.length)];
    const pitch: Pitch = { step: source.step, octave: source.octave, alteration: source.alteration };
    const note: NoteEvent = { id, duration, pitches: [pitch], fingers: [fingerFor(position, hand, pitch)] };
    return note;
  });
  return { notes };
}

function takeBars(random: () => number, catalog: Duration[][]): Duration[][] {
  return Array.from({ length: MEASURE_COUNT }, () => takeOne(random, catalog));
}

function takeOne(random: () => number, catalog: Duration[][]): Duration[] {
  return catalog[Math.floor(random() * catalog.length)].slice();
}

function shapeFits(score: Score, shape: L2Shape): boolean {
  switch (shape.kind) {
    case "eighths-single":
      return singleHand(score, shape.hand) && score.keySignature === "C" && hasEighthGroup(score) && pitchesStay(score, shape.hand, "C");
    case "alternate":
      return bothHands(score) && score.keySignature === "C" && handsAlternate(score);
    case "together":
      return bothHands(score) && score.keySignature === "C" && (shape.texture === "same" ? handsMatchRhythm(score) : oneHandHolds(score));
    case "key-find":
      return singleHand(score, shape.hand) && score.keySignature === shape.key && pitchesStay(score, shape.hand, shape.key) && findsTone(score, shape.hand, shape.key);
    case "key-line":
      return singleHand(score, shape.hand) && score.keySignature === shape.key && hasEighthGroup(score) && pitchesStay(score, shape.hand, shape.key);
    case "shift-once":
      return singleHand(score, shape.hand) && score.keySignature === "C" && shiftCount(score, shape.hand) === 1;
    case "test":
    case "sight":
      return (
        bothHands(score) &&
        (score.keySignature === "C" || score.keySignature === "F" || score.keySignature === "G") &&
        hasEighthGroup(score) &&
        soundingTotal(score) >= 8 &&
        soundingNotes(score, "RH").length > 0 &&
        soundingNotes(score, "LH").length > 0
      );
  }
}

function singleHand(score: Score, hand: Hand): boolean {
  return score.hands.length === 1 && score.hands[0] === hand;
}

function bothHands(score: Score): boolean {
  return score.hands.length === 2 && score.staves.RH !== undefined && score.staves.LH !== undefined;
}

function handsAlternate(score: Score): boolean {
  const owners: Hand[] = [];
  for (let measure = 0; measure < MEASURE_COUNT; measure++) {
    const sounding = HANDS.filter((hand) =>
      score.staves[hand]?.measures[measure]?.notes.some((note) => note.pitches.length > 0),
    );
    if (sounding.length !== 1) return false;
    owners.push(sounding[0]);
  }
  return owners[0] !== owners[1] && owners[2] === owners[0] && owners[3] === owners[1];
}

function handsMatchRhythm(score: Score): boolean {
  const rh = durationPattern(score, "RH");
  const lh = durationPattern(score, "LH");
  return rh.length > 0 && rh.every((bar, index) => bar.join() === lh[index]?.join()) && shortSpans(score, "RH").length > 0;
}

function oneHandHolds(score: Score): boolean {
  const rh = soundingNotes(score, "RH");
  const lh = soundingNotes(score, "LH");
  const rhLong = isSustained(rh);
  const lhLong = isSustained(lh);
  if (rhLong === lhLong) return false;
  const short = rhLong ? lh : rh;
  const long = spansOf(score, rhLong ? "RH" : "LH");
  return (
    short.length > 0 &&
    short.every((note) => note.duration === "q" || note.duration === "8") &&
    shortSpans(score, rhLong ? "LH" : "RH").every((start) => long.some((span) => start >= span.start && start < span.end))
  );
}

function findsTone(score: Score, hand: Hand, key: "F" | "G"): boolean {
  const notes = soundingNotes(score, hand);
  if (key === "F") return notes.some((note) => note.pitches[0].step === "B" && note.pitches[0].alteration === -1);
  const tonic = pitchesFor("G", hand)[0];
  return notes.some(
    (note) =>
      note.pitches[0].step === tonic.step &&
      note.pitches[0].octave === tonic.octave &&
      note.pitches[0].alteration === tonic.alteration,
  );
}

function pitchesStay(score: Score, hand: Hand, position: PositionId): boolean {
  const slots = pitchesFor(position, hand);
  const notes = soundingNotes(score, hand);
  return (
    notes.length > 0 &&
    notes.every(
      (note) =>
        slots.some(
          (slot) =>
            slot.step === note.pitches[0].step &&
            slot.octave === note.pitches[0].octave &&
            slot.alteration === note.pitches[0].alteration,
        ) && note.fingers?.[0] === fingerFor(position, hand, note.pitches[0]),
    )
  );
}

function shiftCount(score: Score, hand: Hand): number {
  const positions = soundingNotes(score, hand).map((note) => fingerPosition(note.pitches[0], note.fingers?.[0] ?? -1, hand));
  if (positions.length < 2 || positions[0] !== "C" || positions[positions.length - 1] !== "D-shift") return 0;
  if (positions.some((position) => position !== "C" && position !== "D-shift")) return 0;
  return positions.slice(1).filter((position, index) => position !== positions[index]).length;
}

function fingerPosition(pitch: Pitch, finger: number, hand: Hand): "C" | "D-shift" | undefined {
  let matched: "C" | "D-shift" | undefined;
  for (const position of ["C", "D-shift"] as const) {
    try {
      if (fingerFor(position, hand, pitch) === finger) matched = position;
    } catch {
      // This pitch is outside the five-finger position.
    }
  }
  return matched;
}

function hasEighthGroup(score: Score): boolean {
  for (const hand of score.hands) {
    for (const measure of score.staves[hand]?.measures ?? []) {
      let beat = 0;
      for (let index = 0; index < measure.notes.length; index++) {
        const beats = DURATION_BEATS[measure.notes[index].duration];
        const next = measure.notes[index + 1];
        if (Number.isInteger(beat) && beats === 0.5 && next && DURATION_BEATS[next.duration] === 0.5) return true;
        beat += beats;
      }
    }
  }
  return false;
}

function soundingNotes(score: Score, hand: Hand): NoteEvent[] {
  return (score.staves[hand]?.measures ?? []).flatMap((measure) => measure.notes.filter((note) => note.pitches.length > 0));
}

function soundingTotal(score: Score): number {
  return score.hands.reduce((count, hand) => count + soundingNotes(score, hand).length, 0);
}

function durationPattern(score: Score, hand: Hand): string[][] {
  return (score.staves[hand]?.measures ?? []).map((measure) => measure.notes.map((note) => note.duration));
}

function shortSpans(score: Score, hand: Hand): number[] {
  const starts: number[] = [];
  let beat = 0;
  for (const measure of score.staves[hand]?.measures ?? []) {
    for (const note of measure.notes) {
      if (note.pitches.length > 0) starts.push(beat);
      beat += DURATION_BEATS[note.duration];
    }
  }
  return starts;
}

function spansOf(score: Score, hand: Hand): { start: number; end: number }[] {
  const spans: { start: number; end: number }[] = [];
  let beat = 0;
  for (const measure of score.staves[hand]?.measures ?? []) {
    for (const note of measure.notes) {
      const length = DURATION_BEATS[note.duration];
      if (note.pitches.length > 0) spans.push({ start: beat, end: beat + length });
      beat += length;
    }
  }
  return spans;
}

function isSustained(notes: NoteEvent[]): boolean {
  return notes.length > 0 && notes.every((note) => note.duration === "h" || note.duration === "w");
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
