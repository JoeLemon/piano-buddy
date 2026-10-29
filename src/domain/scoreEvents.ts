import { pitchLabel, pitchToMidi } from "./pitch";
import { sameMidis, tiesFrom, tiesTo } from "./tie";
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
  /**
   * 实际要按住的拍数。
   *
   * 平时等于 `duration` 查表的结果；带连音线时会把后续段并进来，比谱面上
   * 单个音符长。判定音长一律读这个字段，别再拿 `duration` 查表——否则
   * 跨小节的延音会被判成「按得太短」。
   */
  beats: number;
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
    /**
     * 当前还开着口的连音线起点。带着 `start`/`continue` 的音会把这条线留给
     * 下一个音；遇到任何不带 tie 的音就自动闭合，所以「stop 必须紧邻」这条
     * 记谱约束在这里是天然的。
     */
    let open: { event: ScoreEvent; midis: number[] } | null = null;
    for (const measure of measures) {
      for (const note of measure.notes) {
        if (!isRest(note)) {
          const noteMidis = note.pitches.map((pitch) => pitchToMidi(pitch));
          if (tiesFrom(note) && open && sameMidis(open.midis, noteMidis)) {
            // 承接前音：不产生新的按键，只把时值接上去。
            open.event.beats += DURATION_BEATS[note.duration];
            if (!tiesTo(note)) open = null;
          } else {
            const pitches = [...note.pitches].sort(
              (a, b) => pitchToMidi(a) - pitchToMidi(b),
            );
            const event: ScoreEvent = {
              id: note.id,
              hand: current,
              beat,
              midis: pitches.map((pitch) => pitchToMidi(pitch)),
              // labels/fingers 保持谱面书写顺序，键盘提示按书写顺序显示。
              labels: note.pitches.map((pitch) => pitchLabel(pitch)),
              fingers: note.pitches.map((_, index) => note.fingers?.[index] ?? null),
              duration: note.duration,
              beats: DURATION_BEATS[note.duration],
            };
            events.push(event);
            open = tiesTo(note) ? { event, midis: event.midis } : null;
          }
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
