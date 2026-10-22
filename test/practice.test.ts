import { describe, expect, it } from "vitest";
import {
  CATALOG_VALIDATION as CHORD_CATALOG_VALIDATION,
  CHORD_CATALOG,
} from "../src/practice/chordCatalog";
import {
  CATALOG_VALIDATION as INTERVAL_CATALOG_VALIDATION,
  INTERVAL_CATALOG,
} from "../src/practice/intervalCatalog";
import { renderScore } from "../src/notation/renderScore";
import { MELODY_BANK } from "../src/practice/melodyBank";
import { melodyToScore } from "../src/practice/melodyPlayback";
import { NOTE_EXAMPLES } from "../src/practice/noteContent";
import { PATTERN_EXAMPLES } from "../src/practice/patternContent";
import { scoreFromPracticeStaff } from "../src/practice/practiceScore";
import {
  PRACTICE_KINDS,
  createPracticeQuestions,
  isPracticeAnswer,
  practiceQuestionCount,
} from "../src/practice/quiz";
import {
  CHORD_EXAMPLES,
  INTERVAL_EXAMPLES,
  SYMBOLS,
} from "../src/practice/theoryContent";

describe("practice content", () => {
  it("keeps the interval and chord catalogs valid", () => {
    expect(INTERVAL_CATALOG_VALIDATION).toEqual({ valid: true, errors: [] });
    expect(CHORD_CATALOG_VALIDATION).toEqual({ valid: true, errors: [] });
    expect(INTERVAL_CATALOG).toHaveLength(27);
    expect(CHORD_CATALOG).toHaveLength(7);
  });

  it("imports the symbol and melody banks without dropping entries", () => {
    expect(SYMBOLS).toHaveLength(32);
    expect(new Set(SYMBOLS.map((entry) => entry.id)).size).toBe(SYMBOLS.length);
    expect(MELODY_BANK).toHaveLength(22);
  });

  it("covers all 27 intervals, multiple chord roots and the new note/pattern banks", () => {
    expect(INTERVAL_EXAMPLES).toHaveLength(27);
    expect(new Set(INTERVAL_EXAMPLES.map((example) => example.intervalId)).size).toBe(27);
    // 七种和弦各配 2–3 个根音，不再全部从 C 起算。
    expect(CHORD_EXAMPLES.length).toBeGreaterThan(7);
    expect(new Set(CHORD_EXAMPLES.map((example) => example.typeId)).size).toBe(7);
    expect(NOTE_EXAMPLES.length).toBeGreaterThan(8);
    expect(PATTERN_EXAMPLES).toHaveLength(8);
    for (const example of [...INTERVAL_EXAMPLES, ...CHORD_EXAMPLES, ...NOTE_EXAMPLES, ...PATTERN_EXAMPLES]) {
      expect(example.staff.groups.length).toBeGreaterThan(0);
    }
  });

  it("filters symbol questions by group without changing the option pool", () => {
    const questions = createPracticeQuestions("symbols", 3, { symbolGroups: ["速度"] });
    expect(questions).toHaveLength(4);
    for (const question of questions) {
      const entry = SYMBOLS.find((symbol) => question.id === `symbol:${symbol.id}`);
      expect(entry?.group).toBe("速度");
      expect(question.choices).toHaveLength(4);
    }
  });

  it("renders note / interval / chord / pattern questions with a staff prompt", () => {
    for (const kind of ["notes", "intervals", "chords", "patterns"] as const) {
      const questions = createPracticeQuestions(kind, 11);
      expect(questions.length).toBeGreaterThan(0);
      for (const question of questions) {
        expect(question.staff).toBeTruthy();
        expect(question.staff?.groups.length).toBeGreaterThan(0);
      }
    }

    const score = scoreFromPracticeStaff(
      { clef: "treble", groups: [{ pitches: ["C4", "E4"], duration: "w" }] },
      "test",
    );
    expect(score.staves.RH?.measures[0].notes[0].pitches).toHaveLength(2);
  });

  it("converts every staff prompt and renders the tricky spellings", () => {
    const examples = [...INTERVAL_EXAMPLES, ...CHORD_EXAMPLES, ...NOTE_EXAMPLES, ...PATTERN_EXAMPLES];
    for (const example of examples) {
      expect(() => scoreFromPracticeStaff(example.staff, example.id)).not.toThrow();
    }

    // 减二度（E–Fb）、增七度（C–B#）和减七和弦会用到不常见的拼写，单独画一遍。
    const tricky = [
      INTERVAL_EXAMPLES.find((example) => example.intervalId === "d2"),
      INTERVAL_EXAMPLES.find((example) => example.intervalId === "A7"),
      CHORD_EXAMPLES.find((example) => example.typeId === "dim7"),
    ];
    for (const example of tricky) {
      expect(example).toBeTruthy();
      const element = document.createElement("div");
      document.body.append(element);
      try {
        renderScore(element, scoreFromPracticeStaff(example!.staff, example!.id), "RH", false);
        expect(element.querySelector("svg")).not.toBeNull();
      } finally {
        element.remove();
      }
    }
  });

  it("builds deterministic quizzes with one correct choice per question", () => {
    for (const kind of PRACTICE_KINDS) {
      const first = createPracticeQuestions(kind, 42);
      const second = createPracticeQuestions(kind, 42);
      expect(first).toEqual(second);
      expect(first).toHaveLength(practiceQuestionCount(kind));

      for (const question of first) {
        expect(question.choices).toHaveLength(4);
        expect(new Set(question.choices.map((choice) => choice.id)).size).toBe(4);
        expect(new Set(question.choices.map((choice) => choice.label)).size).toBe(4);
        expect(question.choices.some((choice) => choice.id === question.answerId)).toBe(true);
        expect(isPracticeAnswer(question, question.answerId)).toBe(true);
        expect(isPracticeAnswer(question, "__not_a_choice__")).toBe(false);
      }
    }
  });

  it("does not repeat the same prompt within a quiz", () => {
    for (const kind of PRACTICE_KINDS) {
      const questions = createPracticeQuestions(kind, 7);
      expect(new Set(questions.map((question) => question.id)).size).toBe(questions.length);
    }
  });

  it("converts a melody question into a playable score", () => {
    const question = MELODY_BANK[0];
    const score = melodyToScore(question);
    const notes = score.staves.RH?.measures[0]?.notes ?? [];

    expect(score.hands).toEqual(["RH"]);
    expect(notes).toHaveLength(question.melody.length + 1);
    expect(notes[0].pitches).toHaveLength(question.tonic.length);
    expect(notes[0].duration).toBe("w");
    expect(notes[1].pitches[0]).toEqual({ step: "G", octave: 4, alteration: 0 });
  });
});
