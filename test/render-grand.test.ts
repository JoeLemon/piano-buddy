import { describe, expect, it } from "vitest";
import type { Score } from "../src/domain/types";
import { renderGrandScore } from "../src/notation/renderScore";

function twoHandScore(): Score {
  return {
    id: "grand-1",
    mode: "reading-lesson",
    level: 2,
    meter: { beats: 4, beatValue: 4 },
    keySignature: "C",
    hands: ["RH", "LH"],
    bpm: 60,
    staves: {
      RH: {
        clef: "treble",
        measures: [
          {
            notes: [
              {
                id: "rh-0",
                pitches: [{ step: "C", octave: 4, alteration: 0 }],
                duration: "q",
                fingers: [1],
              },
            ],
          },
        ],
      },
      LH: {
        clef: "bass",
        measures: [
          {
            notes: [
              {
                id: "lh-0",
                pitches: [{ step: "C", octave: 3, alteration: 0 }],
                duration: "q",
                fingers: [5],
              },
            ],
          },
        ],
      },
    },
  };
}

function lineY(stave: Element): number {
  const path = stave.querySelector("path");
  const match = /M(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/.exec(path?.getAttribute("d") ?? "");
  if (!match) throw new Error("stave has no staff line");
  return Number(match[2]);
}

describe("renderGrandScore", () => {
  it("draws treble above bass for a one-bar two-hand score", () => {
    const element = document.createElement("div");
    renderGrandScore(element, twoHandScore(), true);

    expect(element.querySelector("svg")).not.toBeNull();
    const staves = Array.from(element.querySelectorAll(".vf-stave"));
    expect(staves.length).toBeGreaterThanOrEqual(2);
    expect(lineY(staves[0])).toBeLessThan(lineY(staves[1]));
    expect(element.querySelectorAll(".vf-clef").length).toBeGreaterThanOrEqual(2);

    const fingers = Array.from(element.querySelectorAll(".vf-annotation text"));
    const right = fingers.find((node) => node.textContent === "1");
    const left = fingers.find((node) => node.textContent === "5");
    expect(right).toBeTruthy();
    expect(left).toBeTruthy();
    expect(Number(right?.getAttribute("y"))).toBeLessThan(Number(left?.getAttribute("y")));
  });

  it("draws both staves for every measure", () => {
    const score = twoHandScore();
    score.staves.RH?.measures.push(structuredClone(score.staves.RH.measures[0]));
    score.staves.LH?.measures.push(structuredClone(score.staves.LH.measures[0]));
    const element = document.createElement("div");
    renderGrandScore(element, score, false);
    expect(element.querySelectorAll(".vf-stave").length).toBe(4);
  });

  it("hides finger annotations when showFingers is false", () => {
    const element = document.createElement("div");
    renderGrandScore(element, twoHandScore(), false);
    expect(element.querySelector(".vf-annotation")).toBeNull();
  });

  it("requires both RH and LH", () => {
    const element = document.createElement("div");
    const score = twoHandScore();
    score.hands = ["RH"];
    expect(() => renderGrandScore(element, score, true)).toThrow(/RH and LH/);
  });
});
