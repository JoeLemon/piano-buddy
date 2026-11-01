import type { Score } from "./types";
import { meterQuarterBeats, noteBeats } from "./vocabulary";

/**
 * 弱起小节（anacrusis）的口径唯一来源。
 *
 * 弱起最常见的写法是「首小节不满一个整小节」，例如 4/4 的曲子从第 4 拍
 * 进旋律（`pickup: 1`），3/4 的曲子从第 3 拍进（`pickup: 1`）。把它记成
 * **首小节有多少拍**，而不是「缺几拍」：谱面上写的就是这个数，导入器从
 * MusicXML 拿到的也是这个数。
 *
 * 事件流仍然从第 0 拍开始——弱起的第一个音就是第 0 拍，不需要偏移。
 * 会受影响的是**小节边界**：第二小节从第 `pickup` 拍开始，不是从整小节
 * 拍数开始。所以凡是要把小节号和拍坐标互相换算的地方，一律走
 * 这里的 `measureBeatStarts()` / `barAtBeat()`，别拿 `beat / meter.beats` 硬除。
 *
 * 拍数一律是**四分音符单位**；6/8 的一整小节是 3 拍，不是 6 拍。
 */

/** 拍的最小粒度：十六分音符与三连音都落在这个 1/12 栅格上。 */
const STEP = 1 / 12;

/** 首小节的实际拍数；没有弱起时就是一个整小节。 */
export function pickupBeats(score: Score): number {
  return score.pickup ?? meterQuarterBeats(score.meter);
}

/** 第 index 小节应有的拍数（只有首小节可能不满）。 */
export function measureBudget(score: Score, index: number): number {
  return index === 0 ? pickupBeats(score) : meterQuarterBeats(score.meter);
}

/** 每小节的起始拍（0 起算，长度等于小节数）。 */
export function measureBeatStarts(score: Score): number[] {
  const total = measureTotal(score);
  const starts: number[] = [];
  let cursor = 0;
  for (let index = 0; index < total; index += 1) {
    starts.push(cursor);
    cursor += measureBudget(score, index);
  }
  return starts;
}

/**
 * 弱起写法本身是否自洽。返回错误文案，`null` 表示没问题。
 *
 * 这几条既是 `isAllowed` 的判据，也是 `validateSongContent` 的报错来源——
 * 两处共用一份，免得「渲染层接受、内容 QA 拒绝」。
 */
export function pickupErrors(score: Score): string[] {
  const pickup = score.pickup;
  if (pickup === undefined) return [];
  const errors: string[] = [];
  if (!Number.isFinite(pickup) || pickup <= 0) {
    return [`pickup 必须是正数（首小节拍数），实际是 ${pickup}`];
  }
  const budget = meterQuarterBeats(score.meter);
  if (pickup >= budget) {
    return [`pickup=${pickup} 不小于每小节 ${formatBeats(budget)} 拍，弱起小节必须比整小节短`];
  }
  if (Math.abs(pickup / STEP - Math.round(pickup / STEP)) > 1e-6) {
    errors.push(`pickup=${pickup} 不是十六分音符的整数倍（三连音按 1/3 拍栅格也允许），谱面无法记谱`);
  }
  // 首小节的实际时值必须与声明的 pickup 一致，否则「声明弱起」只是标签。
  for (const hand of score.hands) {
    const measure = score.staves[hand]?.measures[0];
    if (!measure) continue;
    const used = measure.notes.reduce((sum, note) => sum + noteBeats(note), 0);
    if (Math.abs(used - pickup) > 1e-6) {
      errors.push(`首小节实际 ${formatBeats(used)} 拍，与 pickup=${pickup} 不一致（${hand}）`);
    }
  }
  return errors;
}

function measureTotal(score: Score): number {
  return score.hands.reduce(
    (count, hand) => Math.max(count, score.staves[hand]?.measures.length ?? 0),
    0,
  );
}

function formatBeats(beats: number): string {
  return Number.isInteger(beats) ? String(beats) : beats.toFixed(2).replace(/0+$/, "");
}
