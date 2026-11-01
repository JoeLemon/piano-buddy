import { describe, expect, it, vi } from "vitest";
import { EasyScore } from "vexflow";
import { generateL1 } from "../src/domain/generate";
import type { NoteEvent, Score } from "../src/domain/types";
import { renderGrandScore, renderScore, restPitch } from "../src/notation/renderScore";

function tieScore(): Score {
  const first: NoteEvent[] = [
    { id: "a1", pitches: [{ step: "C", octave: 4, alteration: 0 }], duration: "q", fingers: [1] },
    { id: "a2", pitches: [{ step: "D", octave: 4, alteration: 0 }], duration: "q", fingers: [2] },
    { id: "a3", pitches: [{ step: "E", octave: 4, alteration: 0 }], duration: "q", fingers: [3] },
    { id: "a4", pitches: [{ step: "F", octave: 4, alteration: 0 }], duration: "q", fingers: [4], tie: "start" },
  ];
  const second: NoteEvent[] = [
    { id: "b1", pitches: [{ step: "F", octave: 4, alteration: 0 }], duration: "h", fingers: [4], tie: "stop" },
    { id: "b2", pitches: [{ step: "G", octave: 4, alteration: 0 }], duration: "h", fingers: [5] },
  ];
  return {
    id: "score.render.tie",
    mode: "repertoire",
    level: 3,
    meter: { beats: 4, beatValue: 4 },
    keySignature: "C",
    hands: ["RH"],
    bpm: 72,
    staves: { RH: { clef: "treble", measures: [{ notes: first }, { notes: second }] } },
  };
}

describe("renderScore", () => {
  it("draws an L1 staff into the element", () => {
    const element = document.createElement("div");
    renderScore(element, generateL1({ hand: "RH", seed: 4, mode: "sight" }), "RH", true);
    expect(element.querySelector("svg")).not.toBeNull();
  });

  it("places a bass-clef rest on the middle line", () => {
    expect(restPitch("bass")).toBe("D3");
    expect(restPitch("treble")).toBe("B4");
  });

  it("跨小节连音线连成一整条（各小节横向排在同一行）", () => {
    const element = document.createElement("div");
    renderScore(element, tieScore(), "RH", false);
    // 目标音在右边就画一条完整曲线，跨过小节间隙——不是两段半截线。
    expect(element.querySelectorAll(".vf-stavetie").length).toBe(1);
  });

  it("没有连音线时不会凭空画线", () => {
    const element = document.createElement("div");
    renderScore(element, generateL1({ hand: "RH", seed: 4, mode: "sight" }), "RH", false);
    expect(element.querySelectorAll(".vf-stavetie").length).toBe(0);
  });

  it("双手谱的连线也画得出来", () => {
    const element = document.createElement("div");
    const right = tieScore();
    const score: Score = {
      ...right,
      id: "score.render.tie.both",
      hands: ["RH", "LH"],
      staves: {
        RH: right.staves.RH,
        LH: {
          clef: "bass",
          measures: [
            { notes: [{ id: "c1", pitches: [{ step: "C", octave: 3, alteration: 0 }], duration: "w", fingers: [5] }] },
            { notes: [{ id: "c2", pitches: [{ step: "G", octave: 2, alteration: 0 }], duration: "w", fingers: [5] }] },
          ],
        },
      },
    };
    renderGrandScore(element, score, false);
    expect(element.querySelectorAll(".vf-stavetie").length).toBe(1);
  });

  it("draws repeat barlines and navigation text without throwing", () => {
    const element = document.createElement("div");
    const score: Score = {
      id: "score.render.repeats",
      mode: "repertoire",
      level: 3,
      meter: { beats: 4, beatValue: 4 },
      keySignature: "C",
      hands: ["RH"],
      bpm: 72,
      repeats: [{ from: 0, to: 1 }],
      navigation: [
        { at: 0, kind: "fine" },
        { at: 1, kind: "dc" },
      ],
      staves: {
        RH: {
          clef: "treble",
          measures: [
            { notes: [{ id: "r1", pitches: [{ step: "C", octave: 4, alteration: 0 }], duration: "w" }] },
            { notes: [{ id: "r2", pitches: [{ step: "D", octave: 4, alteration: 0 }], duration: "w" }] },
          ],
        },
      },
    };

    expect(() => renderScore(element, score, "RH", false)).not.toThrow();
    expect(element.querySelector("svg")).not.toBeNull();
    const text = element.textContent ?? "";
    expect(text).toContain("Fine");
    expect(text).toContain("D.C.");
  });

  it("draws a/e/d minor key signatures without throwing", () => {
    const base = generateL1({ hand: "RH", seed: 4, mode: "sight" });
    for (const key of ["Am", "Em", "Dm"] as const) {
      const element = document.createElement("div");
      expect(() =>
        renderScore(element, { ...base, keySignature: key, level: 4 }, "RH", false),
      ).not.toThrow();
      expect(element.querySelector("svg")).not.toBeNull();
    }
  });

  it("draws a 6/8 bar without throwing", () => {
    const pitches = ["C", "D", "E", "F", "G", "A"] as const;
    const score: Score = {
      id: "score.render.six-eight",
      mode: "repertoire",
      level: 5,
      meter: { beats: 6, beatValue: 8 },
      keySignature: "C",
      hands: ["RH"],
      bpm: 72,
      staves: {
        RH: {
          clef: "treble",
          measures: [{
            notes: pitches.map((step, index) => ({
              id: `s${index}`,
              pitches: [{ step, octave: 4, alteration: 0 }],
              duration: "8" as const,
            })),
          }],
        },
      },
    };

    const element = document.createElement("div");
    expect(() => renderScore(element, score, "RH", false)).not.toThrow();
    expect(element.querySelector("svg")).not.toBeNull();
    expect(element.querySelectorAll(".vf-stavenote").length).toBe(6);
  });

  it("draws inverted triads and seventh chords without throwing", () => {
    const score: Score = {
      id: "score.render.chords",
      mode: "repertoire",
      level: 5,
      meter: { beats: 4, beatValue: 4 },
      keySignature: "C",
      hands: ["RH"],
      bpm: 72,
      staves: {
        RH: {
          clef: "treble",
          measures: [
            {
              notes: [{
                id: "inv",
                pitches: [
                  { step: "E", octave: 4, alteration: 0 },
                  { step: "G", octave: 4, alteration: 0 },
                  { step: "C", octave: 5, alteration: 0 },
                ],
                duration: "h",
              }],
            },
            {
              notes: [{
                id: "sev",
                pitches: [
                  { step: "C", octave: 4, alteration: 0 },
                  { step: "E", octave: 4, alteration: 0 },
                  { step: "G", octave: 4, alteration: 0 },
                  { step: "B", octave: 4, alteration: 0 },
                ],
                duration: "h",
              }],
            },
          ],
        },
      },
    };

    const element = document.createElement("div");
    expect(() => renderScore(element, score, "RH", false)).not.toThrow();
    expect(element.querySelector("svg")).not.toBeNull();
    expect(element.querySelectorAll(".vf-stavenote").length).toBeGreaterThanOrEqual(2);
  });

  it("fills a short measure with rest glyphs, not extra notes", () => {
    const score: Score = {
      id: "score.render.fill",
      mode: "repertoire",
      level: 2,
      meter: { beats: 4, beatValue: 4 },
      keySignature: "C",
      hands: ["RH"],
      bpm: 72,
      staves: {
        RH: {
          clef: "treble",
          measures: [{
            notes: [{ id: "a", pitches: [{ step: "C", octave: 4, alteration: 0 }], duration: "q" }],
          }],
        },
      },
    };

    const element = document.createElement("div");
    renderScore(element, score, "RH", false);
    // 剩余 3 拍拆成二分休止 + 四分休止；休止符没有符干。
    // 以前把 hd/h/q 当成音高 token，会画出 3 条符干。
    expect(element.querySelectorAll(".vf-stem").length).toBe(1);
    expect(element.querySelectorAll(".pb-filler-rest").length).toBe(2);
  });

  it("keeps pickup filler rests out of the tie/finger note mapping", () => {
    const score: Score = {
      id: "score.render.pickup",
      mode: "repertoire",
      level: 2,
      meter: { beats: 4, beatValue: 4 },
      keySignature: "C",
      hands: ["RH"],
      bpm: 72,
      pickup: 1,
      staves: {
        RH: {
          clef: "treble",
          measures: [
            {
              notes: [
                {
                  id: "p1",
                  pitches: [{ step: "C", octave: 4, alteration: 0 }],
                  duration: "q",
                  fingers: [1],
                  tie: "start",
                },
              ],
            },
            {
              notes: [
                {
                  id: "p2",
                  pitches: [{ step: "C", octave: 4, alteration: 0 }],
                  duration: "h",
                  fingers: [1],
                  tie: "stop",
                },
                {
                  id: "p3",
                  pitches: [{ step: "G", octave: 4, alteration: 0 }],
                  duration: "h",
                  fingers: [5],
                },
              ],
            },
          ],
        },
      },
    };

    const element = document.createElement("div");
    expect(() => renderScore(element, score, "RH", true)).not.toThrow();
    expect(element.querySelectorAll(".vf-stavetie").length).toBe(1);
    const fingers = Array.from(element.querySelectorAll(".vf-annotation text")).map(
      (node) => node.textContent,
    );
    expect(fingers).toEqual(expect.arrayContaining(["1", "5"]));
  });

  it("draws 3:2 triplets with a tuplet bracket", () => {
    const triplet = (id: string, step: "C" | "D" | "E"): NoteEvent => ({
      id,
      pitches: [{ step, octave: 4, alteration: 0 }],
      duration: "8",
      tuplet: "t1",
    });
    const score: Score = {
      id: "score.render.triplet",
      mode: "repertoire",
      level: 5,
      meter: { beats: 4, beatValue: 4 },
      keySignature: "C",
      hands: ["RH"],
      bpm: 72,
      staves: {
        RH: {
          clef: "treble",
          measures: [{
            notes: [
              triplet("a", "C"),
              triplet("b", "D"),
              triplet("c", "E"),
              { id: "q1", pitches: [{ step: "F", octave: 4, alteration: 0 }], duration: "q" },
              { id: "q2", pitches: [{ step: "G", octave: 4, alteration: 0 }], duration: "q" },
              { id: "q3", pitches: [{ step: "A", octave: 4, alteration: 0 }], duration: "q" },
            ],
          }],
        },
      },
    };

    const element = document.createElement("div");
    const spy = vi.spyOn(EasyScore.prototype, "tuplet");
    try {
      expect(() => renderScore(element, score, "RH", false)).not.toThrow();
      expect(spy).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({ num_notes: 3, notes_occupied: 2 }),
      );
    } finally {
      spy.mockRestore();
    }
  });

  it("draws a triplet group that contains a rest", () => {
    const score: Score = {
      id: "score.render.triplet.rest",
      mode: "repertoire",
      level: 5,
      meter: { beats: 4, beatValue: 4 },
      keySignature: "C",
      hands: ["RH"],
      bpm: 72,
      staves: {
        RH: {
          clef: "treble",
          measures: [{
            notes: [
              { id: "a", pitches: [{ step: "C", octave: 4, alteration: 0 }], duration: "8", tuplet: "t1" },
              { id: "b", pitches: [], duration: "8r", tuplet: "t1" },
              { id: "c", pitches: [{ step: "E", octave: 4, alteration: 0 }], duration: "8", tuplet: "t1" },
              { id: "q1", pitches: [{ step: "F", octave: 4, alteration: 0 }], duration: "q" },
              { id: "q2", pitches: [{ step: "G", octave: 4, alteration: 0 }], duration: "q" },
              { id: "q3", pitches: [{ step: "A", octave: 4, alteration: 0 }], duration: "q" },
            ],
          }],
        },
      },
    };

    const element = document.createElement("div");
    const spy = vi.spyOn(EasyScore.prototype, "tuplet");
    try {
      expect(() => renderScore(element, score, "RH", false)).not.toThrow();
      expect(spy).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({ num_notes: 3, notes_occupied: 2 }),
      );
    } finally {
      spy.mockRestore();
    }
  });
});
