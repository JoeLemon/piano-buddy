import { describe, expect, it } from "vitest";
import { isAllowed } from "../src/domain/allowed";
import { measureBeatStarts, pickupErrors } from "../src/domain/pickup";
import { sliceScore } from "../src/domain/sliceScore";
import type { Duration, NoteEvent, Score, Step } from "../src/domain/types";
import { barOfBeat, planForScore } from "../src/practice/rhythm";

/**
 * 弱起小节（pickup）的契约：
 *
 * - 「首小节有几拍」写在 `Score.pickup` 上，首小节时值必须与它一致；
 * - 事件流仍从第 0 拍起算，只有小节边界往后挪；
 * - 切片只在「从第一小节开始」时保留弱起。
 *
 * 4/4 的弱起典型是「从第 4 拍进旋律」：首小节 1 个四分音符。
 */

function note(id: string, step: Step, octave: number, duration: Duration): NoteEvent {
  return { id, pitches: [{ step, octave, alteration: 0 }], duration, fingers: [1] };
}

const FULL: NoteEvent[] = [
  note("f1", "C", 4, "q"),
  note("f2", "D", 4, "q"),
  note("f3", "E", 4, "q"),
  note("f4", "F", 4, "q"),
];

/** 三小节：`first` 是首小节内容（弱起时只有一拍），后两小节满拍。 */
function score(first: readonly NoteEvent[], pickup?: number): Score {
  const built: Score = {
    id: "score.pickup.test",
    mode: "repertoire",
    level: 2,
    meter: { beats: 4, beatValue: 4 },
    keySignature: "C",
    hands: ["RH"],
    bpm: 80,
    staves: {
      RH: { clef: "treble", measures: [{ notes: [...first] }, { notes: [...FULL] }, { notes: [...FULL] }] },
    },
  };
  if (pickup !== undefined) built.pickup = pickup;
  return built;
}

const ONE_BEAT = [note("a1", "C", 4, "q")];

describe("弱起小节的写法校验", () => {
  it("首小节 1 拍 + pickup=1 合法", () => {
    expect(pickupErrors(score(ONE_BEAT, 1))).toEqual([]);
    expect(isAllowed(score(ONE_BEAT, 1))).toBe(true);
  });

  it("没有 pickup 时首小节必须满拍（回归）", () => {
    expect(isAllowed(score(FULL))).toBe(true);
    expect(isAllowed(score(ONE_BEAT))).toBe(false);
  });

  it("声明了 pickup 但首小节时值对不上，报错指向具体拍数", () => {
    const errors = pickupErrors(score(ONE_BEAT, 2));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("pickup=2");
    expect(isAllowed(score(ONE_BEAT, 2))).toBe(false);
  });

  it("pickup 必须比整小节短、且是十六分音符的整数倍", () => {
    expect(pickupErrors(score(FULL, 4))[0]).toContain("不小于每小节");
    expect(pickupErrors(score(ONE_BEAT, 0))[0]).toContain("必须是正数");
    expect(pickupErrors(score(ONE_BEAT, 0.3))[0]).toContain("十六分音符的整数倍");
    expect(isAllowed(score(ONE_BEAT, 4))).toBe(false);
  });
});

describe("弱起的时间轴", () => {
  it("小节起始拍把首小节的短拍算进去", () => {
    expect(measureBeatStarts(score(ONE_BEAT, 1))).toEqual([0, 1, 5]);
    // 没有弱起时回到整小节等距。
    expect(measureBeatStarts(score(FULL))).toEqual([0, 4, 8]);
  });

  it("跟弹网格的小节线跟着 measureStarts 走，报错定位不偏小节", () => {
    const scoreWithPickup = score(ONE_BEAT, 1);
    const plan = planForScore(scoreWithPickup, "RH");
    expect(plan.measureStarts).toEqual([0, 1, 5]);
    expect(plan.pickupBeats).toBe(1);
    expect(plan.slots.map((slot) => slot.startBeat)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);

    // 首小节只有 1 拍，它在谱面上是 4/4 的第 4 拍——网格标签要这么标。
    expect(barOfBeat(plan, 0)).toEqual({ bar: 1, inBar: 4 });
    expect(barOfBeat(plan, 1)).toEqual({ bar: 2, inBar: 1 });
    expect(barOfBeat(plan, 4)).toEqual({ bar: 2, inBar: 4 });
    expect(barOfBeat(plan, 5)).toEqual({ bar: 3, inBar: 1 });

    // 没有 measureStarts 的音型题仍走 beatsPerBar 硬乘。
    expect(barOfBeat({ slots: [], bpm: 72, beatsPerBar: 4, totalBeats: 8 }, 5)).toEqual({
      bar: 2,
      inBar: 2,
    });
  });
});

describe("切片与弱起", () => {
  it("从第一小节切出来的段落保留弱起，中间段落清掉", () => {
    const whole = score(ONE_BEAT, 1);
    expect(sliceScore(whole, 0, 2).pickup).toBe(1);
    expect(sliceScore(whole, 1, 3).pickup).toBeUndefined();
  });

  it("中间段落不是弱起，切片后仍是合法谱面", () => {
    const sliced = sliceScore(score(ONE_BEAT, 1), 1, 3);
    expect(sliced.staves.RH!.measures).toHaveLength(2);
    expect(isAllowed(sliced)).toBe(true);
  });
});
