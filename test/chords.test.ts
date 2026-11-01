import { describe, expect, it } from "vitest";
import { identifyChord, isSeventhQuality, isTriadQuality } from "../src/domain/chords";
import { isAllowed } from "../src/domain/allowed";
import { annotateScore } from "../src/domain/fingering";
import type { Level, Pitch, Score, Step } from "../src/domain/types";
import { analyzeHandPositions, minLevelForScore, requiredSkillsForScore } from "../src/repertoire/skillGraph";

function p(step: Step, octave: number, alteration: -1 | 0 | 1 = 0): Pitch {
  return { step, octave, alteration };
}

function chordScore(pitches: Pitch[], level: Level = 4, fingers?: number[]): Score {
  return {
    id: `chord.${level}.${pitches.map((pitch) => `${pitch.step}${pitch.octave}`).join("-")}`,
    mode: "repertoire",
    level,
    meter: { beats: 4, beatValue: 4 },
    keySignature: "C",
    hands: ["RH"],
    bpm: 60,
    staves: {
      RH: {
        clef: "treble",
        measures: [
          {
            notes: [
              {
                id: "c1",
                pitches,
                duration: "w",
                ...(fingers ? { fingers } : {}),
              },
            ],
          },
        ],
      },
    },
  };
}

/**
 * TODO-08 的领域契约：
 * - 转位只改变低音，不改变根音/性质；
 * - L3 只允许原位三和弦，L4 开放转位，L5 开放七和弦；
 * - 技能拆解能分别报出 chord.inversion / chord.seventh；
 * - 指法求解器能处理 3–4 音和弦，且不会把转位误判成换手位。
 */
describe("和弦识别", () => {
  it("转位被识别成同一个根音与性质", () => {
    expect(identifyChord([p("C", 4), p("E", 4), p("G", 4)])).toMatchObject({
      quality: "maj",
      inversion: 0,
    });
    expect(identifyChord([p("E", 4), p("G", 4), p("C", 5)])).toMatchObject({
      quality: "maj",
      inversion: 1,
    });
    expect(identifyChord([p("G", 4), p("C", 5), p("E", 5)])).toMatchObject({
      quality: "maj",
      inversion: 2,
    });
    expect(identifyChord([p("A", 4), p("C", 5), p("E", 5)])).toMatchObject({
      quality: "min",
      inversion: 0,
    });
  });

  it("识别大七/小七/属七及它们的转位", () => {
    const maj7 = identifyChord([p("C", 4), p("E", 4), p("G", 4), p("B", 4)]);
    expect(maj7?.quality).toBe("maj7");
    expect(maj7?.inversion).toBe(0);
    expect(isSeventhQuality(maj7!.quality)).toBe(true);

    const min7 = identifyChord([p("A", 4), p("C", 5), p("E", 5), p("G", 5)]);
    expect(min7?.quality).toBe("min7");
    expect(min7?.inversion).toBe(0);

    const dom7 = identifyChord([p("B", 3), p("D", 4), p("F", 4), p("G", 4)]);
    expect(dom7?.quality).toBe("dom7");
    expect(dom7?.inversion).toBe(1);
    expect(dom7?.root.step).toBe("G");
  });

  it("八度重复根音仍识别为同一个三和弦", () => {
    const doubled = identifyChord([p("C", 4), p("E", 4), p("G", 4), p("C", 5)]);
    expect(doubled).toMatchObject({ quality: "maj", inversion: 0, doubled: true });
    // 根音写最低的那个 C，不写 C5
    expect(doubled?.root.octave).toBe(4);

    const plain = identifyChord([p("C", 4), p("E", 4), p("G", 4)]);
    expect(plain?.doubled).toBe(false);
  });

  it("减七与半减七能被识别，转位不影响性质", () => {
    const dim7 = identifyChord([p("B", 3), p("D", 4), p("F", 4), p("A", 4, -1)]);
    expect(dim7).toMatchObject({ quality: "dim7", inversion: 0 });
    expect(isSeventhQuality(dim7!.quality)).toBe(true);

    const halfDim7 = identifyChord([p("B", 3), p("D", 4), p("F", 4), p("A", 4)]);
    expect(halfDim7).toMatchObject({ quality: "halfDim7", inversion: 0 });

    // 第一转位：低音是 D，根音仍是 B
    const inverted = identifyChord([p("D", 4), p("F", 4), p("A", 4), p("B", 4)]);
    expect(inverted).toMatchObject({ quality: "halfDim7", inversion: 1 });
    expect(inverted?.root.step).toBe("B");
  });

  it("同音重复或非和弦音集返回 null", () => {
    // 同一个音写两遍是记谱错误，不是「重复根音」
    expect(identifyChord([p("C", 4), p("E", 4), p("G", 4), p("C", 4)])).toBeNull();
    expect(identifyChord([p("C", 4), p("D", 4), p("E", 4)])).toBeNull();
    expect(isTriadQuality("maj")).toBe(true);
    expect(isTriadQuality("dom7")).toBe(false);
  });
});

describe("转位与七和弦的词汇表", () => {
  it("L3 只收原位三和弦，L4 才收转位", () => {
    const root = chordScore([p("C", 4), p("E", 4), p("G", 4)], 3);
    const firstInversion = chordScore([p("E", 4), p("G", 4), p("C", 5)], 3);

    expect(isAllowed(root)).toBe(true);
    expect(isAllowed(firstInversion)).toBe(false);
    expect(isAllowed({ ...firstInversion, level: 4 })).toBe(true);
  });

  it("七和弦从 L5 起进入词汇表", () => {
    const seventh = chordScore([p("C", 4), p("E", 4), p("G", 4), p("B", 4)], 4);
    expect(isAllowed(seventh)).toBe(false);
    expect(isAllowed({ ...seventh, level: 5 })).toBe(true);
  });

  it("minLevel 分别给转位三和弦 4、七和弦 5、减七/半减七 6", () => {
    expect(minLevelForScore(chordScore([p("E", 4), p("G", 4), p("C", 5)], 4))).toBe(4);
    expect(minLevelForScore(chordScore([p("C", 4), p("E", 4), p("G", 4), p("B", 4)], 5))).toBe(5);
    expect(minLevelForScore(chordScore([p("B", 3), p("D", 4), p("F", 4), p("A", 4)], 5))).toBe(6);
  });

  it("减七/半减七从 L6 起进入词汇表", () => {
    const halfDim = [p("B", 3), p("D", 4), p("F", 4), p("A", 4)];
    expect(isAllowed(chordScore(halfDim, 5))).toBe(false);
    expect(isAllowed(chordScore(halfDim, 6))).toBe(true);

    const dim7 = [p("B", 3), p("D", 4), p("F", 4), p("A", 4, -1)];
    expect(isAllowed(chordScore(dim7, 5))).toBe(false);
    expect(isAllowed(chordScore(dim7, 6))).toBe(true);
  });

  it("八度重复根音的四音三和弦从 L5 起开放", () => {
    const doubled = [p("C", 4), p("E", 4), p("G", 4), p("C", 5)];
    // L4 的 maxChordSize 是 3，四个音直接过不去
    expect(isAllowed(chordScore(doubled, 4))).toBe(false);
    expect(isAllowed(chordScore(doubled, 5))).toBe(true);
  });
});

describe("和弦技能拆解", () => {
  it("原位三和弦不报转位，转位三和弦报 chord.inversion", () => {
    const root = requiredSkillsForScore(chordScore([p("C", 4), p("E", 4), p("G", 4)], 4));
    expect(root.has("chord.triad")).toBe(true);
    expect(root.has("chord.inversion")).toBe(false);

    const inverted = requiredSkillsForScore(chordScore([p("E", 4), p("G", 4), p("C", 5)], 4));
    expect(inverted.has("chord.inversion")).toBe(true);
  });

  it("七和弦报 chord.seventh，转位七和弦同时报两个节点", () => {
    const root = requiredSkillsForScore(chordScore([p("C", 4), p("E", 4), p("G", 4), p("B", 4)], 5));
    expect(root.has("chord.seventh")).toBe(true);
    expect(root.has("chord.inversion")).toBe(false);

    const inverted = requiredSkillsForScore(chordScore([p("B", 3), p("D", 4), p("F", 4), p("G", 4)], 5));
    expect(inverted.has("chord.seventh")).toBe(true);
    expect(inverted.has("chord.inversion")).toBe(true);
  });

  it("减七/半减七同时报 chord.seventh 与 chord.diminished", () => {
    const dim7 = requiredSkillsForScore(chordScore([p("B", 3), p("D", 4), p("F", 4), p("A", 4, -1)], 6));
    expect(dim7.has("chord.seventh")).toBe(true);
    expect(dim7.has("chord.diminished")).toBe(true);

    const halfDim = requiredSkillsForScore(chordScore([p("B", 3), p("D", 4), p("F", 4), p("A", 4)], 6));
    expect(halfDim.has("chord.diminished")).toBe(true);

    // 普通属七不报减七节点
    const dom7 = requiredSkillsForScore(chordScore([p("G", 4), p("B", 4), p("D", 5), p("F", 5)], 5));
    expect(dom7.has("chord.seventh")).toBe(true);
    expect(dom7.has("chord.diminished")).toBe(false);
  });

  it("八度重复根音不会被误判成换手位", () => {
    const score = chordScore([p("C", 4), p("E", 4), p("G", 4), p("C", 5)], 5, [1, 2, 3, 5]);
    const analysis = analyzeHandPositions(score);
    expect(analysis.shift).toBe(false);
    expect(analysis.expand).toBe(false);
  });

  it("同一和弦的不同转位不重复算作和弦连接", () => {
    const score = chordScore([p("C", 4), p("E", 4), p("G", 4)], 4, [1, 3, 5]);
    score.staves.RH!.measures.push({
      notes: [
        {
          id: "c2",
          pitches: [p("E", 4), p("G", 4), p("C", 5)],
          duration: "w",
          fingers: [1, 2, 4],
        },
      ],
    });

    const skills = requiredSkillsForScore(score);
    expect(skills.has("chord.inversion")).toBe(true);
    expect(skills.has("chord.progression")).toBe(false);
    expect(skills.has("pos.shift")).toBe(false);
    expect(skills.has("pos.expand")).toBe(false);
  });
});

describe("转位/七和弦的指法", () => {
  it("四音七和弦能求出四个不重复指法", () => {
    for (const pitches of [
      [p("C", 4), p("E", 4), p("G", 4), p("B", 4)],
      [p("B", 3), p("D", 4), p("F", 4), p("G", 4)],
    ]) {
      const annotated = annotateScore(chordScore(pitches, 5));
      const fingers = annotated.staves.RH!.measures[0].notes[0].fingers ?? [];
      expect(fingers).toHaveLength(4);
      expect(new Set(fingers).size).toBe(4);
      expect(fingers.every((finger) => finger >= 1 && finger <= 5)).toBe(true);
    }
  });

  it("八度重复根音的四音三和弦也能求出四个不重复指法", () => {
    const annotated = annotateScore(chordScore([p("C", 4), p("E", 4), p("G", 4), p("C", 5)], 5));
    const fingers = annotated.staves.RH!.measures[0].notes[0].fingers ?? [];
    expect(fingers).toHaveLength(4);
    expect(new Set(fingers).size).toBe(4);
  });

  it("转位三和弦能求出三个不重复指法，且不误判成换手位", () => {
    const score = chordScore([p("E", 4), p("G", 4), p("C", 5)], 4);
    const annotated = annotateScore(score);
    const fingers = annotated.staves.RH!.measures[0].notes[0].fingers ?? [];
    expect(fingers).toHaveLength(3);
    expect(new Set(fingers).size).toBe(3);

    const analysis = analyzeHandPositions(annotated);
    expect(analysis.shift).toBe(false);
    expect(analysis.expand).toBe(false);

    // 没有指法时也不要把和弦转位当成换位/扩张；手位信息不足就不报。
    const pitchOnly = analyzeHandPositions(score);
    expect(pitchOnly.shift).toBe(false);
    expect(pitchOnly.expand).toBe(false);
  });
});
