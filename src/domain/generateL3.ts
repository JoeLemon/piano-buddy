import { isAllowed } from "./allowed";
import { annotateScore } from "./fingering";
import type {
  Duration,
  Hand,
  KeySignature,
  Measure,
  Mode,
  NoteEvent,
  Pitch,
  PositionId,
  Score,
} from "./types";
import { fingerFor, pitchesFor } from "./vocabulary";

/**
 * L3 识谱课/过关用的生成器。
 *
 * L1 是单手单音，L2 是双手单音；L3 第一次出现「同时按多个键」，所以生成器要能
 * 产出双音、三和弦与带临时记号的谱子。约束由 `isAllowed` 把关：L3 词汇表限制
 * 在 C/F/G 三个调、C/D-shift/F/G 四个手位，和弦必须是三度叠置。
 *
 * 形状：
 * - interval：单手双音（三度/五度），练「和弦里只按两个键」；
 * - triad：单手三和弦（右手课 / 左手课）；
 * - accidental：单手临时升降，含升、降与还原；
 * - test / sight：双手，左手三和弦铺底，右手带一个临时记号。
 */
export type L3Shape =
  | { kind: "interval"; hand: Hand }
  | { kind: "triad"; hand: Hand }
  | { kind: "accidental"; hand: Hand }
  | { kind: "test" }
  | { kind: "sight" };

const MEASURE_COUNT = 4;
const MAX_ATTEMPTS = 30;
const LESSON_KEYS: readonly KeySignature[] = ["C", "F", "G"];

/** 双音课可选的三度/五度：手位 + 音级下标对。 */
const INTERVAL_SETS: readonly { position: PositionId; pairs: readonly [number, number][] }[] = [
  { position: "C", pairs: [[0, 2], [0, 4], [2, 4]] },
  { position: "F", pairs: [[0, 2], [0, 4], [2, 4]] },
  { position: "G", pairs: [[0, 2], [0, 4], [2, 4]] },
];

/** 三和弦根音位置：手位 + 音级下标 [根, 三音, 五音]。 */
const TRIAD_ROOTS: readonly { position: PositionId; key: KeySignature; steps: readonly [number, number, number] }[] = [
  { position: "C", key: "C", steps: [0, 2, 4] },
  { position: "F", key: "F", steps: [0, 2, 4] },
  { position: "G", key: "G", steps: [0, 2, 4] },
];

export function generateL3(request: { seed: number; mode: Mode; shape: L3Shape }): Score {
  const random = mulberry32(request.seed);
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const score = buildScore(request, random);
    if (isAllowed(score) && shapeFits(score, request.shape)) return score;
  }
  throw new Error(`failed to generate an L3 score for ${request.shape.kind}`);
}

function buildScore(request: { seed: number; mode: Mode; shape: L3Shape }, random: () => number): Score {
  const { mode, seed, shape } = request;
  switch (shape.kind) {
    case "interval":
      return assembled(assemble(scoreId(shape, seed), mode, "C", [shape.hand], {
        [shape.hand]: intervalMeasures(shape.hand, random),
      }));
    case "triad": {
      const root = TRIAD_ROOTS[Math.floor(random() * TRIAD_ROOTS.length)];
      return assembled(assemble(scoreId(shape, seed), mode, root.key, [shape.hand], {
        [shape.hand]: triadMeasures(shape.hand, root, random),
      }));
    }
    case "accidental": {
      const key = LESSON_KEYS[Math.floor(random() * LESSON_KEYS.length)];
      return assembled(assemble(scoreId(shape, seed), mode, key, [shape.hand], {
        [shape.hand]: accidentalMeasures(shape.hand, key, random),
      }));
    }
    case "test":
    case "sight": {
      const key = LESSON_KEYS[Math.floor(random() * LESSON_KEYS.length)];
      return assembled(assemble(scoreId(shape, seed), mode, key, ["RH", "LH"], {
        RH: rightMeasures(key, random),
        LH: leftMeasures(key, random),
      }));
    }
  }
}

function scoreId(shape: L3Shape, seed: number): string {
  const base = `l3-${shape.kind}-${seed}`;
  if (shape.kind === "interval" || shape.kind === "triad" || shape.kind === "accidental") {
    return `${base}-${shape.hand}`;
  }
  return base;
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
    level: 3,
    meter: { beats: 4, beatValue: 4 },
    keySignature: key,
    hands,
    bpm: 60,
    staves,
  };
}

function assembled(score: Score): Score {
  return annotateScore(score);
}

/** 双音课：每小节两个二分音符和弦（三度或五度），全在五指位里。 */
function intervalMeasures(hand: Hand, random: () => number): Measure[] {
  const set = INTERVAL_SETS[Math.floor(random() * INTERVAL_SETS.length)];
  const vocab = pitchesFor(set.position, hand);
  return Array.from({ length: MEASURE_COUNT }, (_, measureIndex) => {
    const notes: NoteEvent[] = [0, 1].map((slot) => {
      const pair = set.pairs[Math.floor(random() * set.pairs.length)];
      const pitches = pair.map((index) => clone(vocab[index]));
      return note(
        `${hand}-${measureIndex}-${slot}`,
        "h",
        pitches,
        set.position,
        hand,
      );
    });
    return { notes };
  });
}

/** 三和弦课：每小节一个整小节三和弦或两个二分音符三和弦，根音位置。 */
function triadMeasures(
  hand: Hand,
  root: { position: PositionId; steps: readonly [number, number, number] },
  random: () => number,
): Measure[] {
  const vocab = pitchesFor(root.position, hand);
  const pitches = root.steps.map((index) => clone(vocab[index]));
  return Array.from({ length: MEASURE_COUNT }, (_, measureIndex) => {
    const twoHalf = random() < 0.5;
    const durations: Duration[] = twoHalf ? ["h", "h"] : ["w"];
    const notes = durations.map((duration, slot) =>
      note(`${hand}-${measureIndex}-${slot}`, duration, pitches.map(clone), root.position, hand),
    );
    return { notes };
  });
}

/**
 * 临时升降课：每小节两个二分音符，8 个音里至少有一个升/降与一个还原。
 *
 * key C 用「升号后接同音高还原」展示还原；key F/G 用调号音与还原音对比。
 */
function accidentalMeasures(hand: Hand, key: KeySignature, random: () => number): Measure[] {
  const sequence = accidentalSequence(hand, key);
  void random;
  return Array.from({ length: MEASURE_COUNT }, (_, measureIndex) => {
    const notes = [0, 1].map((slot) => {
      const index = measureIndex * 2 + slot;
      const pitch = sequence[index % sequence.length];
      return note(
        `${hand}-${measureIndex}-${slot}`,
        "h",
        [pitch],
        pitchPosition(pitch, hand),
        hand,
      );
    });
    return { notes };
  });
}

function accidentalSequence(hand: Hand, key: KeySignature): Pitch[] {
  const c = pitchesFor("C", hand);
  const f = pitchesFor("F", hand);
  const g = pitchesFor("G", hand);
  const at = (vocab: readonly Pitch[], index: number, alteration: -1 | 0 | 1): Pitch => ({
    ...vocab[index],
    alteration,
  });
  if (key === "G") {
    // F 在 G 调里是升号，F4(还原) 要显式画还原记号；G# 是调外升号。
    return [
      at(c, 3, 0),       // F natural
      at(g, 0, 1),       // G#
      at(g, 0, 0),       // G
      at(c, 3, 1),       // F#
      at(c, 3, 0),       // F natural
      at(g, 1, 0),       // A
      at(g, 4, 0),       // D
      at(g, 0, 0),       // G
    ];
  }
  if (key === "F") {
    // B 在 F 调里是降号，B4(还原) 要显式画还原记号；F# 是调外升号。
    return [
      at(f, 1, -1),      // Bb
      at(g, 2, 0),       // B natural
      at(c, 3, 1),       // F#
      at(f, 0, 0),       // F
      at(g, 2, 0),       // B natural
      at(f, 2, 0),       // A
      at(f, 4, 0),       // C5
      at(f, 1, -1),      // Bb
    ];
  }
  // key C：升号后接同音高还原，展示临时记号的「本小节内」规则。
  return [
    at(c, 0, 1),       // C#
    at(c, 0, 0),       // C natural
    at(c, 1, 1),       // D#
    at(c, 1, 0),       // D natural
    at(c, 3, 1),       // F#
    at(c, 3, 0),       // F natural
    at(c, 4, 1),       // G#
    at(c, 4, 0),       // G natural
  ];
}

/** 临时音的手位：优先用能覆盖该音高的手位，取不到就落到 C。 */
function pitchPosition(pitch: Pitch, hand: Hand): PositionId {
  for (const position of ["C", "D-shift", "F", "G"] as const) {
    if (pitchesFor(position, hand).some((slot) => slot.step === pitch.step && slot.octave === pitch.octave)) {
      return position;
    }
  }
  return "C";
}

/** 过关/视奏右手：一个三和弦 + 一个临时记号，其余为单音。 */
function rightMeasures(key: KeySignature, random: () => number): Measure[] {
  const position: PositionId = key === "F" ? "F" : key === "G" ? "G" : "C";
  const vocab = pitchesFor(position, "RH");
  const triad = [clone(vocab[0]), clone(vocab[2]), clone(vocab[4])];
  const accidental = rightAccidental(key);
  const walk = () => clone(vocab[Math.floor(random() * vocab.length)]);
  return [
    { notes: ["q", "q", "q", "q"].map((duration, index) => note(`RH-0-${index}`, duration as Duration, [walk()], position, "RH")) },
    {
      notes: [
        note("RH-1-0", "h", triad.map(clone), position, "RH"),
        note("RH-1-1", "h", [walk()], position, "RH"),
      ],
    },
    {
      notes: [
        note("RH-2-0", "q", [walk()], position, "RH"),
        note("RH-2-1", "q", [accidental], pitchPosition(accidental, "RH"), "RH"),
        note("RH-2-2", "q", [walk()], position, "RH"),
        note("RH-2-3", "q", [walk()], position, "RH"),
      ],
    },
    {
      notes: [
        note("RH-3-0", "h", [walk()], position, "RH"),
        note("RH-3-1", "h", [walk()], position, "RH"),
      ],
    },
  ];
}

/** 过关/视奏左手：每小节一个三和弦铺底。 */
function leftMeasures(key: KeySignature, random: () => number): Measure[] {
  const position: PositionId = key === "F" ? "F" : key === "G" ? "G" : "C";
  const vocab = pitchesFor(position, "LH");
  const triad = [clone(vocab[0]), clone(vocab[2]), clone(vocab[4])];
  return Array.from({ length: MEASURE_COUNT }, (_, measureIndex) => {
    const twoHalf = random() < 0.5;
    const durations: Duration[] = twoHalf ? ["h", "h"] : ["w"];
    return {
      notes: durations.map((duration, slot) =>
        note(`LH-${measureIndex}-${slot}`, duration, triad.map(clone), position, "LH"),
      ),
    };
  });
}

function rightAccidental(key: KeySignature): Pitch {
  if (key === "G") return { step: "F", octave: 4, alteration: 0 };
  if (key === "F") return { step: "B", octave: 4, alteration: 0 };
  return { step: "F", octave: 4, alteration: 1 };
}


function note(
  id: string,
  duration: Duration,
  pitches: Pitch[],
  position: PositionId,
  hand: Hand,
): NoteEvent {
  return {
    id,
    duration,
    pitches,
    fingers: pitches.map((pitch, index) => safeFinger(position, hand, pitch, index)),
  };
}

function safeFinger(position: PositionId, hand: Hand, pitch: Pitch, index: number): number {
  try {
    return fingerFor(position, hand, pitch);
  } catch {
    return index + 1;
  }
}

function clone(pitch: Pitch): Pitch {
  return { step: pitch.step, octave: pitch.octave, alteration: pitch.alteration };
}

function shapeFits(score: Score, shape: L3Shape): boolean {
  switch (shape.kind) {
    case "interval":
      return singleHand(score, shape.hand)
        && hasChord(score)
        && soundingNotes(score, shape.hand).every((note) => note.pitches.length === 2);
    case "triad":
      return singleHand(score, shape.hand)
        && soundingNotes(score, shape.hand).every((note) => note.pitches.length === 3);
    case "accidental":
      return singleHand(score, shape.hand)
        && accidentalCount(score, shape.hand) >= 2
        && soundingNotes(score, shape.hand).every((note) => note.pitches.length === 1);
    case "test":
    case "sight":
      return bothHands(score)
        && hasChord(score)
        && accidentalCount(score) >= 1
        && soundingTotal(score) >= 8;
  }
}

function singleHand(score: Score, hand: Hand): boolean {
  return score.hands.length === 1 && score.hands[0] === hand;
}

function bothHands(score: Score): boolean {
  return score.hands.length === 2 && score.staves.RH !== undefined && score.staves.LH !== undefined;
}

function hasChord(score: Score): boolean {
  return score.hands.some((hand) => soundingNotes(score, hand).some((note) => note.pitches.length > 1));
}

function accidentalCount(score: Score, hand?: Hand): number {
  const hands = hand ? [hand] : score.hands;
  let count = 0;
  for (const current of hands) {
    for (const note of soundingNotes(score, current)) {
      for (const pitch of note.pitches) {
        if (pitch.alteration !== keyAlterationSafe(score.keySignature, pitch.step)) count += 1;
      }
    }
  }
  return count;
}

function keyAlterationSafe(key: KeySignature, step: Pitch["step"]): -1 | 0 | 1 {
  if (key === "F" && step === "B") return -1;
  if (key === "G" && step === "F") return 1;
  return 0;
}

function soundingNotes(score: Score, hand: Hand): NoteEvent[] {
  return (score.staves[hand]?.measures ?? []).flatMap((measure) =>
    measure.notes.filter((note) => note.pitches.length > 0),
  );
}

function soundingTotal(score: Score): number {
  return score.hands.reduce((count, hand) => count + soundingNotes(score, hand).length, 0);
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
