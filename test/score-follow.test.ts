import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Score } from "../src/domain/types";
import type { MidiNote } from "../src/midi/types";
import ScoreFollow from "../src/ui/ScoreFollow.vue";

/**
 * 曲库跟弹的行为契约。
 *
 * 时间全用假时钟：`startedAt` 由 `performance.now()` 定格在 0，之后每个音带
 * 自己的时间戳推进，所以断言可以精确到「这一拍是不是准时」。
 */

/** 右手 C4（四分）、D4（二分）；左手 C3 全音符压在第 0 拍。 */
const SCORE: Score = {
  id: "follow-score",
  mode: "repertoire",
  level: 2,
  meter: { beats: 4, beatValue: 4 },
  keySignature: "C",
  hands: ["RH", "LH"],
  bpm: 80,
  staves: {
    RH: {
      clef: "treble",
      measures: [
        {
          notes: [
            { id: "r1", pitches: [{ step: "C", octave: 4, alteration: 0 }], duration: "q" },
            { id: "r2", pitches: [{ step: "D", octave: 4, alteration: 0 }], duration: "h" },
          ],
        },
      ],
    },
    LH: {
      clef: "bass",
      measures: [
        {
          notes: [{ id: "l1", pitches: [{ step: "C", octave: 3, alteration: 0 }], duration: "w" }],
        },
      ],
    },
  },
};

const C3 = 48;
const C4 = 60;
const D4 = 62;
const BEAT_MS = 750; // 80 bpm
const COUNT_IN = 4;

/** 第几拍 → 绝对毫秒（预备拍占满一小节）。 */
const at = (beat: number) => (beat + COUNT_IN) * BEAT_MS;

let seq = 0;

function note(midi: number, timeMs: number, kind: MidiNote["kind"] = "on"): MidiNote {
  return { midi, timeMs, kind, source: "screen" };
}

const mounted: Array<{ unmount: () => void }> = [];

async function setup(score: Score = SCORE) {
  let clock = 0;
  vi.spyOn(performance, "now").mockImplementation(() => clock);

  const wrapper = mount(ScoreFollow, { props: { score, prefix: "t" } });
  mounted.push(wrapper);

  await wrapper.get("[data-test=t-start]").trigger("click");
  await flushPromises();

  return {
    wrapper,
    /** 推进假时钟（只影响网格游标与跳拍，判定用音符自己的时间戳）。 */
    tick(value: number) {
      clock = value;
    },
    async press(midi: number, timeMs: number) {
      seq += 1;
      await wrapper.setProps({ pulse: { seq, note: note(midi, timeMs) } });
    },
    /** 抬手：只补时值，不推进进度。 */
    async release(midi: number, timeMs: number) {
      seq += 1;
      await wrapper.setProps({ pulse: { seq, note: note(midi, timeMs, "off") } });
    },
  };
}

/** 等真实的渲染帧跑几轮（网格游标靠 rAF 推进）。 */
const nextFrames = () => new Promise((resolve) => setTimeout(resolve, 60));

afterEach(() => {
  mounted.splice(0).forEach((wrapper) => wrapper.unmount());
  vi.restoreAllMocks();
});

describe("ScoreFollow", () => {
  it("waits through the count-in bar before accepting notes", async () => {
    const { wrapper, press } = await setup();

    expect(wrapper.get("[data-test=t-status]").text()).toContain("预备");

    // 预备拍里的按键既不计分也不推进位置。
    await press(C4, at(0) - BEAT_MS);
    expect(wrapper.get("[data-test=t-status]").text()).toContain("预备");

    // 到点上再按同一个音才生效。
    await press(C4, at(0));
    expect(wrapper.get("[data-test=t-status]").text()).toContain("1 / 2");
  });

  it("labels a two-hand position with one note plus how many more keys", async () => {
    const { wrapper } = await setup();

    const labels = wrapper
      .findAll("[data-test=t-grid] .note")
      .map((note) => note.text().replace(/\s+/g, ""));

    // 第 0 拍是右手 C4 + 左手 C3：主音写最高的那一声，另加一个键。
    expect(labels).toEqual(["C+1", "D"]);
  });

  it("widens the beat lane for sixteenth notes so note names stay readable", async () => {
    // 一拍四个十六分：仍按 44px/拍画，相邻音名只隔 11px，会和和弦的「+1」叠住。
    const dense: Score = {
      ...SCORE,
      id: "follow-dense",
      hands: ["RH"],
      staves: {
        RH: {
          clef: "treble",
          measures: [
            {
              notes: [
                { id: "dense-0", pitches: [{ step: "C", octave: 4, alteration: 0 }], duration: "16" },
                { id: "dense-1", pitches: [{ step: "D", octave: 4, alteration: 0 }], duration: "16" },
                { id: "dense-2", pitches: [{ step: "E", octave: 4, alteration: 0 }], duration: "16" },
                { id: "dense-3", pitches: [{ step: "F", octave: 4, alteration: 0 }], duration: "16" },
              ],
            },
          ],
        },
      },
    };

    const { wrapper } = await setup(dense);
    const grid = wrapper.get("[data-test=t-grid]").element as HTMLElement;

    // 最小间隔 0.25 拍，按 24px/槽位算出来是 96px/拍。
    expect(grid.style.getPropertyValue("--beat-w")).toBe("96px");
    expect(wrapper.findAll("[data-test=t-grid] .note")).toHaveLength(4);
  });

  it("asks for both hands on the same beat instead of advancing on one note", async () => {
    const { wrapper, press } = await setup();

    await press(C4, at(0));
    expect(wrapper.get("[data-test=t-status]").text()).toContain("1 / 2");

    await press(C3, at(0));
    expect(wrapper.get("[data-test=t-status]").text()).toContain("2 / 2");
  });

  it("keeps the position open when the note does not belong to it", async () => {
    const { wrapper, press } = await setup();

    await press(65, at(0)); // F4 不在这段里
    expect(wrapper.get("[data-test=t-status]").text()).toContain("1 / 2");

    await press(C4, at(0));
    await press(C3, at(0));
    await press(D4, at(1));

    const summary = wrapper.get("[data-test=t-summary]").text();
    expect(summary).toContain("2 / 2");
    // 多弹的音只提示、不计分，结论里要说一声。
    expect(summary).toContain("多弹了 1 个音");
  });

  it("says when the take was late as a whole", async () => {
    const { wrapper, press } = await setup();

    await press(C4, at(0) + BEAT_MS * 0.5);
    await press(C3, at(0) + BEAT_MS * 0.5);
    await press(D4, at(1) + BEAT_MS * 0.5);

    expect(wrapper.get("[data-test=t-summary]").text()).toContain("整体偏晚");
    // 逐音偏差只补「哪一拍」，不重复网格上已经画出来的东西。
    expect(wrapper.get("[data-test=t-detail]").text()).toContain("第 1 小节第 1 拍");
  });

  it("finishes once the last position is played", async () => {
    const { wrapper, press } = await setup();

    await press(C4, at(0));
    await press(C3, at(0));
    await press(D4, at(1));

    expect(wrapper.get("[data-test=t-status]").text()).toBe("跟完了");
    expect(wrapper.get("[data-test=t-summary]").text()).toContain("2 / 2");
    expect(wrapper.emitted("done")?.[0]?.[0]).toEqual({ onCount: 2, total: 2 });
  });

  it("moves on when the clock has already passed a position", async () => {
    const { wrapper, tick } = await setup();

    // 一个音都没弹，时钟走到第 4 拍：整段都该按漏音收尾，而不是卡在第一拍。
    tick(at(4));
    await nextFrames();

    expect(wrapper.get("[data-test=t-status]").text()).toBe("跟完了");
    expect(wrapper.get("[data-test=t-summary]").text()).toContain("还有 2 个音没弹到");
  });

  it("drops the take when the segment changes", async () => {
    const { wrapper, press } = await setup();
    await press(C4, at(0));

    await wrapper.setProps({ hand: "RH" });
    await flushPromises();

    expect(wrapper.get("[data-test=t-status]").text()).toContain("共 2 个位置");
    expect(wrapper.find("[data-test=t-grid]").exists()).toBe(false);
  });
});

/**
 * 音长是附加观察：抬手时刻补到那一击上，结论里单独说「按得太短」，
 * 但不折算进对错——见 `MIN_HELD_RATIO` 的注释。
 */
describe("ScoreFollow note length", () => {
  it("says nothing about length when every note is held to its value", async () => {
    const { wrapper, press, release } = await setup();

    await press(C4, at(0));
    await press(C3, at(0));
    await release(C4, at(1)); // 四分音符按满一拍
    await release(C3, at(4)); // 全音符按满四拍
    await press(D4, at(1));
    await release(D4, at(3)); // 二分音符按满两拍

    const summary = wrapper.get("[data-test=t-summary]").text();
    expect(summary).toContain("2 / 2");
    expect(summary).not.toContain("按得太短");
  });

  it("points out a whole note tapped out early without changing the score", async () => {
    const { wrapper, press, release } = await setup();

    await press(C4, at(0));
    await press(C3, at(0));
    await release(C4, at(1));
    await release(C3, at(1)); // 全音符只按了一拍就抬
    await press(D4, at(1));
    await release(D4, at(3));

    const summary = wrapper.get("[data-test=t-summary]").text();
    // 对错不变：音高和拍点都准。
    expect(summary).toContain("音高与节拍都对了 2 / 2 音（100%）");
    expect(summary).toContain("1 个音按得太短");
  });

  it("keeps the release out of the progress and the stray count", async () => {
    const { wrapper, press, release } = await setup();

    await press(C4, at(0));
    await release(C4, at(1));
    // 抬手不该让位置前进，也不该算成「多弹了一个音」。
    expect(wrapper.get("[data-test=t-status]").text()).toContain("1 / 2");

    await press(C3, at(0));
    await release(C3, at(4));
    await press(D4, at(1));
    await release(D4, at(3));

    expect(wrapper.get("[data-test=t-status]").text()).toBe("跟完了");
    expect(wrapper.get("[data-test=t-summary]").text()).not.toContain("多弹");
  });

  it("pairs the release with the latest press of the same note", async () => {
    // 右手 C4 出现两次（第 0 拍四分、第 1 拍二分）时，抬手要配到后按的那一次。
    const repeated: Score = {
      ...SCORE,
      id: "follow-score-repeat",
      staves: {
        ...SCORE.staves,
        RH: {
          clef: "treble",
          measures: [
            {
              notes: [
                { id: "r1", pitches: [{ step: "C", octave: 4, alteration: 0 }], duration: "q" },
                { id: "r2", pitches: [{ step: "C", octave: 4, alteration: 0 }], duration: "w" },
              ],
            },
          ],
        },
      },
    };
    const { wrapper, press, release } = await setup(repeated);

    await press(C4, at(0));
    await press(C3, at(0));
    await release(C4, at(1)); // 第一个 C4 按满一拍
    await release(C3, at(4));
    await press(C4, at(1)); // 第二个 C4 是全音符
    await release(C4, at(5)); // 也按满四拍

    const summary = wrapper.get("[data-test=t-summary]").text();
    expect(summary).toContain("2 / 2");
    expect(summary).not.toContain("按得太短");
  });
});
