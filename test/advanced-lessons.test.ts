import { describe, expect, it } from "vitest";
import { initialProfile } from "../src/domain/profile";
import { noteBeats } from "../src/domain/vocabulary";
import {
  THEORY_PATH,
  createCurriculumStageQuestions,
  nextTheoryNode,
  scoreFromPracticeStaff,
  theoryChapterNodes,
} from "../src/practice";

describe("L4–L6 micro-lessons", () => {
  it("renders the 6/8 meter and 3:2 triplet staff from lesson questions", () => {
    const meterQuestion = createCurriculumStageQuestions("L5-2", 3).find(
      (question) => question.id === "l5:meter:count",
    );
    expect(meterQuestion?.staff?.meter).toEqual({ beats: 6, beatValue: 8 });

    const meterScore = scoreFromPracticeStaff(meterQuestion!.staff!, "l5-meter");
    expect(meterScore.meter).toEqual({ beats: 6, beatValue: 8 });

    const tripletQuestion = createCurriculumStageQuestions("L5-3", 3).find(
      (question) => question.id === "l5:triplet:beats",
    );
    const tripletScore = scoreFromPracticeStaff(tripletQuestion!.staff!, "l5-triplet");
    const notes = tripletScore.staves.RH?.measures[0]?.notes ?? [];
    expect(notes.filter((note) => note.tuplet).length).toBe(3);
    expect(notes[0]?.tuplet).toBe("l5-triplet");
    expect(noteBeats(notes[0])).toBeCloseTo(1 / 3);
  });

  it("teaches inversions and minor triads with a real staff", () => {
    for (const question of createCurriculumStageQuestions("L4-3", 7)) {
      expect(question.staff?.groups[0]?.pitches.length).toBe(3);
      expect(question.choices.some((choice) => choice.id === question.answerId)).toBe(true);
      expect(question.explanation.length).toBeGreaterThan(0);
    }

    const minor = createCurriculumStageQuestions("L4-4", 7);
    expect(minor).toHaveLength(4);
    expect(minor.some((question) => question.id === "l4:minor-key")).toBe(true);
    expect(minor.find((question) => question.id === "l4:minor-key")?.answerId).toBe("Am");

    const shift = createCurriculumStageQuestions("L6-3", 7);
    expect(shift).toHaveLength(4);
    expect(shift.some((question) => question.id === "l6:position:strategy")).toBe(true);
  });

  it("teaches the diminished chords from a dedicated L6 lesson", () => {
    const stage = createCurriculumStageQuestions("L6-6", 11);
    expect(stage).toHaveLength(4);
    // 四道题都只在这两类里出：减七两道、半减七两道（题库各配两个根音）
    const types = new Set(stage.map((question) => question.answerId));
    expect([...types].sort()).toEqual(["dim7", "halfDim7"]);
    expect(stage.every((question) => question.staff?.groups[0]?.pitches.length === 4)).toBe(true);
    expect(stage.every((question) => question.explanation.length > 0)).toBe(true);
  });

  it("chains L5 and L6 after the earlier theory chapters", () => {
    expect(theoryChapterNodes("l5")).toHaveLength(5);
    expect(theoryChapterNodes("l6")).toHaveLength(6);

    const beforeL5 = THEORY_PATH.filter(
      (node) => node.chapter === "basics" || node.chapter === "l3" || node.chapter === "l4",
    ).map((node) => node.id);
    const next = nextTheoryNode({
      ...initialProfile().theoryPath,
      completed: beforeL5,
    });
    expect(next?.id).toBe("L5-1");
  });
});
