import { describe, expect, it } from "vitest";
import { annotateScore, isBlackKey, keyPos, solveFingering, type SolverNote } from "../src/domain/fingering";
import { pitchToMidi } from "../src/domain/pitch";
import type { Duration, Hand, Measure, Mode, NoteEvent, Score, Step } from "../src/domain/types";
import { fingerFor } from "../src/domain/vocabulary";
import { generateL1 } from "../src/domain/generate";
import { generateL2, type L2Shape } from "../src/domain/generateL2";
import { PIANOPLAYER_REFERENCE, type ReferenceNote } from "./fixtures/pianoplayer-reference";

// ---------------------------------------------------------------------------
// 移植保真度：与上游 pianoplayer 逐条比对
// ---------------------------------------------------------------------------

describe("pianoplayer 移植保真度", () => {
  for (const scenario of PIANOPLAYER_REFERENCE) {
    it(`${scenario.name} 与上游求解结果一致`, () => {
      const notes: SolverNote[] = scenario.notes.map(toSolverNote);
      const solved = solveFingering(notes, scenario.side);
      expect(solved.map((note) => note.finger)).toEqual(scenario.fingers);
    });
  }

  it("锚点指法被原样保留", () => {
    const scale = [60, 62, 64, 65, 67, 69, 71, 72];
    const notes = scale.map((midi, index) => toSolverNote({
      midi,
      time: index,
      duration: 1,
      isChord: false,
      chordId: 0,
      chordNr: 0,
      notesInChord: 0,
      finger: index === 3 ? 5 : 0,
    }));
    const solved = solveFingering(notes, "right");
    expect(solved[3].finger).toBe(5);
    expect(solved.every((note) => note.finger >= 1 && note.finger <= 5)).toBe(true);
  });

  it("求解不会修改入参", () => {
    const notes = [60, 62, 64, 65].map((midi, index) =>
      toSolverNote({ midi, time: index, duration: 1, isChord: false, chordId: 0, chordNr: 0, notesInChord: 0, finger: 0 }),
    );
    const snapshot = JSON.parse(JSON.stringify(notes));
    solveFingering(notes, "right");
    expect(notes).toEqual(snapshot);
  });
});

// ---------------------------------------------------------------------------
// 键盘坐标
// ---------------------------------------------------------------------------

describe("keyPos 键盘坐标", () => {
  it("白键等距，黑键居中", () => {
    const c = keyPos(60);
    const d = keyPos(62);
    const e = keyPos(64);
    const f = keyPos(65);
    const cs = keyPos(61);
    expect(d - c).toBeCloseTo(e - d);
    expect(cs - c).toBeCloseTo((d - c) / 2);
    expect(keyPos(65) - keyPos(64)).toBeCloseTo(d - c);
    // 一个八度 16.5cm：C4 到 C5。
    expect(keyPos(72) - keyPos(60)).toBeCloseTo(16.5);
  });

  it("跨八度单调（B3 在 C4 左侧）", () => {
    expect(keyPos(59)).toBeLessThan(keyPos(60));
    expect(keyPos(71)).toBeLessThan(keyPos(72));
    for (let midi = 21; midi < 108; midi += 1) {
      expect(keyPos(midi + 1)).toBeGreaterThan(keyPos(midi));
    }
  });

  it("黑键识别", () => {
    expect(isBlackKey(61)).toBe(true);
    expect(isBlackKey(60)).toBe(false);
    expect(isBlackKey(66)).toBe(true);
    expect(isBlackKey(65)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 乐谱适配器
// ---------------------------------------------------------------------------

function note(id: string, label: string, duration: Duration, fingers?: number[]): NoteEvent {
  const match = /^([A-G])([#b]?)(-?\d+)$/.exec(label);
  if (!match) throw new Error(`bad pitch label: ${label}`);
  const alteration = match[2] === "#" ? 1 : match[2] === "b" ? -1 : 0;
  return {
    id,
    duration,
    pitches: [{ step: match[1] as Step, octave: Number(match[3]), alteration }],
    ...(fingers ? { fingers } : {}),
  };
}

function measure(notes: NoteEvent[]): Measure {
  return { notes };
}

function scoreOf(staves: Partial<Record<Hand, { clef: "treble" | "bass"; measures: Measure[] }>>, hands: Hand[] = ["RH"]): Score {
  return {
    id: "test",
    mode: "sight" as Mode,
    level: 2,
    meter: { beats: 4, beatValue: 4 },
    keySignature: "C",
    hands,
    bpm: 60,
    staves,
  };
}

function fingersOf(score: Score, hand: Hand): (number | undefined)[][] {
  return (score.staves[hand]?.measures ?? []).map((m) => m.notes.map((event) => event.fingers?.[0]));
}

describe("annotateScore 乐谱适配", () => {
  it("fill-gaps：已有手位指法的乐谱原样不动", () => {
    const score = generateL1({ hand: "RH", seed: 7, mode: "reading-lesson" });
    const annotated = annotateScore(score);
    expect(annotated).toEqual(score);
  });

  it("fill-gaps：越出手位的音由求解器补指法（C 大调音阶 1-2-3-1-2-3-4-5）", () => {
    const labels = ["C4", "D4", "E4", "F4", "G4", "A4", "B4", "C5"];
    const events = labels.map((label, index) => note(`n${index}`, label, "q"));
    const annotated = annotateScore(scoreOf({ RH: { clef: "treble", measures: [measure(events)] } }));
    expect(fingersOf(annotated, "RH")[0]).toEqual(scenario("scale-rh-quarters").fingers);
    expect(fingersOf(annotated, "RH")[0]).toEqual([1, 2, 3, 1, 2, 3, 4, 5]);
  });

  it("和弦音的每个音各得一个指法（与上游对照一致）", () => {
    const events = [
      note("c1", "C4", "q"),
      {
        id: "chord",
        duration: "q" as Duration,
        pitches: [
          { step: "C" as const, octave: 4, alteration: 0 as const },
          { step: "E" as const, octave: 4, alteration: 0 as const },
          { step: "G" as const, octave: 4, alteration: 0 as const },
        ],
      },
      note("c2", "C5", "q"),
    ];
    const annotated = annotateScore(scoreOf({ RH: { clef: "treble", measures: [measure(events)] } }));
    const all = annotated.staves.RH!.measures[0].notes.flatMap((event) => event.fingers ?? []);
    expect(all).toEqual(scenario("single-chord-c4e4g4-single").fingers);
    // 上游对该场景的结果：单音 1，和弦 1-2-4，尾音 5。
    expect(all).toEqual([1, 1, 2, 4, 5]);
  });

  it("左手镜像求解：下行音阶与上游一致（拇指从最高音起）", () => {
    const labels = ["C4", "B3", "A3", "G3", "F3", "E3", "D3", "C3"];
    const events = labels.map((label, index) => note(`n${index}`, label, "q"));
    const annotated = annotateScore(scoreOf({ LH: { clef: "bass", measures: [measure(events)] } }, ["LH"]));
    expect(fingersOf(annotated, "LH")[0]).toEqual(scenario("scale-lh-descending-quarters").fingers);
    expect(fingersOf(annotated, "LH")[0]).toEqual([1, 2, 3, 1, 2, 3, 4, 5]);
  });

  it("fill-gaps：已有指法作为锚点保留，缺口由求解器补（与上游对照一致）", () => {
    const events = [
      note("n0", "C4", "q", [2]),
      note("n1", "D4", "q"),
      note("n2", "E4", "q"),
      note("n3", "F4", "q"),
      note("n4", "G4", "q"),
    ];
    const annotated = annotateScore(scoreOf({ RH: { clef: "treble", measures: [measure(events)] } }));
    const fingers = annotated.staves.RH!.measures[0].notes.map((event) => event.fingers?.[0]);
    expect(fingers).toEqual(scenario("anchor-5-quarters").fingers);
    expect(fingers).toEqual([2, 1, 2, 3, 4]);
  });

  it("auto：忽略既有指法，整段交给求解器（与上游无锚点结果一致）", () => {
    const events = ["C4", "D4", "E4", "F4", "G4"].map((label, index) => note(`n${index}`, label, "q", [1]));
    const annotated = annotateScore(scoreOf({ RH: { clef: "treble", measures: [measure(events)] } }), "auto");
    expect(fingersOf(annotated, "RH")[0]).toEqual(scenario("scale-rh-5-quarters").fingers);
    expect(fingersOf(annotated, "RH")[0]).toEqual([1, 2, 3, 4, 5]);
  });

  it("跨小节拍连续：两小节八音音符与等长长句得到相同指法", () => {
    const labels = ["C4", "E4", "G4", "E4", "C4", "D4", "F4", "D4", "C4", "E4", "G4", "C5"];
    const events = labels.map((label, index) => note(`n${index}`, label, "8"));
    // 拆成两小节（每小节 6 个八分 = 3 拍）与不拆分各跑一次，结果应一致。
    const split = scoreOf({ RH: { clef: "treble", measures: [measure(events.slice(0, 6)), measure(events.slice(6))] } });
    const joined = scoreOf({ RH: { clef: "treble", measures: [measure(events)] } });
    expect(fingersOf(annotateScore(split), "RH").flat()).toEqual(fingersOf(annotateScore(joined), "RH").flat());
  });

  it("不修改入参，返回新对象", () => {
    const events = ["C4", "D4", "E4", "F4", "G4"].map((label, index) => note(`n${index}`, label, "q"));
    const score = scoreOf({ RH: { clef: "treble", measures: [measure(events)] } });
    const snapshot = JSON.parse(JSON.stringify(score));
    annotateScore(score);
    expect(score).toEqual(snapshot);
  });

  it("全休止符的手不参与求解", () => {
    const events: NoteEvent[] = [
      { id: "r0", duration: "wr", pitches: [] },
      { id: "r1", duration: "wr", pitches: [] },
      { id: "r2", duration: "wr", pitches: [] },
      { id: "r3", duration: "wr", pitches: [] },
    ];
    const annotated = annotateScore(scoreOf({ RH: { clef: "treble", measures: [measure(events)] } }));
    expect(annotated.staves.RH!.measures[0].notes.every((event) => event.fingers === undefined)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 生成管线无回归
// ---------------------------------------------------------------------------

describe("生成管线接入后指法不变", () => {
  it("L1 全部使用 C 手位指法", () => {
    for (const seed of [1, 2, 3, 42, 99]) {
      const score = generateL1({ hand: "RH", seed, mode: "sight" });
      for (const m of score.staves.RH!.measures) {
        for (const event of m.notes) {
          if (event.pitches.length === 0) continue;
          expect(event.fingers?.[0]).toBe(fingerFor("C", "RH", event.pitches[0]));
        }
      }
    }
  });

  it("L2 全部使用该课手位指法", () => {
    const shapes: L2Shape[] = [
      { kind: "eighths-single", hand: "RH" },
      { kind: "alternate" },
      { kind: "together", texture: "same" },
      { kind: "together", texture: "hold" },
      { kind: "key-find", key: "F", hand: "RH" },
      { kind: "key-line", key: "G", hand: "LH" },
      { kind: "shift-once", hand: "RH" },
    ];
    for (const shape of shapes) {
      for (const seed of [3, 8, 21]) {
        const score = generateL2({ seed, mode: "reading-lesson", shape });
        for (const hand of score.hands) {
          for (const m of score.staves[hand]!.measures) {
            for (const event of m.notes) {
              if (event.pitches.length === 0) continue;
              const finger = event.fingers?.[0];
              expect(finger).toBeGreaterThanOrEqual(1);
              expect(finger).toBeLessThanOrEqual(5);
            }
          }
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 性能
// ---------------------------------------------------------------------------

describe("求解性能", () => {
  it("32 音的八分音符乐谱在 3 秒内完成标注", () => {
    const labels = ["C4", "D4", "E4", "F4", "G4", "A4", "B4", "C5", "D5", "E5", "F5", "G5"];
    const events = Array.from({ length: 32 }, (_, index) => note(`n${index}`, labels[index % labels.length], "8"));
    const measures = [measure(events.slice(0, 8)), measure(events.slice(8, 16)), measure(events.slice(16, 24)), measure(events.slice(24))];
    const score = scoreOf({ RH: { clef: "treble", measures } });
    const started = Date.now();
    annotateScore(score);
    expect(Date.now() - started).toBeLessThan(3000);
  });
});

function toSolverNote(spec: ReferenceNote): SolverNote {
  return {
    midi: spec.midi,
    x: keyPos(spec.midi),
    time: spec.time,
    duration: spec.duration,
    isBlack: isBlackKey(spec.midi),
    isChord: spec.isChord,
    chordId: spec.chordId,
    chordNr: spec.chordNr,
    notesInChord: spec.notesInChord,
    finger: spec.finger,
    cost: 0,
    measure: 0,
  };
}

function scenario(name: string): (typeof PIANOPLAYER_REFERENCE)[number] {
  const found = PIANOPLAYER_REFERENCE.find((item) => item.name === name);
  if (!found) throw new Error(`missing reference scenario: ${name}`);
  return found;
}
