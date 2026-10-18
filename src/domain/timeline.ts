import { pitchLabel, pitchToMidi } from "./pitch";
import type { Hand, NoteEvent, Score } from "./types";
import { DURATION_BEATS } from "./vocabulary";

export type TimelineNote = {
  id: string;
  midi: number;
  beat: number;
  hand: Hand;
  label: string;
  /** 该音在五指位里的指法编号（1–5），无指法时为 null。 */
  finger: number | null;
};

const HANDS: readonly Hand[] = ["RH", "LH"];

/** Sounding notes in beat order. The same beat lists RH before LH. Rests are omitted. */
export function flattenScore(score: Score): TimelineNote[] {
  const notes: TimelineNote[] = [];
  for (const hand of HANDS) {
    const measures = score.staves[hand]?.measures ?? [];
    let beat = 0;
    for (const measure of measures) {
      for (const note of measure.notes) {
        const beats = DURATION_BEATS[note.duration];
        if (!isRest(note)) {
          const pitch = note.pitches[0];
          notes.push({
            id: note.id,
            midi: pitchToMidi(pitch),
            beat,
            hand,
            label: pitchLabel(pitch),
            finger: note.fingers?.[0] ?? null,
          });
        }
        beat += beats;
      }
    }
  }
  notes.sort((a, b) => a.beat - b.beat || handOrder(a.hand, b.hand));
  return notes;
}

function handOrder(a: Hand, b: Hand): number {
  if (a === b) return 0;
  return a === "RH" ? -1 : 1;
}

function isRest(note: NoteEvent): boolean {
  return note.duration.endsWith("r") || note.pitches.length === 0;
}
