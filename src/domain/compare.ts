import { scoreBeats } from "./scoreBeats";
import { scoreEvents } from "./scoreEvents";
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

const PASS_LIMIT: Partial<Record<Level, number>> = { 1: 2, 2: 2, 3: 3 };

/** 和弦/双音允许的「同时按下」窗口；超过这个间隔就当两组分开的按键。 */
const CHORD_WINDOW_MS = 180;

export function compare(
  score: Score,
  hand: Hand | "BOTH",
  played: PlayedNote[],
  bpm: number,
): CompareResult {
  const events = scoreEvents(score, hand);
  if (events.some((event) => event.midis.length > 1)) {
    return compareEvents(events, played, bpm);
  }

  // 没有和弦的谱子继续走原来的逐音路径，保证 L1/L2 的判定和旧行为一致。
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

/**
 * 和弦路径：把时间上相邻的按键合成一组，再和「这一拍要按的音」做集合比较。
 *
 * 只按对和弦里的一个音仍然算一次错，但不会把一个三和弦拆成三个错误，
 * 否则 L3 的通过线会被一个和弦直接打穿。
 */
function compareEvents(
  events: ReturnType<typeof scoreEvents>,
  played: PlayedNote[],
  bpm: number,
): CompareResult {
  const groups = groupPlayed(played);
  const beats = scoreBeats(events);
  let pitchErrors = 0;
  let rhythmBreaks = 0;
  let firstWrongLabel: string | null = null;
  const wrongPitchNoteIds: string[] = [];
  const lateNoteIds: string[] = [];

  beats.forEach((beat, index) => {
    const group = groups[index];
    const ok = group !== undefined && sameMidiSet(group, beat.midis);
    if (!ok) {
      pitchErrors += 1;
      wrongPitchNoteIds.push(...beat.ids);
      if (firstWrongLabel === null) {
        firstWrongLabel = beat.events.flatMap((event) => event.labels).join("+");
      }
    }
    const firstTime = group?.[0]?.timeMs;
    if (firstTime !== undefined && firstTime / (60000 / bpm) - beat.beat > 2) {
      rhythmBreaks += 1;
      lateNoteIds.push(...beat.ids);
    }
  });

  return { pitchErrors, rhythmBreaks, firstWrongLabel, wrongPitchNoteIds, lateNoteIds };
}

function groupPlayed(played: PlayedNote[]): PlayedNote[][] {
  const sorted = [...played].sort((a, b) => a.timeMs - b.timeMs);
  const groups: PlayedNote[][] = [];
  for (const note of sorted) {
    const group = groups[groups.length - 1];
    const last = group?.[group.length - 1];
    if (!group || !last || note.timeMs - last.timeMs > CHORD_WINDOW_MS) {
      groups.push([note]);
    } else {
      group.push(note);
    }
  }
  return groups;
}

function sameMidiSet(group: PlayedNote[], midis: number[]): boolean {
  const playedSet = new Set(group.map((note) => note.midi));
  if (playedSet.size !== midis.length) return false;
  return midis.every((midi) => playedSet.has(midi));
}

export function passLimit(level: Level): number {
  const limit = PASS_LIMIT[level];
  if (limit === undefined) throw new Error(`pass limit is not defined for level ${level}`);
  return limit;
}

export function isPass(result: CompareResult, level: Level): boolean {
  return result.pitchErrors <= passLimit(level) && result.rhythmBreaks < 2;
}
