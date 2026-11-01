import { identifyChord, isDiminishedQuality, isSeventhQuality, isTriadQuality } from "./chords";
import { pitchToMidi } from "./pitch";
import { measureBudget, pickupErrors } from "./pickup";
import { repeatErrors } from "./repeats";
import { samePitches, tieErrors } from "./tie";
import { tupletErrors } from "./tuplets";
import type { Clef, Hand, KeySignature, NoteEvent, Pitch, Score, Step } from "./types";
import {
  LEVEL_SPEC,
  TRIADS,
  expansionPitches,
  keyAlteration,
  noteBeats,
  pitchesFor,
  type LevelSpec,
} from "./vocabulary";

const STEP_INDEX: Record<Step, number> = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };

export function isAllowed(score: Score): boolean {
  const spec = LEVEL_SPEC[score.level];
  if (!spec) return false;
  // 连音线自洽与词汇表无关，单独判（见 domain/tie.ts）。
  if (tieErrors(score).length > 0) return false;
  // 弱起同理：首小节拍数与 pickup 声明的自洽性先判（见 domain/pickup.ts）。
  if (pickupErrors(score).length > 0) return false;
  // 反复/导航写错会让演奏顺序不可预测，和连音线断线同级（见 domain/repeats.ts）。
  if (repeatErrors(score).length > 0) return false;
  // 三连音组不完整会让拍数永远差 1/3，先判结构（见 domain/tuplets.ts）。
  if (tupletErrors(score).length > 0) return false;
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
    for (let index = 0; index < stave.measures.length; index += 1) {
      const measure = stave.measures[index];
      let beats = 0;
      for (const note of measure.notes) {
        if (!spec.durations.includes(note.duration)) return false;
        if (note.tuplet !== undefined && !spec.tuplets) return false;
        beats += noteBeats(note);
        if (isRest(note.duration)) {
          if (note.pitches.length !== 0) return false;
          continue;
        }
        if (!soundingNoteOk(note, hand, clef, score.keySignature, spec, previous)) return false;
        previous = note.pitches;
      }
      // 弱起小节只要求填满它自己的拍数，其余小节仍是整小节。三连音会带来
      // 1/3 拍，不能再用整数十六分音符比较。
      if (Math.abs(beats - measureBudget(score, index)) > 1e-6) return false;
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
  if (pitches.length < 2 || pitches.length > spec.maxChordSize) return false;
  if (pitches.length === 2) return intervalShapeOk(pitches);

  const info = identifyChord(pitches);
  if (!info) return false;

  if (isTriadQuality(info.quality)) {
    if (!triadShapeOk(pitches)) return false;
    // 八度重复根音的四音三和弦（C4–E4–G4–C5）已经不是五指位形状了：
    // 它只能按总跨度判，并且要 L5 起才开放。
    if (info.doubled) {
      return spec.doubledRoot && chordSpanOk(pitches);
    }
    // 原位三和弦仍要求整只手能放在一个五指位（含两端扩张）；转位会让
    // 和弦音跨出手位，改看总跨度，具体指法交给 fingering.ts 求解。
    if (info.inversion > 0) {
      return spec.inversions && chordSpanOk(pitches);
    }
    return chordFitsPosition(pitches, hand, key, spec);
  }

  // 七和弦：L5 起开放。四个音很难同时落在同一个五指位里（C4–E4–G4–B4
  // 已经跨到 B4），所以只限制总跨度和每个音是否在词汇表里；每个音已经由
  // soundingNoteOk() 的 pitchInVocabulary() 检查过。减七/半减七更晚一档：
  // 它们还要求 `chord.diminished`（L6）。
  if (isSeventhQuality(info.quality)) {
    if (isDiminishedQuality(info.quality) && !spec.diminished) return false;
    return spec.sevenths && chordSpanOk(pitches);
  }

  return false;
}

function intervalShapeOk(pitches: Pitch[]): boolean {
  const steps = new Set(pitches.map((pitch) => pitch.step));
  const interval = Math.abs(pitchToMidi(pitches[0]) - pitchToMidi(pitches[1]));
  if (interval !== 3 && interval !== 4 && interval !== 7) return false;
  return TRIADS.some((chord) => [...steps].every((step) => chord.includes(step)));
}

/**
 * 三和弦形状：三个**不同音级**正好凑成 `TRIADS` 里的一条。
 *
 * 允许八度重复（四个音、三个音级）：柱式和弦里重复根音很常见，一刀切拒绝
 * 会让编配只能写三个音。重复必须是同一个音级的八度重复——两个不同音级
 * 拼成同一个音（B♯ 与 C）会在这里被音级集合挡住。
 */
function triadShapeOk(pitches: Pitch[]): boolean {
  const steps = new Set(pitches.map((pitch) => pitch.step));
  if (steps.size !== 3) return false;
  if (pitches.length > 3 && pitches.length !== 4) return false;
  return TRIADS.some((chord) => chord.length === 3 && chord.every((step) => steps.has(step)));
}

/** 和弦总跨度不超过一个八度；七和弦原位正好 11 个半音。 */
function chordSpanOk(pitches: Pitch[]): boolean {
  const midis = pitches.map(pitchToMidi).sort((a, b) => a - b);
  return midis[midis.length - 1] - midis[0] <= 12;
}

function chordFitsPosition(pitches: Pitch[], hand: Hand, key: KeySignature, spec: LevelSpec): boolean {
  return spec.positions.some((position) => {
    const slots = pitchesFor(position, hand);
    // 小调主和弦常落在五指位边缘（A 小调的 A–C–E、E 小调的 E–G–B），
    // 到 L4 手位两端扩张已经允许，和弦也应能用同一个手位的扩张键。
    const expansions = spec.expandEnds ? expansionPitches(position, hand) : [];
    return pitches.every(
      (pitch) =>
        slots.some((slot) => slotAccepts(pitch, slot, key, spec)) ||
        expansions.some((slot) => slotAccepts(pitch, slot, key, spec)),
    );
  });
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

function isRest(duration: NoteEvent["duration"]): boolean {
  return duration.endsWith("r");
}
