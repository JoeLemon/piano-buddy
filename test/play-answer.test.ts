import { describe, expect, it } from "vitest";
import { parsePitchLabel, pitchToMidi } from "../src/domain/pitch";
import {
  createPracticeQuestions,
  judgePlay,
  midiLabel,
  pitchClassName,
  playHintFor,
  playTargetFor,
  playTargetText,
  type PracticeKind,
  type PlayTarget,
} from "../src/practice";

function targetOf(kind: PracticeKind, seed = 3, pick = 0): PlayTarget {
  const questions = createPracticeQuestions(kind, seed);
  const question = questions[pick];
  const target = playTargetFor(question);
  if (!target) throw new Error(`${kind} 应该可以弹奏作答`);
  return target;
}

function midis(labels: string[]): number[] {
  return labels.map((label) => pitchToMidi(parsePitchLabel(label)));
}

describe("playTargetFor", () => {
  it("reads the single note straight off the staff", () => {
    const questions = createPracticeQuestions("notes", 11);
    for (const question of questions) {
      const target = playTargetFor(question);
      expect(target).not.toBeNull();
      expect(target?.ordered).toBe(false);
      // 单音题的题面就是音名，谱面必须和题面一致——两处不一致就是教错。
      expect(target?.midis).toEqual([pitchToMidi(parsePitchLabel(question.prompt))]);
    }
  });

  it("keeps intervals and chords unordered and in staff order", () => {
    const interval = targetOf("intervals");
    expect(interval.midis).toHaveLength(2);
    expect(interval.ordered).toBe(false);

    const chord = targetOf("chords");
    expect(chord.midis.length).toBeGreaterThanOrEqual(3);
    expect(chord.ordered).toBe(false);
  });

  it("keeps patterns ordered", () => {
    const pattern = targetOf("patterns");
    expect(pattern.midis).toHaveLength(4);
    expect(pattern.ordered).toBe(true);
  });

  it("refuses kinds whose staff is not the answer", () => {
    for (const kind of ["symbols", "accidentals", "progressions", "melodies"] as const) {
      const questions = createPracticeQuestions(kind, 5);
      expect(questions.length).toBeGreaterThan(0);
      for (const question of questions) {
        expect(playTargetFor(question)).toBeNull();
      }
    }
  });
});

describe("judgePlay", () => {
  const single: PlayTarget = { kind: "notes", midis: [60], ordered: false };
  const third: PlayTarget = { kind: "intervals", midis: [60, 64], ordered: false };
  const triad: PlayTarget = { kind: "chords", midis: [60, 64, 67], ordered: false };
  const scale: PlayTarget = { kind: "patterns", midis: [60, 62, 64, 65], ordered: true };

  it("stays pending until the last note arrives", () => {
    expect(judgePlay(triad, []).state).toBe("pending");
    expect(judgePlay(triad, [60]).state).toBe("pending");
    const two = judgePlay(triad, [60, 64]);
    expect(two.state).toBe("pending");
    expect(two.matched).toBe(2);
  });

  it("accepts a chord in any order and any inversion", () => {
    expect(judgePlay(triad, [67, 60, 64]).state).toBe("correct");
    expect(judgePlay(triad, [64, 67, 60]).state).toBe("correct");
  });

  it("ignores a key pressed twice while counting notes", () => {
    // 和弦音按两遍不该把进度撑满，也不该判错。
    expect(judgePlay(triad, [60, 60, 64]).state).toBe("pending");
    expect(judgePlay(triad, [60, 60, 64, 67]).state).toBe("correct");
  });

  it("fails on the first note outside the answer", () => {
    const judge = judgePlay(third, [60, 62]);
    expect(judge.state).toBe("wrong");
    expect(judge.stray).toBe(62);
    expect(judge.matched).toBe(1);
  });

  it("requires the exact order for patterns", () => {
    expect(judgePlay(scale, [60, 62, 64, 65]).state).toBe("correct");
    const swapped = judgePlay(scale, [60, 64]);
    expect(swapped.state).toBe("wrong");
    expect(swapped.stray).toBe(64);
    expect(swapped.matched).toBe(1);
  });

  it("counts repeated notes in patterns as separate steps", () => {
    const repeat: PlayTarget = { kind: "patterns", midis: [60, 60, 64, 64], ordered: true };
    expect(judgePlay(repeat, [60]).state).toBe("pending");
    expect(judgePlay(repeat, [60, 60, 64]).state).toBe("pending");
    expect(judgePlay(repeat, [60, 60, 64, 64]).state).toBe("correct");
  });

  it("treats the right note one octave off as wrong but recognisable", () => {
    const judge = judgePlay(single, [72]);
    expect(judge.state).toBe("wrong");
    expect(pitchClassName(judge.stray as number)).toBe(pitchClassName(60));
    expect(pitchClassName(62)).not.toBe(pitchClassName(60));
  });
});

describe("labels and hints", () => {
  it("names midi notes the way the rest of the app does", () => {
    expect(midiLabel(21)).toBe("A0");
    expect(midiLabel(60)).toBe("C4");
    expect(midiLabel(61)).toBe("C#4");
    expect(midiLabel(108)).toBe("C8");
  });

  it("joins the answer with the same separator the prompts use", () => {
    expect(playTargetText({ kind: "chords", midis: midis(["C4", "E4", "G4"]), ordered: false })).toBe(
      "C4 · E4 · G4",
    );
  });

  it("says what to play, and whether the order matters", () => {
    expect(playHintFor({ kind: "notes", midis: [60], ordered: false })).toContain("这个音");
    expect(playHintFor({ kind: "intervals", midis: [60, 64], ordered: false })).toContain("两个音");
    expect(playHintFor({ kind: "chords", midis: [60, 64, 67], ordered: false })).toContain("和弦音");
    expect(playHintFor({ kind: "patterns", midis: [60, 62], ordered: true })).toContain("按谱面上的顺序");
  });
});
