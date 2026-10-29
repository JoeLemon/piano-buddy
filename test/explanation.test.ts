import { describe, expect, it } from "vitest";
import { BROKEN_CHORD_EXAMPLES } from "../src/practice/brokenChordContent";
import { HAND_SPAN_EXAMPLES } from "../src/practice/handSpanContent";
import {
  CHORD_EXAMPLES,
  INTERVAL_EXAMPLES,
  MELODY_BANK,
  NOTE_EXAMPLES,
  PATTERN_EXAMPLES,
  PROGRESSIONS,
  brokenChordExplanation,
  chordExplanation,
  handSpanExplanation,
  intervalExplanation,
  melodyExplanation,
  noteExplanation,
  patternExplanation,
  progressionExplanation,
  staffPlacement,
} from "../src/practice";
import { createPracticeQuestions } from "../src/practice/quiz";

/**
 * 逐题讲解的可信度全靠「谱面位置」这一层算得对。
 * 这些期望值按五线谱常识手写，不跟着实现走——改算法时这里会报警。
 */
describe("staffPlacement", () => {
  it("places every treble example on the correct line or space", () => {
    const expected: Record<string, string> = {
      C4: "下加一线",
      D4: "下加一间",
      E4: "第一线",
      F4: "第一间",
      G4: "第二线",
      A4: "第二间",
      B4: "第三线",
      C5: "第三间",
      D5: "第四线",
      E5: "第四间",
    };
    for (const [pitch, placement] of Object.entries(expected)) {
      expect(staffPlacement("treble", pitch), pitch).toBe(placement);
    }
  });

  it("places every bass example on the correct line or space", () => {
    const expected: Record<string, string> = {
      C3: "第二间",
      D3: "第三线",
      E3: "第三间",
      F3: "第四线",
      G3: "第四间",
      A3: "第五线",
      B3: "上加一间",
      C4: "上加一线",
    };
    for (const [pitch, placement] of Object.entries(expected)) {
      expect(staffPlacement("bass", pitch), pitch).toBe(placement);
    }
  });

  it("continues above and below the staff in both clefs", () => {
    expect(staffPlacement("treble", "F5")).toBe("第五线");
    expect(staffPlacement("treble", "G5")).toBe("上加一间");
    expect(staffPlacement("treble", "A5")).toBe("上加一线");
    // 低音谱下加一线是 E2，再往下一条线才是 C2。
    expect(staffPlacement("bass", "E2")).toBe("下加一线");
    expect(staffPlacement("bass", "C2")).toBe("下加二线");
  });
});

describe("noteExplanation", () => {
  it("names the placement for every note example in the bank", () => {
    for (const example of NOTE_EXAMPLES) {
      const explained = noteExplanation(example);
      expect(explained.summary).toContain(example.pitch);
      expect(explained.steps.length).toBe(2);
      // 第二步必须把位置说出来，而不是重复「这是 C4」。
      expect(explained.steps[1]).toContain(staffPlacement(example.clef, example.pitch));
    }
  });

  it("points the counting direction toward the note, not always upward", () => {
    // 高音谱锚点是 C5，C4 在它下方，不能说「往上数」。
    const trebleLow = NOTE_EXAMPLES.find(
      (example) => example.clef === "treble" && example.pitch === "C4",
    );
    expect(trebleLow).toBeTruthy();
    expect(noteExplanation(trebleLow!).steps[1]).toContain("往下");

    // 低音谱锚点是 C3，同名的 C4 在它上方。
    const bassHigh = NOTE_EXAMPLES.find(
      (example) => example.clef === "bass" && example.pitch === "C4",
    );
    expect(bassHigh).toBeTruthy();
    expect(noteExplanation(bassHigh!).steps[1]).toContain("往上");
  });
});

describe("intervalExplanation", () => {
  it("explains a major third by letter count and semitones", () => {
    const third = INTERVAL_EXAMPLES.find((example) => example.intervalId === "M3");
    expect(third).toBeTruthy();
    const explained = intervalExplanation(third!);
    expect(explained.summary).toContain("三度");
    expect(explained.summary).toContain("4 个半音");
    expect(explained.steps[0]).toContain("三个音级");
    expect(explained.steps[1]).toContain("大三度");
  });

  it("keeps augmented and diminished spellings apart", () => {
    const augmented = INTERVAL_EXAMPLES.find((example) => example.intervalId === "A4");
    const diminished = INTERVAL_EXAMPLES.find((example) => example.intervalId === "d5");
    expect(augmented).toBeTruthy();
    expect(diminished).toBeTruthy();
    // A4 与 d5 半音数相同，但字母级数与性质不同，讲解必须分开。
    expect(intervalExplanation(augmented!).summary).toContain("增");
    expect(intervalExplanation(diminished!).summary).toContain("减");
  });
});

describe("chordExplanation", () => {
  it("spells out the stacked thirds of a major triad", () => {
    const major = CHORD_EXAMPLES.find((example) => example.typeId === "maj");
    expect(major).toBeTruthy();
    const explained = chordExplanation(major!);
    expect(explained.summary).toContain("大三度 + 小三度");
    expect(explained.steps[1]).toContain("0 / 4 / 7");
  });

  it("describes every chord type in the practice set", () => {
    for (const example of CHORD_EXAMPLES) {
      const explained = chordExplanation(example);
      expect(explained.steps.length, example.id).toBe(2);
      expect(explained.summary, example.id).toContain(example.root);
    }
  });
});

describe("progressionExplanation", () => {
  it("pairs each chord with its roman numeral", () => {
    const plain = PROGRESSIONS.find((example) => example.id === "major-141");
    expect(plain).toBeTruthy();
    const explained = progressionExplanation(plain!);
    expect(explained.steps[1]).toBe("逐个定位：C 是第 I 级，F 是第 IV 级，C 是第 I 级。");
  });
});

describe("brokenChordExplanation", () => {
  it("stacks the broken notes back into thirds", () => {
    const major = BROKEN_CHORD_EXAMPLES.find((example) => example.typeId === "maj");
    expect(major).toBeTruthy();
    const explained = brokenChordExplanation(major!);
    expect(explained.summary).toContain("大三度 + 小三度");
    // 步骤先拢音、再叠三度、再给 A/B 试听的口子。
    expect(explained.steps).toHaveLength(3);
    expect(explained.steps[1]).toContain("0 / 4 / 7");
    expect(explained.steps[2]).toContain("柱式");
  });

  it("describes every broken example from the chord bank", () => {
    for (const example of BROKEN_CHORD_EXAMPLES) {
      const explained = brokenChordExplanation(example);
      expect(explained.steps.length, example.id).toBe(3);
      expect(explained.summary, example.id).toContain(example.root);
    }
  });
});

describe("handSpanExplanation", () => {
  it("counts the outer letters and says whether the hand must expand", () => {
    const add9 = HAND_SPAN_EXAMPLES.find((example) => example.id === "span:c-add9");
    expect(add9).toBeTruthy();
    const explained = handSpanExplanation(add9!);
    expect(explained.summary).toContain("C4 到 A4");
    expect(explained.summary).toContain("六度");
    expect(explained.steps[1]).toContain("C、D、E、F、G、A");
    expect(explained.steps[2]).toContain("撑开");

    // 五度以内：结论反过来，说「罩得住」。
    const triad = HAND_SPAN_EXAMPLES.find((example) => example.id === "span:c-major");
    expect(handSpanExplanation(triad!).steps[2]).toContain("罩得住");
  });

  it("only counts the outer two notes, not the middle ones", () => {
    const octave = HAND_SPAN_EXAMPLES.find((example) => example.id === "span:c-octave");
    expect(octave).toBeTruthy();
    const explained = handSpanExplanation(octave!);
    // C4–G4–C5：中间有个 G4，但跨度按 C4 到 C5 算八度。
    expect(explained.summary).toContain("八度");
    expect(explained.steps[0]).toContain("C4 和 C5");
  });
});

describe("patternExplanation", () => {
  it("describes an ascending run", () => {
    const up = PATTERN_EXAMPLES.find((example) => example.id === "up4");
    expect(up).toBeTruthy();
    expect(patternExplanation(up!).steps[1]).toContain("每一步都比前一个高");
  });

  it("names the turn when the line reverses", () => {
    const arch = PATTERN_EXAMPLES.find((example) => example.id === "arch");
    expect(arch).toBeTruthy();
    expect(patternExplanation(arch!).steps[1]).toContain("先");
  });
});

describe("melodyExplanation", () => {
  it("ties the key to the tonic chord", () => {
    const question = MELODY_BANK[0];
    expect(question).toBeTruthy();
    const explained = melodyExplanation(question);
    expect(explained.summary).toContain(question.key.replace("major", "大调").replace("minor", "小调"));
    expect(explained.steps[0]).toContain(question.tonic.join(" – "));
  });
});

describe("practice questions carry the steps", () => {
  it("attaches explanation steps to every seeded question", () => {
    for (const kind of ["notes", "intervals", "chords", "progressions", "patterns", "melodies"] as const) {
      const questions = createPracticeQuestions(kind, 7);
      expect(questions.length, kind).toBeGreaterThan(0);
      for (const question of questions) {
        expect(question.explanation.length, question.id).toBeGreaterThan(0);
        expect(question.explanationSteps?.length, question.id).toBeGreaterThan(0);
      }
    }
  });
});
