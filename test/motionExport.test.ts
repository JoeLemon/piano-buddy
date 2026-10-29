import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { annotateScore } from "../src/domain/fingering";
import type { Score } from "../src/domain/types";
import {
  motionDurationSeconds,
  scoreToMotion,
  toDemoEvents,
  validateMotion,
} from "../src/repertoire/motion";

/**
 * 导出管线的守卫：demo 的 `Pianist.loadScore` 会访问 `fingers[finger - 1]`，
 * 所以进 Motion IR 的每个音都必须带 1..5 的指法。这两个用例把
 * 「内容包 → 指法引擎 → Motion IR」的契约钉住。
 */

describe("Motion 导出：指法契约", () => {
  it("L2《欢乐颂》经指法引擎后没有 finger=0，且 Motion 校验通过", () => {
    const score = JSON.parse(
      readFileSync("content/song.ode-to-joy.l2/content/score.json", "utf8"),
    ) as Score;

    const motion = scoreToMotion(annotateScore(score), "欢乐颂 · L2 编配");

    expect(motion.notes.length).toBeGreaterThan(0);
    expect(
      motion.notes.every(
        (note) => Number.isInteger(note.finger) && note.finger >= 1 && note.finger <= 5,
      ),
    ).toBe(true);
    expect(validateMotion(motion)).toEqual({ ok: true, errors: [] });
    expect(motionDurationSeconds(motion)).toBeGreaterThan(0);
    expect(toDemoEvents(motion).every((event) => event.finger >= 1)).toBe(true);
  });

  it("缺口指法由求解器补齐（fill-gaps）", () => {
    const score: Score = {
      id: "test.gap",
      mode: "repertoire",
      level: 2,
      meter: { beats: 4, beatValue: 4 },
      keySignature: "C",
      hands: ["RH"],
      bpm: 80,
      staves: {
        RH: {
          clef: "treble",
          measures: [
            {
              notes: [
                { id: "a", pitches: [{ step: "C", octave: 4, alteration: 0 }], duration: "q" },
                { id: "b", pitches: [{ step: "D", octave: 4, alteration: 0 }], duration: "q" },
                { id: "c", pitches: [{ step: "E", octave: 4, alteration: 0 }], duration: "q" },
                { id: "d", pitches: [{ step: "F", octave: 4, alteration: 0 }], duration: "q" },
              ],
            },
          ],
        },
      },
    };

    const annotated = annotateScore(score, "fill-gaps");
    const notes = annotated.staves.RH?.measures[0]?.notes ?? [];
    const fingers = notes.map((note) => note.fingers?.[0] ?? 0);

    expect(fingers.every((finger) => finger >= 1 && finger <= 5)).toBe(true);
    // 上行音阶的指法必须严格递增（具体从哪根指起由求解器决定）。
    expect(fingers.every((finger, i) => i === 0 || finger > fingers[i - 1])).toBe(true);

    const motion = scoreToMotion(annotated, "gap");
    expect(validateMotion(motion)).toEqual({ ok: true, errors: [] });
    expect(motion.notes.map((note) => note.finger)).toEqual(fingers);
  });
});
