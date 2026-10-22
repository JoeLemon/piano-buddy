import type { ScoreEvent } from "./scoreEvents";

/**
 * 同一拍上要同时按下的所有音。
 *
 * L3 的双手谱里，左手和弦与右手旋律可能在同一拍起音；如果按事件逐个判，
 * 四只手会互相抢同一组按键。这里先把同一拍的事件并成一组，评测与跟弹都以
 * 「这一拍要按哪些键」为单位。
 */
export type ScoreBeat = {
  beat: number;
  /** 这一拍所有事件合起来的 MIDI（去重、保持出现顺序）。 */
  midis: number[];
  /** 这一拍涉及的事件 id，用于把错误回写到谱面。 */
  ids: string[];
  events: ScoreEvent[];
};

const EPSILON = 1e-6;

export function scoreBeats(events: ScoreEvent[]): ScoreBeat[] {
  const beats: ScoreBeat[] = [];
  for (const event of events) {
    const last = beats[beats.length - 1];
    if (last && Math.abs(last.beat - event.beat) < EPSILON) {
      last.events.push(event);
      last.ids.push(event.id);
      for (const midi of event.midis) {
        if (!last.midis.includes(midi)) last.midis.push(midi);
      }
      continue;
    }
    beats.push({
      beat: event.beat,
      midis: [...event.midis],
      ids: [event.id],
      events: [event],
    });
  }
  return beats;
}
