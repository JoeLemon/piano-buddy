import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MidiNote } from "../src/midi/types";
import type { PlaybackQuestion } from "../src/practice/melodyTypes";
import MelodyFollow from "../src/ui/MelodyFollow.vue";

/**
 * 跟弹的行为契约。
 *
 * 时间全用假时钟：`startedAt` 由 `performance.now()` 定格在 0，之后每个音
 * 带自己的时间戳推进，所以断言可以精确到「这个音晚了半拍」。
 */

const MELODY: PlaybackQuestion = {
  id: "follow-1",
  key: "G major",
  meter: "4/4",
  tonic: ["G4", "B4", "D5", "G5"],
  melody: [
    { pitch: "C4", beats: 1 },
    { pitch: "D4", beats: 1 },
  ],
};

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

async function setup() {
  let clock = 0;
  vi.spyOn(performance, "now").mockImplementation(() => clock);

  const wrapper = mount(MelodyFollow, { props: { melody: MELODY, prefix: "t" } });
  mounted.push(wrapper);

  await wrapper.get("[data-test=t-follow]").trigger("click");
  await flushPromises();

  return {
    wrapper,
    /** 推进假时钟（只影响网格游标，判定用音符自己的时间戳）。 */
    tick(value: number) {
      clock = value;
    },
    async press(midi: number, timeMs: number) {
      seq += 1;
      await wrapper.setProps({ pulse: { seq, note: note(midi, timeMs) } });
    },
    /** 抬手：只补时值，不影响进度。 */
    async release(midi: number, timeMs: number) {
      seq += 1;
      await wrapper.setProps({ pulse: { seq, note: note(midi, timeMs, "off") } });
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("MelodyFollow", () => {
  it("starts with a count-in before accepting any note", async () => {
    const { wrapper } = await setup();

    expect(wrapper.get("[data-test=t-follow-status]").text()).toContain("预备");
    expect(wrapper.find("[data-test=t-countdown]").exists()).toBe(true);
    // 开始之后不能再点一次，避免两条时钟并行。
    expect(wrapper.get("[data-test=t-follow]").attributes("disabled")).toBeDefined();
  });

  it("ignores notes played during the count-in", async () => {
    const { wrapper, press } = await setup();

    await press(C4, 1500); // 还在预备拍里

    expect(wrapper.find("[data-test=t-mark-0]").exists()).toBe(false);
    // 刚才那一下不算数：正式进来后仍然从第 1 个音算起。
    await press(C4, at(0));
    expect(wrapper.get("[data-test=t-follow-status]").text()).toContain("1 / 2");
  });

  it("accepts a note that lands on the beat and marks it green", async () => {
    const { wrapper, press } = await setup();

    await press(C4, at(0));

    expect(wrapper.get("[data-test=t-follow-status]").text()).toContain("1 / 2");
    expect(wrapper.get("[data-test=t-mark-0]").classes()).toContain("on");
  });

  it("records a late note as off but still moves on", async () => {
    const { wrapper, press } = await setup();

    await press(C4, at(0) + BEAT_MS * 0.5);

    expect(wrapper.get("[data-test=t-follow-status]").text()).toContain("1 / 2");
    expect(wrapper.get("[data-test=t-mark-0]").classes()).toContain("off");
  });

  it("does not advance on a wrong pitch and says so", async () => {
    const { wrapper, press } = await setup();

    await press(C4 + 1, at(0)); // C#4，不是 C4

    expect(wrapper.get("[data-test=t-follow-status]").text()).toContain("0 / 2");
    expect(wrapper.text()).toContain("这个音不对");
    expect(wrapper.find("[data-test=t-mark-0]").exists()).toBe(false);
  });

  it("finishes when the last note is played and summarises the take", async () => {
    const { wrapper, press } = await setup();

    await press(C4, at(0));
    await press(D4, at(1));

    expect(wrapper.get("[data-test=t-follow-status]").text()).toBe("跟完了");
    const summary = wrapper.get("[data-test=t-follow-summary]").text();
    expect(summary).toContain("2 / 2");
    expect(summary).toContain("整体没有系统性偏移");
    // 结束后重新可以开始。
    expect(wrapper.get("[data-test=t-follow]").attributes("disabled")).toBeUndefined();
  });

  it("reports a systematic late take", async () => {
    const { wrapper, press } = await setup();

    await press(C4, at(0) + BEAT_MS * 0.5);
    await press(D4, at(1) + BEAT_MS * 0.5);

    expect(wrapper.get("[data-test=t-follow-summary]").text()).toContain("整体偏晚");
  });

  it("marks the notes it never reached once stopped", async () => {
    const { wrapper, press } = await setup();

    await press(C4, at(0));
    await wrapper.get("[data-test=t-follow-stop]").trigger("click");

    // 弹过的位置有落点，没弹到的标空圈；两者一眼能分开。
    expect(wrapper.find("[data-test=t-mark-0]").exists()).toBe(true);
    expect(wrapper.find("[data-test=t-missed-0]").exists()).toBe(false);
    expect(wrapper.find("[data-test=t-missed-1]").exists()).toBe(true);
  });

  it("keeps the notes it already matched when restarted", async () => {
    const { wrapper, press } = await setup();

    await press(C4, at(0));
    await wrapper.get("[data-test=t-follow-stop]").trigger("click");
    await wrapper.get("[data-test=t-follow]").trigger("click");
    await flushPromises();

    expect(wrapper.get("[data-test=t-follow-status]").text()).toContain("预备");
    expect(wrapper.find("[data-test=t-mark-0]").exists()).toBe(false);
  });

  it("reports a tapped-out note as short without changing the verdict", async () => {
    const { wrapper, press, release } = await setup();

    await press(C4, at(0));
    await release(C4, at(0) + BEAT_MS * 0.4); // 四分音符只按了四成就抬
    await press(D4, at(1));
    await release(D4, at(2));

    const summary = wrapper.get("[data-test=t-follow-summary]").text();
    // 音长是附加观察：对错仍按音高与拍点算。
    expect(summary).toContain("音高与节拍都对了 2 / 2 音（100%）");
    expect(summary).toContain("1 个音按得太短");
  });

  it("says nothing about length when the notes are held to their value", async () => {
    const { wrapper, press, release } = await setup();

    await press(C4, at(0));
    await release(C4, at(1));
    await press(D4, at(1));
    await release(D4, at(2));

    expect(wrapper.get("[data-test=t-follow-summary]").text()).not.toContain("按得太短");
  });
});
