import { describe, expect, it } from "vitest";
import { generateL1 } from "../src/domain/generate";
import { generateL2 } from "../src/domain/generateL2";
import { pitchToMidi } from "../src/domain/pitch";
import {
  flatRows,
  grandProgressRatio,
  measureForSounding,
  paintGrandProgress,
  paintScoreProgress,
  grandRows,
  scoreProgressRatio,
  scrollScoreToCursor,
  scrollScoreToNote,
  soundingTotal,
} from "../src/notation/scorePaint";
import { renderGrandScore, renderScore } from "../src/notation/renderScore";
import type { Measure, Score } from "../src/domain/types";

function sounding(score: ReturnType<typeof generateL1>, hand: "RH" | "LH") {
  const events: { id: string; midi: number }[] = [];
  for (const measure of score.staves[hand]?.measures ?? []) {
    for (const note of measure.notes) {
      if (note.duration.endsWith("r") || note.pitches.length === 0) continue;
      events.push({ id: note.id, midi: pitchToMidi(note.pitches[0]) });
    }
  }
  return events;
}

describe("soundingTotal / scoreProgressRatio", () => {
  it("counts sounding notes and maps progress", () => {
    const score = generateL1({ hand: "RH", seed: 4, mode: "sight" });
    const total = sounding(score, "RH").length;
    expect(total).toBe(soundingTotal(score, "RH"));
    expect(scoreProgressRatio(score, "RH", 0)).toBe(0);
    expect(scoreProgressRatio(score, "RH", total)).toBe(1);
    expect(scoreProgressRatio(score, "RH", Math.floor(total / 2))).toBeGreaterThan(0);
    expect(scoreProgressRatio(score, "RH", total + 9)).toBe(1);
  });
});

describe("paintScoreProgress", () => {
  it("tints played region, colors correct and wrong notes", () => {
    const score = generateL1({ hand: "RH", seed: 4, mode: "sight" });
    const events = sounding(score, "RH");
    const element = document.createElement("div");
    document.body.append(element);
    try {
      renderScore(element, score, "RH", false);
      const groups = element.querySelectorAll(".vf-stavenote");
      expect(groups.length).toBeGreaterThan(0);
      const rows = flatRows(score, "RH");
      const flatOfFirst = rows.findIndex((row) => row.id === events[0].id);
      expect(flatOfFirst).toBeGreaterThanOrEqual(0);
      paintScoreProgress(element, score, "RH", {
        playedCount: 3,
        correctIds: new Set([events[0].id]),
        wrongIds: new Set([events[2].id]),
      });
      // 弹对：豆蔻绿标记
      expect(groups.item(flatOfFirst).getAttribute("data-correct")).toBe("true");
      expect(groups.item(flatOfFirst).querySelector("path")?.getAttribute("fill")).toBeTruthy();
      // 弹错：锗黄标记存在
      expect(element.querySelector("[data-wrong]")).not.toBeNull();
      // 弹完全条：所有音符都有进度标记（弹过=浅豆沙绿底色）
      paintScoreProgress(element, score, "RH", {
        playedCount: events.length,
        correctIds: new Set(),
        wrongIds: new Set(),
      });
      const unmarked = Array.from(groups).filter(
        (group) =>
          !group.getAttribute("data-played")
          && !group.getAttribute("data-correct")
          && !group.getAttribute("data-wrong"),
      );
      expect(unmarked.length).toBe(0);
      // 重置游标：恢复默认（无标记）
      paintScoreProgress(element, score, "RH", {
        playedCount: 0,
        correctIds: new Set(),
        wrongIds: new Set(),
      });
      expect(element.querySelector("[data-played]")).toBeNull();
      expect(element.querySelector("[data-correct]")).toBeNull();
      expect(element.querySelector("[data-wrong]")).toBeNull();
    } finally {
      element.remove();
    }
  });

  it("skips filler rests when painting a pickup measure", () => {
    const q = (id: string, step: "C" | "D" | "E" | "F"): Measure["notes"][number] => ({
      id,
      pitches: [{ step, octave: 4, alteration: 0 }],
      duration: "q",
    });
    const score: Score = {
      id: "score.paint.pickup",
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
            { notes: [q("p1", "C")] },
            { notes: [q("p2", "D"), q("p3", "E"), q("p4", "F"), q("p5", "D")] },
          ],
        },
      },
    };

    const element = document.createElement("div");
    document.body.append(element);
    try {
      renderScore(element, score, "RH", false);
      paintScoreProgress(element, score, "RH", {
        playedCount: 0,
        correctIds: new Set(["p1"]),
        wrongIds: new Set(),
      });
      const groups = Array.from(element.querySelectorAll(".vf-stavenote"));
      const fillers = groups.filter((group) => group.classList.contains("pb-filler-rest"));
      expect(fillers.length).toBe(2);
      expect(fillers.some((group) => group.hasAttribute("data-correct"))).toBe(false);
      const notes = groups.filter((group) => !group.classList.contains("pb-filler-rest"));
      expect(notes[0]?.getAttribute("data-correct")).toBe("true");
    } finally {
      element.remove();
    }
  });

  it("clears previous marks on repaint", () => {
    const score = generateL1({ hand: "RH", seed: 4, mode: "sight" });
    const events = sounding(score, "RH");
    const element = document.createElement("div");
    document.body.append(element);
    try {
      renderScore(element, score, "RH", false);
      paintScoreProgress(element, score, "RH", {
        playedCount: 0,
        correctIds: new Set([events[0].id]),
        wrongIds: new Set(),
      });
      expect(element.querySelector("[data-correct]")).not.toBeNull();
      paintScoreProgress(element, score, "RH", {
        playedCount: 0,
        correctIds: new Set(),
        wrongIds: new Set(),
      });
      expect(element.querySelector("[data-correct]")).toBeNull();
      expect(element.querySelector("[data-played]")).toBeNull();
      expect(element.querySelector("[data-wrong]")).toBeNull();
    } finally {
      element.remove();
    }
  });
});

describe("grand staff", () => {
  it("paints correct hands from timeline order", () => {
    const score = generateL2({ seed: 2, mode: "reading-lesson", shape: { kind: "alternate" } });
    const element = document.createElement("div");
    document.body.append(element);
    try {
      renderGrandScore(element, score, false);
      expect(grandRows(score).length).toBeGreaterThan(0);
      const firstKey = "RH:" + score.staves.RH!.measures[0].notes[0].id;
      paintGrandProgress(element, score, {
        timelineCount: 0,
        correctKeys: new Set([firstKey]),
        wrongKeys: new Set(),
      });
      expect(element.querySelector("[data-correct] path")?.getAttribute("fill")).toBeTruthy();
      paintGrandProgress(element, score, {
        timelineCount: 1,
        correctKeys: new Set(),
        wrongKeys: new Set(),
      });
      expect(element.querySelector("[data-played]")).not.toBeNull();
      const value = grandProgressRatio(score, 2);
      expect(value).toBeGreaterThan(0);
      expect(value).toBeLessThan(1);
      expect(grandProgressRatio(score, 999)).toBe(1);
    } finally {
      element.remove();
    }
  });
});

describe("scrollScoreToCursor", () => {
  it("does not throw when layout is unavailable (happy-dom)", () => {
    const score = generateL1({ hand: "RH", seed: 4, mode: "sight" });
    const element = document.createElement("div");
    document.body.append(element);
    try {
      renderScore(element, score, "RH", false);
      expect(() => scrollScoreToCursor(element, score, "RH", 2)).not.toThrow();
    } finally {
      element.remove();
    }
  });
});

describe("active note (preview follow)", () => {
  it("marks the sounding note and clears it on the next repaint", () => {
    const score = generateL1({ hand: "RH", seed: 4, mode: "sight" });
    const events = sounding(score, "RH");
    const element = document.createElement("div");
    document.body.append(element);
    try {
      renderScore(element, score, "RH", false);
      paintScoreProgress(element, score, "RH", {
        playedCount: 1,
        correctIds: new Set(),
        wrongIds: new Set(),
        activeId: events[1].id,
      });
      const active = element.querySelector("[data-active]");
      expect(active).not.toBeNull();
      expect(active?.querySelector("path")?.getAttribute("fill")).toBeTruthy();
      paintScoreProgress(element, score, "RH", {
        playedCount: 1,
        correctIds: new Set(),
        wrongIds: new Set(),
      });
      expect(element.querySelector("[data-active]")).toBeNull();
    } finally {
      element.remove();
    }
  });

  it("keeps wrong over active when both point at the same note", () => {
    const score = generateL1({ hand: "RH", seed: 4, mode: "sight" });
    const events = sounding(score, "RH");
    const element = document.createElement("div");
    document.body.append(element);
    try {
      renderScore(element, score, "RH", false);
      paintScoreProgress(element, score, "RH", {
        playedCount: 1,
        correctIds: new Set(),
        wrongIds: new Set([events[1].id]),
        activeId: events[1].id,
      });
      expect(element.querySelector("[data-wrong]")).not.toBeNull();
      expect(element.querySelector("[data-active]")).toBeNull();
    } finally {
      element.remove();
    }
  });
});

describe("measureForSounding", () => {
  it("maps a sounding index to its measure and clamps past the end", () => {
    const score = generateL1({ hand: "RH", seed: 4, mode: "sight" });
    const total = score.staves.RH!.measures.length;
    const events = sounding(score, "RH");
    expect(measureForSounding(score, "RH", 0).current).toBe(1);
    expect(measureForSounding(score, "RH", events.length - 1).current).toBe(total);
    expect(measureForSounding(score, "RH", events.length + 5).current).toBe(total);
    expect(measureForSounding(score, "RH", 0).total).toBe(total);
    // 每个发声音的所在小节单调不减
    for (let index = 1; index < events.length; index += 1) {
      const previous = measureForSounding(score, "RH", index - 1).current;
      expect(measureForSounding(score, "RH", index).current).toBeGreaterThanOrEqual(previous);
    }
  });

  it("scrolls to the sounding note without throwing (happy-dom)", () => {
    const score = generateL1({ hand: "RH", seed: 4, mode: "sight" });
    const element = document.createElement("div");
    document.body.append(element);
    try {
      renderScore(element, score, "RH", false);
      expect(() => scrollScoreToNote(element, score, "RH", 3)).not.toThrow();
    } finally {
      element.remove();
    }
  });

  it("maps a repeated pass back to the same written measure", () => {
    const whole = (id: string): Measure => ({
      notes: [{ id, pitches: [{ step: "C", octave: 4, alteration: 0 }], duration: "w" }],
    });
    const score: Score = {
      id: "score.paint.repeats",
      mode: "repertoire",
      level: 3,
      meter: { beats: 4, beatValue: 4 },
      keySignature: "C",
      hands: ["RH"],
      bpm: 72,
      repeats: [{ from: 0, to: 1 }],
      staves: {
        RH: { clef: "treble", measures: [whole("m0"), whole("m1"), whole("m2")] },
      },
    };
    // 演奏顺序 1–2–1–2–3：第二遍仍是谱面上的第 1、2 小节。
    expect(measureForSounding(score, "RH", 0).current).toBe(1);
    expect(measureForSounding(score, "RH", 2).current).toBe(1);
    expect(measureForSounding(score, "RH", 4).current).toBe(3);
    expect(measureForSounding(score, "RH", 9).current).toBe(3);
  });
});
