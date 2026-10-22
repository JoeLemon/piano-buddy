import { pitchLabel, pitchToMidi } from "./pitch";
import type { Hand, NoteEvent, Score } from "./types";
import { DURATION_BEATS } from "./vocabulary";

/**
 * 一次按键要同时按下的音。单音是长度 1，和弦/双音是长度 2–3。
 *
 * `flattenScore` 是给「逐音」评测用的，遇到和弦只取第一个音；视奏、过关和
 * 曲库跟弹需要知道「这一拍要按哪几个键」，所以单独保留事件级视图。
 */
export type ScoreEvent = {
  id: string;
  hand: Hand;
  beat: number;
  /** 升序排列的 MIDI，便于直接和一组按键做集合比较。 */
  midis: number[];
  labels: string[];
  fingers: (number | null)[];
  duration: NoteEvent["duration"];
};

const HANDS: readonly Hand[] = ["RH", "LH"];

export function scoreEvents(score: Score, hand?: Hand | "BOTH"): ScoreEvent[] {
  const events: ScoreEvent[] = [];
  const hands: readonly Hand[] = hand && hand !== "BOTH"
    ? [hand]
    : [...score.hands].sort((a, b) => (a === b ? 0 : a === "RH" ? -1 : 1));

  for (const current of hands) {
    const measures = score.staves[current]?.measures ?? [];
    let beat = 0;
    for (const measure of measures) {
      for (const note of measure.notes) {
        if (!isRest(note)) {
          const pitches = [...note.pitches].sort(
            (a, b) => pitchToMidi(a) - pitchToMidi(b),
          );
          events.push({
            id: note.id,
            hand: current,
            beat,
            midis: pitches.map((pitch) => pitchToMidi(pitch)),
            // labels/fingers 保持谱面书写顺序，键盘提示按书写顺序显示。
            labels: note.pitches.map((pitch) => pitchLabel(pitch)),
            fingers: note.pitches.map((_, index) => note.fingers?.[index] ?? null),
            duration: note.duration,
          });
        }
        beat += DURATION_BEATS[note.duration];
      }
    }
  }

  return events.sort((a, b) => a.beat - b.beat || handOrder(a.hand, b.hand));
}

function handOrder(a: Hand, b: Hand): number {
  if (a === b) return 0;
  return a === "RH" ? -1 : 1;
}

function isRest(note: NoteEvent): boolean {
  return note.duration.endsWith("r") || note.pitches.length === 0;
}
