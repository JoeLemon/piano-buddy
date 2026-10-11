import type { Duration, Hand, Measure, Mode, NoteEvent, Pitch, Score } from "./types";
import { DURATION_BEATS, fingerFor, pitchesFor } from "./vocabulary";

const MEASURE_COUNT = 4;
const BEATS_PER_MEASURE = 4;
const MIN_SOUNDING = 8;
const MAX_ATTEMPTS = 30;

const DURATION_WEIGHTS: ReadonlyArray<{ duration: Duration; weight: number }> = [
  { duration: "q", weight: 0.7 },
  { duration: "h", weight: 0.2 },
  { duration: "qr", weight: 0.1 },
];

export function generateL1(request: { hand: Hand; seed: number; mode: Mode }): Score {
  const random = mulberry32(request.seed);
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const score = buildScore(request, random);
    if (soundingCount(score, request.hand) >= MIN_SOUNDING) return score;
  }
  throw new Error("failed to generate an L1 score");
}

function buildScore(request: { hand: Hand; seed: number; mode: Mode }, random: () => number): Score {
  const { hand, seed, mode } = request;
  const vocabulary = pitchesFor("C", hand);
  const measures = Array.from({ length: MEASURE_COUNT }, (_, measureIndex) =>
    fillMeasure(hand, vocabulary, random, measureIndex),
  );
  return {
    id: `l1-${hand}-${seed}`,
    mode,
    level: 1,
    meter: { beats: 4, beatValue: 4 },
    keySignature: "C",
    hands: [hand],
    bpm: 60,
    staves: {
      [hand]: {
        clef: hand === "RH" ? "treble" : "bass",
        measures,
      },
    },
  };
}

function fillMeasure(hand: Hand, vocabulary: Pitch[], random: () => number, measureIndex: number): Measure {
  const notes: NoteEvent[] = [];
  let remaining = BEATS_PER_MEASURE;
  while (remaining > 0) {
    const duration = drawDuration(random, remaining);
    const beats = DURATION_BEATS[duration];
    const rest = duration.endsWith("r");
    const pitch = rest ? undefined : vocabulary[Math.floor(random() * vocabulary.length)];
    const note: NoteEvent = {
      id: `${hand}-${measureIndex}-${notes.length}`,
      pitches: pitch ? [{ step: pitch.step, octave: pitch.octave, alteration: pitch.alteration }] : [],
      duration,
    };
    if (pitch) note.fingers = [fingerFor("C", hand, pitch)];
    notes.push(note);
    remaining -= beats;
  }
  return { notes };
}

/** Weights stay 0.7 / 0.2 / 0.1. A duration longer than the beats left in the bar is drawn again. */
function drawDuration(random: () => number, remaining: number): Duration {
  for (;;) {
    const roll = random();
    let cursor = 0;
    let duration: Duration = DURATION_WEIGHTS[DURATION_WEIGHTS.length - 1].duration;
    for (const choice of DURATION_WEIGHTS) {
      cursor += choice.weight;
      if (roll < cursor) {
        duration = choice.duration;
        break;
      }
    }
    if (DURATION_BEATS[duration] <= remaining) return duration;
  }
}

function soundingCount(score: Score, hand: Hand): number {
  const measures = score.staves[hand]?.measures ?? [];
  return measures.reduce(
    (count, measure) => count + measure.notes.filter((note) => note.pitches.length > 0).length,
    0,
  );
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
