import { describe, expect, it } from "vitest";
import { isAllowed } from "../src/domain/allowed";
import { keyAlteration, isMinorKey } from "../src/domain/vocabulary";
import type { KeySignature, Pitch, Score } from "../src/domain/types";
import { rateScore } from "../src/repertoire/difficulty";
import {
  minLevelForScore,
  requiredSkillsForScore,
} from "../src/repertoire/skillGraph";

/**
 * TODO-06 的领域契约：
 * - a/e/d 小调写进 keySignature 后，调号音按自然小调解释；
 * - 小三和弦进入和弦词汇，并由 `chord.minor` 节点参与评级；
 * - 小调曲目至少 L4，不能靠声明 level 混进 L2/L3。
 */

function singleNote(key: KeySignature, pitch: Pitch, level: 4 | 3 = 4): Score {
  return {
    id: `minor.${key}`,
    mode: "repertoire",
    level,
    meter: { beats: 4, beatValue: 4 },
    keySignature: key,
    hands: ["RH"],
    bpm: 60,
    staves: {
      RH: {
        clef: "treble",
        measures: [{ notes: [{ id: "n1", pitches: [pitch], duration: "w" }] }],
      },
    },
  };
}

function chord(key: KeySignature, pitches: Pitch[], level: 4 | 3 = 4): Score {
  return {
    id: `minor.chord.${key}`,
    mode: "repertoire",
    level,
    meter: { beats: 4, beatValue: 4 },
    keySignature: key,
    hands: ["RH"],
    bpm: 60,
    staves: {
      RH: {
        clef: "treble",
        measures: [{ notes: [{ id: "c1", pitches, duration: "w" }] }],
      },
    },
  };
}

const p = (step: Pitch["step"], octave: number, alteration: -1 | 0 | 1 = 0): Pitch => ({
  step,
  octave,
  alteration,
});

describe("小调调号", () => {
  it("a/e/d 小调按自然小调解释调号音", () => {
    expect(keyAlteration("Am", "F")).toBe(0);
    expect(keyAlteration("Am", "G")).toBe(0);
    expect(keyAlteration("Em", "F")).toBe(1);
    expect(keyAlteration("Em", "G")).toBe(0);
    expect(keyAlteration("Dm", "B")).toBe(-1);
    expect(keyAlteration("Dm", "E")).toBe(0);
  });

  it("isMinorKey 只认 a/e/d 三个小调", () => {
    expect(isMinorKey("Am")).toBe(true);
    expect(isMinorKey("Em")).toBe(true);
    expect(isMinorKey("Dm")).toBe(true);
    expect(isMinorKey("C")).toBe(false);
  });

  it("小调从 L4 起进入词汇表，L3 仍然拒绝", () => {
    expect(isAllowed(singleNote("Am", p("A", 4), 4))).toBe(true);
    expect(isAllowed(singleNote("Em", p("E", 4), 4))).toBe(true);
    expect(isAllowed(singleNote("Dm", p("D", 4), 4))).toBe(true);
    expect(isAllowed(singleNote("Am", p("A", 4), 3))).toBe(false);
  });
});

describe("小三和弦", () => {
  it("A 小调 i：A–C–E 在 L4 通过", () => {
    expect(isAllowed(chord("Am", [p("A", 4), p("C", 5), p("E", 5)]))).toBe(true);
  });

  it("D 小调 i：D–F–A 在 L4 通过", () => {
    expect(isAllowed(chord("Dm", [p("D", 4), p("F", 4), p("A", 4)]))).toBe(true);
  });

  it("E 小调 i：E–G–B 在 L4 通过", () => {
    expect(isAllowed(chord("Em", [p("E", 4), p("G", 4), p("B", 4)]))).toBe(true);
  });

  it("小调 iv / v 也落在和弦词汇里", () => {
    expect(isAllowed(chord("Am", [p("D", 4), p("F", 4), p("A", 4)]))).toBe(true);
    expect(isAllowed(chord("Dm", [p("G", 4), p("B", 4, -1), p("D", 5)]))).toBe(true);
  });

  it("小三和弦识别为 chord.minor", () => {
    for (const score of [
      chord("Am", [p("A", 4), p("C", 5), p("E", 5)]),
      chord("Dm", [p("D", 4), p("F", 4), p("A", 4)]),
      chord("Em", [p("E", 4), p("G", 4), p("B", 4)]),
    ]) {
      expect(requiredSkillsForScore(score).has("chord.minor")).toBe(true);
    }
  });

  it("大三和弦不会误判成 chord.minor", () => {
    const major = chord("C", [p("C", 4), p("E", 4), p("G", 4)]);
    expect(requiredSkillsForScore(major).has("chord.minor")).toBe(false);
  });
});

describe("小调与评级", () => {
  it("小调调号识别为 key.minor", () => {
    for (const key of ["Am", "Em", "Dm"] as const) {
      const skills = requiredSkillsForScore(singleNote(key, p("C", 4)));
      expect(skills.has("key.minor")).toBe(true);
      expect(skills.has("key.c")).toBe(false);
    }
  });

  it("小调曲目最低 L4，vector.key 为 4", () => {
    const score = singleNote("Am", p("A", 4));
    expect(minLevelForScore(score)).toBe(4);
    const rated = rateScore(score);
    expect(rated.baseLevel).toBe(4);
    expect(rated.vector.key).toBe(4);
  });

  it("C 大调里的 ii 级小三和弦把评级从 L3 提到 L4", () => {
    const score = chord("C", [p("D", 4), p("F", 4), p("A", 4)], 3);
    expect(minLevelForScore(score)).toBe(3);
    const rated = rateScore(score);
    expect(rated.baseLevel).toBe(4);
    expect(rated.vector.harmony).toBe(4);
  });
});
