import { pitchToMidi } from "./pitch";
import type { Clef, Duration, Hand, KeySignature, NoteEvent, Pitch, Score, Step } from "./types";
import {
  DURATION_BEATS,
  LEVEL_SPEC,
  TRIADS,
  expansionPitches,
  keyAlteration,
  pitchesFor,
  type LevelSpec,
} from "./vocabulary";

const STEP_INDEX: Record<Step, number> = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };

export function isAllowed(score: Score): boolean {
  const spec = LEVEL_SPEC[score.level];
  if (!spec) return false;
  if (score.hands.length < 1 || score.hands.length > 2) return false;
  if (spec.singleHand && score.hands.length !== 1) return false;
  if (new Set(score.hands).size !== score.hands.length) return false;
  if (!spec.meters.some((meter) => meter.beats === score.meter.beats && meter.beatValue === score.meter.beatValue)) {
    return false;
  }
  if (!spec.keys.includes(score.keySignature)) return false;

  const usedHands = (Object.keys(score.staves) as Hand[]).filter((hand) => score.staves[hand]);
  if (usedHands.length !== score.hands.length) return false;
  if (usedHands.some((hand) => !score.hands.includes(hand))) return false;

  for (const hand of score.hands) {
    const stave = score.staves[hand];
    if (!stave) return false;
    const clef: Clef = hand === "RH" ? "treble" : "bass";
    if (stave.clef !== clef) return false;

    let previous: Pitch[] | null = null;
    for (const measure of stave.measures) {
      let sixteenths = 0;
      for (const note of measure.notes) {
        if (!spec.durations.includes(note.duration)) return false;
        sixteenths += durationSixteenths(note.duration);
        if (isRest(note.duration)) {
          if (note.pitches.length !== 0) return false;
          continue;
        }
        if (!soundingNoteOk(note, hand, clef, score.keySignature, spec, previous)) return false;
        previous = note.pitches;
      }
      if (sixteenths !== score.meter.beats * 4) return false;
    }
  }
  return true;
}

function soundingNoteOk(
  note: NoteEvent,
  hand: Hand,
  clef: Clef,
  key: KeySignature,
  spec: LevelSpec,
  previous: Pitch[] | null,
): boolean {
  if (note.pitches.length === 0 || note.pitches.length > spec.maxChordSize) return false;
  if (note.pitches.length > 1 && !chordOk(note.pitches, hand, key, spec)) return false;
  for (const pitch of note.pitches) {
    if (!alterationOk(pitch, key, spec)) return false;
    if (ledgerCapApplies(spec) && ledgerLines(clef, pitch) > spec.maxLedgerLines) return false;
    if (!pitchInVocabulary(pitch, hand, clef, key, spec)) return false;
  }
  if (spec.maxLeap !== null && previous && leapSemitones(previous, note.pitches) > spec.maxLeap) return false;
  return true;
}

function chordOk(pitches: Pitch[], hand: Hand, key: KeySignature, spec: LevelSpec): boolean {
  if (pitches.length < 2 || pitches.length > 3) return false;
  if (!triadShapeOk(pitches)) return false;
  return spec.positions.some((position) =>
    pitches.every((pitch) => pitchesFor(position, hand).some((slot) => slotAccepts(pitch, slot, key, spec))),
  );
}

function triadShapeOk(pitches: Pitch[]): boolean {
  const steps = new Set(pitches.map((pitch) => pitch.step));
  if (pitches.length === 3) {
    return TRIADS.some((chord) => chord.length === steps.size && chord.every((step) => steps.has(step)));
  }
  const interval = Math.abs(pitchToMidi(pitches[0]) - pitchToMidi(pitches[1]));
  if (interval !== 3 && interval !== 4 && interval !== 7) return false;
  return TRIADS.some((chord) => [...steps].every((step) => chord.includes(step)));
}

function ledgerCapApplies(spec: LevelSpec): boolean {
  return spec.ledgerWindow || !spec.expandEnds;
}

function alterationOk(pitch: Pitch, key: KeySignature, spec: LevelSpec): boolean {
  if (spec.accidentals) return true;
  return pitch.alteration === keyAlteration(key, pitch.step);
}

function pitchInVocabulary(pitch: Pitch, hand: Hand, clef: Clef, key: KeySignature, spec: LevelSpec): boolean {
  for (const position of spec.positions) {
    if (pitchesFor(position, hand).some((slot) => slotAccepts(pitch, slot, key, spec))) return true;
    if (!spec.expandEnds) continue;
    const [below, above] = expansionPitches(position, hand);
    if (slotAccepts(pitch, below, key, spec) || slotAccepts(pitch, above, key, spec)) return true;
  }
  return spec.ledgerWindow && ledgerLines(clef, pitch) <= spec.maxLedgerLines;
}

function slotAccepts(pitch: Pitch, slot: Pitch, key: KeySignature, spec: LevelSpec): boolean {
  if (pitch.step !== slot.step || pitch.octave !== slot.octave) return false;
  if (spec.accidentals) return true;
  if (pitch.alteration !== keyAlteration(key, pitch.step)) return false;
  if (pitch.alteration === slot.alteration) return true;
  return slot.alteration === 0 && pitch.alteration !== 0;
}

function leapSemitones(left: Pitch[], right: Pitch[]): number {
  let max = 0;
  for (const from of left) {
    for (const to of right) {
      max = Math.max(max, Math.abs(pitchToMidi(from) - pitchToMidi(to)));
    }
  }
  return max;
}

function ledgerLines(clef: Clef, pitch: Pitch): number {
  const diatonic = pitch.octave * 7 + STEP_INDEX[pitch.step];
  const bottom = clef === "treble" ? 4 * 7 + STEP_INDEX.E : 2 * 7 + STEP_INDEX.G;
  const top = clef === "treble" ? 5 * 7 + STEP_INDEX.F : 3 * 7 + STEP_INDEX.A;
  if (diatonic < bottom) return Math.floor((bottom - diatonic) / 2);
  if (diatonic > top) return Math.floor((diatonic - top) / 2);
  return 0;
}

function durationSixteenths(duration: Duration): number {
  return Math.round(DURATION_BEATS[duration] * 4);
}

function isRest(duration: Duration): boolean {
  return duration.endsWith("r");
}
