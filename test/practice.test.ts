import { describe, expect, it } from "vitest";
import { DURATION_BEATS } from "../src/domain/vocabulary";
import {
  CATALOG_VALIDATION as CHORD_CATALOG_VALIDATION,
  CHORD_CATALOG,
} from "../src/practice/chordCatalog";
import {
  CATALOG_VALIDATION as INTERVAL_CATALOG_VALIDATION,
  INTERVAL_CATALOG,
} from "../src/practice/intervalCatalog";
import { renderScore } from "../src/notation/renderScore";
import { BROKEN_CHORD_EXAMPLES } from "../src/practice/brokenChordContent";
import {
  degreeLabel,
  handSpanChoices,
  HAND_SPAN_EXAMPLES,
} from "../src/practice/handSpanContent";
import { MELODY_BANK } from "../src/practice/melodyBank";
import { melodyStaff, melodyToScore } from "../src/practice/melodyPlayback";
import { NOTE_EXAMPLES } from "../src/practice/noteContent";
import { PATTERN_EXAMPLES } from "../src/practice/patternContent";
import { arpeggioScore, blockScore, scoreFromPracticeStaff } from "../src/practice/practiceScore";
import {
  PRACTICE_KINDS,
  createPracticeQuestions,
  isPracticeAnswer,
  practiceQuestionCount,
} from "../src/practice/quiz";
import {
  CHORD_EXAMPLES,
  INTERVAL_EXAMPLES,
  PROGRESSIONS,
  SYMBOLS,
} from "../src/practice/theoryContent";

describe("practice content", () => {
  it("keeps the interval and chord catalogs valid", () => {
    expect(INTERVAL_CATALOG_VALIDATION).toEqual({ valid: true, errors: [] });
    expect(CHORD_CATALOG_VALIDATION).toEqual({ valid: true, errors: [] });
    expect(INTERVAL_CATALOG).toHaveLength(27);
    expect(CHORD_CATALOG).toHaveLength(8);
  });

  it("imports the symbol and melody banks without dropping entries", () => {
    expect(SYMBOLS).toHaveLength(32);
    expect(new Set(SYMBOLS.map((entry) => entry.id)).size).toBe(SYMBOLS.length);
    expect(MELODY_BANK).toHaveLength(22);
  });

  it("covers all 27 intervals, multiple chord roots and the new note/pattern banks", () => {
    expect(INTERVAL_EXAMPLES).toHaveLength(27);
    expect(new Set(INTERVAL_EXAMPLES.map((example) => example.intervalId)).size).toBe(27);
    // 八种和弦各配 2–3 个根音，不再全部从 C 起算。
    expect(CHORD_EXAMPLES.length).toBeGreaterThan(8);
    expect(new Set(CHORD_EXAMPLES.map((example) => example.typeId)).size).toBe(8);
    // 半减七（m7♭5）从 B 起算正好不用临时记号：B–D–F–A
    const halfDim = CHORD_EXAMPLES.find((example) => example.typeId === "halfDim7");
    expect(halfDim?.notes).toBe("B4 – D5 – F5 – A5");
    expect(halfDim?.label).toBe("半减七和弦 (m7♭5)");

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

  it("gives every progression question a one-measure-per-chord staff", () => {
    const questions = createPracticeQuestions("progressions", 11);
    expect(questions.length).toBeGreaterThan(0);
    for (const question of questions) {
      // 每个和弦一小节：谱面按进行逐和弦渲染，不是三个和弦糊在一小节里。
      expect(question.staff?.measures).toHaveLength(3);
      for (const measure of question.staff?.measures ?? []) {
        expect(measure).toHaveLength(1);
        expect(measure[0]?.duration).toBe("w");
      }
      // 谱面试听与分解试听都从这份提示出发生成，听到的和看到的是一致的。
      const score = scoreFromPracticeStaff(question.staff!, question.id);
      expect(score.staves.RH?.measures).toHaveLength(3);
    }
  });

  it("keeps minor progression staves in their minor key", () => {
    const minor = PROGRESSIONS.filter((example) => example.key.includes("小调"));
    expect(minor.length).toBeGreaterThan(0);
    for (const example of minor) {
      expect(example.staff.keySignature, example.id).toBe("Am");
      expect(scoreFromPracticeStaff(example.staff, example.id).keySignature).toBe("Am");
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
    const measures = score.staves.RH?.measures ?? [];

    expect(score.hands).toEqual(["RH"]);
    // 第一小节是主音和弦（听辨调性的锚点），旋律从第二小节开始。
    expect(measures[0]?.notes).toHaveLength(1);
    expect(measures[0]?.notes[0].pitches).toHaveLength(question.tonic.length);
    expect(measures[0]?.notes[0].duration).toBe("w");
    // 旋律音一个不少：Final_01 是 4/4，0.5×4 + 1×4 + 2 = 8 拍，正好两小节。
    const melodyNotes = measures.slice(1).flatMap((measure) => measure.notes);
    expect(melodyNotes).toHaveLength(question.melody.length);
    expect(melodyNotes[0].pitches[0]).toEqual({ step: "G", octave: 4, alteration: 0 });
    // 每小节拍数配平（4/4）：不满一小节的旋律音会另起一节。
    for (const measure of measures) {
      const beats = measure.notes.reduce((sum, note) => sum + DURATION_BEATS[note.duration], 0);
      expect(beats).toBeLessThanOrEqual(4);
    }
  });

  it("lays the melody staff out bar by bar with spelled durations", () => {
    const question = MELODY_BANK[0];
    const staff = melodyStaff(question);

    expect(staff.clef).toBe("treble");
    expect(staff.measures).toHaveLength(3); // 主音 1 小节 + 旋律 2 小节
    // 每小节不超过 4 拍，且除最后一节外都配平。
    for (const [index, measure] of staff.measures!.entries()) {
      const beats = measure.reduce((sum, group) => sum + (group.duration ? DURATION_BEATS[group.duration] : 1), 0);
      if (index < staff.measures!.length - 1) expect(beats).toBe(4);
      else expect(beats).toBeLessThanOrEqual(4);
    }
    // 时值按拍数映射：0.5 → 八分音符，2 → 二分音符。
    const flat = staff.measures!.flat();
    expect(flat[1]).toEqual({ pitches: ["G4"], duration: "8" });
    expect(flat[flat.length - 1]).toEqual({ pitches: ["D5"], duration: "h" });
  });

  it("keeps a 3/4 melody question in three-beat bars", () => {
    const waltz = MELODY_BANK.find((item) => item.meter === "3/4");
    expect(waltz).toBeTruthy();
    const staff = melodyStaff(waltz!);
    const score = melodyToScore(waltz!);

    expect(score.meter.beats).toBe(3);
    expect(staff.measures?.[0]?.[0].duration).toBe("hd"); // 主音和弦 3 拍满小节
    for (const measure of staff.measures!) {
      const beats = measure.reduce((sum, group) => sum + (group.duration ? DURATION_BEATS[group.duration] : 1), 0);
      expect(beats).toBeLessThanOrEqual(3);
    }
  });

  it("puts the melody staff on the question so the page can draw it", () => {
    const questions = createPracticeQuestions("melodies", 5);
    for (const question of questions) {
      expect(question.staff).toBeTruthy();
      // 谱面与音频同源：题目上的谱就是 melodyToScore 会播放的那一份。
      expect(question.staff).toEqual(melodyStaff(question.melody!));
    }
  });
});

describe("L4 practice content", () => {
  it("derives broken-chord examples from the chord bank without a second answer", () => {
    // 一一对应：根音、拼写、类型全部沿用和弦题库。
    expect(BROKEN_CHORD_EXAMPLES).toHaveLength(CHORD_EXAMPLES.length);
    for (const example of BROKEN_CHORD_EXAMPLES) {
      const source = CHORD_EXAMPLES.find((item) => item.id === example.id);
      expect(source).toBeTruthy();
      expect(source?.typeId).toBe(example.typeId);
      expect(example.arpeggio).toEqual(source?.staff.groups[0]?.pitches);
      // 谱面上每个音单独一组、四分音符：看到的分解形状。
      expect(example.staff.groups).toHaveLength(example.arpeggio.length);
      for (const group of example.staff.groups) {
        expect(group.pitches).toHaveLength(1);
        expect(group.duration).toBe("q");
      }
    }
  });

  it("asks for the chord type of a broken chord", () => {
    const questions = createPracticeQuestions("broken", 5);
    expect(questions.length).toBeGreaterThan(0);
    for (const question of questions) {
      expect(question.kind).toBe("broken");
      expect(question.answerId).toMatch(/^(maj|min|aug|maj7|min7|dom7|dim7|halfDim7)$/);
      expect(question.choices).toHaveLength(4);
      expect(question.choices.some((choice) => choice.id === question.answerId)).toBe(true);
      // prompt 就是依次弹出的几个音，和谱面组一一对应。
      const example = BROKEN_CHORD_EXAMPLES.find((item) => question.id === `broken:${item.id}`);
      expect(example).toBeTruthy();
      expect(question.prompt).toBe(example?.arpeggio.join(" – "));
    }
  });

  it("plays the same pitches as block and broken textures", () => {
    const example = BROKEN_CHORD_EXAMPLES[0];
    const broken = arpeggioScore(example.staff, example.id);
    const block = blockScore(example.staff, example.id);
    // 分解：一音一个事件；柱式：全部音在一个事件里。
    expect(broken.staves.RH?.measures[0]?.notes).toHaveLength(example.arpeggio.length);
    expect(block.staves.RH?.measures[0]?.notes).toHaveLength(1);
    expect(block.staves.RH?.measures[0]?.notes[0]?.pitches).toHaveLength(example.arpeggio.length);
    // 两种织体是同一组音，音高集合相同。
    const pitchSet = (score: { staves: { RH?: { measures: { notes: { pitches: { step: string; octave: number }[] }[] }[] } } }) =>
      new Set(
        (score.staves.RH?.measures ?? []).flatMap((measure) =>
          measure.notes.flatMap((note) => note.pitches.map((pitch) => `${pitch.step}${pitch.octave}`)),
        ),
      );
    expect(pitchSet(broken)).toEqual(pitchSet(block));
  });

  it("counts the outer span of hand-position questions by letter", () => {
    // 只数字母：C4–A4 是六度，G4–F5 是七度，C4–C5 是八度。
    const spans = new Map(HAND_SPAN_EXAMPLES.map((example) => [example.id, example.spanDegrees]));
    expect(spans.get("span:c-add9")).toBe(6);
    expect(spans.get("span:g-span")).toBe(7);
    expect(spans.get("span:c-octave")).toBe(8);
    expect(spans.get("span:c-major")).toBe(5);
    // 两端以内的音按音高排好，谱面从低到高。
    for (const example of HAND_SPAN_EXAMPLES) {
      expect(example.pitches).toHaveLength(example.staff.groups.length);
      expect(example.notes).toBe(example.pitches.join(" – "));
    }
  });

  it("offers four degree choices around the answer, clamped to 2..8", () => {
    for (let answer = 2; answer <= 8; answer += 1) {
      const choices = handSpanChoices(answer);
      expect(choices).toHaveLength(4);
      expect(new Set(choices.map((choice) => choice.id)).size).toBe(4);
      expect(choices.some((choice) => choice.id === String(answer))).toBe(true);
      for (const choice of choices) {
        const degrees = Number(choice.id);
        expect(degrees).toBeGreaterThanOrEqual(2);
        expect(degrees).toBeLessThanOrEqual(8);
        expect(choice.label).toBe(degreeLabel(degrees));
      }
    }
    // 八度的干扰项在一侧贴边，也要凑满四个（±3 兜底）。
    expect(handSpanChoices(8).map((choice) => choice.id).sort()).toEqual(["5", "6", "7", "8"]);
    expect(handSpanChoices(2).map((choice) => choice.id).sort()).toEqual(["2", "3", "4", "5"]);
  });

  it("renders broken-chord and hand-span questions with a staff", () => {
    for (const kind of ["broken", "handSpan"] as const) {
      const questions = createPracticeQuestions(kind, 11);
      expect(questions.length).toBeGreaterThan(0);
      for (const question of questions) {
        expect(question.staff).toBeTruthy();
        expect(() =>
          renderScore(document.createElement("div"), scoreFromPracticeStaff(question.staff!, question.id), "RH", false),
        ).not.toThrow();
      }
    }
  });
});
