import { pitchLabel, pitchToMidi } from "./pitch";
import type { Hand, Level, NoteEvent, Score } from "./types";
import { DURATION_BEATS } from "./vocabulary";

export type PlayedNote = { midi: number; timeMs: number };

export type CompareResult = {
  pitchErrors: number;
  rhythmBreaks: number;
  firstWrongLabel: string | null;
  wrongPitchNoteIds: string[];
  lateNoteIds: string[];
};

const PASS_LIMIT: Partial<Record<Level, number>> = { 1: 2 };

export function compare(
  score: Score,
  hand: Hand,
  played: PlayedNote[],
  bpm: number,
): CompareResult {
  const measures = score.staves[hand]?.measures ?? [];
  let beat = 0;
  let cursor = 0;
  let pitchErrors = 0;
  let rhythmBreaks = 0;
  let firstWrongLabel: string | null = null;
  const wrongPitchNoteIds: string[] = [];
  const lateNoteIds: string[] = [];

  for (const measure of measures) {
    for (const note of measure.notes) {
      const beats = DURATION_BEATS[note.duration];
      if (isRest(note)) {
        beat += beats;
        continue;
      }
      const pitch = note.pitches[0];
      const hit = played[cursor];
      if (hit) cursor += 1;
      if (!hit || hit.midi !== pitchToMidi(pitch)) {
        pitchErrors += 1;
        wrongPitchNoteIds.push(note.id);
        if (firstWrongLabel === null) firstWrongLabel = pitchLabel(pitch);
      }
      if (hit && hit.timeMs / (60000 / bpm) - beat > 2) {
        rhythmBreaks += 1;
        lateNoteIds.push(note.id);
      }
      beat += beats;
    }
  }

  return { pitchErrors, rhythmBreaks, firstWrongLabel, wrongPitchNoteIds, lateNoteIds };
}

export function passLimit(level: Level): number {
  const limit = PASS_LIMIT[level];
  if (limit === undefined) throw new Error(`pass limit is not defined for level ${level}`);
  return limit;
}

export function isPass(result: CompareResult, level: Level): boolean {
  return result.pitchErrors <= passLimit(level) && result.rhythmBreaks < 2;
}

function isRest(note: NoteEvent): boolean {
  return note.duration.endsWith("r") || note.pitches.length === 0;
}
