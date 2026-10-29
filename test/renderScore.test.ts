import { describe, expect, it } from "vitest";
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
});
