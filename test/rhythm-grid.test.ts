import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import type { RhythmPlan } from "../src/practice/rhythm";
import RhythmGrid from "../src/ui/RhythmGrid.vue";

/**
 * 节拍网格的展示契约。
 *
 * 重点是「多音槽位」：轨道上格子窄，只写得下主音 + N；要按哪几个键得另外
 * 摊开讲，而且必须带八度——四音和弦里 C4 与 C5 音级相同，不写八度等于没说。
 */

/** 第 0 拍：左手 C3 与右手 C4/E4/G4 一起按（四音，含八度重复根音）；第 4 拍一个单音。 */
const PLAN: RhythmPlan = {
  slots: [
    { midis: [48, 60, 64, 67], startBeat: 0, beats: 4 },
    { midis: [62], startBeat: 4, beats: 4 },
  ],
  bpm: 60,
  beatsPerBar: 4,
  totalBeats: 8,
};

function grid(props: Record<string, unknown> = {}) {
  return mount(RhythmGrid, { props: { plan: PLAN, beat: 0, prefix: "g", ...props } });
}

describe("RhythmGrid 多音槽位", () => {
  it("keeps the track compact: highest note plus a +N count", () => {
    const wrapper = grid();
    const first = wrapper.findAll(".note")[0]!;
    // 轨道上一格只写主音（G4 是这四个音里最高的）
    expect(first.get(".name").text()).toBe("G+3");
  });

  it("does not expand anything when the caller gives no active slot", () => {
    // MelodyFollow 与复盘态不传 activeSlot：只画轨道，不插一行提示
    expect(grid().find("[data-test=g-chord-hint]").exists()).toBe(false);
  });

  it("spells out every key of the current chord, with octaves", () => {
    const wrapper = grid({ activeSlot: 0, remaining: [48, 60, 64, 67] });
    const hint = wrapper.get("[data-test=g-chord-hint]");

    expect(hint.findAll(".key").map((key) => key.text())).toEqual(["C3", "C4", "E4", "G4"]);
    expect(hint.get(".lead").text()).toBe("一起按");
    // 一个都没按下时不该有已完成标记
    expect(hint.findAll(".key.done")).toHaveLength(0);
  });

  it("ticks off the keys that are already down", () => {
    // 左手 C3 与右手 C4 已经按下，还差 E4 与 G4
    const wrapper = grid({ activeSlot: 0, remaining: [64, 67] });
    const hint = wrapper.get("[data-test=g-chord-hint]");

    expect(hint.get(".lead").text()).toBe("还差");
    expect(hint.findAll(".key.done").map((key) => key.text())).toEqual(["C3", "C4"]);
  });

  it("shows no hint for a single-note slot", () => {
    expect(grid({ activeSlot: 1, remaining: [62] }).find("[data-test=g-chord-hint]").exists()).toBe(
      false,
    );
  });

  it("hides the hint once the run is over", () => {
    // 结束时 beat 会被推到 totalBeats，展开条不该留在页面上
    expect(
      grid({ activeSlot: 0, remaining: [48, 60], finished: true, beat: PLAN.totalBeats }).find(
        "[data-test=g-chord-hint]",
      ).exists(),
    ).toBe(false);
  });
});
