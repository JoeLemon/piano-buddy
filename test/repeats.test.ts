import { describe, expect, it } from "vitest";
import { isAllowed } from "../src/domain/allowed";
import {
  hasRepeats,
  measureTotal,
  navigationLabelsAt,
  performanceMeasures,
  playOrder,
  repeatBarlines,
  repeatErrors,
} from "../src/domain/repeats";
import { scoreEvents } from "../src/domain/scoreEvents";
import type { Measure, NavigationMark, RepeatSpan, Score } from "../src/domain/types";

/**
 * 反复/导航的核心契约：
 *
 * - 谱面仍是「写一遍」的线性小节，演奏顺序由 `playOrder` 展开；
 * - 结构写错时 `repeatErrors` 给出作者能直接改的报错，`isAllowed` 也据此拒绝；
 * - 所有派生层（事件、拍坐标）读同一份顺序。
 */

function measureOf(index: number): Measure {
  return {
    notes: [
      { id: `m${index}`, pitches: [{ step: "C", octave: 4, alteration: 0 }], duration: "w" },
    ],
  };
}

/** 每小节一个全音符（4 拍），方便直接读拍坐标。 */
function scoreOf(
  total: number,
  structure: { repeats?: RepeatSpan[]; navigation?: NavigationMark[] } = {},
): Score {
  const measures = Array.from({ length: total }, (_, index) => measureOf(index));
  return {
    id: "score.test.repeats",
    mode: "repertoire",
    level: 3,
    meter: { beats: 4, beatValue: 4 },
    keySignature: "C",
    hands: ["RH"],
    bpm: 72,
    staves: { RH: { clef: "treble", measures } },
    ...structure,
  };
}

/** 能过 `isAllowed` 的 L1 谱：单手、C 五指位、四分音符填满 4/4。 */
function levelOne(structure: { repeats?: RepeatSpan[] } = {}): Score {
  const notes = ["C", "D", "E", "F"].map((step, index) => ({
    id: `n${index}`,
    pitches: [{ step: step as "C" | "D" | "E" | "F", octave: 4, alteration: 0 as const }],
    duration: "q" as const,
  }));
  return {
    id: "score.test.repeats.l1",
    mode: "sight",
    level: 1,
    meter: { beats: 4, beatValue: 4 },
    keySignature: "C",
    hands: ["RH"],
    bpm: 72,
    staves: {
      RH: {
        clef: "treble",
        measures: [{ notes }, { notes: notes.map((note) => ({ ...note, id: `${note.id}b` })) }],
      },
    },
    ...structure,
  };
}

describe("playOrder", () => {
  it("plays a simple |: :| twice and then continues", () => {
    const score = scoreOf(3, { repeats: [{ from: 0, to: 1 }] });
    expect(playOrder(score)).toEqual([0, 1, 0, 1, 2]);
  });

  it("honours an explicit times count", () => {
    const score = scoreOf(3, { repeats: [{ from: 0, to: 1, times: 3 }] });
    expect(playOrder(score)).toEqual([0, 1, 0, 1, 0, 1, 2]);
  });

  it("expands nested repeats from the inside out", () => {
    const score = scoreOf(4, {
      repeats: [
        { from: 0, to: 3 },
        { from: 1, to: 2 },
      ],
    });
    expect(playOrder(score)).toEqual([
      0, 1, 2, 1, 2, 3,
      0, 1, 2, 1, 2, 3,
    ]);
  });

  it("repeats a single measure", () => {
    const score = scoreOf(2, { repeats: [{ from: 0, to: 0 }] });
    expect(playOrder(score)).toEqual([0, 0, 1]);
  });

  it("D.C. goes back to the top once and stops at Fine", () => {
    const score = scoreOf(4, {
      navigation: [
        { at: 3, kind: "dc" },
        { at: 1, kind: "fine" },
      ],
    });
    expect(playOrder(score)).toEqual([0, 1, 2, 3, 0, 1]);
  });

  it("D.S. al Coda jumps to Segno, then to Coda", () => {
    const score = scoreOf(6, {
      navigation: [
        { at: 1, kind: "segno" },
        { at: 2, kind: "to-coda" },
        { at: 3, kind: "ds" },
        { at: 4, kind: "coda" },
      ],
    });
    expect(playOrder(score)).toEqual([0, 1, 2, 3, 1, 2, 4, 5]);
  });

  it("ignores structure that points outside the score", () => {
    const score = scoreOf(2, { repeats: [{ from: 0, to: 9 }] });
    expect(playOrder(score)).toEqual([0, 1]);
  });

  it("returns nothing for an empty score", () => {
    expect(playOrder({ ...scoreOf(0) })).toEqual([]);
  });
});

describe("repeatErrors", () => {
  it("accepts a well-formed repeat and navigation plan", () => {
    const score = scoreOf(6, {
      repeats: [
        { from: 0, to: 3 },
        { from: 1, to: 2 },
      ],
      navigation: [
        { at: 1, kind: "segno" },
        { at: 2, kind: "to-coda" },
        { at: 3, kind: "ds" },
        { at: 4, kind: "coda" },
      ],
    });
    expect(repeatErrors(score)).toEqual([]);
  });

  it("reports spans outside the score and inverted ranges", () => {
    expect(repeatErrors(scoreOf(3, { repeats: [{ from: 0, to: 3 }] }))[0]).toContain(
      "超出全曲 3 小节",
    );
    expect(repeatErrors(scoreOf(3, { repeats: [{ from: 2, to: 1 }] }))[0]).toContain(
      "起点晚于终点",
    );
  });

  it("rejects invalid times and duplicate declarations", () => {
    expect(repeatErrors(scoreOf(3, { repeats: [{ from: 0, to: 1, times: 1 }] }))[0]).toContain(
      "遍数必须是 ≥2 的整数",
    );
    expect(repeatErrors(scoreOf(3, { repeats: [{ from: 0, to: 1, times: 17 }] }))[0]).toContain(
      "超过上限",
    );
    const duplicated = repeatErrors(
      scoreOf(3, {
        repeats: [
          { from: 0, to: 1 },
          { from: 0, to: 1 },
        ],
      }),
    );
    expect(duplicated.some((text) => text.includes("重复声明"))).toBe(true);
  });

  it("allows nesting but rejects partial overlap and shared starts", () => {
    expect(
      repeatErrors(
        scoreOf(5, {
          repeats: [
            { from: 0, to: 3 },
            { from: 1, to: 2 },
          ],
        }),
      ),
    ).toEqual([]);

    const crossing = repeatErrors(
      scoreOf(5, {
        repeats: [
          { from: 0, to: 2 },
          { from: 1, to: 3 },
        ],
      }),
    );
    expect(crossing.some((text) => text.includes("部分重叠"))).toBe(true);

    const sameStart = repeatErrors(
      scoreOf(5, {
        repeats: [
          { from: 0, to: 2 },
          { from: 0, to: 3 },
        ],
      }),
    );
    expect(sameStart.some((text) => text.includes("同一小节有两个反复起点"))).toBe(true);
  });

  it("reports navigation marks that cannot be resolved", () => {
    expect(repeatErrors(scoreOf(4, { navigation: [{ at: 3, kind: "ds" }] }))[0]).toContain(
      "没有 Segno",
    );
    expect(
      repeatErrors(
        scoreOf(4, {
          navigation: [
            { at: 2, kind: "segno" },
            { at: 1, kind: "ds" },
          ],
        }),
      ).some((text) => text.includes("Segno 必须在 D.S. 之前")),
    ).toBe(true);
    expect(
      repeatErrors(
        scoreOf(4, {
          navigation: [
            { at: 3, kind: "dc" },
            { at: 2, kind: "ds" },
            { at: 0, kind: "segno" },
          ],
        }),
      ).some((text) => text.includes("不能同时有 D.C. 和 D.S.")),
    ).toBe(true);
    expect(
      repeatErrors(scoreOf(4, { navigation: [{ at: 2, kind: "to-coda" }] })).some((text) =>
        text.includes("没有 Coda"),
      ),
    ).toBe(true);
    expect(
      repeatErrors(
        scoreOf(4, {
          navigation: [
            { at: 1, kind: "fine" },
            { at: 2, kind: "fine" },
          ],
        }),
      ).some((text) => text.includes("只能出现一次")),
    ).toBe(true);
  });
});

describe("isAllowed with structure", () => {
  it("keeps a valid L1 score with repeats legal", () => {
    expect(isAllowed(levelOne())).toBe(true);
    expect(isAllowed(levelOne({ repeats: [{ from: 0, to: 1 }] }))).toBe(true);
  });

  it("rejects a score whose repeats cannot be paired", () => {
    expect(isAllowed(levelOne({ repeats: [{ from: 0, to: 5 }] }))).toBe(false);
  });
});

describe("performanceMeasures", () => {
  it("lays out performed measures with repeat beats", () => {
    const score = scoreOf(3, { repeats: [{ from: 0, to: 1 }] });
    const layout = performanceMeasures(score, "RH");
    expect(layout.map((measure) => measure.number)).toEqual([1, 2, 1, 2, 3]);
    expect(layout.map((measure) => measure.startBeat)).toEqual([0, 4, 8, 12, 16]);
    expect(layout.every((measure) => measure.beats === 4)).toBe(true);
  });

  it("skips measures past the reference hand's stave", () => {
    const score = scoreOf(3, { repeats: [{ from: 0, to: 1 }] });
    score.staves.RH!.measures = score.staves.RH!.measures.slice(0, 2);
    const layout = performanceMeasures(score, "RH");
    // 第三小节不在右手谱上：反复回来时也不该产生越界的拍坐标。
    expect(layout.map((measure) => measure.number)).toEqual([1, 2, 1, 2]);
  });
});

describe("scoreEvents with repeats", () => {
  it("sounds each pass instead of the written measures once", () => {
    const score = scoreOf(3, { repeats: [{ from: 0, to: 1 }] });
    const events = scoreEvents(score, "RH");
    expect(events.map((event) => event.beat)).toEqual([0, 4, 8, 12, 16]);
  });

  it("breaks an open tie when the repeat jumps back", () => {
    // 写谱本身自洽：0→1、2→3 各是一条完整连音线；反复段落 1–2 会从 2 跳回 1。
    const score = scoreOf(4, { repeats: [{ from: 1, to: 2 }] });
    score.staves.RH!.measures[0].notes[0].tie = "start";
    score.staves.RH!.measures[1].notes[0].tie = "stop";
    score.staves.RH!.measures[2].notes[0].tie = "start";
    score.staves.RH!.measures[3].notes[0].tie = "stop";

    const events = scoreEvents(score, "RH");
    // 第二遍落在第 2 小节的 stop 上：上一遍第 3 小节留下的开口连线必须断开，
    // 否则会把第 3 小节的音拖长成 8 拍（正确结果是新起一个 4 拍的音）。
    expect(events.map((event) => [event.beat, event.beats])).toEqual([
      [0, 8],
      [8, 4],
      [12, 4],
      [16, 8],
    ]);
  });
});

describe("render helpers", () => {
  it("marks both ends of every repeat span", () => {
    const score = scoreOf(4, {
      repeats: [
        { from: 0, to: 3 },
        { from: 1, to: 2 },
      ],
    });
    const marks = repeatBarlines(score);
    expect(marks.get(0)).toEqual({ begin: true, end: false });
    expect(marks.get(1)).toEqual({ begin: true, end: false });
    expect(marks.get(2)).toEqual({ begin: false, end: true });
    expect(marks.get(3)).toEqual({ begin: false, end: true });
  });

  it("labels navigation marks on their measure", () => {
    const score = scoreOf(4, {
      navigation: [
        { at: 3, kind: "dc" },
        { at: 1, kind: "fine" },
      ],
    });
    expect(navigationLabelsAt(score, 3)).toEqual(["D.C."]);
    expect(navigationLabelsAt(score, 1)).toEqual(["Fine"]);
    expect(navigationLabelsAt(score, 0)).toEqual([]);
  });
});

describe("hasRepeats / measureTotal", () => {
  it("only counts structure that actually changes the performance", () => {
    expect(hasRepeats(scoreOf(3))).toBe(false);
    expect(hasRepeats(scoreOf(3, { repeats: [{ from: 0, to: 1 }] }))).toBe(true);
    expect(hasRepeats(scoreOf(3, { repeats: [{ from: 0, to: 0, times: 2 }] }))).toBe(true);
  });

  it("uses the longer hand as the score length", () => {
    const score = scoreOf(3);
    score.hands = ["RH", "LH"];
    score.staves.LH = { clef: "bass", measures: [measureOf(0), measureOf(1)] };
    expect(measureTotal(score)).toBe(3);
  });
});
