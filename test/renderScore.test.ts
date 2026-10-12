import { describe, expect, it } from "vitest";
import { generateL1 } from "../src/domain/generate";
import { renderScore, restPitch } from "../src/notation/renderScore";

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
});
