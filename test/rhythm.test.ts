import { describe, expect, it } from "vitest";
import {
  barOfBeat,
  beatAt,
  beatText,
  countInFor,
  gradeRhythm,
  offsetText,
  ON_BEAT_TOLERANCE,
  planForMelody,
  planForPattern,
  rhythmSummary,
  type RhythmHit,
  type RhythmPlan,
} from "../src/practice/rhythm";
import type { PlayTarget } from "../src/practice/playAnswer";
import type { PlaybackQuestion } from "../src/practice/melodyTypes";
import type { Measure, Score } from "../src/domain/types";
import { planForScore } from "../src/practice/rhythm";

/** 一条 4/4、四分音符、C4–D4–E4 的短旋律，够用且好算。 */
const MELODY: PlaybackQuestion = {
  id: "test-1",
  key: "G major",
  meter: "4/4",
  tonic: ["G4", "B4", "D5", "G5"],
  melody: [
    { pitch: "C4", beats: 1 },
    { pitch: "D4", beats: 1 },
    { pitch: "E4", beats: 1 },
  ],
};

/** C4 / D4 / E4 / F4 的 MIDI。 */
const C4 = 60;
const D4 = 62;
const E4 = 64;
const F4 = 65;

const START = 1000;
const msPerBeat = (bpm: number) => 60000 / bpm;

/** 目标拍 → 绝对毫秒，省得每个用例手算。 */
function atBeatMs(plan: RhythmPlan, targetBeat: number, countIn: number, bpm = plan.bpm): number {
  return START + (targetBeat + countIn) * msPerBeat(bpm);
}

describe("planForMelody", () => {
  it("accumulates start beats from the note durations", () => {
    const plan = planForMelody(MELODY);

    expect(plan.slots.map((slot) => slot.startBeat)).toEqual([0, 1, 2]);
    expect(plan.totalBeats).toBe(3);
    expect(plan.bpm).toBe(80);
    expect(plan.beatsPerBar).toBe(4);
  });

  it("keeps dotted and half values on the grid", () => {
    const plan = planForMelody({
      ...MELODY,
      melody: [
        { pitch: "C4", beats: 1.5 },
        { pitch: "D4", beats: 0.5 },
        { pitch: "E4", beats: 2 },
      ],
    });

    expect(plan.slots.map((slot) => slot.startBeat)).toEqual([0, 1.5, 2]);
    expect(plan.totalBeats).toBe(4);
  });

  it("reads the bar length from the meter", () => {
    expect(planForMelody(MELODY).beatsPerBar).toBe(4);
    expect(planForMelody({ ...MELODY, meter: "3/4" }).beatsPerBar).toBe(3);
  });

  it("uses one full bar as the count-in", () => {
    expect(countInFor(planForMelody(MELODY))).toBe(4);
    expect(countInFor(planForMelody({ ...MELODY, meter: "3/4" }))).toBe(3);
  });

  it("honours an explicit tempo so the grid follows the slow take", () => {
    const slow = planForMelody(MELODY, 60);
    expect(slow.bpm).toBe(60);
    // 拍点不随速度变化，变的是每拍多少毫秒。
    expect(slow.slots.map((slot) => slot.startBeat)).toEqual([0, 1, 2]);
  });
});

describe("beatAt", () => {
  it("counts the count-in as negative beats", () => {
    const plan = planForMelody(MELODY);
    expect(beatAt(plan, START, START, 4)).toBeCloseTo(-4, 6);
    expect(beatAt(plan, START, START + 2 * msPerBeat(80), 4)).toBeCloseTo(-2, 6);
  });

  it("puts the downbeat at zero when the count-in ends", () => {
    const plan = planForMelody(MELODY);
    const downbeat = START + 4 * msPerBeat(80);
    expect(beatAt(plan, START, downbeat, 4)).toBeCloseTo(0, 6);
  });
});

describe("gradeRhythm", () => {
  const plan = planForMelody(MELODY);
  const countIn = countInFor(plan);

  const hit = (midi: number, targetBeat: number, shift = 0): RhythmHit => ({
    midi,
    atMs: atBeatMs(plan, targetBeat, countIn) + shift,
  });

  it("passes a take that lands exactly on the beat", () => {
    const result = gradeRhythm(plan, [hit(C4, 0), hit(D4, 1), hit(E4, 2)], START, countIn);

    expect(result.accuracy).toBe(1);
    expect(result.onCount).toBe(3);
    expect(result.playedCount).toBe(3);
    expect(result.meanOffset).toBeCloseTo(0, 6);
    expect(result.steps.every((step) => step.quality === "on")).toBe(true);
  });

  it("accepts a hit inside the tolerance and rejects one just outside", () => {
    const inside = msPerBeat(80) * ON_BEAT_TOLERANCE * 0.9;
    const outside = msPerBeat(80) * ON_BEAT_TOLERANCE * 1.1;

    const ok = gradeRhythm(plan, [hit(C4, 0, inside)], START, countIn);
    expect(ok.steps[0]?.quality).toBe("on");

    const late = gradeRhythm(plan, [hit(C4, 0, outside)], START, countIn);
    expect(late.steps[0]?.quality).toBe("off");
    expect(late.steps[0]?.offsetBeat).toBeCloseTo(ON_BEAT_TOLERANCE * 1.1, 3);
  });

  it("treats an early hit symmetrically", () => {
    const result = gradeRhythm(
      plan,
      [hit(C4, 0, -msPerBeat(80) * 0.5)],
      START,
      countIn,
    );
    expect(result.steps[0]?.quality).toBe("off");
    expect(result.steps[0]?.offsetBeat).toBeCloseTo(-0.5, 3);
    expect(offsetText(result.steps[0]?.offsetBeat ?? 0)).toBe("早了半拍");
  });

  it("marks missing notes instead of shifting the rest", () => {
    // 只弹了第 1、3 个音（第 3 个音明确指定 slot 2）：第二个位置必须算漏，
    // 不能把 E4 顶上来。
    const result = gradeRhythm(
      plan,
      [hit(C4, 0), { ...hit(E4, 2), slotIndex: 2 }],
      START,
      countIn,
    );

    expect(result.steps.map((step) => step.quality)).toEqual(["on", "missed", "on"]);
    expect(result.steps[1]?.midi).toBeNull();
    expect(result.steps[2]?.midi).toBe(E4);
    expect(result.accuracy).toBeCloseTo(2 / 3, 6);
  });

  it("falls back to positional order when no slot is given", () => {
    // 音型题的语义：弹错一个音就停在原地，第二次击键仍然算第 2 个音。
    const result = gradeRhythm(plan, [hit(C4, 0), hit(E4, 2)], START, countIn);

    expect(result.steps[0]?.quality).toBe("on");
    expect(result.steps[1]?.midi).toBe(E4);
    expect(result.steps[1]?.pitchMatched).toBe(false);
    expect(result.steps[2]?.quality).toBe("missed");
  });

  it("keeps the first attempt when the same note is pressed twice", () => {
    const onBeat = atBeatMs(plan, 0, countIn);
    const result = gradeRhythm(
      plan,
      [
        { midi: C4, atMs: onBeat + msPerBeat(80) * 0.5 },
        { midi: C4, atMs: onBeat, slotIndex: 0 },
      ],
      START,
      countIn,
    );

    // 第二次按得再准，也不能覆盖第一次「晚了半拍」的事实。
    expect(result.steps[0]?.quality).toBe("off");
    expect(result.steps[0]?.offsetBeat).toBeCloseTo(0.5, 3);
  });

  it("separates a wrong pitch from a wrong beat", () => {
    const result = gradeRhythm(plan, [hit(C4 + 12, 0)], START, countIn);

    expect(result.steps[0]?.quality).toBe("on");
    expect(result.steps[0]?.pitchMatched).toBe(false);
    expect(result.playedCount).toBe(1);
    // 拍子对但音错了，不能算「音高与节拍都对」。
    expect(result.onCount).toBe(0);
    expect(result.accuracy).toBe(0);
  });

  it("reports a systematic late offset", () => {
    const shift = msPerBeat(80) * 0.5;
    const result = gradeRhythm(
      plan,
      [hit(C4, 0, shift), hit(D4, 1, shift), hit(E4, 2, shift)],
      START,
      countIn,
    );

    expect(result.meanOffset).toBeCloseTo(0.5, 3);
    expect(result.accuracy).toBe(0);
    expect(rhythmSummary(result)).toContain("整体偏晚");
  });

  it("says so when there is no systematic drift", () => {
    const result = gradeRhythm(plan, [hit(C4, 0), hit(D4, 1), hit(E4, 2)], START, countIn);
    expect(rhythmSummary(result)).toContain("整体没有系统性偏移");
  });

  it("scales with tempo: the same delay is smaller at a slower tempo", () => {
    const delayMs = 200;
    const fast = planForMelody(MELODY, 80);
    const slow = planForMelody(MELODY, 60);

    const fastBeat = beatAt(fast, START, atBeatMs(fast, 0, 4) + delayMs, 4);
    const slowBeat = beatAt(slow, START, atBeatMs(slow, 0, 4, 60) + delayMs, 4);

    // 80bpm：200ms ≈ 0.27 拍（超出容差）；60bpm：约 0.2 拍（还在容差内）。
    expect(fastBeat).toBeGreaterThan(ON_BEAT_TOLERANCE);
    expect(slowBeat).toBeLessThan(ON_BEAT_TOLERANCE);
  });

  it("ignores extra hits beyond the melody", () => {
    const result = gradeRhythm(
      plan,
      [hit(C4, 0), hit(D4, 1), hit(E4, 2), hit(72, 3)],
      START,
      countIn,
    );
    expect(result.steps).toHaveLength(3);
    expect(result.accuracy).toBe(1);
  });

  it("returns an empty result for an empty plan", () => {
    const empty: RhythmPlan = { slots: [], bpm: 80, beatsPerBar: 4, totalBeats: 0 };
    const result = gradeRhythm(empty, [], START, 4);

    expect(result.total).toBe(0);
    expect(result.accuracy).toBe(0);
    expect(result.meanOffset).toBeNull();
    expect(rhythmSummary(result)).toBe("这段没有可跟的音。");
  });
});

describe("planForPattern", () => {
  const target: PlayTarget = {
    kind: "patterns",
    midis: [C4, D4, E4, F4],
    ordered: true,
    beats: [1, 1, 0.5, 0.5],
  };

  it("lays the notes out by their written durations", () => {
    const plan = planForPattern(target);
    expect(plan).not.toBeNull();
    expect(plan?.slots.map((slot) => slot.startBeat)).toEqual([0, 1, 2, 2.5]);
    expect(plan?.totalBeats).toBe(3);
  });

  it("refuses non-sequential kinds: a chord has no rhythm to grade", () => {
    expect(planForPattern({ kind: "chords", midis: [C4, E4, 67], ordered: false })).toBeNull();
    expect(planForPattern({ kind: "notes", midis: [C4], ordered: false })).toBeNull();
  });

  it("defaults a missing duration to a quarter note", () => {
    const plan = planForPattern({ kind: "patterns", midis: [C4, D4], ordered: true, beats: [1] });
    expect(plan?.slots[1]?.beats).toBe(1);
    expect(plan?.totalBeats).toBe(2);
  });
});

/** 一份够用的两小节乐谱：右手 C4–D4，左手 C3 铺底。 */
function scoreOf(options: {
  hands?: Array<"RH" | "LH">;
  bpm?: number;
  beats?: 3 | 4;
} = {}): Score {
  const hands = options.hands ?? ["RH", "LH"];
  const staves: Score["staves"] = {};
  if (hands.includes("RH")) {
    staves.RH = {
      clef: "treble",
      measures: [
        {
          notes: [
            { id: "r1", pitches: [{ step: "C", octave: 4, alteration: 0 }], duration: "q" },
            { id: "r2", pitches: [{ step: "D", octave: 4, alteration: 0 }], duration: "h" },
          ],
        },
      ],
    };
  }
  if (hands.includes("LH")) {
    staves.LH = {
      clef: "bass",
      measures: [
        {
          notes: [
            { id: "l1", pitches: [{ step: "C", octave: 3, alteration: 0 }], duration: "w" },
          ],
        },
      ],
    };
  }
  return {
    id: "score-test",
    mode: "repertoire",
    level: 2,
    meter: { beats: options.beats ?? 4, beatValue: 4 },
    keySignature: "C",
    hands,
    bpm: options.bpm ?? 80,
    staves,
  };
}

const C3 = 48;

describe("planForScore", () => {
  it("reads the beats straight off the score", () => {
    const plan = planForScore(scoreOf({ hands: ["RH"] }));

    // C4 四分音符占第 0 拍，D4 二分音符接在第 1 拍，总长 3 拍。
    expect(plan.slots.map((slot) => slot.startBeat)).toEqual([0, 1]);
    expect(plan.slots.map((slot) => slot.beats)).toEqual([1, 2]);
    expect(plan.totalBeats).toBe(3);
    expect(plan.bpm).toBe(80);
    expect(plan.beatsPerBar).toBe(4);
  });

  it("merges the two hands on the same beat into one position", () => {
    const both = planForScore(scoreOf());
    // 第 0 拍是右手 C4 与左手 C3：必须一个位置一起按，不能拆成两拍。
    expect(both.slots[0]?.midis).toEqual([C3, C4]);
    expect(both.slots).toHaveLength(2);
  });

  it("only keeps the requested hand", () => {
    const right = planForScore(scoreOf(), "RH");
    expect(right.slots[0]?.midis).toEqual([C4]);
  });

  it("carries the meter and the requested tempo over to the grid", () => {
    const plan = planForScore(scoreOf({ beats: 3 }), "RH", 60);
    expect(plan.beatsPerBar).toBe(3);
    expect(plan.bpm).toBe(60);
    // 拍点不随速度变化，只有每拍多少毫秒变。
    expect(plan.slots.map((slot) => slot.startBeat)).toEqual([0, 1]);
  });

  it("6/8 的网格仍以四分音符为一格：一小节 3 格", () => {
    const base = scoreOf({ hands: ["RH"] });
    const steps = ["C", "D", "E", "F", "G", "A"] as const;
    const score: Score = {
      ...base,
      meter: { beats: 6, beatValue: 8 },
      staves: {
        RH: {
          clef: "treble",
          measures: [{
            notes: steps.map((step, index) => ({
              id: `s${index}`,
              pitches: [{ step, octave: 4, alteration: 0 }],
              duration: "8" as const,
            })),
          }],
        },
      },
    };
    const plan = planForScore(score, "RH");
    expect(plan.beatsPerBar).toBe(3);
    expect(plan.totalBeats).toBe(3);
    expect(plan.measureStarts).toEqual([0]);
  });

  it("skips rests instead of putting a slot there", () => {
    const plan = planForScore({
      ...scoreOf({ hands: ["RH"] }),
      staves: {
        RH: {
          clef: "treble",
          measures: [
            {
              notes: [
                { id: "x", pitches: [], duration: "qr" },
                { id: "y", pitches: [{ step: "E", octave: 4, alteration: 0 }], duration: "q" },
              ],
            },
          ],
        },
      },
    });
    expect(plan.slots.map((slot) => slot.startBeat)).toEqual([1]);
    expect(plan.totalBeats).toBe(2);
  });

  it("lays out the grid in performance order when the score repeats", () => {
    const oneMeasure = (id: string): Measure => ({
      notes: [{ id, pitches: [{ step: "C", octave: 4, alteration: 0 }], duration: "w" }],
    });
    const score: Score = {
      ...scoreOf({ hands: ["RH"] }),
      repeats: [{ from: 0, to: 1 }],
      staves: {
        RH: {
          clef: "treble",
          measures: [oneMeasure("a"), oneMeasure("b"), oneMeasure("c")],
        },
      },
    };

    const plan = planForScore(score, "RH");
    expect(plan.slots.map((slot) => slot.startBeat)).toEqual([0, 4, 8, 12, 16]);
    expect(plan.measureStarts).toEqual([0, 4, 8, 12, 16]);
    // 第二遍仍是第 1、2 小节，而不是被下标带成第 3、4 小节。
    expect(plan.measureNumbers).toEqual([1, 2, 1, 2, 3]);
    expect(plan.totalBeats).toBe(20);
    expect(barOfBeat(plan, 8)).toEqual({ bar: 1, inBar: 1 });
    expect(barOfBeat(plan, 12)).toEqual({ bar: 2, inBar: 1 });
  });
});

describe("gradeRhythm with chords", () => {
  const plan = planForScore(scoreOf());
  const countIn = countInFor(plan);
  const chordBeats = [C3, C4];

  it("needs every note of the position before it counts as played", () => {
    const only = gradeRhythm(plan, [{ midi: C4, atMs: atBeatMs(plan, 0, countIn) }], START, countIn);
    expect(only.steps[0]?.pitchMatched).toBe(false);
    expect(only.onCount).toBe(0);

    const both = gradeRhythm(
      plan,
      chordBeats.map((midi) => ({ midi, atMs: atBeatMs(plan, 0, countIn), slotIndex: 0 })),
      START,
      countIn,
    );
    expect(both.steps[0]?.pitchMatched).toBe(true);
    expect(both.steps[0]?.quality).toBe("on");
  });

  it("times the position by the first note of the chord", () => {
    // 和弦摊开半拍按：起手时刻算第 0 拍的那个音，不能按最后一个音算。
    const result = gradeRhythm(
      plan,
      [
        { midi: C3, atMs: atBeatMs(plan, 0, countIn) },
        { midi: C4, atMs: atBeatMs(plan, 0.5, countIn) },
      ],
      START,
      countIn,
    );
    expect(result.steps[0]?.offsetBeat).toBeCloseTo(0, 6);
    expect(result.steps[0]?.quality).toBe("on");
  });

  it("rejects a position with an extra note that does not belong to it", () => {
    const result = gradeRhythm(
      plan,
      [
        ...chordBeats.map((midi) => ({ midi, atMs: atBeatMs(plan, 0, countIn) })),
        { midi: F4, atMs: atBeatMs(plan, 0, countIn) },
      ],
      START,
      countIn,
    );
    expect(result.steps[0]?.pitchMatched).toBe(false);
  });
});

describe("gradeRhythm note length", () => {
  /** 一条全音符 + 一个四分音符的长旋律：时值差别一眼看得出。 */
  const longPlan = planForMelody({
    ...MELODY,
    melody: [
      { pitch: "C4", beats: 4 },
      { pitch: "D4", beats: 1 },
    ],
  });
  const longCountIn = countInFor(longPlan);

  const held = (midi: number, beat: number, beats: number): RhythmHit => ({
    midi,
    atMs: atBeatMs(longPlan, beat, longCountIn),
    offMs: atBeatMs(longPlan, beat + beats, longCountIn),
  });

  it("counts a note held to its full value as held", () => {
    const result = gradeRhythm(
      longPlan,
      [held(C4, 0, 4), held(D4, 4, 1)],
      START,
      longCountIn,
    );

    expect(result.steps[0]?.heldBeats).toBeCloseTo(4, 6);
    expect(result.steps[0]?.length).toBe("held");
    expect(result.steps[1]?.length).toBe("held");
    expect(result.heldCount).toBe(2);
    expect(result.shortCount).toBe(0);
  });

  it("flags a whole note tapped out as a quarter note", () => {
    const result = gradeRhythm(longPlan, [held(C4, 0, 1), held(D4, 4, 1)], START, longCountIn);

    expect(result.steps[0]?.length).toBe("short");
    expect(result.shortCount).toBe(1);
    // 音长不影响对错：音高和拍点都对，这一段仍然是满分。
    expect(result.accuracy).toBe(1);
    expect(result.onCount).toBe(2);
  });

  it("treats a note just past the held ratio as long enough", () => {
    // 全音符按 2.5 拍（62.5%）松手：踩在六成线上，算按住。
    const result = gradeRhythm(longPlan, [held(C4, 0, 2.5)], START, longCountIn);
    expect(result.steps[0]?.length).toBe("held");

    // 2 拍（50%）松手：明显弹短。
    const short = gradeRhythm(longPlan, [held(C4, 0, 2)], START, longCountIn);
    expect(short.steps[0]?.length).toBe("short");
  });

  it("says unknown when the device never sends a note-off", () => {
    const result = gradeRhythm(longPlan, [{ midi: C4, atMs: atBeatMs(longPlan, 0, longCountIn) }], START, longCountIn);

    expect(result.steps[0]?.heldBeats).toBeNull();
    expect(result.steps[0]?.length).toBe("unknown");
    expect(result.heldCount).toBe(0);
    expect(result.shortCount).toBe(0);
  });

  it("takes the earliest release of a chord: one note dropped breaks the sound", () => {
    const chord: Score = {
      id: "chord-length",
      mode: "repertoire",
      level: 2,
      keySignature: "C",
      hands: ["RH"],
      meter: { beats: 4, beatValue: 4 },
      bpm: 80,
      staves: {
        RH: {
          clef: "treble",
          measures: [
            {
              notes: [
                {
                  id: "c1",
                  duration: "w",
                  pitches: [
                    { step: "C", octave: 4, alteration: 0 },
                    { step: "E", octave: 4, alteration: 0 },
                  ],
                },
              ],
            },
          ],
        },
      },
    };
    const plan = planForScore(chord);
    const countIn = countInFor(plan);
    const on = atBeatMs(plan, 0, countIn);
    // C4 按满四拍，E4 一拍就抬：和声在第一拍就断了。
    const result = gradeRhythm(
      plan,
      [
        { midi: C4, atMs: on, slotIndex: 0 },
        { midi: E4, atMs: on, offMs: on + msPerBeat(plan.bpm), slotIndex: 0 },
      ],
      START,
      countIn,
    );

    expect(result.steps[0]?.heldBeats).toBeCloseTo(1, 6);
    expect(result.steps[0]?.length).toBe("short");
  });

  it("keeps a short right-hand note out of trouble when the bass holds the bar", () => {
    // 同拍上 C4 只该按一拍、C3 铺满四拍：两个音都按对了才算按住，
    // 不能拿最长的那一个要求所有音（这是 targetBeats 存在的理由）。
    const chord: Score = {
      id: "mixed-lengths",
      mode: "repertoire",
      level: 2,
      keySignature: "C",
      hands: ["RH", "LH"],
      meter: { beats: 4, beatValue: 4 },
      bpm: 80,
      staves: {
        RH: {
          clef: "treble",
          measures: [
            {
              notes: [
                { id: "r1", duration: "q", pitches: [{ step: "C", octave: 4, alteration: 0 }] },
              ],
            },
          ],
        },
        LH: {
          clef: "bass",
          measures: [
            {
              notes: [
                { id: "l1", duration: "w", pitches: [{ step: "C", octave: 3, alteration: 0 }] },
              ],
            },
          ],
        },
      },
    };
    const plan = planForScore(chord);
    const countIn = countInFor(plan);
    const on = atBeatMs(plan, 0, countIn);
    const result = gradeRhythm(
      plan,
      [
        { midi: C4, atMs: on, offMs: on + msPerBeat(plan.bpm), slotIndex: 0 },
        { midi: C3, atMs: on, offMs: on + msPerBeat(plan.bpm) * 4, slotIndex: 0 },
      ],
      START,
      countIn,
    );

    expect(result.steps[0]?.length).toBe("held");
    expect(result.shortCount).toBe(0);
  });

  it("mentions short notes in the summary without folding them into the score", () => {
    const result = gradeRhythm(longPlan, [held(C4, 0, 1), held(D4, 4, 1)], START, longCountIn);

    expect(rhythmSummary(result)).toContain("1 个音按得太短");
    // 节拍准的结论照旧：音长不改变对错的百分比。
    expect(rhythmSummary(result)).toContain("音高与节拍都对了 2 / 2 音（100%）");
  });
});

describe("beatText", () => {
  it("names the common fractions the way players say them", () => {
    expect(beatText(0.25)).toBe("四分之一拍");
    expect(beatText(0.5)).toBe("半拍");
    expect(beatText(0.75)).toBe("四分之三拍");
    expect(beatText(1)).toBe("1 拍");
    expect(beatText(2)).toBe("2 拍");
  });

  it("describes both directions", () => {
    expect(offsetText(0)).toBe("正好在拍上");
    expect(offsetText(0.5)).toBe("晚了半拍");
    expect(offsetText(-0.25)).toBe("早了四分之一拍");
  });
});
