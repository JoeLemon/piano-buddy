import { describe, expect, it } from "vitest";
import { isAllowed } from "../src/domain/allowed";
import { scoreEvents } from "../src/domain/scoreEvents";
import { sliceScore } from "../src/domain/sliceScore";
import { tieErrors } from "../src/domain/tie";
import { flattenScore } from "../src/domain/timeline";
import type { Duration, NoteEvent, Score, Step, TieMark } from "../src/domain/types";
import { planForScore } from "../src/practice/rhythm";
import { motionDurationSeconds, scoreToMotion, toDemoEvents } from "../src/repertoire/motion";
import { validateSongContent } from "../src/repertoire/contentValidation";

function note(
  id: string,
  step: Step,
  octave: number,
  duration: Duration,
  tie?: TieMark,
): NoteEvent {
  return {
    id,
    pitches: [{ step, octave, alteration: 0 }],
    duration,
    fingers: [1],
    ...(tie ? { tie } : {}),
  };
}

/**
 * 4/4、C 大调、单右手：
 *
 * 第 1 小节 C4 C4 C4 C4(tie→)　第 2 小节 C4(→stop) D4 E4 F4
 *
 * 所以第 1 小节最后一拍与第 2 小节第一拍是同一次击键、按住 2 拍。
 */
function tiedScore(overrides: Partial<Record<"first" | "second", NoteEvent[]>> = {}): Score {
  const first =
    overrides.first ??
    [
      note("a1", "C", 4, "q"),
      note("a2", "C", 4, "q"),
      note("a3", "C", 4, "q"),
      note("a4", "C", 4, "q", "start"),
    ];
  const second =
    overrides.second ??
    [
      note("b1", "C", 4, "q", "stop"),
      note("b2", "D", 4, "q"),
      note("b3", "E", 4, "q"),
      note("b4", "F", 4, "q"),
    ];
  return {
    id: "score.tie.test",
    mode: "repertoire",
    level: 2,
    meter: { beats: 4, beatValue: 4 },
    keySignature: "C",
    hands: ["RH"],
    bpm: 80,
    staves: { RH: { clef: "treble", measures: [{ notes: first }, { notes: second }] } },
  };
}

describe("连音线（tie）", () => {
  it("scoreEvents 把跨小节的两段并成一次按键，时值累加", () => {
    const events = scoreEvents(tiedScore());
    // 第 1 小节 4 个音 + 第 2 小节 3 个（第一个被并掉）。
    expect(events).toHaveLength(7);
    const tied = events[3];
    expect(tied.beat).toBe(3);
    expect(tied.id).toBe("a4");
    expect(tied.midis).toEqual([60]);
    expect(tied.beats).toBe(2);
    // 谱面时值仍是四分音符：位置在谱上没变，变的是要按住多久。
    expect(tied.duration).toBe("q");
  });

  it("flattenScore 同样合并，视奏不会在小节线处要求抬手", () => {
    const notes = flattenScore(tiedScore());
    expect(notes).toHaveLength(7);
    expect(notes[3].beat).toBe(3);
    expect(notes[3].beats).toBe(2);
  });

  it("中间隔了别的音就不再合并（那是断掉的记谱）", () => {
    const score = tiedScore({
      second: [
        note("b1", "D", 4, "q"),
        note("b2", "C", 4, "q", "stop"),
        note("b3", "E", 4, "q"),
        note("b4", "F", 4, "q"),
      ],
    });
    // 音高对不上：不能并到上一个 C4，只能当成独立的音。
    expect(scoreEvents(score)).toHaveLength(8);
    expect(flattenScore(score)).toHaveLength(8);
  });

  it("跟弹时间轴上是一个槽位、两拍", () => {
    const plan = planForScore(tiedScore(), "RH");
    const slot = plan.slots.find((item) => item.startBeat === 3);
    expect(slot?.midis).toEqual([60]);
    expect(slot?.beats).toBe(2);
    expect(slot?.targetBeats?.[60]).toBe(2);
    // 合并掉的那一拍不该再出现一个槽位。
    expect(plan.slots.some((item) => item.startBeat === 4)).toBe(false);
  });

  it("导出 demo 时合成一条长音，不会弹两次", () => {
    const motion = scoreToMotion(tiedScore());
    const tied = motion.notes.filter((item) => item.midi === 60);
    // MotionNote 保持谱面的逐段表示，只在第三段上标 tie。
    expect(tied).toHaveLength(5);
    expect(tied[3].onsetBeats).toBe(3);
    expect(tied[3].durationBeats).toBe(1);
    expect(tied[3].tie).toBe(true);
    expect(tied[4].tie).toBe(false);

    // demo 只有 start/end，合成一条才不会重复击键。
    const events = toDemoEvents(motion);
    const c4 = events.filter((item) => item.midi === 60);
    expect(c4).toHaveLength(4);
    expect(c4[3].start).toBeCloseTo((3 * 60) / 80, 2);
    expect(c4[3].end - c4[3].start).toBeCloseTo((2 * 60) / 80, 2);
    expect(motionDurationSeconds(motion)).toBeCloseTo((8 * 60) / 80, 5);
  });

  it("isAllowed 接受自洽的跨小节连线", () => {
    expect(isAllowed(tiedScore())).toBe(true);
  });

  it("isAllowed 拒绝接不上的半截线", () => {
    const dangling = tiedScore({
      second: [
        note("b1", "D", 4, "q"),
        note("b2", "E", 4, "q"),
        note("b3", "F", 4, "q"),
        note("b4", "G", 4, "q"),
      ],
    });
    // 第 1 小节末尾那条 start 没有接续。
    expect(isAllowed(dangling)).toBe(false);
  });

  it("isAllowed 拒绝没有起点的 stop", () => {
    const orphan = tiedScore({
      first: [
        note("a1", "C", 4, "q"),
        note("a2", "C", 4, "q"),
        note("a3", "C", 4, "q"),
        note("a4", "C", 4, "q"),
      ],
    });
    expect(isAllowed(orphan)).toBe(false);
  });

  it("isAllowed 拒绝音高对不上的承接", () => {
    const mismatched = tiedScore({
      second: [
        note("b1", "E", 4, "q", "stop"),
        note("b2", "D", 4, "q"),
        note("b3", "C", 4, "q"),
        note("b4", "C", 4, "q"),
      ],
    });
    expect(isAllowed(mismatched)).toBe(false);
  });

  it("切片切断连线时清掉悬空的一端", () => {
    const score = tiedScore();
    // 只保留第 2 小节：首音的 stop 已经没有起点。
    const second = sliceScore(score, 1, 2, "BOTH");
    expect(second.staves.RH!.measures[0].notes[0].tie).toBeUndefined();

    // 只保留第 1 小节：末尾的 start 后面没东西可接。
    const first = sliceScore(score, 0, 1, "BOTH");
    const notes = first.staves.RH!.measures[0].notes;
    expect(notes[notes.length - 1].tie).toBeUndefined();

    // 整段都保留时连线不动。
    const whole = sliceScore(score, 0, 2, "BOTH");
    expect(whole.staves.RH!.measures[0].notes[3].tie).toBe("start");
    expect(whole.staves.RH!.measures[1].notes[0].tie).toBe("stop");
  });

  it("切片后悬空的一律不剩，isAllowed 仍然通过", () => {
    const second = sliceScore(tiedScore(), 1, 2, "BOTH");
    expect(isAllowed(second)).toBe(true);
  });

  it("tieErrors 说清楚是哪一处断了", () => {
    expect(tieErrors(tiedScore())).toEqual([]);

    const dangling = tiedScore({
      second: [
        note("b1", "D", 4, "q"),
        note("b2", "C", 4, "q", "stop"),
        note("b3", "E", 4, "q"),
        note("b4", "F", 4, "q"),
      ],
    });
    const messages = tieErrors(dangling);
    // 第 1 小节末尾的 start 没有被接上，第 2 小节的 stop 也找不到起点。
    expect(messages.some((text) => text.includes("没有接续"))).toBe(true);
    expect(messages.some((text) => text.includes("没有起点"))).toBe(true);
  });

  it("内容 QA 会把断掉的连音线算成错误", () => {
    const manifest = {
      schemaVersion: 1 as const,
      id: "song.tie.test",
      type: "song" as const,
      name: "连音线测试",
      version: "1.0.0",
      minAppVersion: "0.1.0",
      songId: "tie.test",
      arrangementId: "tie.test.l2",
      songTitle: "连音线测试",
      composer: "test",
      difficulty: { level: 2, bpm: 80 },
      skillDeps: [],
      assets: ["content/score.json"],
    };
    const dangling = tiedScore({
      second: [
        note("b1", "D", 4, "q"),
        note("b2", "E", 4, "q"),
        note("b3", "F", 4, "q"),
        note("b4", "G", 4, "q"),
      ],
    });
    const result = validateSongContent(dangling, manifest);
    expect(result.ok).toBe(false);
    expect(result.errors.some((text) => text.includes("连音线"))).toBe(true);
  });
});
