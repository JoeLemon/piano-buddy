import { flattenScore, type TimelineNote } from "./timeline";
import type { Hand, Level, Score } from "./types";

export type PlayedNote = { midi: number; timeMs: number };

export type CompareResult = {
  pitchErrors: number;
  rhythmBreaks: number;
  firstWrongLabel: string | null;
  wrongPitchNoteIds: string[];
  lateNoteIds: string[];
};

const PASS_LIMIT: Partial<Record<Level, number>> = { 1: 2, 2: 2 };

export function compare(
  score: Score,
  hand: Hand | "BOTH",
  played: PlayedNote[],
  bpm: number,
): CompareResult {
  const notes = hand === "BOTH" || score.hands.length === 2
    ? flattenScore(score)
    : flattenScore({ ...score, staves: { [hand]: score.staves[hand] } });
  return scoreNotes(notes, played, bpm);
}

function scoreNotes(
  notes: TimelineNote[],
  played: PlayedNote[],
  bpm: number,
): CompareResult {
  let cursor = 0;
  let pitchErrors = 0;
  let rhythmBreaks = 0;
  let firstWrongLabel: string | null = null;
  const wrongPitchNoteIds: string[] = [];
  const lateNoteIds: string[] = [];

  for (const note of notes) {
    const hit = played[cursor];
    if (hit) cursor += 1;
    if (!hit || hit.midi !== note.midi) {
      pitchErrors += 1;
      wrongPitchNoteIds.push(note.id);
      if (firstWrongLabel === null) firstWrongLabel = note.label;
    }
    if (hit && hit.timeMs / (60000 / bpm) - note.beat > 2) {
      rhythmBreaks += 1;
      lateNoteIds.push(note.id);
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
