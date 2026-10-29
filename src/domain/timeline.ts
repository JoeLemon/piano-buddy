import { pitchLabel, pitchToMidi } from "./pitch";
import { sameMidis, tiesFrom, tiesTo } from "./tie";
import type { Hand, NoteEvent, Score } from "./types";
import { DURATION_BEATS } from "./vocabulary";

export type TimelineNote = {
  id: string;
  midi: number;
  beat: number;
  /** 目标时值（拍）。音长判定用：按住不足六成算「按得太短」。 */
  beats: number;
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
    // 连音线的起点：后续段不产生新音，只是把时值接上去（见 domain/tie.ts）。
    let open: TimelineNote | null = null;
    for (const measure of measures) {
      for (const note of measure.notes) {
        const beats = DURATION_BEATS[note.duration];
        if (!isRest(note)) {
          const pitch = note.pitches[0];
          if (tiesFrom(note) && open && sameMidis([open.midi], [pitchToMidi(pitch)])) {
            open.beats += beats;
            if (!tiesTo(note)) open = null;
          } else {
            const entry: TimelineNote = {
              id: note.id,
              midi: pitchToMidi(pitch),
              beat,
              beats,
              hand,
              label: pitchLabel(pitch),
              finger: note.fingers?.[0] ?? null,
            };
            notes.push(entry);
            open = tiesTo(note) ? entry : null;
          }
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
